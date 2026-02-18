/**
 * Epitome API Server
 *
 * Hono 4.11.x monolithic server for:
 * - REST API (/v1/*)
 * - Authentication (/v1/auth/*)
 * - MCP Server (/mcp)
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { corsMiddleware } from '@/middleware/cors';
import { errorHandler } from '@/middleware/errorHandler';
import { authResolver } from '@/middleware/auth';
import { rateLimitMiddleware } from '@/middleware/rateLimit';
import authRoutes from '@/routes/auth';
import profileRoutes from '@/routes/profile';
import tablesRoutes from '@/routes/tables';
import vectorsRoutes from '@/routes/vectors';
import memoryRoutes from '@/routes/memory';
import activityRoutes from '@/routes/activity';
import graphRoutes from '@/routes/graph';
import consentRoutes from '@/routes/consent';
import { createMcpRoutes } from '@/mcp/handler';
import {
  oauthDiscovery,
  protectedResourceMetadata,
  oauthRegister,
  oauthAuthorize,
  oauthAuthorizeConsent,
  oauthToken,
} from '@/mcp/oauth';
import { closeDatabase } from '@/db/client';
import { startEnrichmentWorkers, stopEnrichmentWorkers } from '@/services/enrichmentQueue.service';
import { scheduleNightlyExtraction } from '@/services/entityExtraction';
import { startMemoryDecayScheduler, stopMemoryDecayScheduler } from '@/services/memoryQuality.service';
import { logger } from '@/utils/logger';
import type { HonoEnv } from '@/types/hono';

// Initialize Hono app
const app = new Hono<HonoEnv>();

// Global middleware chain
app.use('*', corsMiddleware);
app.use('*', errorHandler);
app.use('*', authResolver);
app.use('*', rateLimitMiddleware); // H-3 Security Fix: Rate limiting (after auth so tier is correct)

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// Mount auth routes
app.route('/v1/auth', authRoutes);

// Mount API routes
app.route('/v1/profile', profileRoutes);
app.route('/v1/tables', tablesRoutes);
app.route('/v1/vectors', vectorsRoutes);
app.route('/v1/memory', memoryRoutes);
app.route('/v1/graph', graphRoutes);
app.route('/v1/consent', consentRoutes);
app.route('/v1', activityRoutes); // Activity routes include /v1/activity and /v1/export

// Mount MCP server
app.route('/mcp', createMcpRoutes());

// OAuth 2.0 discovery + MCP OAuth flow
app.get('/.well-known/oauth-protected-resource', protectedResourceMetadata);
app.get('/.well-known/oauth-authorization-server', oauthDiscovery);
app.post('/v1/auth/oauth/register', oauthRegister);
app.get('/v1/auth/oauth/authorize', oauthAuthorize);
app.post('/v1/auth/oauth/authorize', oauthAuthorizeConsent);
app.post('/v1/auth/oauth/token', oauthToken);

// Global error handler (catches errors that escape middleware)
app.onError((error, c) => {
  // Handle SQL Sandbox errors
  if (error.message.includes('SQL_SANDBOX_ERROR')) {
    return c.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: error.message,
        },
      },
      400
    );
  }

  // Handle not found errors
  if (error.message.includes('not found') || error.message.includes('NOT_FOUND')) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: error.message,
        },
      },
      404
    );
  }

  // Handle consent/forbidden errors
  if (error.message.includes('CONSENT') || error.message.includes('FORBIDDEN')) {
    return c.json(
      {
        error: {
          code: 'FORBIDDEN',
          message: error.message,
        },
      },
      403
    );
  }

  // Default internal error
  logger.error('Unhandled error in onError handler', {
    message: error.message,
    stack: error.stack,
    cause: error.cause ? String(error.cause) : undefined,
    path: c.req.path,
    method: c.req.method,
  });

  return c.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'production'
          ? 'An internal error occurred'
          : error.message,
      },
    },
    500
  );
});

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not found',
      },
    },
    404
  );
});

// Start server (skip in test mode)
if (process.env.NODE_ENV !== 'test') {
  const PORT = parseInt(process.env.PORT || '3000');

  startEnrichmentWorkers();
  startMemoryDecayScheduler();

  if (process.env.ENABLE_NIGHTLY_EXTRACTION === 'true') {
    scheduleNightlyExtraction().catch((error) => {
      logger.error('Failed to schedule nightly extraction', { error: String(error) });
    });
  }

  serve({
    fetch: app.fetch,
    port: PORT,
  });

  console.log(`🚀 Epitome API Server running on http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health`);
  console.log(`🔐 Auth endpoints: http://localhost:${PORT}/v1/auth/*`);
  console.log(`👤 Profile: http://localhost:${PORT}/v1/profile`);
  console.log(`📊 Tables: http://localhost:${PORT}/v1/tables`);
  console.log(`🔍 Vectors: http://localhost:${PORT}/v1/vectors`);
  console.log(`🧠 Memory: http://localhost:${PORT}/v1/memory`);
  console.log(`🕸️  Graph: http://localhost:${PORT}/v1/graph`);
  console.log(`📈 Activity: http://localhost:${PORT}/v1/activity`);
  console.log(`🤖 MCP Server: http://localhost:${PORT}/mcp`);
  console.log(`🔓 OAuth Discovery: http://localhost:${PORT}/.well-known/oauth-authorization-server`);
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  stopEnrichmentWorkers();
  stopMemoryDecayScheduler();
  await closeDatabase();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT signal received: closing HTTP server');
  stopEnrichmentWorkers();
  stopMemoryDecayScheduler();
  await closeDatabase();
  process.exit(0);
});

export default app;
