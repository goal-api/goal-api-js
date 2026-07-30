// GOAL_API_KEY=... node examples/live-scores.js
//
// Connects to the live socket, subscribes to whatever is in play, and prints every frame
// the server sends. Exits non-zero if nothing arrives, so it is usable as a smoke test.
import { GoalApi, GoalApiError } from '../src/index.js';

const apiKey = process.env.GOAL_API_KEY;
if (!apiKey) {
    console.error('GOAL_API_KEY is not set.');
    process.exit(2);
}

const goal = new GoalApi({ apiKey });
const listenSeconds = Number(process.env.LISTEN_SECONDS ?? 30);

const { data: live } = await goal.fixtures.live();
console.log(`${live.length} match(es) in play`);
for (const match of live.slice(0, 5)) {
    console.log(`  ${match.id}  ${match.homeTeam?.name ?? '?'} v ${match.awayTeam?.name ?? '?'}`);
}

const feed = goal.live();
const seen = new Map();
const count = (type) => seen.set(type, (seen.get(type) ?? 0) + 1);

feed.on('*', (message) => count(message.type));

feed.on('auth_success', ({ data }) => {
    console.log(`\nauthenticated: plan=${data?.plan} maxSubscriptions=${data?.maxSubscriptions}`);
    if (data?.maxSubscriptions === 0) {
        console.warn('  this plan allows 0 concurrent subscriptions, so no match_update can arrive');
    }
});

feed.on('subscribe_response', (message) => {
    if (message.success) console.log(`  subscribed: ${JSON.stringify(message.data)}`);
    else console.warn(`  subscribe rejected: ${message.error?.code} ${message.error?.message}`);
});

feed.on('match_update', ({ data }) => {
    console.log(`  UPDATE  ${data?.homeTeam?.name ?? '?'} ${data?.homeScore}-${data?.awayScore} ` +
                `${data?.awayTeam?.name ?? '?'}  ${data?.minute ?? '?'}'`);
});

feed.on('pong', () => console.log('  pong'));
feed.on('error', (error) => console.error(`  error: ${error.message ?? JSON.stringify(error)}`));
feed.on('close', ({ code, reason }) => console.log(`  closed (${code}${reason ? `: ${reason}` : ''})`));

try {
    await feed.connect();
} catch (error) {
    console.error(`\nconnect failed: ${error instanceof GoalApiError ? error.message : error}`);
    process.exit(1);
}

for (const match of live.slice(0, 5)) feed.subscribe(match.id);
feed.listSubscriptions();
feed.ping();

console.log(`\nlistening for ${listenSeconds}s ...`);
await new Promise((resolve) => setTimeout(resolve, listenSeconds * 1000));

feed.close();
console.log(`\nreceived: ${JSON.stringify(Object.fromEntries(seen))}`);

if (!seen.has('auth_success')) {
    console.error('nothing was received from the socket');
    process.exit(1);
}
