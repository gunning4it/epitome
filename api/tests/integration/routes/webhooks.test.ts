/**
 * Integration Tests - Stripe Webhook Endpoint
 *
 * Tests POST /webhooks/stripe:
 * - Missing stripe-signature header returns 400
 * - Invalid signature returns 400
 * - Duplicate event (idempotency) returns { received: true } without processing
 * - Successful event processing returns { received: true }
 *
 * All external services are mocked. No real database connection required.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Stripe from 'stripe';

// Mock ALL stripe service functions
vi.mock('@/services/stripe.service', () => ({
  constructWebhookEvent: vi.fn(),
  insertStripeEvent: vi.fn(),
  handleCheckoutCompleted: vi.fn().mockResolvedValue(undefined),
  handleSubscriptionUpdated: vi.fn().mockResolvedValue(undefined),
  handleSubscriptionDeleted: vi.fn().mockResolvedValue(undefined),
  handleInvoicePaid: vi.fn().mockResolvedValue(undefined),
  handleInvoicePaymentFailed: vi.fn().mockResolvedValue(undefined),
  getSubscription: vi.fn(),
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  getBillingTransactions: vi.fn(),
}));

// Mock logger to suppress output during tests
vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import app from '@/index';
import {
  constructWebhookEvent,
  insertStripeEvent,
  handleCheckoutCompleted,
  handleSubscriptionUpdated,
  handleInvoicePaid,
} from '@/services/stripe.service';

/**
 * Create a minimal Stripe event fixture for testing.
 */
function createStripeEvent(
  type: string,
  data: Record<string, unknown> = {}
): Stripe.Event {
  return {
    id: `evt_test_${Date.now()}`,
    object: 'event',
    type,
    data: {
      object: data,
      previous_attributes: undefined,
    },
    api_version: '2025-01-27.acacia',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
  } as unknown as Stripe.Event;
}

describe('Stripe Webhook Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =====================================================
  // Missing signature
  // =====================================================
  it('should return 400 when stripe-signature header is missing', async () => {
    const response = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ type: 'test' }),
    });

    expect(response.status).toBe(400);
    const json = await response.json() as any;
    expect(json.error).toBe('Missing stripe-signature header');
    // constructWebhookEvent should NOT be called
    expect(constructWebhookEvent).not.toHaveBeenCalled();
  });

  // =====================================================
  // Invalid signature
  // =====================================================
  it('should return 400 for invalid signature', async () => {
    vi.mocked(constructWebhookEvent).mockImplementation(() => {
      throw new Error('Webhook signature verification failed');
    });

    const response = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: new Headers({
        'content-type': 'application/json',
        'stripe-signature': 't=123,v1=bad_signature',
      }),
      body: JSON.stringify({ type: 'test' }),
    });

    expect(response.status).toBe(400);
    const json = await response.json() as any;
    expect(json.error).toBe('Invalid signature');
    expect(constructWebhookEvent).toHaveBeenCalled();
  });

  // =====================================================
  // Idempotency - duplicate event
  // =====================================================
  it('should skip duplicate events (idempotency check)', async () => {
    const event = createStripeEvent('checkout.session.completed', {
      id: 'cs_test_123',
      metadata: { epitome_user_id: 'user-123' },
      subscription: 'sub_123',
    });

    vi.mocked(constructWebhookEvent).mockReturnValue(event);
    // insertStripeEvent returns false => already processed
    vi.mocked(insertStripeEvent).mockResolvedValue(false);

    const response = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: new Headers({
        'content-type': 'application/json',
        'stripe-signature': 't=123,v1=valid_sig',
      }),
      body: JSON.stringify({ type: 'checkout.session.completed' }),
    });

    expect(response.status).toBe(200);
    const json = await response.json() as any;
    expect(json.received).toBe(true);

    // Event handler should NOT be called for duplicate events
    expect(handleCheckoutCompleted).not.toHaveBeenCalled();
  });

  // =====================================================
  // Successful processing - checkout.session.completed
  // =====================================================
  it('should process checkout.session.completed event successfully', async () => {
    const sessionData = {
      id: 'cs_test_456',
      metadata: { epitome_user_id: 'user-456' },
      subscription: 'sub_456',
      customer: 'cus_456',
    };
    const event = createStripeEvent('checkout.session.completed', sessionData);

    vi.mocked(constructWebhookEvent).mockReturnValue(event);
    vi.mocked(insertStripeEvent).mockResolvedValue(true);

    const response = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: new Headers({
        'content-type': 'application/json',
        'stripe-signature': 't=123,v1=valid_sig',
      }),
      body: JSON.stringify(sessionData),
    });

    expect(response.status).toBe(200);
    const json = await response.json() as any;
    expect(json.received).toBe(true);

    expect(constructWebhookEvent).toHaveBeenCalled();
    expect(insertStripeEvent).toHaveBeenCalledWith(event.id, 'checkout.session.completed');
    expect(handleCheckoutCompleted).toHaveBeenCalledWith(sessionData);
  });

  // =====================================================
  // Successful processing - customer.subscription.updated
  // =====================================================
  it('should process customer.subscription.updated event successfully', async () => {
    const subData = {
      id: 'sub_789',
      status: 'active',
      cancel_at_period_end: false,
      items: { data: [{ current_period_start: 1700000000, current_period_end: 1702592000 }] },
    };
    const event = createStripeEvent('customer.subscription.updated', subData);

    vi.mocked(constructWebhookEvent).mockReturnValue(event);
    vi.mocked(insertStripeEvent).mockResolvedValue(true);

    const response = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: new Headers({
        'content-type': 'application/json',
        'stripe-signature': 't=123,v1=valid_sig',
      }),
      body: JSON.stringify(subData),
    });

    expect(response.status).toBe(200);
    const json = await response.json() as any;
    expect(json.received).toBe(true);
    expect(handleSubscriptionUpdated).toHaveBeenCalledWith(subData);
  });

  // =====================================================
  // Successful processing - invoice.paid
  // =====================================================
  it('should process invoice.paid event successfully', async () => {
    const invoiceData = {
      id: 'in_test_001',
      amount_paid: 500,
      currency: 'usd',
      parent: {
        subscription_details: { subscription: 'sub_789' },
      },
      lines: { data: [{ description: 'Pro plan - Monthly' }] },
    };
    const event = createStripeEvent('invoice.paid', invoiceData);

    vi.mocked(constructWebhookEvent).mockReturnValue(event);
    vi.mocked(insertStripeEvent).mockResolvedValue(true);

    const response = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: new Headers({
        'content-type': 'application/json',
        'stripe-signature': 't=123,v1=valid_sig',
      }),
      body: JSON.stringify(invoiceData),
    });

    expect(response.status).toBe(200);
    const json = await response.json() as any;
    expect(json.received).toBe(true);
    expect(handleInvoicePaid).toHaveBeenCalledWith(invoiceData);
  });

  // =====================================================
  // Unhandled event type - still returns 200
  // =====================================================
  it('should return 200 for unhandled event types without errors', async () => {
    const event = createStripeEvent('payment_method.attached', { id: 'pm_123' });

    vi.mocked(constructWebhookEvent).mockReturnValue(event);
    vi.mocked(insertStripeEvent).mockResolvedValue(true);

    const response = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: new Headers({
        'content-type': 'application/json',
        'stripe-signature': 't=123,v1=valid_sig',
      }),
      body: JSON.stringify({ id: 'pm_123' }),
    });

    expect(response.status).toBe(200);
    const json = await response.json() as any;
    expect(json.received).toBe(true);

    // No handler should have been called
    expect(handleCheckoutCompleted).not.toHaveBeenCalled();
    expect(handleSubscriptionUpdated).not.toHaveBeenCalled();
    expect(handleInvoicePaid).not.toHaveBeenCalled();
  });

  // =====================================================
  // Handler error - still returns 200 (prevent Stripe retries)
  // =====================================================
  it('should return 200 even when event handler throws an error', async () => {
    const sessionData = {
      id: 'cs_test_fail',
      metadata: { epitome_user_id: 'user-fail' },
      subscription: 'sub_fail',
    };
    const event = createStripeEvent('checkout.session.completed', sessionData);

    vi.mocked(constructWebhookEvent).mockReturnValue(event);
    vi.mocked(insertStripeEvent).mockResolvedValue(true);
    vi.mocked(handleCheckoutCompleted).mockRejectedValueOnce(
      new Error('Database connection lost')
    );

    const response = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: new Headers({
        'content-type': 'application/json',
        'stripe-signature': 't=123,v1=valid_sig',
      }),
      body: JSON.stringify(sessionData),
    });

    expect(response.status).toBe(200);
    const json = await response.json() as any;
    expect(json.received).toBe(true);
  });
});
