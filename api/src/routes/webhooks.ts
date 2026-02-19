/**
 * Webhook Routes
 *
 * Stripe webhook handler — signature-gated, NOT behind auth middleware.
 * Must be mounted BEFORE the global auth middleware chain in index.ts.
 *
 * Has its own middleware stack: security headers, body limit, error handler.
 */

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { HonoEnv } from '@/types/hono';
import { consumeRateLimit, RateLimitTier } from '@/services/rateLimit.service';
import {
  constructWebhookEvent,
  insertStripeEvent,
  handleCheckoutCompleted,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
} from '@/services/stripe.service';
import { logger } from '@/utils/logger';
import type Stripe from 'stripe';

const webhooks = new Hono<HonoEnv>();

// Dedicated webhook middleware stack:
// 1. Security headers (subset — no CORS needed for server-to-server)
webhooks.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Cache-Control', 'no-store');
});

// 2. Body cap — 256KB (Stripe payloads can include metadata/expanded objects)
webhooks.use('*', bodyLimit({ maxSize: 256 * 1024 }));

// 3. IP-based rate limiting — 100 req/min per IP
webhooks.use('*', async (c, next) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || c.req.header('x-real-ip')
    || 'unknown';
  const result = await consumeRateLimit(`webhook:ip:${ip}`, RateLimitTier.WEBHOOK);
  if (!result.allowed) {
    c.header('Retry-After', String(result.retryAfter || 60));
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }
  return next();
});

// 4. Dedicated error handler — always return 200 to prevent Stripe retries
webhooks.onError((err, c) => {
  logger.error('Webhook error', { error: String(err), path: c.req.path });
  return c.json({ received: true, error: 'Internal processing error' }, 200);
});

/**
 * POST /webhooks/stripe
 * Processes Stripe webhook events with signature verification and idempotency.
 */
webhooks.post('/stripe', async (c) => {
  const rawBody = await c.req.text();
  const sig = c.req.header('stripe-signature');

  if (!sig) {
    return c.json({ error: 'Missing stripe-signature header' }, 400);
  }

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(rawBody, sig);
  } catch (err) {
    logger.warn('Stripe webhook signature verification failed', { error: String(err) });
    return c.json({ error: 'Invalid signature' }, 400);
  }

  // Idempotency check: skip if already processed
  const inserted = await insertStripeEvent(event.id, event.type);
  if (!inserted) {
    return c.json({ received: true }); // Already processed
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      default:
        logger.info('Unhandled Stripe event type', { type: event.type });
    }
  } catch (err) {
    logger.error('Error processing Stripe webhook', { type: event.type, error: String(err) });
    // Return 200 anyway to prevent Stripe retries for app-level errors
    // (Stripe will retry on 5xx, which we want to avoid for handled events)
  }

  return c.json({ received: true });
});

export default webhooks;
