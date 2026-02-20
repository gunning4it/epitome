import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =====================================================
// Mocks — vi.hoisted() runs before vi.mock() hoisting
// =====================================================

const {
  mockInitialize,
  mockPaymentMiddlewareFromHTTPServer,
  mockRegisterExactEvmScheme,
  mockHTTPFacilitatorClient,
} = vi.hoisted(() => {
  const mockInitialize = vi.fn().mockResolvedValue(undefined);
  const mockPaymentMiddlewareFromHTTPServer = vi.fn().mockReturnValue(
    vi.fn(async (_c: unknown, next: () => Promise<void>) => next())
  );
  const mockRegisterExactEvmScheme = vi.fn();
  const mockHTTPFacilitatorClient = vi.fn();

  return {
    mockInitialize,
    mockPaymentMiddlewareFromHTTPServer,
    mockRegisterExactEvmScheme,
    mockHTTPFacilitatorClient,
  };
});

vi.mock('@x402/core/server', () => ({
  x402ResourceServer: function() {},
  x402HTTPResourceServer: function() { this.initialize = mockInitialize; },
  HTTPFacilitatorClient: mockHTTPFacilitatorClient,
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
import { logger } from '@/utils/logger';

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
    // Clean x402 + CDP env vars
    delete process.env.X402_ENABLED;
    delete process.env.X402_PAY_TO_ADDRESS;
    delete process.env.X402_NETWORK;
    delete process.env.X402_FACILITATOR_URL;
    delete process.env.X402_PRICE_PER_CALL;
    delete process.env.CDP_API_KEY_ID;
    delete process.env.CDP_API_KEY_SECRET;
  });

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('X402_') || key.startsWith('CDP_')) delete process.env[key];
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

    it('should be degraded on unknown network without explicit facilitator URL', async () => {
      setEnv({
        X402_ENABLED: 'true',
        X402_PAY_TO_ADDRESS: '0x1234567890abcdef',
        X402_NETWORK: 'eip155:999999',
      });

      await x402Service.initialize();

      const status = x402Service.getStatus();
      expect(status.status).toBe('degraded');
      expect(status.reason).toContain('Unknown network "eip155:999999"');
      expect(status.reason).toContain('Set X402_FACILITATOR_URL explicitly');
    });

    it('should be degraded on partial CDP credentials (only key ID)', async () => {
      setEnv({
        X402_ENABLED: 'true',
        X402_PAY_TO_ADDRESS: '0x1234567890abcdef',
        X402_NETWORK: 'eip155:8453',
        CDP_API_KEY_ID: 'key-id-only',
      });

      await x402Service.initialize();

      const status = x402Service.getStatus();
      expect(status.status).toBe('degraded');
      expect(status.reason).toContain('Partial CDP credentials');
      expect(status.reason).toContain('both CDP_API_KEY_ID and CDP_API_KEY_SECRET are required');
    });

    it('should be degraded on partial CDP credentials (only secret)', async () => {
      setEnv({
        X402_ENABLED: 'true',
        X402_PAY_TO_ADDRESS: '0x1234567890abcdef',
        X402_NETWORK: 'eip155:8453',
        CDP_API_KEY_SECRET: 'secret-only',
      });

      await x402Service.initialize();

      const status = x402Service.getStatus();
      expect(status.status).toBe('degraded');
      expect(status.reason).toContain('Partial CDP credentials');
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

  describe('facilitator auto-selection', () => {
    it('should auto-select CDP facilitator for mainnet (eip155:8453)', async () => {
      setEnv({
        X402_ENABLED: 'true',
        X402_PAY_TO_ADDRESS: '0x1234567890abcdef',
        X402_NETWORK: 'eip155:8453',
      });

      await x402Service.initialize();

      expect(x402Service.getStatus().status).toBe('ready');
      expect(mockHTTPFacilitatorClient).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://api.cdp.coinbase.com/platform/v2/x402',
        })
      );
    });

    it('should auto-select x402.org for testnet (eip155:84532)', async () => {
      setEnv({
        X402_ENABLED: 'true',
        X402_PAY_TO_ADDRESS: '0x1234567890abcdef',
        X402_NETWORK: 'eip155:84532',
      });

      await x402Service.initialize();

      expect(x402Service.getStatus().status).toBe('ready');
      expect(mockHTTPFacilitatorClient).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://x402.org/facilitator',
        })
      );
    });

    it('should normalize alias "base" to eip155:8453 and select CDP', async () => {
      setEnv({
        X402_ENABLED: 'true',
        X402_PAY_TO_ADDRESS: '0x1234567890abcdef',
        X402_NETWORK: 'base',
      });

      await x402Service.initialize();

      expect(x402Service.getStatus().status).toBe('ready');
      expect(mockHTTPFacilitatorClient).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://api.cdp.coinbase.com/platform/v2/x402',
        })
      );
    });

    it('should normalize alias "base-sepolia" to eip155:84532 and select x402.org', async () => {
      setEnv({
        X402_ENABLED: 'true',
        X402_PAY_TO_ADDRESS: '0x1234567890abcdef',
        X402_NETWORK: 'base-sepolia',
      });

      await x402Service.initialize();

      expect(x402Service.getStatus().status).toBe('ready');
      expect(mockHTTPFacilitatorClient).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://x402.org/facilitator',
        })
      );
    });

    it('should use explicit X402_FACILITATOR_URL when set', async () => {
      setEnv({
        X402_ENABLED: 'true',
        X402_PAY_TO_ADDRESS: '0x1234567890abcdef',
        X402_NETWORK: 'eip155:84532',
        X402_FACILITATOR_URL: 'https://custom-facilitator.example.com',
      });

      await x402Service.initialize();

      expect(x402Service.getStatus().status).toBe('ready');
      expect(mockHTTPFacilitatorClient).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://custom-facilitator.example.com',
        })
      );
    });

    it('should warn on known-bad override (x402.org + mainnet)', async () => {
      setEnv({
        X402_ENABLED: 'true',
        X402_PAY_TO_ADDRESS: '0x1234567890abcdef',
        X402_NETWORK: 'eip155:8453',
        X402_FACILITATOR_URL: 'https://x402.org/facilitator',
      });

      await x402Service.initialize();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('x402.org facilitator does not support mainnet')
      );
      // Should still attempt init (operator may know what they're doing)
      expect(mockHTTPFacilitatorClient).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://x402.org/facilitator',
        })
      );
    });
  });

  describe('CDP auth headers', () => {
    it('should pass auth headers when both CDP credentials are set', async () => {
      setEnv({
        X402_ENABLED: 'true',
        X402_PAY_TO_ADDRESS: '0x1234567890abcdef',
        X402_NETWORK: 'eip155:8453',
        CDP_API_KEY_ID: 'my-key-id',
        CDP_API_KEY_SECRET: 'my-key-secret',
      });

      await x402Service.initialize();

      expect(x402Service.getStatus().status).toBe('ready');
      const config = mockHTTPFacilitatorClient.mock.calls[0][0];
      expect(config.createAuthHeaders).toBeTypeOf('function');

      // Verify the auth headers function returns correct format
      const headers = await config.createAuthHeaders();
      expect(headers.verify).toEqual({ Authorization: 'Bearer my-key-id' });
      expect(headers.settle).toEqual({ Authorization: 'Bearer my-key-id' });
      expect(headers.supported).toEqual({ Authorization: 'Bearer my-key-id' });
    });

    it('should not pass auth headers when no CDP credentials are set', async () => {
      setEnv({
        X402_ENABLED: 'true',
        X402_PAY_TO_ADDRESS: '0x1234567890abcdef',
        X402_NETWORK: 'eip155:8453',
      });

      await x402Service.initialize();

      expect(x402Service.getStatus().status).toBe('ready');
      const config = mockHTTPFacilitatorClient.mock.calls[0][0];
      expect(config.createAuthHeaders).toBeUndefined();
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
