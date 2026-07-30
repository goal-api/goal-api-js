/**
 * Type declarations for @goal-api/sdk.
 *
 * Params, methods, enums and errors are fully typed. Row shapes are not, since they are
 * provider-shaped and change, so each endpoint method takes its row type as a type
 * argument and falls back to a plain record:
 *
 *     const page = await goal.fixtures.live<Fixture>();   // page.data is Fixture[]
 *     const raw  = await goal.fixtures.live();            // page.data is Row[]
 *
 * Note that is a type argument and not a cast: `Row` does not overlap a user-defined
 * interface, so `as ListResponse<Fixture>` will not compile.
 */

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type Row = Record<string, Json>;

export interface Pagination {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
}

export interface ListResponse<T = Row> {
    success: true;
    data: T[];
    pagination?: Pagination;
    source?: 'cache' | 'database';
}

export interface ItemResponse<T = Row> {
    success: true;
    data: T | null;
    source?: 'cache' | 'database';
}

/** The betting endpoints add these top-level fields. */
export interface BettingResponse<T = Row> extends ListResponse<T> {
    fixtureId: string | null;
    matchApiId: string;
    count: number;
}

export type MatchStatus =
    | 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'HALF_TIME' | 'AFTER_ET' | 'AFTER_PEN'
    | 'POSTPONED' | 'CANCELLED' | 'AWARDED' | 'ABANDONED' | 'SUSPENDED';

export type PlayerType = 'Goalkeepers' | 'Defenders' | 'Midfielders' | 'Forwards';

export type PlayerStat =
    | 'goals' | 'assists' | 'yellowCards' | 'redCards' | 'rating' | 'matchPlayed'
    | 'minutes' | 'saves' | 'tackles' | 'shotsTotal' | 'keyPasses' | 'passes'
    | 'interceptions' | 'duelsWon' | 'dribbleSucc';

export type Half = 'full' | '1half' | '2half';

/** `YYYY-MM-DD` */
export type DateString = string;
/** `YYYY-YYYY` or `YYYY/YY`, consecutive years. */
export type Season = string;

export declare const MATCH_STATUSES: readonly MatchStatus[];
export declare const PLAYER_TYPES: readonly PlayerType[];
export declare const PLAYER_STATS: readonly PlayerStat[];
export declare const DEFAULT_BASE_URL: string;
export declare const VERSION: string;

export interface PageParams {
    limit?: number;
    offset?: number;
}

export interface DateRangeParams {
    from?: DateString;
    to?: DateString;
}

export interface RequestOptions {
    /** Abort this specific request. Aborting is never retried. */
    signal?: AbortSignal;
}

export interface GoalApiOptions {
    apiKey: string;
    /** Default `https://api.goal-api.com/v1`. */
    baseUrl?: string;
    /** Per-attempt timeout in ms. Default 30000. */
    timeout?: number;
    /** Retries on 429/5xx/network errors. Default 2. */
    maxRetries?: number;
    fetch?: typeof globalThis.fetch;
    userAgent?: string;
    headers?: Record<string, string>;
}

export interface RateLimitSnapshot {
    limit: number | null;
    remaining: number | null;
    reset: number | null;
    type: string | null;
}

// ---------------------------------------------------------------- errors

export interface GoalApiErrorOptions {
    status?: number | null;
    code?: string | null;
    category?: string | null;
    details?: Json;
    correlationId?: string | null;
    headers?: Headers | null;
    cause?: unknown;
}

export declare class GoalApiError extends Error {
    constructor(message: string, options?: GoalApiErrorOptions);
    readonly status: number | null;
    readonly code: string | null;
    readonly category: string | null;
    readonly details: Json;
    readonly correlationId: string | null;
    readonly headers: Headers | null;
}

export declare class ConnectionError extends GoalApiError {}
export declare class TimeoutError extends ConnectionError {}
export declare class ValidationError extends GoalApiError {}
export declare class AuthenticationError extends GoalApiError {}
export declare class PermissionError extends GoalApiError {}
export declare class PlanUpgradeRequiredError extends GoalApiError {}
export declare class NotFoundError extends GoalApiError {}
export declare class ConflictError extends GoalApiError {}
export declare class ServiceUnavailableError extends GoalApiError {}
export declare class ServerError extends GoalApiError {}

export declare class RateLimitError extends GoalApiError {
    /** Seconds to wait, when the server sent Retry-After. */
    readonly retryAfter: number | null;
    readonly limit: number | null;
    readonly remaining: number | null;
    readonly reset: number | null;
    readonly rateLimitType: string | null;
}

export declare function errorFromResponse(status: number, body: Row | null, headers: Headers): GoalApiError;

// ---------------------------------------------------------------- resources

export interface StatusComponent {
    name: string;
    description?: string;
    status: string;
    uptime?: { '24h'?: number | null; '7d'?: number | null };
    history?: Array<{ date: string; uptime: number | null }>;
}

export interface PlatformStatus {
    status: string;
    updatedAt: string;
    measurement?: { since: string; windows: string[] };
    components: StatusComponent[];
}

export interface CoverageLeaguesPage {
    leagues: Row[];
    total: number;
    page: number;
    limit: number;
    pages: number;
}

/**
 * The one group that does not return the { success, data } envelope: these resolve to the
 * bare payload, and paginate with `page`/`limit` rather than `offset`.
 */
export declare class Status {
    get(o?: RequestOptions): Promise<PlatformStatus>;
    coverage<T = Row>(o?: RequestOptions): Promise<T>;
    coverageLeagues(
        p?: { q?: string; country?: string; page?: number; limit?: number },
        o?: RequestOptions,
    ): Promise<CoverageLeaguesPage>;
    coverageCountries(o?: RequestOptions): Promise<{ countries: Row[]; total: number }>;
    coverageLeague<T = Row>(id: string | number, o?: RequestOptions): Promise<T>;
}

export declare class Countries {
    list<T = Row>(p?: PageParams & { isActive?: boolean; search?: string }, o?: RequestOptions): Promise<ListResponse<T>>;
    get<T = Row>(id: string | number, o?: RequestOptions): Promise<ItemResponse<T>>;
    leagues<T = Row>(id: string | number, p?: PageParams & { season?: Season; isActive?: boolean }, o?: RequestOptions): Promise<ListResponse<T>>;
}

export declare class Leagues {
    list<T = Row>(p?: PageParams & { countryId?: string; season?: Season; search?: string; isActive?: boolean }, o?: RequestOptions): Promise<ListResponse<T>>;
    get<T = Row>(id: string | number, o?: RequestOptions): Promise<ItemResponse<T>>;
    teams<T = Row>(id: string | number, p?: PageParams & { season?: Season }, o?: RequestOptions): Promise<ListResponse<T>>;
    standings<T = Row>(id: string | number, p?: { stage?: string }, o?: RequestOptions): Promise<ListResponse<T>>;
    fixtures<T = Row>(id: string | number, p?: PageParams & DateRangeParams & { status?: MatchStatus }, o?: RequestOptions): Promise<ListResponse<T>>;
    topScorers<T = Row>(id: string | number, p?: { limit?: number }, o?: RequestOptions): Promise<ListResponse<T>>;
    results<T = Row>(id: string | number, p?: PageParams & DateRangeParams, o?: RequestOptions): Promise<ListResponse<T>>;
}

export declare class Teams {
    list<T = Row>(p?: PageParams & { leagueId?: string; country?: string; search?: string; isActive?: boolean }, o?: RequestOptions): Promise<ListResponse<T>>;
    get<T = Row>(id: string | number, p?: { includePlayers?: boolean }, o?: RequestOptions): Promise<ItemResponse<T>>;
    players<T = Row>(id: string | number, p?: PageParams & { type?: PlayerType }, o?: RequestOptions): Promise<ListResponse<T>>;
    fixtures<T = Row>(id: string | number, p?: PageParams & DateRangeParams & { status?: MatchStatus }, o?: RequestOptions): Promise<ListResponse<T>>;
    results<T = Row>(id: string | number, p?: PageParams & DateRangeParams, o?: RequestOptions): Promise<ListResponse<T>>;
    statistics<T = Row>(id: string | number, p?: { season?: Season }, o?: RequestOptions): Promise<ItemResponse<T>>;
    upcoming<T = Row>(id: string | number, p?: { limit?: number }, o?: RequestOptions): Promise<ListResponse<T>>;
}

export declare class Fixtures {
    list<T = Row>(p?: PageParams & DateRangeParams & { leagueId?: string; teamId?: string; status?: MatchStatus; live?: boolean }, o?: RequestOptions): Promise<ListResponse<T>>;
    live<T = Row>(p?: { leagueId?: string }, o?: RequestOptions): Promise<ListResponse<T>>;
    byDate<T = Row>(date: DateString, p?: PageParams & { leagueId?: string; teamId?: string }, o?: RequestOptions): Promise<ListResponse<T>>;
    get<T = Row>(id: string | number, o?: RequestOptions): Promise<ItemResponse<T>>;
    events<T = Row>(id: string | number, o?: RequestOptions): Promise<ListResponse<T>>;
    lineups<T = Row>(id: string | number, o?: RequestOptions): Promise<ItemResponse<T>>;
    statistics<T = Row>(id: string | number, p?: { half?: Half }, o?: RequestOptions): Promise<ItemResponse<T>>;
    cards<T = Row>(id: string | number, o?: RequestOptions): Promise<ListResponse<T>>;
    substitutions<T = Row>(id: string | number, o?: RequestOptions): Promise<ListResponse<T>>;
    odds<T = Row>(id: string | number, o?: RequestOptions): Promise<BettingResponse<T>>;
    predictions<T = Row>(id: string | number, o?: RequestOptions): Promise<ItemResponse<T> & { fixtureId: string | null; matchApiId: string }>;
    liveOdds<T = Row>(id: string | number, o?: RequestOptions): Promise<BettingResponse<T>>;
    commentary<T = Row>(id: string | number, o?: RequestOptions): Promise<BettingResponse<T>>;
}

export declare class Standings {
    get<T = Row>(leagueId: string | number, p?: { stage?: string }, o?: RequestOptions): Promise<ListResponse<T>>;
    team<T = Row>(leagueId: string | number, teamId: string | number, o?: RequestOptions): Promise<ItemResponse<T>>;
    home<T = Row>(leagueId: string | number, p?: { stage?: string }, o?: RequestOptions): Promise<ListResponse<T>>;
    away<T = Row>(leagueId: string | number, p?: { stage?: string }, o?: RequestOptions): Promise<ListResponse<T>>;
    form<T = Row>(leagueId: string | number, p?: { stage?: string }, o?: RequestOptions): Promise<ListResponse<T>>;
    zones<T = Row>(leagueId: string | number, p?: { stage?: string }, o?: RequestOptions): Promise<ItemResponse<T>>;
}

export declare class Players {
    list<T = Row>(p?: PageParams & { teamId?: string; type?: PlayerType; search?: string }, o?: RequestOptions): Promise<ListResponse<T>>;
    search<T = Row>(q: string, p?: { limit?: number }, o?: RequestOptions): Promise<ListResponse<T>>;
    /** 2–5 ids. */
    compare<T = Row>(ids: string[] | string, o?: RequestOptions): Promise<ListResponse<T>>;
    top<T = Row>(stat: PlayerStat, p?: { teamId?: string; type?: PlayerType; limit?: number }, o?: RequestOptions): Promise<ListResponse<T>>;
    get<T = Row>(id: string | number, o?: RequestOptions): Promise<ItemResponse<T>>;
    statistics<T = Row>(id: string | number, p?: { season?: Season }, o?: RequestOptions): Promise<ItemResponse<T>>;
}

export declare class Coaches {
    list<T = Row>(p?: PageParams & { search?: string; country?: string }, o?: RequestOptions): Promise<ListResponse<T>>;
    search<T = Row>(q: string, p?: { limit?: number }, o?: RequestOptions): Promise<ListResponse<T>>;
    byCountry<T = Row>(country: string, p?: PageParams, o?: RequestOptions): Promise<ListResponse<T>>;
    byTeam<T = Row>(teamId: string | number, o?: RequestOptions): Promise<ListResponse<T>>;
    get<T = Row>(id: string | number, o?: RequestOptions): Promise<ItemResponse<T>>;
}

export declare class HeadToHead {
    get<T = Row>(team1Id: string | number, team2Id: string | number, o?: RequestOptions): Promise<ItemResponse<T>>;
    direct<T = Row>(team1Id: string | number, team2Id: string | number, p?: { limit?: number }, o?: RequestOptions): Promise<ListResponse<T>>;
    stats<T = Row>(team1Id: string | number, team2Id: string | number, o?: RequestOptions): Promise<ItemResponse<T>>;
}

export declare class Results {
    list<T = Row>(p?: PageParams & DateRangeParams & { leagueId?: string; teamId?: string }, o?: RequestOptions): Promise<ListResponse<T>>;
    today<T = Row>(o?: RequestOptions): Promise<ListResponse<T>>;
    yesterday<T = Row>(o?: RequestOptions): Promise<ListResponse<T>>;
    stats<T = Row>(p?: DateRangeParams & { leagueId?: string }, o?: RequestOptions): Promise<ItemResponse<T>>;
    highScoring<T = Row>(p?: DateRangeParams & { leagueId?: string; limit?: number }, o?: RequestOptions): Promise<ListResponse<T>>;
    byDate<T = Row>(date: DateString, o?: RequestOptions): Promise<ListResponse<T>>;
    byLeague<T = Row>(leagueId: string | number, p?: PageParams & DateRangeParams, o?: RequestOptions): Promise<ListResponse<T>>;
    byTeam<T = Row>(teamId: string | number, p?: PageParams & DateRangeParams, o?: RequestOptions): Promise<ListResponse<T>>;
}

export declare class Videos {
    list<T = Row>(p?: PageParams & DateRangeParams & { leagueId?: string }, o?: RequestOptions): Promise<ListResponse<T>>;
    recent<T = Row>(p?: { leagueId?: string; limit?: number }, o?: RequestOptions): Promise<ListResponse<T>>;
    byMatch<T = Row>(matchId: string | number, o?: RequestOptions): Promise<ListResponse<T>>;
    byLeague<T = Row>(leagueId: string | number, p?: PageParams & DateRangeParams, o?: RequestOptions): Promise<ListResponse<T>>;
    byDate<T = Row>(date: DateString, p?: PageParams & { leagueId?: string }, o?: RequestOptions): Promise<ListResponse<T>>;
}

export declare class Odds {
    list<T = Row>(p?: PageParams & { bookmaker?: string; matchId?: string }, o?: RequestOptions): Promise<ListResponse<T>>;
}

export declare class Predictions {
    list<T = Row>(p?: PageParams & { matchId?: string; leagueName?: string }, o?: RequestOptions): Promise<ListResponse<T>>;
}

// ---------------------------------------------------------------- live

export type LiveEventName =
    | 'match_update' | 'auth_success' | 'status' | 'pong' | 'server_shutdown'
    | 'get_subscriptions' | 'subscribe' | 'unsubscribe'
    | 'error' | 'open' | 'close' | 'message' | '*';

export interface LiveMessage {
    type: string;
    data?: Json;
    timestamp?: number;
    [k: string]: Json | undefined;
}

export interface LiveOptions {
    /** Required in Node < 22. Pass the `ws` package's WebSocket. */
    WebSocket?: unknown;
    url?: string;
    autoReconnect?: boolean;
    maxReconnectAttempts?: number;
    /** Application-level ping cadence in ms. 0 disables. Default 30000. */
    pingIntervalMs?: number;
}

export declare class LiveClient {
    /** Returns an unsubscribe function. */
    on(event: LiveEventName, handler: (payload: LiveMessage | GoalApiError) => void): () => void;
    off(event: LiveEventName, handler: (payload: LiveMessage | GoalApiError) => void): void;
    connect(): Promise<this>;
    /** Queued and replayed if the socket is not open yet, or after a reconnect. */
    subscribe(matchId: string): this;
    unsubscribe(matchId: string): this;
    listSubscriptions(): this;
    requestStatus(): this;
    ping(): this;
    close(code?: number, reason?: string): void;
    readonly connected: boolean;
}

// ---------------------------------------------------------------- webhooks

export declare const WEBHOOK_EVENTS: readonly string[];
export declare const SIGNATURE_HEADER: string;
export declare const EVENT_HEADER: string;
export declare const DELIVERY_HEADER: string;

export declare class WebhookSignatureError extends GoalApiError {}

/** `payload` must be the raw body bytes, not a re-serialized object. */
export declare function verifyWebhook(
    payload: Buffer | string,
    signatureHeader: string | undefined,
    secret: string,
    options?: { tolerance?: number },
): Row;

// ---------------------------------------------------------------- client

export interface PaginateOptions {
    /** Default 100. `/results` and `/countries` accept up to 500. */
    pageSize?: number;
    maxItems?: number;
    startOffset?: number;
}

export declare class GoalApi {
    constructor(options: GoalApiOptions | string);

    readonly status: Status;
    readonly countries: Countries;
    readonly leagues: Leagues;
    readonly teams: Teams;
    readonly fixtures: Fixtures;
    readonly standings: Standings;
    readonly players: Players;
    readonly coaches: Coaches;
    readonly h2h: HeadToHead;
    readonly results: Results;
    readonly videos: Videos;
    readonly odds: Odds;
    readonly predictions: Predictions;

    readonly rateLimit: RateLimitSnapshot;
    readonly baseUrl: string;

    request<T = Row>(path: string, params?: Record<string, unknown>, o?: RequestOptions): Promise<T>;

    paginate<T = Row>(
        fetchPage: (page: { limit: number; offset: number }) => Promise<ListResponse<T>>,
        options?: PaginateOptions,
    ): AsyncGenerator<T, void, void>;

    collect<T = Row>(
        fetchPage: (page: { limit: number; offset: number }) => Promise<ListResponse<T>>,
        options?: PaginateOptions,
    ): Promise<T[]>;

    live(options?: LiveOptions): LiveClient;
}

export default GoalApi;
