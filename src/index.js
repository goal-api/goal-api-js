import { Transport, DEFAULT_BASE_URL, VERSION } from './http.js';
import { LiveClient } from './live.js';
import * as R from './resources.js';

export * from './errors.js';
export * from './webhooks.js';
export { LiveClient } from './live.js';
export { DEFAULT_BASE_URL, VERSION } from './http.js';

export const MATCH_STATUSES = Object.freeze([
    'SCHEDULED', 'LIVE', 'FINISHED', 'HALF_TIME', 'AFTER_ET', 'AFTER_PEN',
    'POSTPONED', 'CANCELLED', 'AWARDED', 'ABANDONED', 'SUSPENDED',
]);

export const PLAYER_TYPES = Object.freeze(['Goalkeepers', 'Defenders', 'Midfielders', 'Forwards']);

export const PLAYER_STATS = Object.freeze([
    'goals', 'assists', 'yellowCards', 'redCards', 'rating', 'matchPlayed', 'minutes',
    'saves', 'tackles', 'shotsTotal', 'keyPasses', 'passes', 'interceptions',
    'duelsWon', 'dribbleSucc',
]);

/**
 * GOAL API client.
 *
 *   const goal = new GoalApi({ apiKey: process.env.GOAL_API_KEY });
 *   const { data } = await goal.fixtures.live();
 */
export class GoalApi {
    constructor(options = {}) {
        const opts = typeof options === 'string' ? { apiKey: options } : options;
        this._transport = new Transport(opts);

        this.status = new R.Status(this._transport);
        this.countries = new R.Countries(this._transport);
        this.leagues = new R.Leagues(this._transport);
        this.teams = new R.Teams(this._transport);
        this.fixtures = new R.Fixtures(this._transport);
        this.standings = new R.Standings(this._transport);
        this.players = new R.Players(this._transport);
        this.coaches = new R.Coaches(this._transport);
        this.h2h = new R.HeadToHead(this._transport);
        this.results = new R.Results(this._transport);
        this.videos = new R.Videos(this._transport);
        this.odds = new R.Odds(this._transport);
        this.predictions = new R.Predictions(this._transport);
    }

    /** Quota from the last response. All null until the first authenticated call. */
    get rateLimit() {
        return { ...this._transport.rateLimit };
    }

    get baseUrl() {
        return this._transport.baseUrl;
    }

    /** For endpoints not wrapped here yet. */
    request(path, params, opts) {
        return this._transport.get(path, params, opts);
    }

    /**
     * Walks pages, yielding items.
     *
     *   for await (const team of goal.paginate((p) => goal.teams.list({ leagueId, ...p }))) { ... }
     *
     * 100 is the limit ceiling on most endpoints; /results and /countries take 500.
     */
    async *paginate(fetchPage, { pageSize = 100, maxItems = Infinity, startOffset = 0 } = {}) {
        let offset = startOffset;
        let yielded = 0;

        while (yielded < maxItems) {
            const page = await fetchPage({ limit: pageSize, offset });
            const items = page?.data ?? [];
            if (items.length === 0) return;

            for (const item of items) {
                yield item;
                if (++yielded >= maxItems) return;
            }

            const pagination = page?.pagination;
            // Some endpoints omit pagination; a short page is the only other signal.
            if (pagination ? !pagination.hasMore : items.length < pageSize) return;
            offset += items.length;
        }
    }

    /** `paginate` collected into an array. */
    async collect(fetchPage, options) {
        const out = [];
        for await (const item of this.paginate(fetchPage, options)) out.push(item);
        return out;
    }

    /**
     * Live match updates. Nothing opens until you await `connect()`.
     *
     *   const live = goal.live();
     *   live.on('match_update', (m) => console.log(m.data));
     *   await live.connect();
     *   live.subscribe(fixtureId);
     */
    live(options) {
        return new LiveClient(this._transport, options);
    }
}

export default GoalApi;
