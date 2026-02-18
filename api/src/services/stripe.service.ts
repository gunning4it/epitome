/**
 * Stripe Service
 *
 * Handles Stripe Checkout, Customer Portal, subscription lifecycle,
 * and webhook event processing.
 */

import Stripe from 'stripe';
import { db, sql, type TransactionSql } from '@/db/client';
import { subscriptions, stripeEvents, billingTransactions } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/utils/logger';

// Initialize Stripe client (lazy — only when STRIPE_SECRET_KEY is set)
let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
    _stripe = new Stripe(key, { apiVersion: '2025-01-27.acacia' as any });
  }
  return _stripe;
}

// =====================================================
// CHECKOUT & PORTAL
// =====================================================

/**
 * Create a Stripe Checkout session for Pro subscription ($5/mo).
 */
export async function createCheckoutSession(userId: string, email: string): Promise<string> {
  const stripe = getStripe();
  const priceId = process.env.STRIPE_PRO_PRICE_ID;
  if (!priceId) throw new Error('STRIPE_PRO_PRICE_ID is not configured');

  // Find or create Stripe customer
  let customerId = await getStripeCustomerId(userId);
  if (!customerId) {
    const customer = await stripe.customers.create({
      email,
      metadata: { epitome_user_id: userId },
    });
    customerId = customer.id;

    // Store customer ID in subscriptions table (incomplete record)
    await db.insert(subscriptions).values({
      userId,
      stripeCustomerId: customerId,
      status: 'incomplete',
    }).onConflictDoUpdate({
      target: [subscriptions.userId],
      set: { stripeCustomerId: customerId, updatedAt: new Date() },
    });
  }

  const baseUrl = process.env.CORS_ORIGIN || 'http://localhost:5173';
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/billing?success=true`,
    cancel_url: `${baseUrl}/billing?canceled=true`,
    metadata: { epitome_user_id: userId },
  });

  return session.url!;
}

/**
 * Create a Stripe Customer Portal session for managing subscriptions.
 */
export async function createPortalSession(userId: string): Promise<string> {
  const stripe = getStripe();

  const customerId = await getStripeCustomerId(userId);
  if (!customerId) {
    throw new Error('No Stripe customer found for this user');
  }

  const baseUrl = process.env.CORS_ORIGIN || 'http://localhost:5173';
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${baseUrl}/billing`,
  });

  return session.url;
}

/**
 * Get Stripe customer ID for a user.
 */
async function getStripeCustomerId(userId: string): Promise<string | null> {
  const [sub] = await db
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  return sub?.stripeCustomerId || null;
}

// =====================================================
// SUBSCRIPTION QUERIES
// =====================================================

/**
 * Get subscription data for a user.
 */
export async function getSubscription(userId: string): Promise<{
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  stripePriceId: string | null;
} | null> {
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  if (!sub || sub.status === 'incomplete') return null;

  return {
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd?.toISOString() || null,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    stripePriceId: sub.stripePriceId,
  };
}

// =====================================================
// HELPERS
// =====================================================

/**
 * Extract subscription ID from a Stripe Invoice.
 * In Stripe v20+, this moved from `invoice.subscription` to
 * `invoice.parent.subscription_details.subscription`.
 */
function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const subDetail = invoice.parent?.subscription_details;
  if (!subDetail) return null;
  const sub = subDetail.subscription;
  if (typeof sub === 'string') return sub;
  if (sub && typeof sub === 'object' && 'id' in sub) return sub.id;
  return null;
}

// =====================================================
// WEBHOOK HANDLERS
// =====================================================

/**
 * Insert a Stripe event for idempotency. Returns false if already processed.
 */
export async function insertStripeEvent(eventId: string, eventType: string): Promise<boolean> {
  try {
    await db.insert(stripeEvents).values({ eventId, eventType });
    return true;
  } catch (err: any) {
    // Unique constraint violation means already processed
    if (err.code === '23505' || err.message?.includes('duplicate key')) {
      return false;
    }
    throw err;
  }
}

/**
 * Propagate tier change to users and their active API keys.
 */
async function propagateTierChange(userId: string, newTier: 'free' | 'pro' | 'enterprise'): Promise<void> {
  await sql.begin(async (rawTx) => {
    const tx = rawTx as TransactionSql;
    await tx`UPDATE users SET tier = ${newTier}, updated_at = NOW() WHERE id = ${userId}`;
    // Only update active (non-revoked) API keys
    await tx`UPDATE api_keys SET tier = ${newTier} WHERE user_id = ${userId} AND revoked_at IS NULL`;
  });
}

/**
 * Handle checkout.session.completed
 */
export async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.epitome_user_id;
  if (!userId) {
    logger.warn('Checkout completed without epitome_user_id metadata', { sessionId: session.id });
    return;
  }

  const subscriptionId = session.subscription as string;
  if (!subscriptionId) return;

  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(subscriptionId);

  // In Stripe v20+, current_period_start/end moved to SubscriptionItem
  const firstItem = sub.items.data[0];
  const periodStart = firstItem?.current_period_start
    ? new Date(firstItem.current_period_start * 1000)
    : new Date();
  const periodEnd = firstItem?.current_period_end
    ? new Date(firstItem.current_period_end * 1000)
    : new Date();

  await db.insert(subscriptions).values({
    userId,
    stripeCustomerId: session.customer as string,
    stripeSubscriptionId: sub.id,
    stripePriceId: firstItem?.price?.id || null,
    status: sub.status as any,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
  }).onConflictDoUpdate({
    target: [subscriptions.userId],
    set: {
      stripeSubscriptionId: sub.id,
      stripePriceId: firstItem?.price?.id || null,
      status: sub.status as any,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      updatedAt: new Date(),
    },
  });

  await propagateTierChange(userId, 'pro');
}

/**
 * Handle customer.subscription.updated
 */
export async function handleSubscriptionUpdated(sub: Stripe.Subscription): Promise<void> {
  // Find user by subscription ID
  const [record] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, sub.id))
    .limit(1);

  if (!record) {
    logger.warn('Subscription updated but no record found', { subscriptionId: sub.id });
    return;
  }

  // In Stripe v20+, current_period_start/end moved to SubscriptionItem
  const firstItem = sub.items.data[0];

  await db.update(subscriptions)
    .set({
      status: sub.status as any,
      currentPeriodStart: firstItem?.current_period_start
        ? new Date(firstItem.current_period_start * 1000) : undefined,
      currentPeriodEnd: firstItem?.current_period_end
        ? new Date(firstItem.current_period_end * 1000) : undefined,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, record.id));

  // Tier propagation based on status
  if (sub.status === 'active') {
    await propagateTierChange(record.userId, 'pro');
  } else if (sub.status === 'canceled' || sub.status === 'unpaid') {
    await propagateTierChange(record.userId, 'free');
  }
}

/**
 * Handle customer.subscription.deleted
 */
export async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const [record] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, sub.id))
    .limit(1);

  if (!record) return;

  await db.update(subscriptions)
    .set({
      status: 'canceled',
      canceledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, record.id));

  await propagateTierChange(record.userId, 'free');
}

/**
 * Handle invoice.paid — record billing transaction
 */
export async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  // In Stripe v20+, subscription is under parent.subscription_details
  const subId = getInvoiceSubscriptionId(invoice);
  if (!subId) return;

  const [record] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subId))
    .limit(1);

  if (!record) return;

  try {
    await db.insert(billingTransactions).values({
      userId: record.userId,
      paymentType: 'stripe',
      stripeInvoiceId: invoice.id,
      stripePaymentIntentId: null,
      amountMicros: (invoice.amount_paid || 0) * 10000, // cents → micros
      currency: invoice.currency || 'usd',
      asset: 'usd',
      status: 'succeeded',
      description: `Pro subscription - ${invoice.lines?.data?.[0]?.description || 'Monthly'}`,
    });
  } catch (err: any) {
    // Ignore duplicate (idempotent via unique partial index)
    if (err.code !== '23505' && !err.message?.includes('duplicate key')) {
      throw err;
    }
  }
}

/**
 * Handle invoice.payment_failed — record failed transaction
 */
export async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  // In Stripe v20+, subscription is under parent.subscription_details
  const subId = getInvoiceSubscriptionId(invoice);
  if (!subId) return;

  const [record] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subId))
    .limit(1);

  if (!record) return;

  try {
    await db.insert(billingTransactions).values({
      userId: record.userId,
      paymentType: 'stripe',
      stripeInvoiceId: invoice.id,
      stripePaymentIntentId: null,
      amountMicros: (invoice.amount_due || 0) * 10000,
      currency: invoice.currency || 'usd',
      asset: 'usd',
      status: 'failed',
      description: `Payment failed - ${invoice.lines?.data?.[0]?.description || 'Monthly'}`,
    });
  } catch (err: any) {
    if (err.code !== '23505' && !err.message?.includes('duplicate key')) {
      throw err;
    }
  }
}

/**
 * Construct and verify a Stripe webhook event from raw body + signature.
 */
export function constructWebhookEvent(rawBody: string, signature: string): Stripe.Event {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

/**
 * Record an x402 payment as a billing transaction.
 */
export async function recordX402Payment(userId: string, txDetails: {
  txHash?: string;
  network?: string;
  amountMicros: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(billingTransactions).values({
    userId,
    paymentType: 'x402',
    x402TxHash: txDetails.txHash || null,
    x402Network: txDetails.network || null,
    amountMicros: txDetails.amountMicros,
    currency: 'usd',
    asset: 'usdc',
    status: 'succeeded',
    description: 'MCP tool call (x402)',
    metadata: txDetails.metadata || {},
  });
}

/**
 * Get billing transactions for a user (paginated).
 */
export async function getBillingTransactions(
  userId: string,
  limit: number = 50,
  offset: number = 0
): Promise<{ transactions: any[]; total: number }> {
  const rows = await sql`
    SELECT * FROM public.billing_transactions
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  const countRows = await sql`
    SELECT COUNT(*)::int AS total FROM public.billing_transactions WHERE user_id = ${userId}
  `;

  return {
    transactions: rows.map(r => ({
      id: r.id,
      paymentType: r.payment_type,
      amountMicros: Number(r.amount_micros),
      currency: r.currency,
      asset: r.asset,
      status: r.status,
      description: r.description,
      stripeInvoiceId: r.stripe_invoice_id,
      x402TxHash: r.x402_tx_hash,
      x402Network: r.x402_network,
      createdAt: r.created_at,
    })),
    total: countRows[0]?.total ?? 0,
  };
}
