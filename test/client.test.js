import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
    GoalApi,
    RateLimitError,
    ValidationError,
    NotFoundError,
    TimeoutError,
    verifyWebhook,
    WebhookSignatureError,
} from '../src/index.js';

/** Records calls and replays a queue of responses. */
function fakeFetch(responses) {
    const calls = [];
    const queue = Array.isArray(responses) ? [...responses] : [responses];
    const fn = async (url, init) => {
        calls.push({ url, init });
        const next = queue.length > 1 ? queue.shift() : queue[0];
        if (typeof next === 'function') return next(url, init);
        const { status = 200, body = { success: true, data: [] }, headers = {} } = next;
        return new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json', ...headers },
        });
    };
    fn.calls = calls;
    return fn;
}

const client = (fetchImpl, opts = {}) =>
    new GoalApi({ apiKey: 'test-key', fetch: fetchImpl, maxRetries: 0, ...opts });

test('requires an apiKey', () => {
    assert.throws(() => new GoalApi({}), /apiKey is required/);
});

test('sends the bearer header to the right URL', async () => {
    const f = fakeFetch({ body: { success: true, data: [{ id: 'x' }] } });
    await client(f).fixtures.live();

    assert.equal(f.calls[0].url, 'https://api.goal-api.com/v1/fixtures/live');
    assert.equal(f.calls[0].init.headers.Authorization, 'Bearer test-key');
    assert.match(f.calls[0].init.headers['User-Agent'], /^goal-api-js\//);
});

test('drops null and undefined params, keeps falsey-but-real ones', async () => {
    const f = fakeFetch({});
    await client(f).fixtures.list({ leagueId: 'L1', status: undefined, teamId: null, offset: 0, live: false });

    const query = new URL(f.calls[0].url).searchParams;
    assert.equal(query.get('leagueId'), 'L1');
    assert.equal(query.get('offset'), '0');
    assert.equal(query.get('live'), 'false');
    assert.equal(query.has('status'), false);
    assert.equal(query.has('teamId'), false);
});

test('encodes path segments so names with spaces cannot alter the route', async () => {
    const f = fakeFetch({});
    await client(f).coaches.byCountry('Trinidad And Tobago');
    assert.equal(f.calls[0].url, 'https://api.goal-api.com/v1/coaches/country/Trinidad%20And%20Tobago');
});

test('rejects an empty path segment instead of hitting the collection route', () => {
    // Throws synchronously: a missing id is a caller bug, and GET /fixtures/ would
    // quietly return the whole collection instead.
    const f = fakeFetch({});
    assert.throws(() => client(f).fixtures.get(''), /Path segment is required/);
    assert.equal(f.calls.length, 0);
});

test('joins array params with commas for /players/compare', async () => {
    const f = fakeFetch({});
    await client(f).players.compare(['p1', 'p2', 'p3']);
    assert.equal(new URL(f.calls[0].url).searchParams.get('ids'), 'p1,p2,p3');
});

test('public endpoints resolve to the bare body, not an envelope', async () => {
    const body = { status: 'operational', components: [{ name: 'API', status: 'operational' }] };
    const f = fakeFetch({ body });
    const status = await client(f).status.get();

    assert.equal(status.status, 'operational');
    assert.equal(status.components.length, 1);
    assert.equal(status.data, undefined);
});

test('coverageLeagues paginates with page, not offset', async () => {
    const f = fakeFetch({ body: { leagues: [], total: 0, page: 2, limit: 50, pages: 1 } });
    await client(f).status.coverageLeagues({ page: 2, limit: 50, country: 'England' });

    const query = new URL(f.calls[0].url).searchParams;
    assert.equal(query.get('page'), '2');
    assert.equal(query.get('limit'), '50');
    assert.equal(query.get('country'), 'England');
    assert.equal(query.has('offset'), false);
});

test('maps status codes to typed errors and keeps the envelope fields', async () => {
    const f = fakeFetch({
        status: 400,
        body: { success: false, message: 'League ID is required', code: 'VALIDATION_ERROR', category: 'validation', details: { field: 'id' }, correlationId: 'abc-123' },
    });

    await assert.rejects(
        () => client(f).leagues.get('bad'),
        (error) => {
            assert.ok(error instanceof ValidationError);
            assert.equal(error.status, 400);
            assert.equal(error.code, 'VALIDATION_ERROR');
            assert.equal(error.correlationId, 'abc-123');
            assert.deepEqual(error.details, { field: 'id' });
            return true;
        },
    );
});

test('404 becomes NotFoundError', async () => {
    const f = fakeFetch({ status: 404, body: { success: false, message: 'Fixture not found', code: 'NOT_FOUND' } });
    await assert.rejects(() => client(f).fixtures.get('nope'), NotFoundError);
});

test('429 carries retryAfter and the rate-limit headers', async () => {
    const f = fakeFetch({
        status: 429,
        body: { success: false, message: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
        headers: { 'retry-after': '42', 'x-ratelimit-limit': '1000', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000', 'x-ratelimit-type': 'DAILY' },
    });

    await assert.rejects(
        () => client(f).fixtures.live(),
        (error) => {
            assert.ok(error instanceof RateLimitError);
            assert.equal(error.retryAfter, 42);
            assert.equal(error.limit, 1000);
            assert.equal(error.rateLimitType, 'DAILY');
            return true;
        },
    );
});

test('degrades gracefully when a proxy answers with HTML instead of JSON', async () => {
    const f = async () => new Response('<html><body>502 Bad Gateway</body></html>', { status: 502, headers: { 'content-type': 'text/html' } });
    await assert.rejects(() => client(f).fixtures.live(), /502 Bad Gateway/);
});

test('records the rate-limit snapshot from a successful response', async () => {
    const f = fakeFetch({
        headers: { 'x-ratelimit-limit': '10000', 'x-ratelimit-remaining': '9997', 'x-ratelimit-reset': '1800000000', 'x-ratelimit-type': 'MONTHLY' },
    });
    const goal = client(f);
    await goal.results.today();

    assert.deepEqual(goal.rateLimit, { limit: 10000, remaining: 9997, reset: 1800000000, type: 'MONTHLY' });
});

test('retries a 503 then succeeds', async () => {
    let n = 0;
    const f = async () => {
        n++;
        return n === 1
            ? new Response(JSON.stringify({ success: false, message: 'down', code: 'SERVICE_UNAVAILABLE' }), { status: 503, headers: { 'content-type': 'application/json' } })
            : new Response(JSON.stringify({ success: true, data: [1] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const page = await client(f, { maxRetries: 2 }).fixtures.live();
    assert.equal(n, 2);
    assert.deepEqual(page.data, [1]);
});

test('does not retry a 400', async () => {
    let n = 0;
    const f = async () => {
        n++;
        return new Response(JSON.stringify({ success: false, message: 'bad', code: 'VALIDATION_ERROR' }), { status: 400, headers: { 'content-type': 'application/json' } });
    };
    await assert.rejects(() => client(f, { maxRetries: 3 }).fixtures.live(), ValidationError);
    assert.equal(n, 1);
});

test('surfaces a timeout as TimeoutError', async () => {
    const f = (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    await assert.rejects(() => client(f, { timeout: 20 }).fixtures.live(), TimeoutError);
});

test('a caller abort is not converted into a TimeoutError', async () => {
    const controller = new AbortController();
    const f = (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    setTimeout(() => controller.abort(), 5);

    await assert.rejects(
        () => client(f, { timeout: 5000 }).fixtures.live({}, { signal: controller.signal }),
        (error) => {
            assert.ok(!(error instanceof TimeoutError));
            return true;
        },
    );
});

test('paginate walks pages and stops on hasMore=false', async () => {
    const pages = [
        { body: { success: true, data: [{ id: 1 }, { id: 2 }], pagination: { total: 3, limit: 2, offset: 0, hasMore: true } } },
        { body: { success: true, data: [{ id: 3 }], pagination: { total: 3, limit: 2, offset: 2, hasMore: false } } },
    ];
    const f = fakeFetch(pages);
    const goal = client(f);

    const all = await goal.collect((p) => goal.teams.list(p), { pageSize: 2 });
    assert.deepEqual(all.map((t) => t.id), [1, 2, 3]);
    assert.equal(new URL(f.calls[1].url).searchParams.get('offset'), '2');
});

test('paginate honours maxItems without fetching further pages', async () => {
    const f = fakeFetch({ body: { success: true, data: [{ id: 1 }, { id: 2 }], pagination: { total: 99, limit: 2, offset: 0, hasMore: true } } });
    const goal = client(f);

    const some = await goal.collect((p) => goal.teams.list(p), { pageSize: 2, maxItems: 2 });
    assert.equal(some.length, 2);
    assert.equal(f.calls.length, 1);
});

test('paginate stops on a short page when the server omits pagination', async () => {
    const f = fakeFetch({ body: { success: true, data: [{ id: 1 }] } });
    const goal = client(f);
    const all = await goal.collect((p) => goal.videos.list(p), { pageSize: 10 });
    assert.equal(all.length, 1);
    assert.equal(f.calls.length, 1);
});

// ---------------------------------------------------------------- webhooks

const SECRET = 'whsec_test';
const sign = (body, ts) => `t=${ts},v1=${crypto.createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex')}`;

test('verifyWebhook accepts a correctly signed payload', () => {
    const body = JSON.stringify({ event: 'goal.scored', matchId: 'm1' });
    const ts = Math.floor(Date.now() / 1000);
    assert.deepEqual(verifyWebhook(body, sign(body, ts), SECRET), { event: 'goal.scored', matchId: 'm1' });
});

test('verifyWebhook works on a raw Buffer body', () => {
    const body = JSON.stringify({ event: 'match.started' });
    const ts = Math.floor(Date.now() / 1000);
    assert.deepEqual(verifyWebhook(Buffer.from(body), sign(body, ts), SECRET).event, 'match.started');
});

test('verifyWebhook rejects a tampered body', () => {
    const body = JSON.stringify({ homeScore: 1 });
    const ts = Math.floor(Date.now() / 1000);
    const signature = sign(body, ts);
    assert.throws(() => verifyWebhook(JSON.stringify({ homeScore: 9 }), signature, SECRET), WebhookSignatureError);
});

test('verifyWebhook rejects a replayed old timestamp', () => {
    const body = JSON.stringify({ event: 'goal.scored' });
    const ts = Math.floor(Date.now() / 1000) - 4000;
    assert.throws(() => verifyWebhook(body, sign(body, ts), SECRET), /outside the 300s tolerance/);
});

test('verifyWebhook rejects a malformed header', () => {
    assert.throws(() => verifyWebhook('{}', 'garbage', SECRET), /Malformed X-Goal-Signature/);
    assert.throws(() => verifyWebhook('{}', undefined, SECRET), /Missing X-Goal-Signature/);
});

test('verifyWebhook rejects a short signature instead of crashing', () => {
    // timingSafeEqual throws RangeError on a length mismatch, and the signature is
    // attacker-controlled, so this used to take the process down instead of returning 400.
    const body = JSON.stringify({ a: 1 });
    assert.throws(() => verifyWebhook(body, 't=1,v1=deadbeef', SECRET), WebhookSignatureError);
    assert.throws(() => verifyWebhook(body, `t=1,v1=${'ab'.repeat(64)}`, SECRET), WebhookSignatureError);
});

test('verifyWebhook rejects a wrong secret', () => {
    const body = JSON.stringify({ a: 1 });
    const ts = Math.floor(Date.now() / 1000);
    assert.throws(() => verifyWebhook(body, sign(body, ts), 'whsec_other'), /does not match/);
});

test('news.list hits /news and forwards its filters', async () => {
    // The surface the ENDPOINTS.md spec promises: leagueId/teamId/matchId are the news
    // source's ids, not ours, so they travel through untouched.
    const f = fakeFetch({ body: { success: true, data: [], pagination: { total: 0 } } });
    await client(f).news.list({ leagueId: '3', teamId: '150', from: '2026-09-01', limit: 5 });

    const url = new URL(f.calls[0].url);
    assert.equal(url.pathname, '/v1/news');
    assert.equal(url.searchParams.get('leagueId'), '3');
    assert.equal(url.searchParams.get('teamId'), '150');
    assert.equal(url.searchParams.get('from'), '2026-09-01');
    assert.equal(url.searchParams.get('limit'), '5');
});
