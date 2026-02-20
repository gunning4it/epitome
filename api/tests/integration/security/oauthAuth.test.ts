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
import {
  VALID_OAUTH_SCOPES,
  validateOAuthScopes,
  parseOAuthScopesToApiKeyScopes,
  permFieldsToScopeString,
} from '@/mcp/oauth';
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
      resource VARCHAR(2048),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `));
  // Add resource column if it doesn't exist (for existing tables)
  await db.execute(sql.raw(`
    ALTER TABLE public.oauth_authorization_codes ADD COLUMN IF NOT EXISTS resource VARCHAR(2048)
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

/**
 * Helper: delete API keys created by token exchange for a given agentId
 * (needed to stay within free tier maxAgents limit across tests)
 */
async function deleteApiKeysForAgent(userId: string, agentId: string) {
  await db.execute(sql.raw(`DELETE FROM public.api_keys WHERE user_id = '${userId}' AND agent_id = '${agentId}'`));
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
      await deleteApiKeysForAgent(testUser.userId, 'test-hash-app');
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

      // Submit consent with CSRF token (using per-resource permission fields)
      const formBody = new URLSearchParams({
        action: 'approve',
        client_id: oauthClientId,
        redirect_uri: 'https://localhost:3000/callback',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state: '',
        'perm_profile': 'read',
        'perm_tables/*': 'none',
        'perm_vectors/*': 'none',
        'perm_graph': 'none',
        'perm_memory': 'none',
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

  // ─── ChatGPT Redirect URI Support ───────────────────────────────────

  describe('ChatGPT redirect URI support', () => {
    test('accepts ChatGPT redirect URI', async () => {
      const response = await app.request('/v1/auth/oauth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'ChatGPT Test',
          redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json() as any;
      expect(body.client_id).toBeDefined();
      expect(body.redirect_uris).toContain('https://chatgpt.com/connector_platform_oauth_redirect');

      // Cleanup
      await deleteOAuthClient(body.client_id);
    });

    test('accepts OpenAI platform redirect URI', async () => {
      const response = await app.request('/v1/auth/oauth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'OpenAI Platform Test',
          redirect_uris: ['https://platform.openai.com/apps-manage/oauth'],
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json() as any;
      expect(body.client_id).toBeDefined();
      expect(body.redirect_uris).toContain('https://platform.openai.com/apps-manage/oauth');

      // Cleanup
      await deleteOAuthClient(body.client_id);
    });
  });

  // ─── RFC 8707: Resource Parameter Validation ────────────────────────

  describe('RFC 8707: Resource parameter validation', () => {
    let oauthClientId: string;

    beforeAll(async () => {
      oauthClientId = crypto.randomBytes(16).toString('hex');
      await insertOAuthClient(oauthClientId, 'Test Resource App', ['https://localhost:3000/callback']);
    });

    afterAll(async () => {
      await deleteAuthCodes(oauthClientId);
      await deleteOAuthClient(oauthClientId);
    });

    test('rejects unknown resource parameter at authorization endpoint', async () => {
      const codeChallenge = crypto.createHash('sha256').update('test_verifier').digest('base64url');
      const url = `/v1/auth/oauth/authorize?client_id=${oauthClientId}&redirect_uri=${encodeURIComponent('https://localhost:3000/callback')}&code_challenge=${codeChallenge}&code_challenge_method=S256&response_type=code&scope=profile:read&resource=${encodeURIComponent('https://evil.example.com')}`;

      const response = await app.request(url, { method: 'GET' });

      expect(response.status).toBe(400);
      const html = await response.text();
      expect(html).toContain('Invalid resource parameter');
    });

    test('rejects unknown resource parameter at token endpoint', async () => {
      const formBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'fake_code',
        code_verifier: 'a'.repeat(43), // minimum length
        resource: 'https://evil.example.com',
      });

      const response = await app.request('/v1/auth/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody.toString(),
      });

      expect(response.status).toBe(400);
      const body = await response.json() as any;
      expect(body.error).toBe('invalid_request');
      expect(body.error_description).toContain('Invalid resource parameter');
    });

    test('accepts valid resource parameter (development)', async () => {
      // In test mode, APP_ENV defaults to 'development', so http://localhost:3000 is allowed
      const codeChallenge = crypto.createHash('sha256').update('test_verifier').digest('base64url');

      // Create a session for the user
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashSessionToken(sessionToken);
      await insertSession(testUser.userId, tokenHash, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

      const headers = new Headers();
      headers.set('Cookie', `epitome_session=${sessionToken}`);

      const url = `/v1/auth/oauth/authorize?client_id=${oauthClientId}&redirect_uri=${encodeURIComponent('https://localhost:3000/callback')}&code_challenge=${codeChallenge}&code_challenge_method=S256&response_type=code&scope=profile:read&resource=${encodeURIComponent('http://localhost:3000')}`;

      const response = await app.request(url, { method: 'GET', headers });

      // Should render consent page (200), not error (400)
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('Authorize Access');

      // Cleanup
      await deleteSession(tokenHash);
    });

    test('rejects token request with mismatched resource', async () => {
      // Store an auth code with resource = 'http://localhost:3000'
      const rawCode = crypto.randomBytes(64).toString('hex');
      const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');
      const codeVerifier = crypto.randomBytes(32).toString('hex');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

      await db.execute(sql.raw(`
        INSERT INTO public.oauth_authorization_codes (code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, state, resource, expires_at)
        VALUES ('${codeHash}', '${oauthClientId}', '${testUser.userId}', 'https://localhost:3000/callback', 'profile:read', '${codeChallenge}', 'S256', '', 'http://localhost:3000', '${new Date(Date.now() + 60 * 1000).toISOString()}')
      `));

      // Try to exchange with a different (but valid-for-env) resource
      // Since dev only has one resource, we need to use an invalid one — but that gets caught earlier.
      // Instead, store one resource in the auth code and send a different one at token time.
      // We'll temporarily set a different resource in the auth code record.
      await db.execute(sql.raw(`
        UPDATE public.oauth_authorization_codes SET resource = 'https://other-valid.example.com' WHERE code = '${codeHash}'
      `));

      const formBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code: rawCode,
        code_verifier: codeVerifier,
        redirect_uri: 'https://localhost:3000/callback',
        client_id: oauthClientId,
        resource: 'http://localhost:3000',
      });

      const response = await app.request('/v1/auth/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody.toString(),
      });

      expect(response.status).toBe(400);
      const body = await response.json() as any;
      expect(body.error).toBe('invalid_grant');
      expect(body.error_description).toContain('resource does not match');

      // Cleanup
      await db.execute(sql.raw(`DELETE FROM public.oauth_authorization_codes WHERE code = '${codeHash}'`));
    });
  });

  // ─── Token Response Scope ───────────────────────────────────────────

  describe('Token response includes scope', () => {
    let oauthClientId: string;

    beforeAll(async () => {
      oauthClientId = crypto.randomBytes(16).toString('hex');
      await insertOAuthClient(oauthClientId, 'Test Scope App', ['https://localhost:3000/callback']);
    });

    afterAll(async () => {
      await deleteApiKeysForAgent(testUser.userId, 'test-scope-app');
      await deleteAuthCodes(oauthClientId);
      await deleteOAuthClient(oauthClientId);
    });

    test('includes scope in token response', async () => {
      const rawCode = crypto.randomBytes(64).toString('hex');
      const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');
      const codeVerifier = crypto.randomBytes(32).toString('hex');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

      await db.execute(sql.raw(`
        INSERT INTO public.oauth_authorization_codes (code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, state, expires_at)
        VALUES ('${codeHash}', '${oauthClientId}', '${testUser.userId}', 'https://localhost:3000/callback', 'profile:read tables:read', '${codeChallenge}', 'S256', '', '${new Date(Date.now() + 60 * 1000).toISOString()}')
      `));

      const formBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code: rawCode,
        code_verifier: codeVerifier,
        redirect_uri: 'https://localhost:3000/callback',
        client_id: oauthClientId,
      });

      const response = await app.request('/v1/auth/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody.toString(),
      });

      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.access_token).toBeDefined();
      expect(body.token_type).toBe('Bearer');
      expect(body.scope).toBe('profile:read tables:read');
      expect(body.expires_in).toBeDefined();
    });
  });

  // ─── OAuth Scope Validation Helpers ─────────────────────────────────

  describe('OAuth scope validation helpers', () => {
    test('VALID_OAUTH_SCOPES contains all documented scopes', () => {
      expect(VALID_OAUTH_SCOPES.has('profile:read')).toBe(true);
      expect(VALID_OAUTH_SCOPES.has('profile:write')).toBe(true);
      expect(VALID_OAUTH_SCOPES.has('tables:read')).toBe(true);
      expect(VALID_OAUTH_SCOPES.has('tables:write')).toBe(true);
      expect(VALID_OAUTH_SCOPES.has('vectors:read')).toBe(true);
      expect(VALID_OAUTH_SCOPES.has('vectors:write')).toBe(true);
      expect(VALID_OAUTH_SCOPES.has('graph:read')).toBe(true);
      expect(VALID_OAUTH_SCOPES.has('memory:read')).toBe(true);
      expect(VALID_OAUTH_SCOPES.has('memory:write')).toBe(true);
      expect(VALID_OAUTH_SCOPES.size).toBe(9);
    });

    test('validateOAuthScopes: accepts valid scopes', () => {
      const result = validateOAuthScopes('profile:read tables:write');
      expect(result.valid).toEqual(['profile:read', 'tables:write']);
      expect(result.invalid).toEqual([]);
    });

    test('validateOAuthScopes: rejects unknown scopes', () => {
      const result = validateOAuthScopes('foo:bar profile:read baz');
      expect(result.valid).toEqual(['profile:read']);
      expect(result.invalid).toEqual(['foo:bar', 'baz']);
    });

    test('validateOAuthScopes: returns empty arrays for null/empty input', () => {
      expect(validateOAuthScopes(null)).toEqual({ valid: [], invalid: [] });
      expect(validateOAuthScopes('')).toEqual({ valid: [], invalid: [] });
      expect(validateOAuthScopes('  ')).toEqual({ valid: [], invalid: [] });
    });

    test('parseOAuthScopesToApiKeyScopes: read-only scopes → [read]', () => {
      expect(parseOAuthScopesToApiKeyScopes('profile:read')).toEqual(['read']);
      expect(parseOAuthScopesToApiKeyScopes('profile:read tables:read graph:read')).toEqual(['read']);
    });

    test('parseOAuthScopesToApiKeyScopes: any write scope → [read, write]', () => {
      expect(parseOAuthScopesToApiKeyScopes('profile:read tables:write')).toEqual(['read', 'write']);
      expect(parseOAuthScopesToApiKeyScopes('memory:write')).toEqual(['read', 'write']);
    });

    test('parseOAuthScopesToApiKeyScopes: empty/null → [read, write] (backward compat)', () => {
      expect(parseOAuthScopesToApiKeyScopes(null)).toEqual(['read', 'write']);
      expect(parseOAuthScopesToApiKeyScopes('')).toEqual(['read', 'write']);
    });
  });

  // ─── Token Exchange Respects Scope ──────────────────────────────────

  describe('Token exchange respects OAuth scopes', () => {
    let oauthClientId: string;

    beforeAll(async () => {
      oauthClientId = crypto.randomBytes(16).toString('hex');
      await insertOAuthClient(oauthClientId, 'Test Scope Respect', ['https://localhost:3000/callback']);
    });

    afterAll(async () => {
      await deleteApiKeysForAgent(testUser.userId, 'test-scope-respect');
      await deleteAuthCodes(oauthClientId);
      await deleteOAuthClient(oauthClientId);
    });

    /**
     * Helper: create auth code and exchange for token
     */
    async function exchangeCodeForToken(scope: string) {
      const rawCode = crypto.randomBytes(64).toString('hex');
      const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');
      const codeVerifier = crypto.randomBytes(32).toString('hex');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

      await db.execute(sql.raw(`
        INSERT INTO public.oauth_authorization_codes (code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, state, expires_at)
        VALUES ('${codeHash}', '${oauthClientId}', '${testUser.userId}', 'https://localhost:3000/callback', '${scope}', '${codeChallenge}', 'S256', '', '${new Date(Date.now() + 60 * 1000).toISOString()}')
      `));

      const formBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code: rawCode,
        code_verifier: codeVerifier,
        redirect_uri: 'https://localhost:3000/callback',
        client_id: oauthClientId,
      });

      return app.request('/v1/auth/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody.toString(),
      });
    }

    test('read-only scope creates read-only API key', async () => {
      const response = await exchangeCodeForToken('profile:read');
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.access_token).toBeDefined();

      // Verify the API key was created with read-only scopes
      const keyHash = crypto.createHash('sha256').update(body.access_token).digest('hex');
      const rows = await db.execute(sql.raw(`
        SELECT scopes FROM public.api_keys WHERE key_hash = '${keyHash}'
      `)) as unknown as any[];
      expect(rows.length).toBe(1);
      expect(rows[0].scopes).toEqual(['read']);
    });

    test('write scope creates read+write API key', async () => {
      const response = await exchangeCodeForToken('profile:read tables:write');
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.access_token).toBeDefined();

      const keyHash = crypto.createHash('sha256').update(body.access_token).digest('hex');
      const rows = await db.execute(sql.raw(`
        SELECT scopes FROM public.api_keys WHERE key_hash = '${keyHash}'
      `)) as unknown as any[];
      expect(rows.length).toBe(1);
      expect(rows[0].scopes).toEqual(['read', 'write']);
    });

    test('empty scope falls back to read+write (backward compat)', async () => {
      const response = await exchangeCodeForToken('');
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.access_token).toBeDefined();

      const keyHash = crypto.createHash('sha256').update(body.access_token).digest('hex');
      const rows = await db.execute(sql.raw(`
        SELECT scopes FROM public.api_keys WHERE key_hash = '${keyHash}'
      `)) as unknown as any[];
      expect(rows.length).toBe(1);
      expect(rows[0].scopes).toEqual(['read', 'write']);
    });

    test('unknown scopes are dropped, valid scopes respected', async () => {
      const response = await exchangeCodeForToken('foo:bar profile:read');
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.access_token).toBeDefined();

      // Only profile:read is valid → read-only key
      const keyHash = crypto.createHash('sha256').update(body.access_token).digest('hex');
      const rows = await db.execute(sql.raw(`
        SELECT scopes FROM public.api_keys WHERE key_hash = '${keyHash}'
      `)) as unknown as any[];
      expect(rows.length).toBe(1);
      expect(rows[0].scopes).toEqual(['read']);
    });
  });

  // ─── Client Registration Scope Handling ─────────────────────────────

  describe('Client registration scope handling', () => {
    test('registration without scope omits scope field (not null)', async () => {
      const response = await app.request('/v1/auth/oauth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'No Scope Client',
          redirect_uris: ['https://localhost:3000/callback'],
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json() as any;
      expect(body.client_id).toBeDefined();
      // scope should be absent from response, not null
      expect(body).not.toHaveProperty('scope');

      // Cleanup
      await deleteOAuthClient(body.client_id);
    });

    test('registration with scope includes it in response', async () => {
      const response = await app.request('/v1/auth/oauth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Scoped Client',
          redirect_uris: ['https://localhost:3000/callback'],
          scope: 'profile:read memory:read',
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json() as any;
      expect(body.scope).toBe('profile:read memory:read');

      // Cleanup
      await deleteOAuthClient(body.client_id);
    });
  });

  // ─── Agent ID Mapping Convention ────────────────────────────────────

  describe('OAuth agent ID mapping', () => {
    test('ChatGPT client name maps to "chatgpt" agentId', async () => {
      const oauthClientId = crypto.randomBytes(16).toString('hex');
      await insertOAuthClient(oauthClientId, 'ChatGPT', ['https://localhost:3000/callback']);

      const rawCode = crypto.randomBytes(64).toString('hex');
      const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');
      const codeVerifier = crypto.randomBytes(32).toString('hex');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

      await db.execute(sql.raw(`
        INSERT INTO public.oauth_authorization_codes (code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, state, expires_at)
        VALUES ('${codeHash}', '${oauthClientId}', '${testUser.userId}', 'https://localhost:3000/callback', 'profile:read', '${codeChallenge}', 'S256', '', '${new Date(Date.now() + 60 * 1000).toISOString()}')
      `));

      const formBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code: rawCode,
        code_verifier: codeVerifier,
        redirect_uri: 'https://localhost:3000/callback',
        client_id: oauthClientId,
      });

      const response = await app.request('/v1/auth/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody.toString(),
      });

      expect(response.status).toBe(200);
      const body = await response.json() as any;

      // Verify the API key has agentId = 'chatgpt'
      const keyHash = crypto.createHash('sha256').update(body.access_token).digest('hex');
      const rows = await db.execute(sql.raw(`
        SELECT agent_id FROM public.api_keys WHERE key_hash = '${keyHash}'
      `)) as unknown as any[];
      expect(rows.length).toBe(1);
      expect(rows[0].agent_id).toBe('chatgpt');

      // Cleanup
      await deleteApiKeysForAgent(testUser.userId, 'chatgpt');
      await deleteAuthCodes(oauthClientId);
      await deleteOAuthClient(oauthClientId);
    });

    test('multi-word client name maps correctly', async () => {
      const oauthClientId = crypto.randomBytes(16).toString('hex');
      await insertOAuthClient(oauthClientId, 'My Custom Agent v2', ['https://localhost:3000/callback']);

      const rawCode = crypto.randomBytes(64).toString('hex');
      const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');
      const codeVerifier = crypto.randomBytes(32).toString('hex');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

      await db.execute(sql.raw(`
        INSERT INTO public.oauth_authorization_codes (code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, state, expires_at)
        VALUES ('${codeHash}', '${oauthClientId}', '${testUser.userId}', 'https://localhost:3000/callback', 'profile:read', '${codeChallenge}', 'S256', '', '${new Date(Date.now() + 60 * 1000).toISOString()}')
      `));

      const formBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code: rawCode,
        code_verifier: codeVerifier,
        redirect_uri: 'https://localhost:3000/callback',
        client_id: oauthClientId,
      });

      const response = await app.request('/v1/auth/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody.toString(),
      });

      expect(response.status).toBe(200);
      const body = await response.json() as any;

      const keyHash = crypto.createHash('sha256').update(body.access_token).digest('hex');
      const rows = await db.execute(sql.raw(`
        SELECT agent_id FROM public.api_keys WHERE key_hash = '${keyHash}'
      `)) as unknown as any[];
      expect(rows.length).toBe(1);
      expect(rows[0].agent_id).toBe('my-custom-agent-v2');

      // Cleanup
      await deleteApiKeysForAgent(testUser.userId, 'my-custom-agent-v2');
      await deleteAuthCodes(oauthClientId);
      await deleteOAuthClient(oauthClientId);
    });
  });

  // ─── Consent Preservation on Re-auth ────────────────────────────────

  describe('Consent rules preserved on OAuth re-auth', () => {
    test('existing dashboard consent is NOT overwritten by OAuth token exchange', async () => {
      const oauthClientId = crypto.randomBytes(16).toString('hex');
      const agentId = 'consent-test-agent';
      await insertOAuthClient(oauthClientId, 'Consent Test Agent', ['https://localhost:3000/callback']);

      // Pre-create consent rules (simulating dashboard-configured read-only agent)
      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.consent_rules (agent_id, resource, permission)
        VALUES ('${agentId}', 'profile', 'read')
        ON CONFLICT (agent_id, resource) DO UPDATE SET permission = 'read', revoked_at = NULL
      `));

      // Now do OAuth token exchange for the same agentId
      const rawCode = crypto.randomBytes(64).toString('hex');
      const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');
      const codeVerifier = crypto.randomBytes(32).toString('hex');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

      await db.execute(sql.raw(`
        INSERT INTO public.oauth_authorization_codes (code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, state, expires_at)
        VALUES ('${codeHash}', '${oauthClientId}', '${testUser.userId}', 'https://localhost:3000/callback', 'memory:write', '${codeChallenge}', 'S256', '', '${new Date(Date.now() + 60 * 1000).toISOString()}')
      `));

      const formBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code: rawCode,
        code_verifier: codeVerifier,
        redirect_uri: 'https://localhost:3000/callback',
        client_id: oauthClientId,
      });

      const response = await app.request('/v1/auth/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody.toString(),
      });

      expect(response.status).toBe(200);

      // Verify the original read-only consent was NOT overwritten to write
      const consentRows = await db.execute(sql.raw(`
        SELECT permission FROM ${testUser.schemaName}.consent_rules
        WHERE agent_id = '${agentId}' AND resource = 'profile' AND revoked_at IS NULL
      `)) as unknown as any[];
      expect(consentRows.length).toBe(1);
      expect(consentRows[0].permission).toBe('read');

      // Verify no new consent rules were auto-granted (only the 1 we inserted)
      const allConsent = await db.execute(sql.raw(`
        SELECT COUNT(*)::int AS count FROM ${testUser.schemaName}.consent_rules
        WHERE agent_id = '${agentId}' AND revoked_at IS NULL
      `)) as unknown as any[];
      expect(allConsent[0].count).toBe(1);

      // Cleanup
      await deleteApiKeysForAgent(testUser.userId, agentId);
      await db.execute(sql.raw(`
        DELETE FROM ${testUser.schemaName}.consent_rules WHERE agent_id = '${agentId}'
      `));
      await deleteAuthCodes(oauthClientId);
      await deleteOAuthClient(oauthClientId);
    });
  });

  // ─── Per-Resource Permission Controls ──────────────────────────────

  describe('Per-resource permission controls on consent page', () => {
    let oauthClientId: string;

    beforeAll(async () => {
      oauthClientId = crypto.randomBytes(16).toString('hex');
      await insertOAuthClient(oauthClientId, 'Perm Controls App', ['https://localhost:3000/callback']);
    });

    afterAll(async () => {
      await deleteApiKeysForAgent(testUser.userId, 'perm-controls-app');
      await deleteAuthCodes(oauthClientId);
      await deleteOAuthClient(oauthClientId);
    });

    test('consent page renders per-resource radio buttons', async () => {
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashSessionToken(sessionToken);
      await insertSession(testUser.userId, tokenHash, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

      const codeChallenge = crypto.createHash('sha256').update('test_verifier').digest('base64url');
      const headers = new Headers();
      headers.set('Cookie', `epitome_session=${sessionToken}`);

      const url = `/v1/auth/oauth/authorize?client_id=${oauthClientId}&redirect_uri=${encodeURIComponent('https://localhost:3000/callback')}&code_challenge=${codeChallenge}&code_challenge_method=S256&response_type=code&scope=profile:read%20memory:write`;

      const response = await app.request(url, { method: 'GET', headers });
      expect(response.status).toBe(200);

      const html = await response.text();
      // Should have per-resource radio buttons
      expect(html).toContain('name="perm_profile"');
      expect(html).toContain('name="perm_tables/*"');
      expect(html).toContain('name="perm_vectors/*"');
      expect(html).toContain('name="perm_graph"');
      expect(html).toContain('name="perm_memory"');
      // Should NOT have the old hidden scope field
      expect(html).not.toContain('name="scope"');
      // Should have privacy/terms links
      expect(html).toContain('epitome.fyi/terms');
      expect(html).toContain('epitome.fyi/privacy');
      // Should have resource labels
      expect(html).toContain('Profile');
      expect(html).toContain('Knowledge Graph');
      expect(html).toContain('Memory');

      await deleteSession(tokenHash);
    });

    test('partial permissions produce correct scope string', async () => {
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashSessionToken(sessionToken);
      await insertSession(testUser.userId, tokenHash, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

      // Get consent page to obtain CSRF token
      const codeChallenge = crypto.createHash('sha256').update('partial_verifier_pad_to_43chars!!!').digest('base64url');
      const getHeaders = new Headers();
      getHeaders.set('Cookie', `epitome_session=${sessionToken}`);

      const getUrl = `/v1/auth/oauth/authorize?client_id=${oauthClientId}&redirect_uri=${encodeURIComponent('https://localhost:3000/callback')}&code_challenge=${codeChallenge}&code_challenge_method=S256&response_type=code&scope=profile:read`;

      const getResponse = await app.request(getUrl, { method: 'GET', headers: getHeaders });
      expect(getResponse.status).toBe(200);

      const html = await getResponse.text();
      const csrfMatch = html.match(/name="csrf_token"\s+value="([^"]+)"/);
      expect(csrfMatch).toBeTruthy();
      const csrfToken = csrfMatch![1];
      const setCookieHeader = getResponse.headers.get('set-cookie') || '';
      const csrfCookieMatch = setCookieHeader.match(/csrf_token=([^;]+)/);
      expect(csrfCookieMatch).toBeTruthy();

      // Submit with partial permissions: profile=read, memory=write, rest=none
      const formBody = new URLSearchParams({
        action: 'approve',
        client_id: oauthClientId,
        redirect_uri: 'https://localhost:3000/callback',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state: '',
        'perm_profile': 'read',
        'perm_tables/*': 'none',
        'perm_vectors/*': 'none',
        'perm_graph': 'none',
        'perm_memory': 'write',
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

      expect(postResponse.status).toBe(302);
      const location = postResponse.headers.get('location')!;
      expect(location).toContain('code=');

      // Verify stored auth code has the correct partial scope
      const rows = await db.execute(sql.raw(`
        SELECT scope FROM public.oauth_authorization_codes
        WHERE client_id = '${oauthClientId}'
        ORDER BY created_at DESC LIMIT 1
      `)) as unknown as any[];
      expect(rows.length).toBe(1);
      const storedScope = rows[0].scope as string;
      expect(storedScope).toContain('profile:read');
      expect(storedScope).toContain('memory:read');
      expect(storedScope).toContain('memory:write');
      expect(storedScope).not.toContain('tables');
      expect(storedScope).not.toContain('vectors');
      expect(storedScope).not.toContain('graph');

      await deleteSession(tokenHash);
    });

    test('all resources set to none produces empty scope', async () => {
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashSessionToken(sessionToken);
      await insertSession(testUser.userId, tokenHash, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

      const codeChallenge = crypto.createHash('sha256').update('none_verifier_pad_to_43chars!!!!!!').digest('base64url');
      const getHeaders = new Headers();
      getHeaders.set('Cookie', `epitome_session=${sessionToken}`);

      const getUrl = `/v1/auth/oauth/authorize?client_id=${oauthClientId}&redirect_uri=${encodeURIComponent('https://localhost:3000/callback')}&code_challenge=${codeChallenge}&code_challenge_method=S256&response_type=code&scope=profile:read`;

      const getResponse = await app.request(getUrl, { method: 'GET', headers: getHeaders });
      const html = await getResponse.text();
      const csrfMatch = html.match(/name="csrf_token"\s+value="([^"]+)"/);
      const setCookieHeader = getResponse.headers.get('set-cookie') || '';
      const csrfCookieMatch = setCookieHeader.match(/csrf_token=([^;]+)/);

      const formBody = new URLSearchParams({
        action: 'approve',
        client_id: oauthClientId,
        redirect_uri: 'https://localhost:3000/callback',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state: '',
        'perm_profile': 'none',
        'perm_tables/*': 'none',
        'perm_vectors/*': 'none',
        'perm_graph': 'none',
        'perm_memory': 'none',
        csrf_token: csrfMatch![1]!,
      });

      const postHeaders = new Headers();
      postHeaders.set('Content-Type', 'application/x-www-form-urlencoded');
      postHeaders.set('Cookie', `epitome_session=${sessionToken}; csrf_token=${csrfCookieMatch![1]}`);

      const postResponse = await app.request('/v1/auth/oauth/authorize', {
        method: 'POST',
        headers: postHeaders,
        body: formBody.toString(),
      });

      // Should still redirect with auth code (empty scope is valid)
      expect(postResponse.status).toBe(302);

      const rows = await db.execute(sql.raw(`
        SELECT scope FROM public.oauth_authorization_codes
        WHERE client_id = '${oauthClientId}'
        ORDER BY created_at DESC LIMIT 1
      `)) as unknown as any[];
      expect(rows.length).toBe(1);
      expect(rows[0].scope).toBe('');

      await deleteSession(tokenHash);
    });

    test('legacy scope field still works when no perm_* fields present', async () => {
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashSessionToken(sessionToken);
      await insertSession(testUser.userId, tokenHash, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

      const codeChallenge = crypto.createHash('sha256').update('legacy_verifier_pad_to_43chars!!!!').digest('base64url');
      const getHeaders = new Headers();
      getHeaders.set('Cookie', `epitome_session=${sessionToken}`);

      const getUrl = `/v1/auth/oauth/authorize?client_id=${oauthClientId}&redirect_uri=${encodeURIComponent('https://localhost:3000/callback')}&code_challenge=${codeChallenge}&code_challenge_method=S256&response_type=code&scope=profile:read`;

      const getResponse = await app.request(getUrl, { method: 'GET', headers: getHeaders });
      const html = await getResponse.text();
      const csrfMatch = html.match(/name="csrf_token"\s+value="([^"]+)"/);
      const setCookieHeader = getResponse.headers.get('set-cookie') || '';
      const csrfCookieMatch = setCookieHeader.match(/csrf_token=([^;]+)/);

      // Submit using the old scope field (no perm_* fields)
      const formBody = new URLSearchParams({
        action: 'approve',
        client_id: oauthClientId,
        redirect_uri: 'https://localhost:3000/callback',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state: '',
        scope: 'profile:read tables:write',
        csrf_token: csrfMatch![1]!,
      });

      const postHeaders = new Headers();
      postHeaders.set('Content-Type', 'application/x-www-form-urlencoded');
      postHeaders.set('Cookie', `epitome_session=${sessionToken}; csrf_token=${csrfCookieMatch![1]}`);

      const postResponse = await app.request('/v1/auth/oauth/authorize', {
        method: 'POST',
        headers: postHeaders,
        body: formBody.toString(),
      });

      expect(postResponse.status).toBe(302);

      const rows = await db.execute(sql.raw(`
        SELECT scope FROM public.oauth_authorization_codes
        WHERE client_id = '${oauthClientId}'
        ORDER BY created_at DESC LIMIT 1
      `)) as unknown as any[];
      expect(rows.length).toBe(1);
      expect(rows[0].scope).toBe('profile:read tables:write');

      await deleteSession(tokenHash);
    });
  });

  // ─── permFieldsToScopeString Unit Tests ────────────────────────────

  describe('permFieldsToScopeString', () => {
    test('all write produces full scope string', () => {
      const result = permFieldsToScopeString({
        'profile': 'write',
        'tables/*': 'write',
        'vectors/*': 'write',
        'graph': 'write', // graph has no write scope, should only get read
        'memory': 'write',
      });
      expect(result).toContain('profile:read');
      expect(result).toContain('profile:write');
      expect(result).toContain('tables:read');
      expect(result).toContain('tables:write');
      expect(result).toContain('vectors:read');
      expect(result).toContain('vectors:write');
      expect(result).toContain('graph:read');
      expect(result).not.toContain('graph:write');
      expect(result).toContain('memory:read');
      expect(result).toContain('memory:write');
    });

    test('all read produces read-only scope string', () => {
      const result = permFieldsToScopeString({
        'profile': 'read',
        'tables/*': 'read',
        'vectors/*': 'read',
        'graph': 'read',
        'memory': 'read',
      });
      expect(result).toBe('profile:read tables:read vectors:read graph:read memory:read');
    });

    test('all none produces empty string', () => {
      const result = permFieldsToScopeString({
        'profile': 'none',
        'tables/*': 'none',
        'vectors/*': 'none',
        'graph': 'none',
        'memory': 'none',
      });
      expect(result).toBe('');
    });

    test('mixed permissions produce correct subset', () => {
      const result = permFieldsToScopeString({
        'profile': 'write',
        'tables/*': 'none',
        'vectors/*': 'read',
        'graph': 'read',
        'memory': 'none',
      });
      expect(result).toContain('profile:read');
      expect(result).toContain('profile:write');
      expect(result).toContain('vectors:read');
      expect(result).toContain('graph:read');
      expect(result).not.toContain('tables');
      expect(result).not.toContain('memory');
    });
  });
});
