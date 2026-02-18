/**
 * CORS Middleware
 *
 * Configure Cross-Origin Resource Sharing for dashboard and MCP clients
 *
 * SECURITY: Split CORS policy to prevent no-origin bypass (H-2)
 * - Dashboard routes (/v1/auth/*): Reject no-origin requests (CSRF protection)
 * - API routes (/v1/*, /mcp): Allow no-origin requests (MCP clients)
 */

import { cors } from 'hono/cors';
import type { Context, Next } from 'hono';

/**
 * Allowed origins for CORS
 * Includes env-configured origin for staging/custom deployments
 */
const ALLOWED_ORIGINS = [
  'http://localhost:5173', // Vite dev server
  'http://localhost:3000', // API dev server
  'https://epitome.fyi', // Production dashboard
  'https://www.epitome.fyi', // Production dashboard (www)
  ...(process.env.CORS_ORIGIN ? [process.env.CORS_ORIGIN] : []),
];

/**
 * Dashboard CORS policy - strict, rejects no-origin requests
 * Used for routes that require session cookies (/v1/auth/*)
 */
const dashboardCorsPolicy = cors({
  origin: (origin) => {
    // SECURITY FIX (H-2): Reject requests with no origin header
    // This prevents CSRF attacks from tools like curl/Postman
    if (!origin) return '';

    // Only allow known dashboard origins
    if (ALLOWED_ORIGINS.includes(origin)) {
      return origin;
    }

    // Reject unknown origins
    return '';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length', 'X-Request-ID'],
  maxAge: 86400, // 24 hours
  credentials: true, // Allow cookies for session auth
});

/**
 * API CORS handler - permissive, allows no-origin requests
 * Used for API routes and MCP server (/v1/*, /mcp)
 *
 * Credentials are only sent when a known dashboard origin is present,
 * so the browser can include session cookies. No-origin requests
 * (MCP clients, CLI tools) get wildcard without credentials.
 */
const apiCorsHandler = async (c: Context, next: Next) => {
  const origin = c.req.header('Origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Access-Control-Expose-Headers': 'Content-Length, X-Request-ID',
    'Access-Control-Max-Age': '86400',
  };

  if (!origin) {
    // No origin (MCP clients, CLI tools) — wildcard, no credentials
    headers['Access-Control-Allow-Origin'] = '*';
  } else if (ALLOWED_ORIGINS.includes(origin)) {
    // Known dashboard origin — echo, allow credentials for session cookies
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  } else {
    // Unknown origin — echo back for Bearer auth use cases
    headers['Access-Control-Allow-Origin'] = origin;
  }

  // Preflight: return 204 with CORS headers directly
  if (c.req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  // Non-preflight: set CORS headers on response
  for (const [key, value] of Object.entries(headers)) {
    c.header(key, value);
  }

  return next();
};

/**
 * Smart CORS middleware that routes to appropriate policy
 */
export const corsMiddleware = async (c: Context, next: Next) => {
  const path = c.req.path;

  // OAuth endpoints are called server-to-server by MCP clients — use permissive CORS
  if (path.startsWith('/v1/auth/oauth/')) {
    return apiCorsHandler(c, next);
  }

  // Dashboard routes require strict CORS (reject no-origin)
  if (path.startsWith('/v1/auth/')) {
    return dashboardCorsPolicy(c, next);
  }

  // All other routes use permissive API CORS (allow no-origin)
  return apiCorsHandler(c, next);
};
