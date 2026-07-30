// Error types mapped from the API's error envelope. Everything extends GoalApiError.

export class GoalApiError extends Error {
    constructor(message, { status = null, code = null, category = null, details = null, correlationId = null, headers = null, cause = null } = {}) {
        super(message);
        this.name = new.target.name;
        this.status = status;
        this.code = code;
        this.category = category;
        this.details = details;
        this.correlationId = correlationId;
        this.headers = headers;
        if (cause) this.cause = cause;
    }

    toString() {
        const parts = [this.message];
        if (this.code) parts.push(`code=${this.code}`);
        if (this.status) parts.push(`status=${this.status}`);
        if (this.correlationId) parts.push(`correlationId=${this.correlationId}`);
        return `${this.name}: ${parts.join(' ')}`;
    }
}

/** No HTTP response at all: DNS, TLS, socket. */
export class ConnectionError extends GoalApiError {}

export class TimeoutError extends ConnectionError {}

/** 400, 422 */
export class ValidationError extends GoalApiError {}

/** 401 */
export class AuthenticationError extends GoalApiError {}

/** 403 */
export class PermissionError extends GoalApiError {}

/** 402: endpoint not included in the current plan. */
export class PlanUpgradeRequiredError extends GoalApiError {}

/** 404 */
export class NotFoundError extends GoalApiError {}

/** 409 */
export class ConflictError extends GoalApiError {}

/** 429. `retryAfter` is in seconds. */
export class RateLimitError extends GoalApiError {
    constructor(message, opts = {}) {
        super(message, opts);
        this.retryAfter = opts.retryAfter ?? null;
        this.limit = opts.limit ?? null;
        this.remaining = opts.remaining ?? null;
        this.reset = opts.reset ?? null;
        this.rateLimitType = opts.rateLimitType ?? null;
    }
}

/** 503 */
export class ServiceUnavailableError extends GoalApiError {}

/** 5xx */
export class ServerError extends GoalApiError {}

const BY_STATUS = {
    400: ValidationError,
    401: AuthenticationError,
    402: PlanUpgradeRequiredError,
    403: PermissionError,
    404: NotFoundError,
    409: ConflictError,
    422: ValidationError,
    429: RateLimitError,
    503: ServiceUnavailableError,
};

function intHeader(headers, name) {
    const raw = headers?.get?.(name);
    if (raw == null || raw === '') return null;
    const n = Number.parseInt(raw, 10);
    return Number.isNaN(n) ? null : n;
}

/**
 * Maps a non-2xx response to an error.
 *
 * `body` is null when the response wasn't JSON. nginx returns HTML for 502s.
 */
export function errorFromResponse(status, body, headers) {
    const Cls = BY_STATUS[status] ?? (status >= 500 ? ServerError : GoalApiError);
    const message = body?.message || body?.error || `HTTP ${status}`;

    const opts = {
        status,
        code: body?.code ?? null,
        category: body?.category ?? null,
        details: body?.details ?? null,
        correlationId: body?.correlationId ?? null,
        headers,
    };

    if (Cls === RateLimitError) {
        Object.assign(opts, {
            retryAfter: intHeader(headers, 'retry-after'),
            limit: intHeader(headers, 'x-ratelimit-limit'),
            remaining: intHeader(headers, 'x-ratelimit-remaining'),
            reset: intHeader(headers, 'x-ratelimit-reset'),
            rateLimitType: headers?.get?.('x-ratelimit-type') ?? null,
        });
    }

    return new Cls(message, opts);
}
