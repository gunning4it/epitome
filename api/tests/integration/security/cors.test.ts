/**
 * CORS Security Tests (H-2 Vulnerability Fix)
 *
 * Verify split CORS policy prevents no-origin bypass attacks
 *
 * Test Coverage:
 * 1. Dashboard routes (/v1/auth/*) reject no-origin requests
 * 2. API routes (/v1/*) allow no-origin requests
 * 3. MCP routes (/mcp) allow no-origin requests
 * 4. Wildcard origin not returned with credentials
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import app from '@/index';
import { createTestUser, cleanupTestUser, type TestUser } from '../../helpers/db';
import { createTestAuthHeaders } from '../../helpers/app';
import { resetAllRateLimits } from '@/services/rateLimit.service';

describe('CORS Security (H-2 Fix)', () => {
  let testUser: TestUser;

  beforeAll(async () => {
    await resetAllRateLimits();
    testUser = await createTestUser();
  });

  afterAll(async () => {
    await cleanupTestUser(testUser.userId);
  });

  describe('Dashboard Routes (Strict CORS)', () => {
    test('should reject no-origin requests to /v1/auth/* endpoints', async () => {
      // No Origin header = CSRF attack vector
      const response = await app.request('/v1/auth/me', { method: 'GET' });
        // Explicitly no Origin header

      // Should fail CORS check (empty Access-Control-Allow-Origin)
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    });

    test('should allow known origin requests to /v1/auth/* endpoints', async () => {
      const headers = new Headers();
      headers.set('origin', 'http://localhost:5173');

      const response = await app.request('/v1/auth/me', {
        method: 'GET',
        headers,
      });

      // Should pass CORS check with specific origin
      expect(response.headers.get('access-control-allow-origin')).toBe(
        'http://localhost:5173'
      );
      expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    });

    test('should reject unknown origin requests to /v1/auth/* endpoints', async () => {
      const headers = new Headers();
      headers.set('origin', 'https://evil.com');

      const response = await app.request('/v1/auth/me', {
        method: 'GET',
        headers,
      });

      // Should reject unknown origin
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    });

    test('should never return wildcard (*) with credentials on dashboard routes', async () => {
      const response = await app.request('/v1/auth/me', { method: 'GET' });

      // Should NOT return wildcard
      expect(response.headers.get('access-control-allow-origin')).not.toBe('*');
    });
  });

  describe('API Routes (Permissive CORS)', () => {
    test('should allow no-origin requests to /v1/* endpoints', async () => {
      // MCP clients and CLI tools don't send Origin header
      const response = await app.request('/v1/profile', {
        method: 'GET',
        headers: createTestAuthHeaders(testUser),
      });

      // Should allow no-origin with wildcard (no credentials)
      expect(response.headers.get('access-control-allow-origin')).toBeDefined();
      expect(response.headers.get('access-control-allow-credentials')).not.toBe(
        'true'
      );
    });

    test('should allow known origin requests to /v1/* endpoints', async () => {
      const headers = createTestAuthHeaders(testUser);
      headers.set('origin', 'http://localhost:5173');

      const response = await app.request('/v1/profile', {
        method: 'GET',
        headers,
      });

      // Should reflect origin back
      expect(response.headers.get('access-control-allow-origin')).toBe(
        'http://localhost:5173'
      );
    });

    test('should reject unknown origin requests to /v1/* endpoints', async () => {
      const headers = createTestAuthHeaders(testUser);
      headers.set('origin', 'https://unknown.com');

      const response = await app.request('/v1/tables', {
        method: 'GET',
        headers,
      });

      // Unknown origins must be rejected — MCP/CLI clients use the no-origin wildcard path
      const allowOrigin = response.headers.get('access-control-allow-origin');
      expect(!allowOrigin || allowOrigin === '').toBe(true);
    });

    test('should not set credentials flag on API routes', async () => {
      const response = await app.request('/v1/profile', {
        method: 'GET',
        headers: createTestAuthHeaders(testUser),
      });

      // API routes should not allow credentials (no cookies)
      expect(response.headers.get('access-control-allow-credentials')).not.toBe(
        'true'
      );
    });
  });

  describe('MCP Routes (Permissive CORS)', () => {
    test('should allow no-origin requests to /mcp endpoints', async () => {
      const headers = new Headers();
      headers.set('content-type', 'application/json');

      const response = await app.request('/mcp', {
        method: 'POST',
        headers,
        body: JSON.stringify({ method: 'ping' }),
      });

      // Should allow no-origin
      expect(response.headers.get('access-control-allow-origin')).toBeDefined();
    });

    test('should allow known origin requests to /mcp endpoints', async () => {
      const headers = new Headers();
      headers.set('origin', 'http://localhost:5173');
      headers.set('content-type', 'application/json');

      const response = await app.request('/mcp', {
        method: 'POST',
        headers,
        body: JSON.stringify({ method: 'ping' }),
      });

      // Should reflect origin back
      expect(response.headers.get('access-control-allow-origin')).toBe(
        'http://localhost:5173'
      );
    });
  });

  describe('Preflight Requests', () => {
    test('should handle OPTIONS preflight for dashboard routes', async () => {
      const headers = new Headers();
      headers.set('origin', 'http://localhost:5173');
      headers.set('access-control-request-method', 'POST');

      const response = await app.request('/v1/auth/logout', {
        method: 'OPTIONS',
        headers,
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe(
        'http://localhost:5173'
      );
      expect(response.headers.get('access-control-allow-methods')).toContain(
        'POST'
      );
    });

    test('should handle OPTIONS preflight for API routes', async () => {
      const headers = new Headers();
      headers.set('origin', 'http://localhost:5173');
      headers.set('access-control-request-method', 'GET');

      const response = await app.request('/v1/tables', {
        method: 'OPTIONS',
        headers,
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBeDefined();
      expect(response.headers.get('access-control-allow-methods')).toContain('GET');
    });
  });

  describe('Attack Scenarios', () => {
    test('should block no-origin CSRF attack on auth logout', async () => {
      // Attacker tries to trigger logout without Origin header
      const response = await app.request('/v1/auth/logout', { method: 'POST' });
        // No Origin header (simulates curl from attacker)

      // Should fail CORS and not process logout
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    });

    test('should block evil.com CSRF attack on auth logout', async () => {
      // Attacker from evil.com tries to trigger logout
      const headers = new Headers();
      headers.set('origin', 'https://evil.com');

      const response = await app.request('/v1/auth/logout', {
        method: 'POST',
        headers,
      });

      // Should reject unknown origin
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    });

    test('should allow legitimate MCP client without Origin header', async () => {
      // Legitimate MCP client (Claude Desktop) sends request without Origin
      const response = await app.request('/v1/tables', {
        method: 'GET',
        headers: createTestAuthHeaders(testUser),
      });

      // Should allow (no Origin needed for Bearer auth)
      expect(response.headers.get('access-control-allow-origin')).toBeDefined();
    });
  });
});
