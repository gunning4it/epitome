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

    const network = process.env.X402_NETWORK || 'eip155:84532';
    if (!NETWORK_FORMAT.test(network)) {
      this.status = 'degraded';
      this.degradedReason = `Invalid network format: "${network}" (expected "eip155:8453" style)`;
      logger.error(`x402: ${this.degradedReason}`);
      return;
    }

    this.status = 'initializing';

    try {
      const { x402ResourceServer, x402HTTPResourceServer, HTTPFacilitatorClient } =
        await import('@x402/core/server');
      const { registerExactEvmScheme } = await import('@x402/evm/exact/server');
      const { paymentMiddlewareFromHTTPServer } = await import('@x402/hono');

      const facilitatorClient = new HTTPFacilitatorClient({
        url: process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator',
      });
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
      logger.info('x402: Payment middleware ready', { network, facilitator: process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator' });
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
