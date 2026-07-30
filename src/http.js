import {
    ConnectionError,
    TimeoutError,
    RateLimitError,
    errorFromResponse,
} from './errors.js';

export const DEFAULT_BASE_URL = 'https://api.goal-api.com/v1';
export const VERSION = '1.0.0';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** Auth, query encoding, retries and rate-limit tracking. */
export class Transport {
    constructor({
        apiKey,
        baseUrl = DEFAULT_BASE_URL,
        timeout = 30_000,
        maxRetries = 2,
        fetch: fetchImpl,
        userAgent,
        headers = {},
    } = {}) {
        if (!apiKey) {
            throw new TypeError('apiKey is required. Create one at https://goal-api.com/dashboard');
        }
        this.apiKey = apiKey;
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.timeout = timeout;
        this.maxRetries = maxRetries;
        this.extraHeaders = headers;
        this.userAgent = userAgent ?? `goal-api-js/${VERSION}`;

        this._fetch = fetchImpl ?? globalThis.fetch;
        if (typeof this._fetch !== 'function') {
            throw new TypeError('No fetch implementation found. Use Node 18+ or pass { fetch }.');
        }

        this.rateLimit = { limit: null, remaining: null, reset: null, type: null };
    }

    /**
     * Drops null/undefined/empty and joins arrays with commas.
     *
     * Callers pass whole option objects with keys unset, and `?season=undefined` is a 400.
     */
    static _query(params) {
        const search = new URLSearchParams();
        for (const [key, value] of Object.entries(params ?? {})) {
            if (value === null || value === undefined || value === '') continue;
            search.append(key, Array.isArray(value) ? value.join(',') : String(value));
        }
        const qs = search.toString();
        return qs ? `?${qs}` : '';
    }

    async get(path, params, { signal } = {}) {
        const url = `${this.baseUrl}${path}${Transport._query(params)}`;
        let lastError;

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                return await this._once('GET', url, signal);
            } catch (error) {
                lastError = error;
                if (attempt === this.maxRetries || !this._shouldRetry(error)) throw error;
                await sleep(this._backoffMs(attempt, error), signal);
            }
        }
        throw lastError;
    }

    async post(path, body, { signal } = {}) {
        // Not retried: /ws/token is single-use, so a retry after a timeout would burn the
        // token the first attempt may already have minted.
        return this._once('POST', `${this.baseUrl}${path}`, signal, body);
    }

    async _once(method, url, callerSignal, body) {
        const controller = new AbortController();
        const onAbort = () => controller.abort();
        callerSignal?.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(() => controller.abort(), this.timeout);

        let response;
        try {
            response = await this._fetch(url, {
                method,
                signal: controller.signal,
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    Accept: 'application/json',
                    'User-Agent': this.userAgent,
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                    ...this.extraHeaders,
                },
                body: body ? JSON.stringify(body) : undefined,
            });
        } catch (error) {
            // Distinguish a caller cancelling from our own timeout firing.
            if (callerSignal?.aborted) throw error;
            if (error?.name === 'AbortError') {
                throw new TimeoutError(`Request to ${url} timed out after ${this.timeout}ms`, { cause: error });
            }
            throw new ConnectionError(`Could not reach ${url}: ${error.message}`, { cause: error });
        } finally {
            clearTimeout(timer);
            callerSignal?.removeEventListener('abort', onAbort);
        }

        this._captureRateLimit(response.headers);

        const payload = await readJson(response);
        if (!response.ok) throw errorFromResponse(response.status, payload, response.headers);
        return payload;
    }

    _captureRateLimit(headers) {
        const num = (name) => {
            const raw = headers.get(name);
            if (raw == null || raw === '') return null;
            const n = Number.parseInt(raw, 10);
            return Number.isNaN(n) ? null : n;
        };
        const limit = num('x-ratelimit-limit');
        // /public/* sends RateLimit-* (draft standard) instead, so leave the snapshot alone.
        if (limit === null && headers.get('x-ratelimit-type') === null) return;
        this.rateLimit = {
            limit,
            remaining: num('x-ratelimit-remaining'),
            reset: num('x-ratelimit-reset'),
            type: headers.get('x-ratelimit-type'),
        };
    }

    _shouldRetry(error) {
        if (error instanceof TimeoutError || error instanceof ConnectionError) return true;
        return RETRYABLE_STATUS.has(error?.status);
    }

    _backoffMs(attempt, error) {
        if (error instanceof RateLimitError && error.retryAfter != null) {
            return Math.min(error.retryAfter * 1000, 60_000);
        }
        const ceiling = Math.min(500 * 2 ** attempt, 8_000);
        return Math.random() * ceiling;
    }
}

async function readJson(response) {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        // nginx returns HTML for 502s. Keep an excerpt so the error message is still useful.
        return { message: text.slice(0, 200).trim() };
    }
}

function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new ConnectionError('Request aborted'));
        }, { once: true });
    });
}
