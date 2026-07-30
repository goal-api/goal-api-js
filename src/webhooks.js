import crypto from 'node:crypto';
import { GoalApiError } from './errors.js';

export const WEBHOOK_EVENTS = Object.freeze([
    'match.started',
    'match.finished',
    'goal.scored',
    'score.changed',
    'match.status_changed',
]);

export const SIGNATURE_HEADER = 'x-goal-signature';
export const EVENT_HEADER = 'x-goal-event';
export const DELIVERY_HEADER = 'x-goal-delivery';

export class WebhookSignatureError extends GoalApiError {}

/**
 * Verifies an inbound webhook and returns the parsed event.
 *
 * `payload` must be the raw body. JSON middleware reorders keys and changes whitespace,
 * which breaks the HMAC:
 *
 *   app.post('/hooks', express.raw({ type: 'application/json' }), (req, res) => {
 *     const event = verifyWebhook(req.body, req.headers['x-goal-signature'], SECRET);
 *   });
 *
 * Throws WebhookSignatureError on a bad signature, or a timestamp older than
 * `tolerance` seconds (replay protection).
 */
export function verifyWebhook(payload, signatureHeader, secret, { tolerance = 300 } = {}) {
    if (!secret) throw new WebhookSignatureError('Webhook secret is required');
    if (!signatureHeader) throw new WebhookSignatureError('Missing X-Goal-Signature header');

    const raw = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload);
    const { timestamp, signature } = parseSignatureHeader(signatureHeader);

    const expected = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${raw}`)
        .digest('hex');

    // Same digest length either way, so timingSafeEqual won't throw on a mismatch.
    const ok = crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
    if (!ok) throw new WebhookSignatureError('Webhook signature does not match');

    if (tolerance > 0) {
        const age = Math.floor(Date.now() / 1000) - timestamp;
        if (Math.abs(age) > tolerance) {
            throw new WebhookSignatureError(`Webhook timestamp is ${age}s old, outside the ${tolerance}s tolerance`);
        }
    }

    try {
        return JSON.parse(raw);
    } catch (error) {
        throw new WebhookSignatureError('Webhook body is not valid JSON', { cause: error });
    }
}

function parseSignatureHeader(header) {
    let timestamp = null;
    let signature = null;

    for (const part of String(header).split(',')) {
        const [key, value] = part.split('=', 2).map((s) => s?.trim());
        if (key === 't') timestamp = Number.parseInt(value, 10);
        else if (key === 'v1') signature = value;
    }

    if (!Number.isInteger(timestamp) || !signature || !/^[0-9a-f]+$/i.test(signature)) {
        throw new WebhookSignatureError(`Malformed X-Goal-Signature header: ${header}`);
    }
    return { timestamp, signature };
}
