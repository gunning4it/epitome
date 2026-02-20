/**
 * Integration Tests - x402 Payment Middleware
 *
 * Tests the x402 middleware behavior in the MCP route via app.request().
 * The x402 service internals are mocked to control ready/degraded/disabled states.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestUser, cleanupTestUser, type TestUser } from '../../helpers/db';
import { createTestAuthHeaders, createTestSessionHeaders } from '../../helpers/app';
import { grantConsent } from '@/services/consent.service';

// =====================================================
// Mocks — control x402 service state per test
// =====================================================

const { mockGetMiddleware, mockIsEnabled, mockInitialize, mockGetStatus, mockReset } = vi.hoisted(() => {
  const mockGetMiddleware = vi.fn().mockReturnValue(null);
  const mockIsEnabled = vi.fn().mockReturnValue(false);
  const mockInitialize = vi.fn().mockResolvedValue(undefined);
  const mockGetStatus = vi.fn().mockReturnValue({ status: 'disabled', reason: null });
  const mockReset = vi.fn();

  return { mockGetMiddleware, mockIsEnabled, mockInitialize, mockGetStatus, mockReset };
});

vi.mock('@/services/x402.service', () => ({
  x402Service: {
    getMiddleware: mockGetMiddleware,
    isEnabled: mockIsEnabled,
    initialize: mockInitialize,
    getStatus: mockGetStatus,
    _reset: mockReset,
  },
}));

// Must import app AFTER mocks
import app from '@/index';

// =====================================================
// Helpers
// =====================================================

const MCP_PATH = '/mcp';

function mcpBody(method = 'tools/list') {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method,
    params: {},
  });
}

// =====================================================
// Tests
// =====================================================

describe('x402 Middleware Integration', () => {
  let testUser: TestUser;

  beforeEach(async () => {
    testUser = await createTestUser();
    vi.clearAllMocks();

    // Grant MCP consent for test agent
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'mcp',
      permission: 'read',
    });
  });

  afterEach(async () => {
    await cleanupTestUser(testUser.userId);
  });

  describe('x402 disabled', () => {
    it('should pass through when x402 is disabled (free-tier agent gets normal auth flow)', async () => {
      mockIsEnabled.mockReturnValue(false);

      const headers = createTestAuthHeaders(testUser);
      const response = await app.request(MCP_PATH, {
        method: 'POST',
        headers,
        body: mcpBody(),
      });

      // Should reach the MCP handler (not blocked by x402)
      // The MCP handler will process the request normally
      expect(response.status).not.toBe(503);
      expect(response.status).not.toBe(402);
    });
  });

  describe('x402 degraded', () => {
    it('should fail open when x402 is enabled but degraded (free-tier still served)', async () => {
      mockIsEnabled.mockReturnValue(true);
      mockGetMiddleware.mockReturnValue(null); // degraded — no middleware available
      mockInitialize.mockResolvedValue(undefined); // init runs but still no middleware
      mockGetStatus.mockReturnValue({ status: 'degraded', reason: 'Facilitator error' });

      const headers = createTestAuthHeaders(testUser);
      const response = await app.request(MCP_PATH, {
        method: 'POST',
        headers,
        body: mcpBody(),
      });

      // Fail open: request should reach MCP handler, not get blocked with 503
      expect(response.status).not.toBe(503);
      expect(response.status).not.toBe(402);
    });
  });

  describe('pro-tier bypass', () => {
    it('should bypass x402 for pro-tier users', async () => {
      mockIsEnabled.mockReturnValue(true);

      const headers = createTestAuthHeaders(testUser);
      headers.set('x-test-tier', 'pro');

      const response = await app.request(MCP_PATH, {
        method: 'POST',
        headers,
        body: mcpBody(),
      });

      // Should not hit x402 at all — no 503 or 402
      expect(response.status).not.toBe(503);
      expect(response.status).not.toBe(402);
      // x402 middleware should not have been invoked
      expect(mockGetMiddleware).not.toHaveBeenCalled();
    });
  });

  describe('session-auth bypass', () => {
    it('should bypass x402 for session-authenticated users', async () => {
      mockIsEnabled.mockReturnValue(true);

      const headers = createTestSessionHeaders(testUser);
      const response = await app.request(MCP_PATH, {
        method: 'POST',
        headers,
        body: mcpBody(),
      });

      // Session auth should bypass x402
      expect(response.status).not.toBe(503);
      expect(response.status).not.toBe(402);
      expect(mockGetMiddleware).not.toHaveBeenCalled();
    });
  });

  describe('x402 ready — middleware invocation', () => {
    it('should invoke x402 middleware for free-tier agent requests', async () => {
      const fakeMiddleware = vi.fn(async (_c: any, next: () => Promise<void>) => {
        await next();
      });

      mockIsEnabled.mockReturnValue(true);
      mockGetMiddleware.mockReturnValue(fakeMiddleware);

      const headers = createTestAuthHeaders(testUser);
      const response = await app.request(MCP_PATH, {
        method: 'POST',
        headers,
        body: mcpBody(),
      });

      // Middleware was called
      expect(fakeMiddleware).toHaveBeenCalled();
      // Request should reach the MCP handler
      expect(response.status).not.toBe(503);
    });

    it('should set x402Paid flag when payment-signature header is present', async () => {
      let capturedX402Paid = false;

      // Fake middleware that calls next() — simulating payment verification success
      const fakeMiddleware = vi.fn(async (c: any, next: () => Promise<void>) => {
        await next();
        // After inner next runs, check if x402Paid was set
        capturedX402Paid = c.get('x402Paid') === true;
      });

      mockIsEnabled.mockReturnValue(true);
      mockGetMiddleware.mockReturnValue(fakeMiddleware);

      const headers = createTestAuthHeaders(testUser);
      headers.set('payment-signature', 'test-payment-sig');

      const response = await app.request(MCP_PATH, {
        method: 'POST',
        headers,
        body: mcpBody(),
      });

      expect(fakeMiddleware).toHaveBeenCalled();
      expect(capturedX402Paid).toBe(true);
    });

    it('should fail open when middleware throws non-Response error', async () => {
      const fakeMiddleware = vi.fn(async () => {
        throw new Error('Unexpected x402 error');
      });

      mockIsEnabled.mockReturnValue(true);
      mockGetMiddleware.mockReturnValue(fakeMiddleware);

      const headers = createTestAuthHeaders(testUser);
      const response = await app.request(MCP_PATH, {
        method: 'POST',
        headers,
        body: mcpBody(),
      });

      // Fail open: request should reach MCP handler, not get blocked with 503
      expect(response.status).not.toBe(503);
      expect(response.status).not.toBe(402);
    });
  });

  describe('/health endpoint', () => {
    it('should include x402 status in health response', async () => {
      mockGetStatus.mockReturnValue({ status: 'disabled', reason: null });

      const response = await app.request('/health', { method: 'GET' });

      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.x402).toEqual({ status: 'disabled', reason: null });
    });

    it('should show degraded status with reason', async () => {
      mockGetStatus.mockReturnValue({ status: 'degraded', reason: 'Facilitator 401' });

      const response = await app.request('/health', { method: 'GET' });

      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.x402).toEqual({ status: 'degraded', reason: 'Facilitator 401' });
    });
  });
});
