/**
 * Integration Tests - Billing API Endpoints
 *
 * Tests all billing endpoints:
 * - GET /v1/billing/usage
 * - GET /v1/billing/subscription
 * - POST /v1/billing/checkout
 * - POST /v1/billing/portal
 * - GET /v1/billing/transactions
 *
 * All external services (stripe, metering, DB) are mocked.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock metering service
vi.mock('@/services/metering.service', () => ({
  getCurrentUsage: vi.fn().mockResolvedValue({
    tables: 3,
    agents: 2,
    graphEntities: 47,
  }),
  getTierLimits: vi.fn().mockResolvedValue({
    maxTables: 5,
    maxAgents: 3,
    maxGraphEntities: 100,
    auditRetentionDays: 30,
  }),
}));

// Mock stripe service
vi.mock('@/services/stripe.service', () => ({
  getSubscription: vi.fn().mockResolvedValue(null),
  createCheckoutSession: vi.fn().mockResolvedValue('https://checkout.stripe.com/test-session'),
  createPortalSession: vi.fn().mockResolvedValue('https://billing.stripe.com/test-portal'),
  getBillingTransactions: vi.fn().mockResolvedValue({
    transactions: [
      {
        id: 'txn-1',
        paymentType: 'stripe',
        amountMicros: 50000000,
        currency: 'usd',
        asset: 'usd',
        status: 'succeeded',
        description: 'Pro subscription - Monthly',
        stripeInvoiceId: 'in_test_123',
        x402TxHash: null,
        x402Network: null,
        createdAt: '2026-02-01T00:00:00.000Z',
      },
    ],
    total: 1,
  }),
}));

// Mock DB client (sql tagged template used for usage history query)
vi.mock('@/db/client', () => {
  const sqlTaggedTemplate = () => Promise.resolve([]);
  // Make it behave like a tagged template function AND have properties
  Object.assign(sqlTaggedTemplate, {
    begin: vi.fn(),
    end: vi.fn(),
  });
  return {
    sql: sqlTaggedTemplate,
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { email: 'test@example.com' },
            ]),
          }),
        }),
      }),
    },
  };
});

// Mock DB schema
vi.mock('@/db/schema', () => ({
  users: { id: 'id', email: 'email' },
}));

// Mock drizzle-orm eq
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
}));

import app from '@/index';
import { getCurrentUsage, getTierLimits } from '@/services/metering.service';
import {
  getSubscription,
  createCheckoutSession,
  createPortalSession,
  getBillingTransactions,
} from '@/services/stripe.service';
import { db } from '@/db/client';

const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440000';

/**
 * Create session auth headers for billing routes (dashboard-only).
 */
function sessionHeaders(): Headers {
  const headers = new Headers();
  headers.set('x-test-user-id', TEST_USER_ID);
  headers.set('x-test-auth-type', 'session');
  headers.set('content-type', 'application/json');
  return headers;
}

describe('Billing API Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =====================================================
  // GET /v1/billing/usage
  // =====================================================
  describe('GET /v1/billing/usage', () => {
    it('should return current usage, limits, and history', async () => {
      const response = await app.request('/v1/billing/usage', {
        method: 'GET',
        headers: sessionHeaders(),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;

      // Current usage
      expect(json.current).toEqual({
        tables: 3,
        agents: 2,
        graphEntities: 47,
      });

      // Limits
      expect(json.limits).toEqual({
        maxTables: 5,
        maxAgents: 3,
        maxGraphEntities: 100,
      });

      // History (empty since sql mock returns [])
      expect(json.history).toEqual([]);

      expect(getCurrentUsage).toHaveBeenCalledWith(TEST_USER_ID);
      expect(getTierLimits).toHaveBeenCalled();
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/billing/usage', {
        method: 'GET',
      });

      expect(response.status).toBe(401);
    });
  });

  // =====================================================
  // GET /v1/billing/subscription
  // =====================================================
  describe('GET /v1/billing/subscription', () => {
    it('should return null for free tier users', async () => {
      const response = await app.request('/v1/billing/subscription', {
        method: 'GET',
        headers: sessionHeaders(),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.subscription).toBeNull();
      expect(getSubscription).toHaveBeenCalledWith(TEST_USER_ID);
    });

    it('should return subscription data for pro users', async () => {
      const subData = {
        status: 'active',
        currentPeriodEnd: '2026-03-15T00:00:00.000Z',
        cancelAtPeriodEnd: false,
        stripePriceId: 'price_pro_monthly',
      };
      vi.mocked(getSubscription).mockResolvedValueOnce(subData);

      const response = await app.request('/v1/billing/subscription', {
        method: 'GET',
        headers: sessionHeaders(),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.subscription).toEqual(subData);
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/billing/subscription', {
        method: 'GET',
      });

      expect(response.status).toBe(401);
    });
  });

  // =====================================================
  // POST /v1/billing/checkout
  // =====================================================
  describe('POST /v1/billing/checkout', () => {
    it('should return checkout URL', async () => {
      const response = await app.request('/v1/billing/checkout', {
        method: 'POST',
        headers: sessionHeaders(),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.url).toBe('https://checkout.stripe.com/test-session');
      expect(createCheckoutSession).toHaveBeenCalledWith(TEST_USER_ID, 'test@example.com');
    });

    it('should return 404 when user is not found', async () => {
      // Override db.select chain to return empty array
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as any);

      const response = await app.request('/v1/billing/checkout', {
        method: 'POST',
        headers: sessionHeaders(),
      });

      expect(response.status).toBe(404);
      const json = await response.json() as any;
      expect(json.error.code).toBe('USER_NOT_FOUND');
    });

    it('should return 500 when Stripe checkout fails', async () => {
      vi.mocked(createCheckoutSession).mockRejectedValueOnce(
        new Error('Stripe API error')
      );

      const response = await app.request('/v1/billing/checkout', {
        method: 'POST',
        headers: sessionHeaders(),
      });

      expect(response.status).toBe(500);
      const json = await response.json() as any;
      expect(json.error.code).toBe('CHECKOUT_ERROR');
      expect(json.error.message).toBe('Stripe API error');
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/billing/checkout', {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
      });

      expect(response.status).toBe(401);
    });
  });

  // =====================================================
  // POST /v1/billing/portal
  // =====================================================
  describe('POST /v1/billing/portal', () => {
    it('should return portal URL', async () => {
      const response = await app.request('/v1/billing/portal', {
        method: 'POST',
        headers: sessionHeaders(),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.url).toBe('https://billing.stripe.com/test-portal');
      expect(createPortalSession).toHaveBeenCalledWith(TEST_USER_ID);
    });

    it('should return 500 when Stripe portal fails', async () => {
      vi.mocked(createPortalSession).mockRejectedValueOnce(
        new Error('No Stripe customer found for this user')
      );

      const response = await app.request('/v1/billing/portal', {
        method: 'POST',
        headers: sessionHeaders(),
      });

      expect(response.status).toBe(500);
      const json = await response.json() as any;
      expect(json.error.code).toBe('PORTAL_ERROR');
      expect(json.error.message).toBe('No Stripe customer found for this user');
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/billing/portal', {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
      });

      expect(response.status).toBe(401);
    });
  });

  // =====================================================
  // GET /v1/billing/transactions
  // =====================================================
  describe('GET /v1/billing/transactions', () => {
    it('should return paginated transaction results', async () => {
      const response = await app.request('/v1/billing/transactions', {
        method: 'GET',
        headers: sessionHeaders(),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;

      expect(json.data).toHaveLength(1);
      expect(json.data[0].id).toBe('txn-1');
      expect(json.data[0].paymentType).toBe('stripe');
      expect(json.data[0].amountMicros).toBe(50000000);

      expect(json.meta).toEqual({
        total: 1,
        limit: 50,
        offset: 0,
      });

      expect(getBillingTransactions).toHaveBeenCalledWith(TEST_USER_ID, 50, 0);
    });

    it('should pass custom limit and offset query params', async () => {
      const response = await app.request('/v1/billing/transactions?limit=10&offset=20', {
        method: 'GET',
        headers: sessionHeaders(),
      });

      expect(response.status).toBe(200);
      expect(getBillingTransactions).toHaveBeenCalledWith(TEST_USER_ID, 10, 20);
    });

    it('should return empty data array when no transactions', async () => {
      vi.mocked(getBillingTransactions).mockResolvedValueOnce({
        transactions: [],
        total: 0,
      });

      const response = await app.request('/v1/billing/transactions', {
        method: 'GET',
        headers: sessionHeaders(),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data).toEqual([]);
      expect(json.meta.total).toBe(0);
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/billing/transactions', {
        method: 'GET',
      });

      expect(response.status).toBe(401);
    });
  });
});
