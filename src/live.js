import { GoalApiError, AuthenticationError } from './errors.js';

/**
 * Live match updates over WebSocket. Reconnects with backoff and re-sends subscriptions.
 *
 * Auth depends on the environment: Node sends an Authorization header on the handshake,
 * browsers can't set headers so they get a single-use token from POST /ws/token instead.
 */
export class LiveClient {
    constructor(transport, {
        WebSocket: WebSocketImpl,
        url,
        autoReconnect = true,
        maxReconnectAttempts = Infinity,
        pingIntervalMs = 30_000,
    } = {}) {
        this._t = transport;
        this._WebSocket = WebSocketImpl ?? globalThis.WebSocket;
        this._url = url ?? transport.baseUrl.replace(/^http/, 'ws') + '/ws';
        this._autoReconnect = autoReconnect;
        this._maxReconnectAttempts = maxReconnectAttempts;
        this._pingIntervalMs = pingIntervalMs;

        this._ws = null;
        this._listeners = new Map();
        this._subscriptions = new Set();
        this._attempts = 0;
        this._pingTimer = null;
        this._closedByUser = false;
    }

    /** Events: match_update, auth_success, status, pong, server_shutdown, error, open, close, '*'. */
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
        const { url, options } = await this._handshake();

        return new Promise((resolve, reject) => {
            let settled = false;
            const ws = new this._WebSocket(url, options);
            this._ws = ws;

            ws.onopen = () => {
                this._attempts = 0;
                this._startPing();
                for (const matchId of this._subscriptions) {
                    this._send({ type: 'subscribe', resource: 'match', matchId });
                }
                this._emit('open', {});
                if (!settled) { settled = true; resolve(this); }
            };

            ws.onmessage = (event) => {
                let message;
                try {
                    message = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
                } catch {
                    this._emit('error', new GoalApiError('Received malformed WebSocket frame'));
                    return;
                }
                this._emit(message.type ?? 'message', message);
                this._emit('*', message);
            };

            ws.onerror = (event) => {
                const error = new GoalApiError(event?.message ?? 'WebSocket error', { cause: event });
                this._emit('error', error);
                if (!settled) { settled = true; reject(error); }
            };

            ws.onclose = (event) => {
                this._stopPing();
                this._emit('close', { code: event?.code, reason: event?.reason });
                if (!settled) {
                    settled = true;
                    reject(new GoalApiError(`WebSocket closed before opening (code ${event?.code})`));
                    return;
                }
                if (this._autoReconnect && !this._closedByUser) this._scheduleReconnect();
            };
        });
    }

    /**
     * Checks for a real browser WebSocket rather than sniffing the runtime, so bundlers
     * and polyfills end up on the right branch.
     */
    async _handshake() {
        const isBrowserLike = typeof window !== 'undefined' && this._WebSocket === globalThis.WebSocket;
        if (!isBrowserLike) {
            return {
                url: this._url,
                options: { headers: { Authorization: `Bearer ${this._t.apiKey}` } },
            };
        }
        const response = await this._t.post('/ws/token', {});
        const token = response?.data?.token;
        if (!token) {
            throw new AuthenticationError('Server did not return a WebSocket connection token');
        }
        return { url: `${this._url}?wsToken=${encodeURIComponent(token)}`, options: undefined };
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

    /** Reply arrives as a `get_subscriptions` message. */
    listSubscriptions() { this._send({ type: 'get_subscriptions' }); return this; }
    requestStatus() { this._send({ type: 'status' }); return this; }
    ping() { this._send({ type: 'ping' }); return this; }

    close(code = 1000, reason = 'client closed') {
        this._closedByUser = true;
        this._autoReconnect = false;
        this._stopPing();
        try { this._ws?.close(code, reason); } catch { /* already gone */ }
    }

    get connected() {
        return this._ws?.readyState === 1;
    }

    _send(message) {
        if (!this.connected) {
            // subscribe/unsubscribe are held in _subscriptions and replayed on open.
            if (message.type !== 'subscribe' && message.type !== 'unsubscribe') {
                this._emit('error', new GoalApiError(`Cannot send "${message.type}": socket is not open`));
            }
            return;
        }
        this._ws.send(JSON.stringify(message));
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
