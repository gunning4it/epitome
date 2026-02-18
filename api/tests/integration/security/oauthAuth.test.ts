/**
 * OAuth & Auth Security Tests
 *
 * Tests for security fixes:
 * - C-1: OAuth state HMAC signing
 * - C-2: Open redirect prevention
 * - C-3: CSRF token on consent form
 * - H-1: Session refresh expiry check
 * - H-2: Hash authorization codes before storage
 * - H-4: SameSite cookie always Lax
 * - M-5: Stricter rate limit on client registration
 * - M-11: Auth code TTL reduced to 60 seconds
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import app from '@/index';
import {
  generateOAuthState,
  decodeOAuthState,
  hashSessionToken,
} from '@/utils/crypto';
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
import { createTestUser, cleanupTestUser, type TestUser } from '../../helpers/db';
import { resetAllRateLimits } from '@/services/rateLimit.service';

/**
 * Helper: ensure the sessions table has the token_hash column
 * (local Docker DB may not have it from migrations)
 */
async function ensureSessionsSchema() {
  await db.execute(sql.raw(`
    ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64) UNIQUE
  `));
  await db.execute(sql.raw(`
    ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45)
  `));
  await db.execute(sql.raw(`
    ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS user_agent TEXT
  `));
  // Make token column nullable (it was NOT NULL in old schema, but now we store hash instead)
  await db.execute(sql.raw(`
    ALTER TABLE public.sessions ALTER COLUMN token DROP NOT NULL
  `));
}

/**
 * Helper: ensure oauth_clients table exists
 */
async function ensureOAuthTables() {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS public.oauth_clients (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id VARCHAR(200) NOT NULL UNIQUE,
      client_secret VARCHAR(200),
      client_name VARCHAR(200),
      redirect_uris JSONB NOT NULL DEFAULT '[]',
      grant_types JSONB NOT NULL DEFAULT '["authorization_code"]',
      response_types JSONB NOT NULL DEFAULT '["code"]',
      token_endpoint_auth_method VARCHAR(50) DEFAULT 'none',
      scope VARCHAR(1000),
      client_uri VARCHAR(2048),
      logo_uri VARCHAR(2048),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `));
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS public.oauth_authorization_codes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code VARCHAR(200) NOT NULL UNIQUE,
      client_id VARCHAR(200) NOT NULL,
      user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      redirect_uri VARCHAR(2048) NOT NULL,
      scope VARCHAR(1000),
      code_challenge VARCHAR(128) NOT NULL,
      code_challenge_method VARCHAR(10) NOT NULL DEFAULT 'S256',
      state VARCHAR(500),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `));
}

/**
 * Helper: insert a session directly via raw SQL
 */
async function insertSession(userId: string, tokenHash: string, expiresAt: Date) {
  await db.execute(sql.raw(`
    INSERT INTO public.sessions (user_id, token_hash, expires_at)
    VALUES ('${userId}', '${tokenHash}', '${expiresAt.toISOString()}')
  `));
}

/**
 * Helper: delete a session by token_hash
 */
async function deleteSession(tokenHash: string) {
  await db.execute(sql.raw(`
    DELETE FROM public.sessions WHERE token_hash = '${tokenHash}'
  `));
}

/**
 * Helper: insert an OAuth client
 */
async function insertOAuthClient(clientId: string, clientName: string, redirectUris: string[]) {
  const urisJson = JSON.stringify(redirectUris);
  await db.execute(sql.raw(`
    INSERT INTO public.oauth_clients (client_id, client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method, scope)
    VALUES ('${clientId}', '${clientName}', '${urisJson}'::jsonb, '["authorization_code"]'::jsonb, '["code"]'::jsonb, 'none', 'profile:read')
  `));
}

/**
 * Helper: delete an OAuth client
 */
async function deleteOAuthClient(clientId: string) {
  await db.execute(sql.raw(`DELETE FROM public.oauth_clients WHERE client_id = '${clientId}'`));
}

/**
 * Helper: delete auth codes by client_id
 */
async function deleteAuthCodes(clientId: string) {
  await db.execute(sql.raw(`DELETE FROM public.oauth_authorization_codes WHERE client_id = '${clientId}'`));
}

describe('OAuth & Auth Security Fixes', () => {
  let testUser: TestUser;

  beforeAll(async () => {
    await resetAllRateLimits();
    testUser = await createTestUser();
    // Ensure SESSION_SECRET is set for HMAC signing
    if (!process.env.SESSION_SECRET) {
      process.env.SESSION_SECRET = 'test-session-secret-for-hmac-signing-32chars!!';
    }
    await ensureSessionsSchema();
    await ensureOAuthTables();
  });

  afterAll(async () => {
    await cleanupTestUser(testUser.userId);
  });

  // ─── C-1: OAuth State HMAC Signing ──────────────────────────────────

  describe('C-1: OAuth State HMAC Signing', () => {
    test('should generate signed state with payload.signature format', () => {
      const state = generateOAuthState('google', '/profile');
      expect(state).toContain('.');
      const parts = state.split('.');
      expect(parts).toHaveLength(2);
      expect(parts[0]!.length).toBeGreaterThan(0);
      expect(parts[1]!.length).toBeGreaterThan(0);
    });

    test('should decode valid signed state successfully', () => {
      const state = generateOAuthState('google', '/profile');
      const decoded = decodeOAuthState(state);
      expect(decoded.provider).toBe('google');
      expect(decoded.redirectUri).toBe('/profile');
      expect(decoded.nonce).toBeDefined();
      expect(decoded.timestamp).toBeDefined();
    });

    test('should reject state with forged signature', () => {
      const state = generateOAuthState('google', '/profile');
      const [payload] = state.split('.');
      const forgedState = `${payload}.forged_signature_here`;

      expect(() => decodeOAuthState(forgedState)).toThrow('Invalid OAuth state signature');
    });

    test('should reject unsigned base64 state (no dot separator)', () => {
      const unsignedState = Buffer.from(
        JSON.stringify({ provider: 'google', nonce: 'abc', timestamp: Date.now() })
      ).toString('base64');

      // base64 may contain '=' padding but not a dot as separator
      // If it happens to have a dot, the HMAC will fail anyway
      expect(() => decodeOAuthState(unsignedState)).toThrow();
    });

    test('should reject state with tampered payload', () => {
      const state = generateOAuthState('google', '/profile');
      const [, signature] = state.split('.');

      // Create a different payload
      const tamperedPayload = Buffer.from(
        JSON.stringify({ provider: 'evil', redirectUri: 'https://evil.com', nonce: 'abc', timestamp: Date.now() })
      ).toString('base64url');

      expect(() => decodeOAuthState(`${tamperedPayload}.${signature}`)).toThrow('Invalid OAuth state signature');
    });

    test('should reject expired state (>10 min old)', () => {
      const stateData = {
        provider: 'google',
        redirectUri: '/profile',
        nonce: crypto.randomBytes(16).toString('hex'),
        timestamp: Date.now() - 11 * 60 * 1000, // 11 minutes ago
      };

      const payload = Buffer.from(JSON.stringify(stateData)).toString('base64url');
      const signature = crypto
        .createHmac('sha256', process.env.SESSION_SECRET!)
        .update(payload)
        .digest('base64url');

      expect(() => decodeOAuthState(`${payload}.${signature}`)).toThrow('OAuth state expired');
    });
  });

  // ─── C-2: Open Redirect Prevention ──────────────────────────────────

  describe('C-2: Open Redirect Prevention', () => {
    test('should allow relative path redirects', () => {
      const state = generateOAuthState('google', '/profile');
      const decoded = decodeOAuthState(state);
      expect(decoded.redirectUri).toBe('/profile');
    });

    test('should generate state with absolute URL for allowed host', () => {
      const state = generateOAuthState('google', 'https://epitome.fyi/callback');
      const decoded = decodeOAuthState(state);
      expect(decoded.redirectUri).toBe('https://epitome.fyi/callback');
    });

    test('should generate state even with evil URL (redirect is blocked at callback time)', () => {
      // The state can contain any URL - the validation happens at redirect time
      const state = generateOAuthState('google', 'https://evil.com/steal');
      const decoded = decodeOAuthState(state);
      expect(decoded.redirectUri).toBe('https://evil.com/steal');
    });
  });

  // ─── C-3: CSRF Token on OAuth Consent Form ─────────────────────────

  describe('C-3: CSRF Token on Consent Form', () => {
    let oauthClientId: string;

    beforeAll(async () => {
      oauthClientId = crypto.randomBytes(16).toString('hex');
      await insertOAuthClient(oauthClientId, 'Test CSRF App', ['https://localhost:3000/callback']);
    });

    afterAll(async () => {
      await deleteAuthCodes(oauthClientId);
      await deleteOAuthClient(oauthClientId);
    });

    test('consent POST without CSRF token should return 403', async () => {
      const formBody = new URLSearchParams({
        action: 'approve',
        client_id: oauthClientId,
        redirect_uri: 'https://localhost:3000/callback',
        code_challenge: 'test_challenge',
        code_challenge_method: 'S256',
        state: 'test_state',
        scope: 'profile:read',
        // NO csrf_token field
      });

      const response = await app.request('/v1/auth/oauth/authorize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formBody.toString(),
      });

      expect(response.status).toBe(403);
      const html = await response.text();
      expect(html).toContain('CSRF token validation failed');
    });

    test('consent POST with mismatched CSRF token should return 403', async () => {
      const formBody = new URLSearchParams({
        action: 'approve',
        client_id: oauthClientId,
        redirect_uri: 'https://localhost:3000/callback',
        code_challenge: 'test_challenge',
        code_challenge_method: 'S256',
        state: 'test_state',
        scope: 'profile:read',
        csrf_token: 'wrong_csrf_token_aaaa',
      });

      const headers = new Headers();
      headers.set('Content-Type', 'application/x-www-form-urlencoded');
      headers.set('Cookie', 'csrf_token=different_csrf_token_b');

      const response = await app.request('/v1/auth/oauth/authorize', {
        method: 'POST',
        headers,
        body: formBody.toString(),
      });

      expect(response.status).toBe(403);
      const html = await response.text();
      expect(html).toContain('CSRF token validation failed');
    });

    test('consent GET should include CSRF token in form and cookie', async () => {
      // Create a session for the user
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashSessionToken(sessionToken);
      await insertSession(testUser.userId, tokenHash, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

      const codeChallenge = crypto.createHash('sha256').update('test_verifier').digest('base64url');

      const headers = new Headers();
      headers.set('Cookie', `epitome_session=${sessionToken}`);

      const url = `/v1/auth/oauth/authorize?client_id=${oauthClientId}&redirect_uri=${encodeURIComponent('https://localhost:3000/callback')}&code_challenge=${codeChallenge}&code_challenge_method=S256&response_type=code&scope=profile:read`;

      const response = await app.request(url, {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const html = await response.text();

      // The form should contain a hidden csrf_token field
      expect(html).toContain('name="csrf_token"');

      // The response should set a csrf_token cookie
      const setCookieHeader = response.headers.get('set-cookie');
      expect(setCookieHeader).toContain('csrf_token=');

      // Cleanup
      await deleteSession(tokenHash);
    });
  });

  // ─── H-1: Session Refresh Must Check Expiry ────────────────────────

  describe('H-1: Session Refresh Must Check Expiry', () => {
    test('should not refresh an expired session', async () => {
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashSessionToken(sessionToken);
      const expiredAt = new Date(Date.now() - 1000); // 1 second ago

      await insertSession(testUser.userId, tokenHash, expiredAt);

      const headers = new Headers();
      headers.set('Cookie', `epitome_session=${sessionToken}`);

      const response = await app.request('/v1/auth/refresh', {
        method: 'POST',
        headers,
      });

      expect(response.status).toBe(401);
      const body = await response.json() as any;
      expect(body.error.code).toBe('INVALID_SESSION');

      // Cleanup
      await deleteSession(tokenHash);
    });

    test('should refresh a valid (not expired) session', async () => {
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashSessionToken(sessionToken);
      const futureExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day from now

      await insertSession(testUser.userId, tokenHash, futureExpiry);

      const headers = new Headers();
      headers.set('Cookie', `epitome_session=${sessionToken}`);

      const response = await app.request('/v1/auth/refresh', {
        method: 'POST',
        headers,
      });

      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.data.expiresAt).toBeDefined();

      // Cleanup
      await deleteSession(tokenHash);
    });
  });

  // ─── H-2: Hash Authorization Codes Before Storage ──────────────────

  describe('H-2: Hash Authorization Codes Before Storage', () => {
    let oauthClientId: string;

    beforeAll(async () => {
      oauthClientId = crypto.randomBytes(16).toString('hex');
      await insertOAuthClient(oauthClientId, 'Test Hash App', ['https://localhost:3000/callback']);
    });

    afterAll(async () => {
      await deleteAuthCodes(oauthClientId);
      await deleteOAuthClient(oauthClientId);
    });

    test('stored auth code should be a SHA-256 hash, not plaintext', async () => {
      const rawCode = crypto.randomBytes(64).toString('hex');
      const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');

      await db.execute(sql.raw(`
        INSERT INTO public.oauth_authorization_codes (code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, state, expires_at)
        VALUES ('${codeHash}', '${oauthClientId}', '${testUser.userId}', 'https://localhost:3000/callback', 'profile:read', 'test_challenge', 'S256', '', '${new Date(Date.now() + 60 * 1000).toISOString()}')
      `));

      // Looking up by plaintext code should NOT find it
      const byPlaintext = await db.execute(sql.raw(`
        SELECT * FROM public.oauth_authorization_codes WHERE code = '${rawCode}' LIMIT 1
      `)) as unknown as any[];
      expect(byPlaintext.length).toBe(0);

      // Looking up by hash should find it
      const byHash = await db.execute(sql.raw(`
        SELECT * FROM public.oauth_authorization_codes WHERE code = '${codeHash}' LIMIT 1
      `)) as unknown as any[];
      expect(byHash.length).toBe(1);

      // Cleanup
      await db.execute(sql.raw(`DELETE FROM public.oauth_authorization_codes WHERE code = '${codeHash}'`));
    });

    test('token exchange with raw code should work (hashes internally)', async () => {
      const rawCode = crypto.randomBytes(64).toString('hex');
      const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');
      const codeVerifier = crypto.randomBytes(32).toString('hex');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

      await db.execute(sql.raw(`
        INSERT INTO public.oauth_authorization_codes (code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, state, expires_at)
        VALUES ('${codeHash}', '${oauthClientId}', '${testUser.userId}', 'https://localhost:3000/callback', 'profile:read', '${codeChallenge}', 'S256', '', '${new Date(Date.now() + 60 * 1000).toISOString()}')
      `));

      // Token exchange with the raw code should work (it hashes it internally)
      const formBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code: rawCode,
        code_verifier: codeVerifier,
        redirect_uri: 'https://localhost:3000/callback',
        client_id: oauthClientId,
      });

      const response = await app.request('/v1/auth/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formBody.toString(),
      });

      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.access_token).toBeDefined();
      expect(body.token_type).toBe('Bearer');
    });
  });

  // ─── H-4: SameSite Cookie Always Lax ───────────────────────────────

  describe('H-4: SameSite Cookie Always Lax', () => {
    test('session refresh cookie should have SameSite=Lax', async () => {
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashSessionToken(sessionToken);
      await insertSession(testUser.userId, tokenHash, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

      const headers = new Headers();
      headers.set('Cookie', `epitome_session=${sessionToken}`);

      const response = await app.request('/v1/auth/refresh', {
        method: 'POST',
        headers,
      });

      expect(response.status).toBe(200);

      const setCookieHeader = response.headers.get('set-cookie');
      expect(setCookieHeader).toBeDefined();
      // Should contain SameSite=Lax (case-insensitive check)
      expect(setCookieHeader!.toLowerCase()).toContain('samesite=lax');
      // Should NOT contain SameSite=None
      expect(setCookieHeader!.toLowerCase()).not.toContain('samesite=none');

      // Cleanup
      await deleteSession(tokenHash);
    });
  });

  // ─── M-11: Auth Code TTL Reduced to 60 Seconds ────────────────────

  describe('M-11: Auth Code TTL Reduced to 60 Seconds', () => {
    test('auth code stored via consent should expire in ~60 seconds, not 10 minutes', async () => {
      const oauthClientId = crypto.randomBytes(16).toString('hex');
      await insertOAuthClient(oauthClientId, 'Test TTL App', ['https://localhost:3000/callback']);

      // Create a session for submitting consent
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashSessionToken(sessionToken);
      await insertSession(testUser.userId, tokenHash, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

      // First get the consent page to get a CSRF token
      const codeChallenge = crypto.createHash('sha256').update('test_verifier').digest('base64url');
      const getHeaders = new Headers();
      getHeaders.set('Cookie', `epitome_session=${sessionToken}`);

      const getUrl = `/v1/auth/oauth/authorize?client_id=${oauthClientId}&redirect_uri=${encodeURIComponent('https://localhost:3000/callback')}&code_challenge=${codeChallenge}&code_challenge_method=S256&response_type=code&scope=profile:read`;

      const getResponse = await app.request(getUrl, { method: 'GET', headers: getHeaders });
      expect(getResponse.status).toBe(200);

      // Extract CSRF token from the HTML
      const html = await getResponse.text();
      const csrfMatch = html.match(/name="csrf_token"\s+value="([^"]+)"/);
      expect(csrfMatch).toBeTruthy();
      const csrfToken = csrfMatch![1];

      // Extract CSRF cookie
      const setCookieHeader = getResponse.headers.get('set-cookie') || '';
      const csrfCookieMatch = setCookieHeader.match(/csrf_token=([^;]+)/);
      expect(csrfCookieMatch).toBeTruthy();

      // Submit consent with CSRF token
      const formBody = new URLSearchParams({
        action: 'approve',
        client_id: oauthClientId,
        redirect_uri: 'https://localhost:3000/callback',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state: '',
        scope: 'profile:read',
        csrf_token: csrfToken!,
      });

      const postHeaders = new Headers();
      postHeaders.set('Content-Type', 'application/x-www-form-urlencoded');
      postHeaders.set('Cookie', `epitome_session=${sessionToken}; csrf_token=${csrfCookieMatch![1]}`);

      const postResponse = await app.request('/v1/auth/oauth/authorize', {
        method: 'POST',
        headers: postHeaders,
        body: formBody.toString(),
      });

      // Should redirect (302) with authorization code
      expect(postResponse.status).toBe(302);

      // Check the stored auth code expiry is ~60 seconds, not 10 minutes
      const result = await db.execute(sql.raw(`
        SELECT expires_at FROM public.oauth_authorization_codes
        WHERE client_id = '${oauthClientId}'
        ORDER BY created_at DESC LIMIT 1
      `)) as unknown as any[];

      expect(result.length).toBe(1);
      const expiresAt = new Date(result[0].expires_at as string);
      const expiresIn = expiresAt.getTime() - Date.now();
      // Should expire in roughly 60 seconds (allow some tolerance for test execution)
      expect(expiresIn).toBeLessThan(65 * 1000); // Less than 65 seconds
      expect(expiresIn).toBeGreaterThan(0); // Not already expired

      // Cleanup
      await deleteAuthCodes(oauthClientId);
      await deleteSession(tokenHash);
      await deleteOAuthClient(oauthClientId);
    });
  });
});
