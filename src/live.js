import { GoalApiError, AuthenticationError } from './errors.js';

/**
 * Live match updates over WebSocket. Reconnects with backoff and re-sends subscriptions.
 *
 * The connection authenticates twice, because two services are involved:
 *
 *   1. The gateway authorises the HTTP upgrade. Node sends `Authorization: Bearer <key>`;
 *      browsers cannot set headers, so they pass `?wsToken=` from POST /ws/token instead.
 *   2. websocket-service then requires `{type: "auth", ...}` as the very first frame, and
 *      closes with 4001 if anything else arrives first.
 *
 * `connect()` resolves on `auth_success`, not on socket open, so a resolved promise means
 * the connection is actually usable.
 */
export class LiveClient {
    constructor(transport, {
        WebSocket: WebSocketImpl,
        url,
        autoReconnect = true,
        maxReconnectAttempts = Infinity,
        pingIntervalMs = 30_000,
        authTimeoutMs = 10_000,
    } = {}) {
        this._t = transport;
        this._WebSocket = WebSocketImpl ?? globalThis.WebSocket;
        this._url = url ?? deriveWsUrl(transport.baseUrl);
        this._autoReconnect = autoReconnect;
        this._maxReconnectAttempts = maxReconnectAttempts;
        this._pingIntervalMs = pingIntervalMs;
        this._authTimeoutMs = authTimeoutMs;

        this._ws = null;
        this._listeners = new Map();
        this._subscriptions = new Set();
        this._attempts = 0;
        this._pingTimer = null;
        this._closedByUser = false;
        this._authenticated = false;
    }

    /**
     * Events: auth_success, match_update, status, pong, subscribe_response,
     * unsubscribe_response, get_subscriptions_response, server_shutdown, error, plus the
     * SDK's own open/close, and '*' for everything.
     */
    on(event, handler) {
        if (!this._listeners.has(event)) this._listeners.set(event, new Set());
        this._listeners.get(event).add(handler);
        return () => this._listeners.get(event)?.delete(handler);
    }

    off(event, handler) {
        this._listeners.get(event)?.delete(handler);
    }

    async connect() {
        if (!this._WebSocket) {
            throw new GoalApiError(
                'No WebSocket implementation found. Use Node 22+, or `npm i ws` and pass { WebSocket } from "ws".'
            );
        }
        this._closedByUser = false;
        this._authenticated = false;
        const { url, options, authFrame } = await this._handshake();

        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };

            const ws = new this._WebSocket(url, options);
            this._ws = ws;

            // The server closes with 4001 if the auth frame is slow, so fail before it does.
            const authTimer = setTimeout(() => {
                finish(reject, new AuthenticationError('Timed out waiting for auth_success'));
                try { ws.close(); } catch { /* already gone */ }
            }, this._authTimeoutMs);

            ws.onopen = () => {
                // Must be the first frame on the wire.
                try {
                    ws.send(JSON.stringify(authFrame));
                } catch (error) {
                    clearTimeout(authTimer);
                    finish(reject, new GoalApiError(`Could not send the auth frame: ${error.message}`));
                }
            };

            ws.onmessage = (event) => {
                let message;
                try {
                    message = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
                } catch {
                    this._emit('error', new GoalApiError('Received malformed WebSocket frame'));
                    return;
                }

                if (!this._authenticated) {
                    if (message.type === 'auth_success') {
                        clearTimeout(authTimer);
                        this._authenticated = true;
                        this._attempts = 0;
                        this._startPing();
                        for (const matchId of this._subscriptions) {
                            this._sendRaw({ type: 'subscribe', resource: 'match', matchId });
                        }
                        this._emit('open', message);
                        finish(resolve, this);
                    } else if (message.type === 'error') {
                        clearTimeout(authTimer);
                        const detail = message.error?.message ?? message.message ?? 'authentication failed';
                        finish(reject, new AuthenticationError(detail, { code: message.error?.code ?? null }));
                    }
                }

                this._emit(message.type ?? 'message', message);
                this._emit('*', message);
            };

            ws.onerror = (event) => {
                const error = new GoalApiError(event?.message ?? 'WebSocket error', { cause: event });
                this._emit('error', error);
                clearTimeout(authTimer);
                finish(reject, error);
            };

            ws.onclose = (event) => {
                clearTimeout(authTimer);
                this._stopPing();
                this._authenticated = false;
                this._emit('close', { code: event?.code, reason: event?.reason });
                // 4001 is the server's "first message must be authentication".
                finish(reject, new GoalApiError(
                    `WebSocket closed before authenticating (code ${event?.code}${event?.reason ? `: ${event.reason}` : ''})`
                ));
                if (this._autoReconnect && !this._closedByUser) this._scheduleReconnect();
            };
        });
    }

    /**
     * Browsers cannot set headers on a WebSocket, so they authorise the upgrade with a
     * minted token in the query string. Checked by capability rather than by sniffing the
     * runtime, so bundlers and polyfills land on the right branch.
     */
    async _handshake() {
        const isBrowserLike = typeof window !== 'undefined' && this._WebSocket === globalThis.WebSocket;
        if (!isBrowserLike) {
            return {
                url: this._url,
                options: { headers: { Authorization: `Bearer ${this._t.apiKey}` } },
                authFrame: { type: 'auth', apiKey: this._t.apiKey },
            };
        }
        const response = await this._t.post('/ws/token', {});
        const token = response?.data?.token;
        if (!token) {
            throw new AuthenticationError('Server did not return a WebSocket connection token');
        }
        return {
            url: `${this._url}?wsToken=${encodeURIComponent(token)}`,
            options: undefined,
            authFrame: { type: 'auth', token },
        };
    }

    subscribe(matchId) {
        this._subscriptions.add(matchId);
        this._send({ type: 'subscribe', resource: 'match', matchId });
        return this;
    }

    unsubscribe(matchId) {
        this._subscriptions.delete(matchId);
        this._send({ type: 'unsubscribe', resource: 'match', matchId });
        return this;
    }

    /** Reply arrives as a `get_subscriptions_response` message. */
    listSubscriptions() { this._send({ type: 'get_subscriptions' }); return this; }
    requestStatus() { this._send({ type: 'status' }); return this; }
    ping() { this._send({ type: 'ping' }); return this; }

    close(code = 1000, reason = 'client closed') {
        this._closedByUser = true;
        this._autoReconnect = false;
        this._authenticated = false;
        this._stopPing();
        try { this._ws?.close(code, reason); } catch { /* already gone */ }
    }

    /** True once authenticated, not merely once the socket is open. */
    get connected() {
        return this._ws?.readyState === 1 && this._authenticated;
    }

    _send(message) {
        if (!this.connected) {
            // subscribe/unsubscribe are held in _subscriptions and replayed after auth.
            if (message.type !== 'subscribe' && message.type !== 'unsubscribe') {
                this._emit('error', new GoalApiError(`Cannot send "${message.type}": not authenticated`));
            }
            return;
        }
        this._sendRaw(message);
    }

    _sendRaw(message) {
        try {
            this._ws.send(JSON.stringify(message));
        } catch (error) {
            this._emit('error', new GoalApiError(`Failed to send "${message.type}": ${error.message}`));
        }
    }

    _emit(event, payload) {
        for (const handler of this._listeners.get(event) ?? []) {
            try {
                handler(payload);
            } catch (error) {
                // One bad listener shouldn't stop the others.
                if (event !== 'error') this._emit('error', error);
            }
        }
    }

    _startPing() {
        this._stopPing();
        if (!this._pingIntervalMs) return;
        this._pingTimer = setInterval(() => this.ping(), this._pingIntervalMs);
        this._pingTimer.unref?.();
    }

    _stopPing() {
        if (this._pingTimer) clearInterval(this._pingTimer);
        this._pingTimer = null;
    }

    _scheduleReconnect() {
        if (this._attempts >= this._maxReconnectAttempts) {
            this._emit('error', new GoalApiError(`Giving up after ${this._attempts} reconnect attempts`));
            return;
        }
        const delay = Math.min(1000 * 2 ** this._attempts, 30_000) * (0.5 + Math.random() / 2);
        this._attempts++;
        const timer = setTimeout(() => {
            this.connect().catch((error) => this._emit('error', error));
        }, delay);
        timer.unref?.();
    }
}

/**
 * The live socket is served at /ws on the host root, not under /v1.
 *
 * nginx routes it with `location ^~ /ws`, the only location carrying the Upgrade headers.
 * /v1/ws falls into the REST location instead and silently answers 200 rather than
 * upgrading, which is a confusing failure because the URL looks right.
 */
export function deriveWsUrl(baseUrl) {
    const url = new URL(baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws';
    url.search = '';
    return url.toString().replace(/\/$/, '');
}
