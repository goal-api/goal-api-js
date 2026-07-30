// GOAL_API_KEY=... node examples/bulk-export.js > teams.csv
//
// Walks every page of a collection and streams it out as CSV. Shows paginate() doing the
// page walking, and how limit ceilings differ per endpoint.
import { GoalApi } from '../src/index.js';

const apiKey = process.env.GOAL_API_KEY;
if (!apiKey) {
    console.error('GOAL_API_KEY is not set.');
    process.exit(2);
}

const goal = new GoalApi({ apiKey });

// Piping into `head` closes stdout early; that is a clean exit, not a crash.
process.stdout.on('error', (error) => {
    if (error.code === 'EPIPE') process.exit(0);
    throw error;
});

const csv = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

// /countries accepts limit up to 500; most endpoints cap at 100.
process.stdout.write('id,name,code,isActive\n');
let rows = 0;
for await (const country of goal.paginate((p) => goal.countries.list(p), { pageSize: 500 })) {
    process.stdout.write([country.id, country.name, country.code, country.isActive].map(csv).join(',') + '\n');
    rows++;
}

console.error(`\n${rows} countries exported`);
console.error(`quota: ${goal.rateLimit.remaining}/${goal.rateLimit.limit} left`);
