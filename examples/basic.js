// GOAL_API_KEY=... node examples/basic.js
//
// The status section works without a key.
import { GoalApi, RateLimitError, GoalApiError } from '../src/index.js';

const apiKey = process.env.GOAL_API_KEY;
const goal = new GoalApi({ apiKey: apiKey ?? 'unset' });

// --- public status: no API key required -------------------------------------
const status = await goal.status.get();
console.log(`Platform: ${status.status}`);
for (const component of status.components ?? []) {
    console.log(`  ${component.name.padEnd(12)} ${component.status}  24h ${component.uptime?.['24h']}%`);
}

if (!apiKey) {
    console.log('\nSet GOAL_API_KEY to run the authenticated examples.');
    process.exit(0);
}

try {
    // --- live matches -------------------------------------------------------
    const { data: live } = await goal.fixtures.live();
    console.log(`\n${live.length} match(es) in play`);
    for (const m of live.slice(0, 5)) {
        console.log(`  ${m.homeTeam?.name ?? '?'} ${m.homeScore ?? 0}-${m.awayScore ?? 0} ${m.awayTeam?.name ?? '?'}  (${m.minute ?? '?'}')`);
    }

    // --- pick a league and read its table ----------------------------------
    const { data: leagues } = await goal.leagues.list({ isActive: true, limit: 1 });
    const league = leagues[0];
    if (league) {
        console.log(`\nStandings: ${league.name}`);
        const { data: table } = await goal.leagues.standings(league.id);
        for (const row of (Array.isArray(table) ? table : []).slice(0, 5)) {
            console.log(`  ${String(row.position).padStart(2)}. ${(row.team?.name ?? row.teamName ?? '?').padEnd(24)} ${row.points} pts`);
        }

        console.log(`\nTop scorers: ${league.name}`);
        const { data: scorers } = await goal.leagues.topScorers(league.id, { limit: 5 });
        for (const s of Array.isArray(scorers) ? scorers : []) {
            console.log(`  ${(s.player?.name ?? s.name ?? '?').padEnd(24)} ${s.goals ?? 0}`);
        }
    }

    // --- pagination across every team in a league ---------------------------
    if (league) {
        const teams = await goal.collect((p) => goal.leagues.teams(league.id, p));
        console.log(`\n${teams.length} teams in ${league.name}`);
    }

    console.log('\nQuota:', goal.rateLimit);
} catch (error) {
    if (error instanceof RateLimitError) {
        console.error(`Rate limited (${error.rateLimitType}). Retry in ${error.retryAfter}s.`);
    } else if (error instanceof GoalApiError) {
        console.error(`${error.code ?? 'ERROR'}: ${error.message} [${error.correlationId ?? 'no correlation id'}]`);
    } else {
        throw error;
    }
    process.exitCode = 1;
}
