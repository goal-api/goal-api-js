# @goalapi/sdk

JavaScript and TypeScript SDK for the [GOAL API](https://goal-api.com): football
fixtures, live scores, standings, player stats, odds and live WebSocket updates.

Zero runtime dependencies. Works in Node 18+, Deno, Bun, Cloudflare Workers and browsers.

```bash
npm install @goalapi/sdk
```

## Quick start

```js
import { GoalApi } from '@goalapi/sdk';

const goal = new GoalApi({ apiKey: process.env.GOAL_API_KEY });

const { data: live } = await goal.fixtures.live();
for (const match of live) {
    console.log(`${match.homeTeam?.name} ${match.homeScore}-${match.awayScore} ${match.awayTeam?.name}`);
}
```

Get a key at [goal-api.com/signup](https://goal-api.com/signup). Don't ship it in
client-side code; proxy through your own backend.

## Client options

```js
const goal = new GoalApi({
    apiKey: process.env.GOAL_API_KEY,
    baseUrl: 'https://api.goal-api.com/v1', // default
    timeout: 30_000,                        // per attempt, ms
    maxRetries: 2,                          // 429 + 5xx + network errors
    headers: { 'X-My-App': 'scoreboard' },
});
```

Retries use exponential backoff with full jitter, and always honour a server-sent
`Retry-After`. Aborted requests are never retried.

## Endpoints

Grouped by resource. Full parameter reference in [`ENDPOINTS.md`](ENDPOINTS.md).

```js
await goal.status.get();                                   // no API key needed
await goal.countries.list({ search: 'spa' });
await goal.leagues.list({ isActive: true, limit: 100 });
await goal.leagues.standings(leagueId);
await goal.leagues.topScorers(leagueId, { limit: 10 });
await goal.teams.get(teamId, { includePlayers: true });
await goal.teams.statistics(teamId, { season: '2025-2026' });
await goal.fixtures.list({ from: '2026-08-01', to: '2026-08-07', status: 'SCHEDULED' });
await goal.fixtures.byDate('2026-08-15', { leagueId });
await goal.fixtures.lineups(fixtureId);
await goal.fixtures.statistics(fixtureId, { half: '1half' });
await goal.standings.form(leagueId);
await goal.players.search('haaland', { limit: 5 });
await goal.players.compare([playerA, playerB]);
await goal.players.top('goals', { limit: 20 });
await goal.coaches.byTeam(teamId);
await goal.h2h.stats(teamA, teamB);
await goal.results.today();
await goal.videos.recent({ leagueId, limit: 10 });
await goal.odds.list({ bookmaker: 'bet365' });
await goal.predictions.list({ matchId });
```

Every method returns the raw envelope, so `pagination` and `source` stay reachable:

```js
const page = await goal.teams.list({ leagueId, limit: 50 });
page.data;                 // Team[]
page.pagination.hasMore;   // boolean
page.source;               // 'cache' | 'database'
```

### One exception: `goal.status.*`

The five `/public/*` endpoints don't use the `{ success, data }` envelope. They return
bare objects, so read them directly with no `.data`:

```js
const status = await goal.status.get();
status.status;        // 'operational'
status.components;    // [{ name, status, uptime }]
```

They also paginate with `page`/`limit` instead of `limit`/`offset`, so `paginate()` does
not apply to `coverageLeagues`.

## Pagination

`paginate` walks pages for you and yields items:

```js
for await (const team of goal.paginate((p) => goal.teams.list({ leagueId, ...p }))) {
    console.log(team.name);
}

// Or collect, with a cap:
const first500 = await goal.collect(
    (p) => goal.results.list({ leagueId, ...p }),
    { pageSize: 500, maxItems: 500 },   // /results accepts limit up to 500
);
```

Default `pageSize` is 100, the limit ceiling on most endpoints. `/results` and
`/countries` take 500.

## Errors

Everything thrown is a `GoalApiError`. Branch only where you'd actually behave
differently:

```js
import { RateLimitError, ValidationError, NotFoundError, PlanUpgradeRequiredError } from '@goalapi/sdk';

try {
    await goal.fixtures.get(id);
} catch (error) {
    if (error instanceof NotFoundError) return null;
    if (error instanceof RateLimitError) {
        console.warn(`Quota exhausted (${error.rateLimitType}), retry in ${error.retryAfter}s`);
    } else if (error instanceof ValidationError) {
        console.error(error.details);       // which field the server rejected
    } else if (error instanceof PlanUpgradeRequiredError) {
        console.error('This endpoint is not in your plan');
    }
    throw error;
}
```

### Two error shapes

The API answers with one of two bodies, and the SDK normalises both:

| | Gateway (auth, routing, rate limits) | Football service (most endpoints) |
|---|---|---|
| text | `message` | `error` |
| `code` | yes | yes |
| `category` | yes | no |
| `correlationId` | yes | **no** |
| `details` | object | array, on validation errors |

So `error.message` and `error.code` are always populated, and `error.correlationId` is
only set on gateway errors. Quote it in a support ticket when you have it.

### Rate limits

The SDK records the headers from the last response:

```js
await goal.fixtures.live();
goal.rateLimit;   // { limit, remaining, reset, type: 'DAILY' | 'MONTHLY' }
```

`reset` is a unix timestamp in seconds.

## Live WebSocket updates

> The socket is at `wss://api.goal-api.com/ws`, **not** `/v1/ws`. Only nginx's
> `location ^~ /ws` carries the `Upgrade` headers; `/v1/ws` is proxied as ordinary HTTP and
> answers 200 instead of upgrading. The SDK derives the right URL for you.
>
> Two services authenticate: the gateway authorises the upgrade from the header or
> `?wsToken=`, then websocket-service needs an `{"type": "auth", ...}` frame as the very
> first message. The SDK sends it, and treats `auth_success` as the point the connection is
> usable.
>
> **`subscribe` is capped per plan and the cap can be 0.** `auth_success` reports
> `maxSubscriptions`; if it is 0 the socket works but no `match_update` will ever arrive.
> See the known server issue in [`ENDPOINTS.md`](ENDPOINTS.md).

```js
const live = goal.live();

live.on('match_update', ({ data }) => console.log(data));
live.on('error', (error) => console.error(error));
live.on('close', ({ code }) => console.log('closed', code));

await live.connect();
live.subscribe(fixtureId);
```

- **Node 22+**: works as-is. On Node 18-21, `npm i ws` and pass it:
  `goal.live({ WebSocket: (await import('ws')).WebSocket })`.
- **Browsers**: the SDK mints a short-lived single-use token via `POST /ws/token`
  automatically. The key is still in the page, so put a proxy in front.
- Reconnects automatically with backoff and replays your subscriptions. `close()` opts out.
- `subscribe()` before `connect()` is fine; it's queued and sent on open.
- Server caps client messages at 60/minute and concurrent subscriptions by plan.

Message types you can listen for: `match_update`, `auth_success`, `status`, `pong`,
`server_shutdown`, `error`, plus the SDK's own `open` / `close`, and `'*'` for everything.

## Webhooks

Verify against the **raw** body. A parsed-and-reserialized object has different bytes and
will never match.

```js
import express from 'express';
import { verifyWebhook, WebhookSignatureError } from '@goalapi/sdk';

const app = express();

app.post('/goal-webhooks', express.raw({ type: 'application/json' }), (req, res) => {
    let event;
    try {
        event = verifyWebhook(req.body, req.headers['x-goal-signature'], process.env.GOAL_WEBHOOK_SECRET);
    } catch (error) {
        if (error instanceof WebhookSignatureError) return res.sendStatus(400);
        throw error;
    }

    switch (req.headers['x-goal-event']) {
        case 'goal.scored': /* ... */ break;
        case 'match.finished': /* ... */ break;
    }
    res.sendStatus(200);   // ack fast; the server retries at ~1m, 5m, 25m, 2h, 10h
});
```

Signatures use the Stripe scheme: `t=<unix>,v1=<hmac-sha256 of "timestamp.body">`.
Timestamps outside 300s are rejected as replays. Override with `{ tolerance }`.

## Escape hatch

For an endpoint this SDK doesn't wrap yet:

```js
const data = await goal.request('/some/new/endpoint', { limit: 10 });
```

## TypeScript

Types ship with the package. Params, methods, enums and errors are fully typed.

Row shapes are not, since they are provider-shaped and change. Each endpoint method takes
its row type as a **type argument** instead:

```ts
import { GoalApi, type MatchStatus } from '@goalapi/sdk';

interface Fixture { id: string; status: MatchStatus; homeScore: number | null }

const page = await goal.fixtures.live<Fixture>();
page.data[0].homeScore;      // number | null

const raw = await goal.fixtures.live();
raw.data[0]['homeScore'];    // Json, since no type argument was given
```

It flows through pagination too, so there are no casts anywhere:

```ts
for await (const team of goal.paginate((p) => goal.teams.list<Team>(p))) {
    team.name;   // string
}
```

## Examples

| File | Shows |
|---|---|
| [`examples/basic.js`](examples/basic.js) | Status, live fixtures, standings, pagination |
| [`examples/live-scores.js`](examples/live-scores.js) | The live socket: connect, subscribe, print every frame |
| [`examples/webhook-server.js`](examples/webhook-server.js) | Verifying a webhook against the raw request bytes |
| [`examples/bulk-export.js`](examples/bulk-export.js) | Walking every page of a collection to CSV |

```bash
GOAL_API_KEY=...          node examples/live-scores.js
GOAL_WEBHOOK_SECRET=...   node examples/webhook-server.js
GOAL_API_KEY=...          node examples/bulk-export.js > countries.csv
```

## Testing

```bash
npm test                       # unit tests, no network
GOAL_API_KEY=... npm test      # also runs the live tests against the real API
```

The live tests skip themselves without a key, so the same command works either way.
Endpoint-by-endpoint coverage of the API lives in `tools/sweep.py` in the SDK workspace.

## Other languages

Four more first-party clients over the same API, with the same resource groups, the same
retry and pagination behaviour and the same error types. All five release in lockstep, so
a version number means the same surface everywhere.

| Language | Package | Install |
|---|---|---|
| [Python](https://github.com/goal-api/goal-api-python) | [`goal-api`](https://pypi.org/project/goal-api/) | `pip install goal-api` |
| [Go](https://github.com/goal-api/goal-api-go) | [`goal-api-go`](https://pkg.go.dev/github.com/goal-api/goal-api-go) | `go get github.com/goal-api/goal-api-go` |
| [Dart / Flutter](https://github.com/goal-api/goal-api-dart) | [`goal_api`](https://pub.dev/packages/goal_api) | `dart pub add goal_api` |
| [PHP](https://github.com/goal-api/goal-api-php) | [`goal-api/sdk`](https://packagist.org/packages/goal-api/sdk) | `composer require goal-api/sdk` |

Each one is its own repository and carries the same [`ENDPOINTS.md`](ENDPOINTS.md), the
API contract derived from the running service.

## Licence

MIT. See [LICENSE](LICENSE).

No runtime dependencies: this package uses the platform's own `fetch`, `WebSocket` and
`node:crypto`. The one optional peer dependency (`ws`, MIT, needed only on Node 18-21) and
the dev-only tooling are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Security issues: [SECURITY.md](SECURITY.md).
