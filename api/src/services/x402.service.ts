/**
 * x402 Payment Service
 *
 * Manages the lifecycle of x402 micropayment middleware.
 * Extracted from handler.ts for testability and operational visibility.
 */

import { logger } from '@/utils/logger';
import type { MiddlewareHandler } from 'hono';

export type X402Status = 'disabled' | 'initializing' | 'ready' | 'degraded';

const NETWORK_FORMAT = /^[a-z0-9]+:\d+$/;

// Step 1: Human-friendly aliases → CAIP-2 format
const NETWORK_ALIASES: Record<string, string> = {
  'base-sepolia': 'eip155:84532',
  'base': 'eip155:8453',
  'ethereum-sepolia': 'eip155:11155111',
  'ethereum': 'eip155:1',
  'arbitrum-sepolia': 'eip155:421614',
  'arbitrum': 'eip155:42161',
};

// Step 2: Explicit facilitator sets
const TESTNET_NETWORKS = new Set([
  'eip155:84532',    // Base Sepolia
  'eip155:11155111', // Ethereum Sepolia
  'eip155:421614',   // Arbitrum Sepolia
]);

const MAINNET_NETWORKS = new Set([
  'eip155:8453',  // Base
  'eip155:1',     // Ethereum
  'eip155:42161', // Arbitrum
]);

const X402_ORG_FACILITATOR = 'https://x402.org/facilitator';
const CDP_FACILITATOR = 'https://api.cdp.coinbase.com/platform/v2/x402';

function normalizeNetwork(raw: string): string {
  return NETWORK_ALIASES[raw] || raw;
}

function selectFacilitatorUrl(network: string): string | null {
  if (TESTNET_NETWORKS.has(network)) return X402_ORG_FACILITATOR;
  if (MAINNET_NETWORKS.has(network)) return CDP_FACILITATOR;
  return null;
}

function buildCdpAuthHeaders(): (() => Promise<{
  verify: Record<string, string>;
  settle: Record<string, string>;
  supported: Record<string, string>;
}>) | undefined {
  const keyId = process.env.CDP_API_KEY_ID;
  const keySecret = process.env.CDP_API_KEY_SECRET;

  if (!keyId && !keySecret) return undefined;

  if (!keyId || !keySecret) {
    // Partial credentials — caller should degrade
    return undefined;
  }

  return async () => {
    const headers = { Authorization: `Bearer ${keyId}` };
    return { verify: headers, settle: headers, supported: headers };
  };
}

class X402Service {
  private status: X402Status = 'disabled';
  private middleware: MiddlewareHandler | null = null;
  private degradedReason: string | null = null;
  private initAttempted = false;

  /**
   * Initialize the x402 payment middleware.
   *
   * Creates the resource server, awaits facilitator handshake, and builds
   * the Hono middleware. Idempotent — subsequent calls are no-ops.
   *
   * On failure, sets status to 'degraded' instead of crashing.
   */
  async initialize(): Promise<void> {
    if (this.initAttempted) return;
    this.initAttempted = true;

    if (process.env.X402_ENABLED !== 'true') {
      this.status = 'disabled';
      return;
    }

    if (!process.env.X402_PAY_TO_ADDRESS) {
      this.status = 'disabled';
      logger.warn('x402: X402_PAY_TO_ADDRESS not set, payments disabled');
      return;
    }

    // Step 1: Normalize aliases before validation
    const network = normalizeNetwork(process.env.X402_NETWORK || 'eip155:84532');
    if (!NETWORK_FORMAT.test(network)) {
      this.status = 'degraded';
      this.degradedReason = `Invalid network format: "${network}" (expected "eip155:8453" style)`;
      logger.error(`x402: ${this.degradedReason}`);
      return;
    }

    // Step 2: Resolve facilitator URL
    const explicitUrl = process.env.X402_FACILITATOR_URL;
    let facilitatorUrl: string;

    if (explicitUrl) {
      facilitatorUrl = explicitUrl;

      // Step 3: Warn on known-bad override
      if (explicitUrl.includes('x402.org') && MAINNET_NETWORKS.has(network)) {
        logger.warn(
          `x402: WARNING — x402.org facilitator does not support mainnet networks. ` +
          `Network "${network}" will likely fail with RouteConfigurationError. ` +
          `Use CDP facilitator: ${CDP_FACILITATOR}`
        );
      }
    } else {
      const autoUrl = selectFacilitatorUrl(network);
      if (!autoUrl) {
        this.status = 'degraded';
        this.degradedReason = `Unknown network "${network}" — cannot auto-select facilitator. Set X402_FACILITATOR_URL explicitly.`;
        logger.error(`x402: ${this.degradedReason}`);
        return;
      }
      facilitatorUrl = autoUrl;
    }

    // Step 4: Check CDP credentials for mainnet
    const cdpKeyId = process.env.CDP_API_KEY_ID;
    const cdpKeySecret = process.env.CDP_API_KEY_SECRET;
    if ((cdpKeyId && !cdpKeySecret) || (!cdpKeyId && cdpKeySecret)) {
      this.status = 'degraded';
      this.degradedReason = 'Partial CDP credentials: both CDP_API_KEY_ID and CDP_API_KEY_SECRET are required';
      logger.error(`x402: ${this.degradedReason}`);
      return;
    }

    this.status = 'initializing';

    try {
      const { x402ResourceServer, x402HTTPResourceServer, HTTPFacilitatorClient } =
        await import('@x402/core/server');
      const { registerExactEvmScheme } = await import('@x402/evm/exact/server');
      const { paymentMiddlewareFromHTTPServer } = await import('@x402/hono');

      const facilitatorConfig: { url: string; createAuthHeaders?: () => Promise<{ verify: Record<string, string>; settle: Record<string, string>; supported: Record<string, string> }> } = {
        url: facilitatorUrl,
      };

      // Step 4: Wire up CDP auth headers
      const authHeaders = buildCdpAuthHeaders();
      if (authHeaders) {
        facilitatorConfig.createAuthHeaders = authHeaders;
      }

      const facilitatorClient = new HTTPFacilitatorClient(facilitatorConfig);
      const resourceServer = new x402ResourceServer(facilitatorClient);
      registerExactEvmScheme(resourceServer);

      const routes = {
        '/': {
          accepts: [
            {
              scheme: 'exact' as const,
              price: process.env.X402_PRICE_PER_CALL || '$0.01',
              network: network as `${string}:${string}`,
              payTo: process.env.X402_PAY_TO_ADDRESS!,
            },
          ],
          description: 'Epitome MCP tool call',
          mimeType: 'application/json',
        },
      };

      const httpServer = new x402HTTPResourceServer(resourceServer, routes);

      // Explicitly await initialization so RouteConfigurationError is
      // caught here instead of becoming an unhandled promise rejection.
      await httpServer.initialize();

      // syncFacilitatorOnStart=false — already initialized above
      this.middleware = paymentMiddlewareFromHTTPServer(httpServer, undefined, undefined, false);
      this.status = 'ready';
      logger.info('x402: Payment middleware ready', { network, facilitator: facilitatorUrl });
    } catch (err) {
      this.status = 'degraded';
      this.degradedReason = String(err);
      logger.error('x402: Failed to initialize — payments degraded', { error: String(err) });
    }
  }

  getStatus(): { status: X402Status; reason: string | null } {
    return { status: this.status, reason: this.degradedReason };
  }

  getMiddleware(): MiddlewareHandler | null {
    return this.middleware;
  }

  isEnabled(): boolean {
    return process.env.X402_ENABLED === 'true';
  }

  /**
   * Reset internal state. Only for testing.
   */
  _reset(): void {
    this.status = 'disabled';
    this.middleware = null;
    this.degradedReason = null;
    this.initAttempted = false;
  }
}

export const x402Service = new X402Service();
