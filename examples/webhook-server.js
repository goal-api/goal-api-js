// GOAL_WEBHOOK_SECRET=... node examples/webhook-server.js
//
// A minimal receiver for GOAL API webhooks, with no framework. The important part is that
// verification runs on the raw bytes: any JSON middleware that parses and re-serialises
// changes the byte order and breaks the HMAC.
import http from 'node:http';
import { verifyWebhook, WebhookSignatureError, WEBHOOK_EVENTS } from '../src/index.js';

const secret = process.env.GOAL_WEBHOOK_SECRET;
if (!secret) {
    console.error('GOAL_WEBHOOK_SECRET is not set.');
    process.exit(2);
}
const port = Number(process.env.PORT ?? 3100);

const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/goal-webhooks') {
        res.writeHead(404).end();
        return;
    }

    // Collect the raw bytes. Do not JSON.parse before verifying.
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
        const raw = Buffer.concat(chunks);
        let event;
        try {
            event = verifyWebhook(raw, req.headers['x-goal-signature'], secret);
        } catch (error) {
            if (error instanceof WebhookSignatureError) {
                console.warn(`rejected: ${error.message}`);
                res.writeHead(400).end();
                return;
            }
            throw error;
        }

        const type = req.headers['x-goal-event'];
        const delivery = req.headers['x-goal-delivery'];
        console.log(`${type}  delivery=${delivery}`);

        switch (type) {
            case 'goal.scored':
                console.log(`  ${event.homeTeam?.name} ${event.homeScore}-${event.awayScore} ${event.awayTeam?.name}`);
                break;
            case 'match.finished':
                console.log('  full time');
                break;
            default:
                console.log(`  ${JSON.stringify(event).slice(0, 120)}`);
        }

        // Ack fast. The server retries at ~1m, 5m, 25m, 2h, 10h, so slow handlers get
        // duplicate deliveries; do the real work off this request.
        res.writeHead(200).end();
    });
});

server.listen(port, () => {
    console.log(`listening on http://localhost:${port}/goal-webhooks`);
    console.log(`events: ${WEBHOOK_EVENTS.join(', ')}`);
});
