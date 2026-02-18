/**
 * Billing Routes
 *
 * Endpoints for subscription management, usage data, and billing history.
 * All routes require session authentication (dashboard-only).
 */

import { Hono } from 'hono';
import type { HonoEnv } from '@/types/hono';
import { requireAuth } from '@/middleware/auth';
import {
  createCheckoutSession,
  createPortalSession,
  getSubscription,
  getBillingTransactions,
} from '@/services/stripe.service';
import { getCurrentUsage, getTierLimits } from '@/services/metering.service';
import { sql } from '@/db/client';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

const billing = new Hono<HonoEnv>();

// All billing routes require session auth
billing.use('*', requireAuth);

/**
 * GET /v1/billing/usage
 * Current counts + limits + 30d history + agent breakdown
 */
billing.get('/usage', async (c) => {
  const userId = c.get('userId') as string;
  const tier = (c.get('tier') as string) || 'free';

  const [current, limits] = await Promise.all([
    getCurrentUsage(userId),
    getTierLimits(tier as 'free' | 'pro' | 'enterprise'),
  ]);

  // 30-day usage history
  const history = await sql`
    SELECT resource, period_date, count, agent_id
    FROM public.usage_records
    WHERE user_id = ${userId}
      AND period_date >= CURRENT_DATE - INTERVAL '30 days'
    ORDER BY period_date ASC
  `;

  return c.json({
    current: {
      tables: current.tables,
      agents: current.agents,
      graphEntities: current.graphEntities,
    },
    limits: {
      maxTables: limits.maxTables,
      maxAgents: limits.maxAgents,
      maxGraphEntities: limits.maxGraphEntities,
    },
    history: history.map(r => ({
      resource: r.resource,
      date: r.period_date,
      count: r.count,
      agentId: r.agent_id,
    })),
  });
});

/**
 * GET /v1/billing/subscription
 * Subscription status (or null for free tier)
 */
billing.get('/subscription', async (c) => {
  const userId = c.get('userId') as string;
  const subscription = await getSubscription(userId);
  return c.json({ subscription });
});

/**
 * POST /v1/billing/checkout
 * Create Stripe Checkout session → return { url }
 */
billing.post('/checkout', async (c) => {
  const userId = c.get('userId') as string;

  // Get user email
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return c.json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } }, 404);
  }

  try {
    const url = await createCheckoutSession(userId, user.email);
    return c.json({ url });
  } catch (err) {
    return c.json({
      error: { code: 'CHECKOUT_ERROR', message: err instanceof Error ? err.message : 'Failed to create checkout session' },
    }, 500);
  }
});

/**
 * POST /v1/billing/portal
 * Create Stripe Customer Portal session → return { url }
 */
billing.post('/portal', async (c) => {
  const userId = c.get('userId') as string;

  try {
    const url = await createPortalSession(userId);
    return c.json({ url });
  } catch (err) {
    return c.json({
      error: { code: 'PORTAL_ERROR', message: err instanceof Error ? err.message : 'Failed to create portal session' },
    }, 500);
  }
});

/**
 * GET /v1/billing/transactions
 * Paginated billing history
 */
billing.get('/transactions', async (c) => {
  const userId = c.get('userId') as string;
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  const { transactions, total } = await getBillingTransactions(userId, limit, offset);

  return c.json({
    data: transactions,
    meta: { total, limit, offset },
  });
});

export default billing;
