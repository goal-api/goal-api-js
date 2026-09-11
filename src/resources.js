// One class per endpoint group. Accepted params and limit ceilings: ENDPOINTS.md

class Resource {
    constructor(transport) {
        this._t = transport;
    }

    _get(path, params, opts) {
        return this._t.get(path, params, opts);
    }
}

/**
 * Unauthenticated status and coverage. No API key needed.
 *
 * These five don't use the { success, data } envelope. They return bare objects, so read
 * `(await status.get()).status`, not `.data.status`.
 */
export class Status extends Resource {
    /** `{ status, updatedAt, measurement, components[] }` */
    get(opts) { return this._get('/public/status', null, opts); }

    /** `{ leagues, countries, teams, players, fixtures, ... }` */
    coverage(opts) { return this._get('/public/coverage', null, opts); }

    /**
     * `{ leagues[], total, page, limit, pages }`
     *
     * Paginates with `page`/`limit`, not `offset`, so `client.paginate()` won't work here.
     * Also accepts `q` and `country`.
     */
    coverageLeagues(params, opts) { return this._get('/public/coverage/leagues', params, opts); }

    /** `{ countries[], total }` */
    coverageCountries(opts) { return this._get('/public/coverage/countries', null, opts); }

    /** A bare league object. 404 body is `{ error, code }`. */
    coverageLeague(id, opts) { return this._get(`/public/coverage/leagues/${enc(id)}`, null, opts); }
}

export class Countries extends Resource {
    list(params, opts) { return this._get('/countries', params, opts); }
    get(id, opts) { return this._get(`/countries/${enc(id)}`, null, opts); }
    leagues(id, params, opts) { return this._get(`/countries/${enc(id)}/leagues`, params, opts); }
}

export class Leagues extends Resource {
    list(params, opts) { return this._get('/leagues', params, opts); }
    get(id, opts) { return this._get(`/leagues/${enc(id)}`, null, opts); }
    teams(id, params, opts) { return this._get(`/leagues/${enc(id)}/teams`, params, opts); }
    standings(id, params, opts) { return this._get(`/leagues/${enc(id)}/standings`, params, opts); }
    fixtures(id, params, opts) { return this._get(`/leagues/${enc(id)}/fixtures`, params, opts); }
    topScorers(id, params, opts) { return this._get(`/leagues/${enc(id)}/top-scorers`, params, opts); }
    results(id, params, opts) { return this._get(`/leagues/${enc(id)}/results`, params, opts); }
}

export class Teams extends Resource {
    list(params, opts) { return this._get('/teams', params, opts); }
    get(id, params, opts) { return this._get(`/teams/${enc(id)}`, params, opts); }
    players(id, params, opts) { return this._get(`/teams/${enc(id)}/players`, params, opts); }
    fixtures(id, params, opts) { return this._get(`/teams/${enc(id)}/fixtures`, params, opts); }
    results(id, params, opts) { return this._get(`/teams/${enc(id)}/results`, params, opts); }
    statistics(id, params, opts) { return this._get(`/teams/${enc(id)}/statistics`, params, opts); }
    upcoming(id, params, opts) { return this._get(`/teams/${enc(id)}/upcoming`, params, opts); }
}

export class Fixtures extends Resource {
    list(params, opts) { return this._get('/fixtures', params, opts); }
    live(params, opts) { return this._get('/fixtures/live', params, opts); }
    byDate(date, params, opts) { return this._get(`/fixtures/date/${enc(date)}`, params, opts); }
    get(id, opts) { return this._get(`/fixtures/${enc(id)}`, null, opts); }
    events(id, opts) { return this._get(`/fixtures/${enc(id)}/events`, null, opts); }
    lineups(id, opts) { return this._get(`/fixtures/${enc(id)}/lineups`, null, opts); }
    statistics(id, params, opts) { return this._get(`/fixtures/${enc(id)}/statistics`, params, opts); }
    cards(id, opts) { return this._get(`/fixtures/${enc(id)}/cards`, null, opts); }
    substitutions(id, opts) { return this._get(`/fixtures/${enc(id)}/substitutions`, null, opts); }

    // These four accept a matchApiId as well as a fixture id.
    odds(id, opts) { return this._get(`/fixtures/${enc(id)}/odds`, null, opts); }
    predictions(id, opts) { return this._get(`/fixtures/${enc(id)}/predictions`, null, opts); }
    liveOdds(id, opts) { return this._get(`/fixtures/${enc(id)}/live-odds`, null, opts); }
    commentary(id, opts) { return this._get(`/fixtures/${enc(id)}/commentary`, null, opts); }
}

export class Standings extends Resource {
    get(leagueId, params, opts) { return this._get(`/standings/${enc(leagueId)}`, params, opts); }
    team(leagueId, teamId, opts) { return this._get(`/standings/${enc(leagueId)}/team/${enc(teamId)}`, null, opts); }
    home(leagueId, params, opts) { return this._get(`/standings/${enc(leagueId)}/home`, params, opts); }
    away(leagueId, params, opts) { return this._get(`/standings/${enc(leagueId)}/away`, params, opts); }
    form(leagueId, params, opts) { return this._get(`/standings/${enc(leagueId)}/form`, params, opts); }
    zones(leagueId, params, opts) { return this._get(`/standings/${enc(leagueId)}/zones`, params, opts); }
}

export class Players extends Resource {
    list(params, opts) { return this._get('/players', params, opts); }
    search(q, params, opts) { return this._get('/players/search', { ...params, q }, opts); }
    /** 2-5 ids, as an array or a comma-joined string. */
    compare(ids, opts) { return this._get('/players/compare', { ids }, opts); }
    top(stat, params, opts) { return this._get(`/players/top/${enc(stat)}`, params, opts); }
    get(id, opts) { return this._get(`/players/${enc(id)}`, null, opts); }
    statistics(id, params, opts) { return this._get(`/players/${enc(id)}/statistics`, params, opts); }
}

export class Coaches extends Resource {
    list(params, opts) { return this._get('/coaches', params, opts); }
    search(q, params, opts) { return this._get('/coaches/search', { ...params, q }, opts); }
    byCountry(country, params, opts) { return this._get(`/coaches/country/${enc(country)}`, params, opts); }
    byTeam(teamId, opts) { return this._get(`/coaches/team/${enc(teamId)}`, null, opts); }
    get(id, opts) { return this._get(`/coaches/${enc(id)}`, null, opts); }
}

export class HeadToHead extends Resource {
    get(team1Id, team2Id, opts) { return this._get(`/h2h/${enc(team1Id)}/${enc(team2Id)}`, null, opts); }
    direct(team1Id, team2Id, params, opts) { return this._get(`/h2h/${enc(team1Id)}/${enc(team2Id)}/direct`, params, opts); }
    stats(team1Id, team2Id, opts) { return this._get(`/h2h/${enc(team1Id)}/${enc(team2Id)}/stats`, null, opts); }
}

export class Results extends Resource {
    list(params, opts) { return this._get('/results', params, opts); }
    today(opts) { return this._get('/results/today', null, opts); }
    yesterday(opts) { return this._get('/results/yesterday', null, opts); }
    stats(params, opts) { return this._get('/results/stats', params, opts); }
    highScoring(params, opts) { return this._get('/results/high-scoring', params, opts); }
    byDate(date, opts) { return this._get(`/results/date/${enc(date)}`, null, opts); }
    byLeague(leagueId, params, opts) { return this._get(`/results/league/${enc(leagueId)}`, params, opts); }
    byTeam(teamId, params, opts) { return this._get(`/results/team/${enc(teamId)}`, params, opts); }
}

export class Videos extends Resource {
    list(params, opts) { return this._get('/videos', params, opts); }
    recent(params, opts) { return this._get('/videos/recent', params, opts); }
    byMatch(matchId, opts) { return this._get(`/videos/match/${enc(matchId)}`, null, opts); }
    byLeague(leagueId, params, opts) { return this._get(`/videos/league/${enc(leagueId)}`, params, opts); }
    byDate(date, params, opts) { return this._get(`/videos/date/${enc(date)}`, params, opts); }
}

export class News extends Resource {
    list(params, opts) { return this._get('/news', params, opts); }
    byMatch(matchId, params, opts) { return this._get(`/news/match/${enc(matchId)}`, params, opts); }
    byTeam(teamId, params, opts) { return this._get(`/news/team/${enc(teamId)}`, params, opts); }
    byLeague(leagueId, params, opts) { return this._get(`/news/league/${enc(leagueId)}`, params, opts); }
    get(id, opts) { return this._get(`/news/${enc(id)}`, null, opts); }
}

export class Odds extends Resource {
    list(params, opts) { return this._get('/odds', params, opts); }
}

export class Predictions extends Resource {
    list(params, opts) { return this._get('/predictions', params, opts); }
}

/**
 * Path segments carry user-supplied ids, dates and country names. `Real Madrid` and
 * ids with reserved characters cannot change which route is hit.
 */
function enc(segment) {
    if (segment === null || segment === undefined || segment === '') {
        throw new TypeError('Path segment is required');
    }
    return encodeURIComponent(String(segment));
}
