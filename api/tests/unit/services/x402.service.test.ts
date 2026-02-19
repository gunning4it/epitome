import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =====================================================
// Mocks — vi.hoisted() runs before vi.mock() hoisting
// =====================================================

const {
  mockInitialize,
  mockPaymentMiddlewareFromHTTPServer,
  mockRegisterExactEvmScheme,
} = vi.hoisted(() => {
  const mockInitialize = vi.fn().mockResolvedValue(undefined);
  const mockPaymentMiddlewareFromHTTPServer = vi.fn().mockReturnValue(
    vi.fn(async (_c: unknown, next: () => Promise<void>) => next())
  );
  const mockRegisterExactEvmScheme = vi.fn();

  return {
    mockInitialize,
    mockPaymentMiddlewareFromHTTPServer,
    mockRegisterExactEvmScheme,
  };
});

vi.mock('@x402/core/server', () => ({
  x402ResourceServer: function() {},
  x402HTTPResourceServer: function() { this.initialize = mockInitialize; },
  HTTPFacilitatorClient: function() {},
}));

vi.mock('@x402/evm/exact/server', () => ({
  registerExactEvmScheme: mockRegisterExactEvmScheme,
}));

vi.mock('@x402/hono', () => ({
  paymentMiddlewareFromHTTPServer: mockPaymentMiddlewareFromHTTPServer,
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks
import { x402Service } from '@/services/x402.service';

// =====================================================
// Helpers
// =====================================================

const originalEnv = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

// =====================================================
// Tests
// =====================================================

describe('X402Service', () => {
  beforeEach(() => {
    x402Service._reset();
    vi.clearAllMocks();
    // Clean x402 env vars
    delete process.env.X402_ENABLED;
    delete process.env.X402_PAY_TO_ADDRESS;
    delete process.env.X402_NETWORK;
    delete process.env.X402_FACILITATOR_URL;
    delete process.env.X402_PRICE_PER_CALL;
  });

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('X402_')) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  describe('disabled states', () => {
    it('should be disabled when X402_ENABLED is not set', async () => {
      await x402Service.initialize();

      expect(x402Service.getStatus()).toEqual({ status: 'disabled', reason: null });
      expect(x402Service.getMiddleware()).toBeNull();
    });

    it('should be disabled when X402_ENABLED is false', async () => {
      setEnv({ X402_ENABLED: 'false' });

      await x402Service.initialize();

      expect(x402Service.getStatus()).toEqual({ status: 'disabled', reason: null });
      expect(x402Service.getMiddleware()).toBeNull();
    });

    it('should be disabled when X402_PAY_TO_ADDRESS is missing', async () => {
      setEnv({ X402_ENABLED: 'true' });

      await x402Service.initialize();

      expect(x402Service.getStatus()).toEqual({ status: 'disabled', reason: null });
      expect(x402Service.getMiddleware()).toBeNull();
    });
  });

  describe('degraded states', () => {
    it('should be degraded on invalid network format', async () => {
      setEnv({
        X402_ENABLED: 'true',
        X402_PAY_TO_ADDRESS: '0x1234567890abcdef',
        X402_NETWORK: 'badformat',
      });

      await x402Service.initialize();

      const status = x402Service.getStatus();
      expect(status.status).toBe('degraded');
      expect(status.reason).toContain('Invalid network format');
      expect(x402Service.getMiddleware()).toBeNull();
    });

    it('should be degraded when facilitator returns error (e.g. 401)', async () => {
      setEnv({
        X402_ENABLED: 'true',
        X402_PAY_TO_ADDRESS: '0x1234567890abcdef',
        X402_NETWORK: 'eip155:8453',
      });

      mockInitialize.mockRejectedValueOnce(new Error('RouteConfigurationError: 401 Unauthorized'));

      await x402Service.initialize();

      const status = x402Service.getStatus();
      expect(status.status).toBe('degraded');
      expect(status.reason).toContain('RouteConfigurationError');
      expect(x402Service.getMiddleware()).toBeNull();
    });

    it('should be degraded on facilitator timeout/network error', async () => {
      setEnv({
        X402_ENABLED: 'true',
        X402_PAY_TO_ADDRESS: '0x1234567890abcdef',
        X402_NETWORK: 'eip155:8453',
      });

      mockInitialize.mockRejectedValueOnce(new Error('fetch failed: ECONNREFUSED'));

      await x402Service.initialize();

      const status = x402Service.getStatus();
      expect(status.status).toBe('degraded');
      expect(status.reason).toContain('ECONNREFUSED');
      expect(x402Service.getMiddleware()).toBeNull();
    });
  });

  describe('ready state', () => {
    it('should be ready on successful initialization', async () => {
      setEnv({
        X402_ENABLED: 'true',
        X402_PAY_TO_ADDRESS: '0x1234567890abcdef',
        X402_NETWORK: 'eip155:8453',
      });

      await x402Service.initialize();

      expect(x402Service.getStatus()).toEqual({ status: 'ready', reason: null });
      expect(x402Service.getMiddleware()).toBeTypeOf('function');
    });

    it('should use default network eip155:84532 when X402_NETWORK not set', async () => {
      setEnv({
        X402_ENABLED: 'true',
        X402_PAY_TO_ADDRESS: '0x1234567890abcdef',
      });

      await x402Service.initialize();

      expect(x402Service.getStatus().status).toBe('ready');
    });
  });

  describe('idempotency', () => {
    it('should only run initialization once', async () => {
      setEnv({
        X402_ENABLED: 'true',
        X402_PAY_TO_ADDRESS: '0x1234567890abcdef',
        X402_NETWORK: 'eip155:8453',
      });

      await x402Service.initialize();
      await x402Service.initialize();

      expect(mockInitialize).toHaveBeenCalledTimes(1);
    });

    it('should not retry after degraded state', async () => {
      setEnv({
        X402_ENABLED: 'true',
        X402_PAY_TO_ADDRESS: '0x1234567890abcdef',
        X402_NETWORK: 'eip155:8453',
      });

      mockInitialize.mockRejectedValueOnce(new Error('fail'));

      await x402Service.initialize();
      expect(x402Service.getStatus().status).toBe('degraded');

      // Second call should be a no-op
      await x402Service.initialize();
      expect(mockInitialize).toHaveBeenCalledTimes(1);
    });
  });

  describe('isEnabled', () => {
    it('should return true when X402_ENABLED=true', () => {
      setEnv({ X402_ENABLED: 'true' });
      expect(x402Service.isEnabled()).toBe(true);
    });

    it('should return false when X402_ENABLED is not set', () => {
      expect(x402Service.isEnabled()).toBe(false);
    });

    it('should return false when X402_ENABLED=false', () => {
      setEnv({ X402_ENABLED: 'false' });
      expect(x402Service.isEnabled()).toBe(false);
    });
  });

  describe('_reset', () => {
    it('should reset all state for testing', async () => {
      setEnv({
        X402_ENABLED: 'true',
        X402_PAY_TO_ADDRESS: '0x1234567890abcdef',
        X402_NETWORK: 'eip155:8453',
      });

      await x402Service.initialize();
      expect(x402Service.getStatus().status).toBe('ready');

      x402Service._reset();

      expect(x402Service.getStatus()).toEqual({ status: 'disabled', reason: null });
      expect(x402Service.getMiddleware()).toBeNull();
    });
  });
});
