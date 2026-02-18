/**
 * Security Headers Middleware
 *
 * Sets standard security headers on all responses to prevent:
 * - Clickjacking (X-Frame-Options, frame-ancestors)
 * - MIME sniffing (X-Content-Type-Options)
 * - Protocol downgrade (Strict-Transport-Security)
 * - XSS amplification (Content-Security-Policy)
 * - Referrer leakage (Referrer-Policy)
 * - Unnecessary browser features (Permissions-Policy)
 */

import type { Context, Next } from 'hono';

export async function securityHeaders(c: Context, next: Next) {
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'sha256-6yLO2xQwL7Uj30cFbdc4XXu+cP756dP7GCQd+MFhp8U='; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'"
  );
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return next();
}
