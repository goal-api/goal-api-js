// Runs against the real API. Skipped unless GOAL_API_KEY is set.
//
//   GOAL_API_KEY=... node --test "test/**/*.test.js"
//
// The endpoint-by-endpoint coverage lives in ../tools/sweep.py. This checks the
// parts that are the SDK's job: auth, param encoding, envelope handling, pagination
// across real pages, error mapping and the quota snapshot.

import test from 'node:test';
import assert from 'node:assert/strict';

import { GoalApi, NotFoundError, ValidationError, AuthenticationError } from '../src/index.js';

const apiKey = process.env.GOAL_API_KEY;
const options = { skip: apiKey ? false : 'GOAL_API_KEY is not set' };

const goal = new GoalApi({ apiKey: apiKey ?? 'unset', timeout: 30_000 });

test('status.get returns the bare body', options, async () => {
    const status = await goal.status.get();
    assert.equal(typeof status.status, 'string');
    assert.ok(Array.isArray(status.components));
    assert.equal(status.data, undefined, '/public/* must not be wrapped in an envelope');
});

test('coverage.leagues paginates with page/limit', options, async () => {
    const page = await goal.status.coverageLeagues({ page: 1, limit: 5 });
    assert.ok(Array.isArray(page.leagues));
    assert.ok(page.leagues.length <= 5);
    assert.equal(typeof page.total, 'number');
    assert.equal(typeof page.pages, 'number');
});

test('leagues.list returns the envelope and honours limit', options, async () => {
    const page = await goal.leagues.list({ isActive: true, limit: 3 });
    assert.equal(page.success, true);
    assert.ok(Array.isArray(page.data));
    assert.ok(page.data.length <= 3);
    assert.equal(typeof page.pagination.total, 'number');
    assert.ok(['cache', 'database'].includes(page.source));
});

test('the quota snapshot is populated after an authenticated call', options, async () => {
    await goal.leagues.list({ limit: 1 });
    assert.equal(typeof goal.rateLimit.limit, 'number');
    assert.ok(goal.rateLimit.remaining <= goal.rateLimit.limit);
    assert.ok(['DAILY', 'MONTHLY'].includes(goal.rateLimit.type));
});

test('fixtures.live returns matches in play', options, async () => {
    const page = await goal.fixtures.live();
    assert.equal(page.success, true);
    assert.ok(Array.isArray(page.data));
});

test('a real league resolves through the nested endpoints', options, async () => {
    const { data: leagues } = await goal.leagues.list({ isActive: true, limit: 1 });
    assert.ok(leagues.length > 0, 'expected at least one active league');
    const leagueId = leagues[0].id;

    const teams = await goal.leagues.teams(leagueId, { limit: 5 });
    assert.equal(teams.success, true);

    const fixtures = await goal.leagues.fixtures(leagueId, { limit: 5 });
    assert.equal(fixtures.success, true);
});

test('paginate walks real pages without repeating or looping', options, async () => {
    const seen = [];
    for await (const country of goal.paginate((p) => goal.countries.list(p), { pageSize: 20, maxItems: 45 })) {
        seen.push(country.id);
    }
    assert.ok(seen.length > 20, 'expected pagination to cross a page boundary');
    assert.equal(new Set(seen).size, seen.length, 'pagination returned duplicates');
});

test('players.search accepts a query', options, async () => {
    const page = await goal.players.search('silva', { limit: 3 });
    assert.equal(page.success, true);
    assert.ok(page.data.length <= 3);
});

test('an unknown id raises NotFoundError with the service error shape', options, async () => {
    await assert.rejects(
        () => goal.fixtures.get('definitely-not-a-real-id'),
        (error) => {
            assert.ok(error instanceof NotFoundError);
            assert.equal(error.status, 404);
            // football-service puts the text in `error`, not `message`; the SDK
            // normalises both into `.message`.
            assert.ok(error.message.length > 0);
            assert.equal(error.code, 'FIXTURE_NOT_FOUND');
            return true;
        },
    );
});

test('a bad enum value raises ValidationError with details', options, async () => {
    await assert.rejects(
        () => goal.players.top('not-a-real-stat'),
        (error) => {
            assert.ok(error instanceof ValidationError);
            assert.equal(error.status, 400);
            assert.equal(error.code, 'VALIDATION_ERROR');
            assert.ok(Array.isArray(error.details), 'expected express-validator details');
            return true;
        },
    );
});

test('a bad key raises AuthenticationError', options, async () => {
    const bad = new GoalApi({ apiKey: 'gapi_not_a_real_key', maxRetries: 0 });
    await assert.rejects(() => bad.leagues.list({ limit: 1 }), AuthenticationError);
});
