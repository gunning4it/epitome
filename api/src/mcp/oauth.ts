/**
 * MCP OAuth 2.0 Endpoints
 *
 * Full OAuth 2.0 Authorization Code + PKCE flow for AI platforms
 * (Claude Desktop, ChatGPT remote MCP connector).
 *
 * References:
 * - RFC 8414 (Authorization Server Metadata)
 * - RFC 9728 (Protected Resource Metadata)
 * - RFC 7591 (Dynamic Client Registration)
 * - RFC 6749 (OAuth 2.0 Authorization Code)
 * - RFC 7636 (PKCE)
 * - RFC 8707 (Resource Indicators)
 *
 * Key design decision: Reuses epi_... API keys as OAuth access tokens.
 * The existing authResolver middleware validates them automatically.
 */

import crypto from 'crypto';
import { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { db } from '@/db/client';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { oauthClients, oauthAuthorizationCodes, users, sessions } from '@/db/schema';
import {
  generateAuthorizationCode,
  generateOAuthClientId,
  verifyPkceS256,
  hashSessionToken,
  constantTimeCompare,
} from '@/utils/crypto';
import { createApiKeyForUser } from '@/services/auth.service';
import { logger } from '@/utils/logger';

// ─── OAuth Scope Validation ─────────────────────────────────────────

/**
 * Allowlist of valid OAuth scopes, derived from scopes_supported in
 * protectedResourceMetadata and oauthDiscovery.
 */
export const VALID_OAUTH_SCOPES = new Set([
  'profile:read',
  'profile:write',
  'tables:read',
  'tables:write',
  'vectors:read',
  'vectors:write',
  'graph:read',
  'memory:read',
  'memory:write',
]);

/**
 * Validate an OAuth scope string against the allowlist.
 * Splits on whitespace and categorizes each token.
 */
export function validateOAuthScopes(scopeString: string | null | undefined): {
  valid: string[];
  invalid: string[];
} {
  if (!scopeString || !scopeString.trim()) {
    return { valid: [], invalid: [] };
  }
  const tokens = scopeString.trim().split(/\s+/);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const token of tokens) {
    if (VALID_OAUTH_SCOPES.has(token)) {
      valid.push(token);
    } else {
      invalid.push(token);
    }
  }
  return { valid, invalid };
}

/**
 * Convert validated OAuth scope tokens to API key scopes (['read'] or ['read','write']).
 *
 * - If any scope ends with `:write` → ['read', 'write']
 * - If all scopes are `:read` → ['read']
 * - If empty/missing → ['read', 'write'] (backward-compat fallback)
 */
export function parseOAuthScopesToApiKeyScopes(scopeString: string | null | undefined): string[] {
  if (!scopeString || !scopeString.trim()) {
    logger.warn('OAuth scope empty — falling back to read+write for backward compatibility');
    return ['read', 'write'];
  }
  const tokens = scopeString.trim().split(/\s+/);
  const hasWrite = tokens.some((t) => t.endsWith(':write'));
  return hasWrite ? ['read', 'write'] : ['read'];
}

// ─── APP_ENV-scoped resource validation (RFC 8707) ──────────────────

const ALLOWED_RESOURCES: Record<string, Set<string>> = {
  production:  new Set(['https://api.epitome.fyi']),
  staging:     new Set(['https://epitome-staging-api.fly.dev']),
  development: new Set(['http://localhost:3000']),
};

function getAppEnv(): string {
  // In test mode, default to 'development' so tests don't need APP_ENV set
  if (process.env.NODE_ENV === 'test') {
    return process.env.APP_ENV || 'development';
  }
  const env = process.env.APP_ENV;
  if (!env || !ALLOWED_RESOURCES[env]) {
    throw new Error(`FATAL: APP_ENV must be one of: ${Object.keys(ALLOWED_RESOURCES).join(', ')}. Got: '${env}'`);
  }
  return env;
}

/**
 * Validate a resource parameter against the APP_ENV-scoped allowlist.
 * Returns null if valid (or absent), or an error description string if invalid.
 */
export function validateResource(resource: string | undefined): string | null {
  if (!resource) return null; // resource param is optional
  const env = getAppEnv();
  const allowed = ALLOWED_RESOURCES[env]!;
  // Normalize trailing slash — Claude sends "https://api.epitome.fyi/"
  // but our allowlist has "https://api.epitome.fyi"
  const normalized = resource.replace(/\/+$/, '');
  if (!allowed.has(normalized)) {
    return `Invalid resource parameter for environment '${env}'`;
  }
  return null;
}

function getBaseUrl(): string {
  return process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
}

// ─── RFC 9728: Protected Resource Metadata ──────────────────────────

/**
 * GET /.well-known/oauth-protected-resource
 *
 * First endpoint Claude Desktop hits. Tells it which authorization
 * server to use for this resource.
 */
export async function protectedResourceMetadata(c: Context) {
  const baseUrl = getBaseUrl();

  return c.json({
    resource: baseUrl,
    authorization_servers: [baseUrl],
    scopes_supported: [
      'profile:read',
      'profile:write',
      'tables:read',
      'tables:write',
      'vectors:read',
      'vectors:write',
      'graph:read',
      'memory:read',
      'memory:write',
    ],
    bearer_methods_supported: ['header'],
  });
}

// ─── RFC 8414: Authorization Server Metadata ────────────────────────

/**
 * GET /.well-known/oauth-authorization-server
 *
 * Updated from skeleton: removed jwks_uri, added registration_endpoint,
 * added 'none' to auth methods (public clients like Claude Desktop).
 */
export async function oauthDiscovery(c: Context) {
  const baseUrl = getBaseUrl();

  return c.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/v1/auth/oauth/authorize`,
    token_endpoint: `${baseUrl}/v1/auth/oauth/token`,
    registration_endpoint: `${baseUrl}/v1/auth/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: [
      'profile:read',
      'profile:write',
      'tables:read',
      'tables:write',
      'vectors:read',
      'vectors:write',
      'graph:read',
      'memory:read',
      'memory:write',
    ],
  });
}

// ─── RFC 7591: Dynamic Client Registration ──────────────────────────

/**
 * POST /v1/auth/oauth/register
 *
 * Registers a new OAuth client. Claude Desktop and ChatGPT call this
 * automatically before starting the auth flow.
 */
export async function oauthRegister(c: Context) {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_request', error_description: 'Invalid JSON body' }, 400);
  }

  const redirectUris = body.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return c.json(
      { error: 'invalid_client_metadata', error_description: 'redirect_uris is required and must be a non-empty array' },
      400
    );
  }

  // Validate each redirect URI — must be HTTPS or localhost
  for (const uri of redirectUris) {
    if (typeof uri !== 'string') {
      return c.json(
        { error: 'invalid_client_metadata', error_description: 'Each redirect_uri must be a string' },
        400
      );
    }
    try {
      const parsed = new URL(uri);
      const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (parsed.protocol !== 'https:' && !isLocalhost) {
        return c.json(
          { error: 'invalid_client_metadata', error_description: `redirect_uri must use HTTPS (or localhost): ${uri}` },
          400
        );
      }
    } catch {
      return c.json(
        { error: 'invalid_client_metadata', error_description: `Invalid redirect_uri: ${uri}` },
        400
      );
    }
  }

  const clientId = generateOAuthClientId();
  const clientName = typeof body.client_name === 'string' ? body.client_name : null;
  const scope = typeof body.scope === 'string' ? body.scope : null;
  const clientUri = typeof body.client_uri === 'string' ? body.client_uri : null;
  const logoUri = typeof body.logo_uri === 'string' ? body.logo_uri : null;

  await db.insert(oauthClients).values({
    clientId,
    clientName,
    redirectUris: redirectUris as string[],
    grantTypes: ['authorization_code'],
    responseTypes: ['code'],
    tokenEndpointAuthMethod: 'none',
    scope,
    clientUri,
    logoUri,
  });

  const response: Record<string, unknown> = {
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
  if (scope) response.scope = scope;

  return c.json(response, 201);
}

// ─── Authorization Endpoint ─────────────────────────────────────────

/**
 * GET /v1/auth/oauth/authorize
 *
 * Validates params, checks session, renders login or consent page.
 */
export async function oauthAuthorize(c: Context) {
  const clientId = c.req.query('client_id');
  const redirectUri = c.req.query('redirect_uri');
  const codeChallenge = c.req.query('code_challenge');
  const codeChallengeMethod = c.req.query('code_challenge_method') || 'S256';
  const responseType = c.req.query('response_type');
  const scope = c.req.query('scope') || '';
  const state = c.req.query('state') || '';
  const resource = c.req.query('resource');

  // Validate required params
  if (!clientId || !redirectUri || !codeChallenge || !responseType) {
    return c.html(renderErrorPage('Missing required parameters: client_id, redirect_uri, code_challenge, response_type'), 400);
  }

  if (responseType !== 'code') {
    return c.html(renderErrorPage('Unsupported response_type. Only "code" is supported.'), 400);
  }

  if (codeChallengeMethod !== 'S256') {
    return c.html(renderErrorPage('Unsupported code_challenge_method. Only "S256" is supported.'), 400);
  }

  // RFC 8707: Validate resource parameter if provided
  const resourceError = validateResource(resource);
  if (resourceError) {
    return c.html(renderErrorPage(resourceError), 400);
  }

  // Look up client
  const [client] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1);

  if (!client) {
    return c.html(renderErrorPage('Unknown client_id'), 400);
  }

  // Validate redirect_uri against registered URIs
  const registeredUris = client.redirectUris as string[];
  if (!registeredUris.includes(redirectUri)) {
    return c.html(renderErrorPage('redirect_uri does not match any registered URI for this client'), 400);
  }

  // Check session cookie
  const sessionToken = getCookie(c, 'epitome_session');
  if (!sessionToken) {
    // No session — render login page
    return c.html(renderLoginPage(c.req.url), 200);
  }

  // Validate session
  const tokenHash = hashSessionToken(sessionToken);
  const now = new Date();
  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1);

  if (!session) {
    // Expired/invalid session — render login page
    return c.html(renderLoginPage(c.req.url), 200);
  }

  // Valid session — look up user for consent page
  const [user] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  // C-3 SECURITY FIX: Generate CSRF token for consent form (double-submit pattern)
  const csrfToken = crypto.randomBytes(32).toString('hex');
  setCookie(c, 'csrf_token', csrfToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Strict',
    path: '/v1/auth/oauth/authorize',
    maxAge: 600, // 10 minutes
  });

  // Render consent page
  return c.html(
    renderConsentPage({
      clientName: client.clientName || clientId,
      scope,
      userEmail: user?.email || 'unknown',
      clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      state,
      resource: resource || '',
      csrfToken,
    }),
    200
  );
}

/**
 * POST /v1/auth/oauth/authorize
 *
 * Processes consent form submission. Generates auth code on approval.
 */
export async function oauthAuthorizeConsent(c: Context) {
  // Parse form body
  const body = await c.req.parseBody();

  const action = body['action'] as string;
  const clientId = body['client_id'] as string;
  const redirectUri = body['redirect_uri'] as string;
  const codeChallenge = body['code_challenge'] as string;
  const codeChallengeMethod = body['code_challenge_method'] as string || 'S256';
  const state = body['state'] as string || '';
  const scope = body['scope'] as string || '';
  const resource = body['resource'] as string || '';

  // C-3 SECURITY FIX: Verify CSRF token (double-submit cookie pattern)
  const csrfFromForm = body['csrf_token'] as string;
  const csrfFromCookie = getCookie(c, 'csrf_token');
  if (!csrfFromForm || !csrfFromCookie || !constantTimeCompare(csrfFromForm, csrfFromCookie)) {
    return c.html(renderErrorPage('CSRF token validation failed'), 403);
  }

  if (!clientId || !redirectUri || !codeChallenge) {
    return c.html(renderErrorPage('Missing required form fields'), 400);
  }

  // Denied
  if (action !== 'approve') {
    const url = new URL(redirectUri);
    url.searchParams.set('error', 'access_denied');
    url.searchParams.set('error_description', 'User denied the authorization request');
    if (state) url.searchParams.set('state', state);
    return c.redirect(url.toString());
  }

  // Must have valid session
  const sessionToken = getCookie(c, 'epitome_session');
  if (!sessionToken) {
    return c.html(renderErrorPage('Session expired. Please try again.'), 401);
  }

  const tokenHash = hashSessionToken(sessionToken);
  const now = new Date();
  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1);

  if (!session) {
    return c.html(renderErrorPage('Session expired. Please try again.'), 401);
  }

  // M-11 SECURITY FIX: Reduce auth code TTL from 10 minutes to 60 seconds
  const code = generateAuthorizationCode();
  const expiresAt = new Date(Date.now() + 60 * 1000);

  // H-2 SECURITY FIX: Hash authorization code before storage
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');

  await db.insert(oauthAuthorizationCodes).values({
    code: codeHash,
    clientId,
    userId: session.userId,
    redirectUri,
    scope,
    codeChallenge,
    codeChallengeMethod,
    state,
    resource: resource || null,
    expiresAt,
  });

  // Redirect back to client with code
  const url = new URL(redirectUri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);

  return c.redirect(url.toString());
}

// ─── Token Endpoint ─────────────────────────────────────────────────

/**
 * POST /v1/auth/oauth/token
 *
 * Exchanges authorization code for an epi_... access token.
 * Supports both application/x-www-form-urlencoded and JSON body.
 */
export async function oauthToken(c: Context) {
  let grantType: string | undefined;
  let code: string | undefined;
  let redirectUri: string | undefined;
  let codeVerifier: string | undefined;
  let clientId: string | undefined;
  let resource: string | undefined;

  const contentType = c.req.header('Content-Type') || '';

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const body = await c.req.parseBody();
    grantType = body['grant_type'] as string;
    code = body['code'] as string;
    redirectUri = body['redirect_uri'] as string;
    codeVerifier = body['code_verifier'] as string;
    clientId = body['client_id'] as string;
    resource = body['resource'] as string;
  } else {
    try {
      const body = await c.req.json();
      grantType = body.grant_type;
      code = body.code;
      redirectUri = body.redirect_uri;
      codeVerifier = body.code_verifier;
      clientId = body.client_id;
      resource = body.resource;
    } catch {
      return c.json({ error: 'invalid_request', error_description: 'Invalid request body' }, 400);
    }
  }

  // RFC 8707: Validate resource parameter if provided
  const resourceError = validateResource(resource);
  if (resourceError) {
    return c.json({ error: 'invalid_request', error_description: resourceError }, 400);
  }

  if (grantType !== 'authorization_code') {
    return c.json({ error: 'unsupported_grant_type', error_description: 'Only authorization_code is supported' }, 400);
  }

  if (!code || !codeVerifier) {
    return c.json({ error: 'invalid_request', error_description: 'code and code_verifier are required' }, 400);
  }

  // RFC 7636 §4.1: code_verifier MUST be 43-128 characters
  if (codeVerifier.length < 43 || codeVerifier.length > 128) {
    return c.json({ error: 'invalid_request', error_description: 'code_verifier must be 43-128 characters (RFC 7636)' }, 400);
  }

  // H-2 SECURITY FIX: Hash the incoming code before lookup
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');

  // Look up the authorization code by hash
  const now = new Date();
  const [authCode] = await db
    .select()
    .from(oauthAuthorizationCodes)
    .where(
      and(
        eq(oauthAuthorizationCodes.code, codeHash),
        isNull(oauthAuthorizationCodes.usedAt),
        gt(oauthAuthorizationCodes.expiresAt, now)
      )
    )
    .limit(1);

  if (!authCode) {
    return c.json({ error: 'invalid_grant', error_description: 'Authorization code is invalid, expired, or already used' }, 400);
  }

  // Validate redirect_uri matches (if provided)
  if (redirectUri && redirectUri !== authCode.redirectUri) {
    return c.json({ error: 'invalid_grant', error_description: 'redirect_uri does not match' }, 400);
  }

  // Validate client_id matches (if provided)
  if (clientId && clientId !== authCode.clientId) {
    return c.json({ error: 'invalid_grant', error_description: 'client_id does not match' }, 400);
  }

  // RFC 8707: Validate resource matches what was stored with the auth code
  // Normalize trailing slashes for comparison
  if (resource && authCode.resource && resource.replace(/\/+$/, '') !== authCode.resource.replace(/\/+$/, '')) {
    return c.json({ error: 'invalid_grant', error_description: 'resource does not match the authorization request' }, 400);
  }

  // PKCE S256 verification
  if (!verifyPkceS256(codeVerifier, authCode.codeChallenge)) {
    return c.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
  }

  // Mark code as used
  await db
    .update(oauthAuthorizationCodes)
    .set({ usedAt: now })
    .where(eq(oauthAuthorizationCodes.id, authCode.id));

  // Create an epi_... API key as the access token
  try {
    // Look up client for name to derive a proper agentId
    const [client] = await db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.clientId, authCode.clientId))
      .limit(1);

    // Derive agentId from client_name (e.g., "Claude Desktop" → "claude-desktop")
    const agentId = (client?.clientName || authCode.clientId)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    // Validate scopes from auth code
    const { valid, invalid } = validateOAuthScopes(authCode.scope);
    if (invalid.length > 0) {
      logger.warn('OAuth token exchange: ignoring unknown scopes', { invalid });
    }
    const apiKeyScopes = parseOAuthScopesToApiKeyScopes(
      valid.length > 0 ? valid.join(' ') : authCode.scope
    );

    const apiKey = await createApiKeyForUser(
      authCode.userId,
      `MCP OAuth (${client?.clientName || authCode.clientId})`,
      agentId,
      apiKeyScopes,
      365 // 1 year expiry
    );

    return c.json({
      access_token: apiKey.key,
      token_type: 'Bearer',
      scope: authCode.scope || '',
      expires_in: 31536000, // 1 year in seconds
    });
  } catch (error) {
    logger.error('Failed to create access token', { error: String(error) });
    return c.json({ error: 'server_error', error_description: 'Failed to create access token' }, 500);
  }
}

// ─── HTML Page Renderers ────────────────────────────────────────────

const FONT_LINKS = `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
`;

const PAGE_STYLES = `
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a1a; color: #fafafa; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #1f1f1f; border: 1px solid #333338; border-radius: 14px; padding: 2.5rem 2rem; max-width: 420px; width: 100%; box-shadow: 0 1px 2px rgba(0,0,0,0.3); }
    .logo { font-family: 'Instrument Serif', serif; font-size: 1.75rem; font-weight: 400; letter-spacing: -0.02em; color: #fff; margin-bottom: 1.5rem; text-align: center; }
    .logo span { color: #3b82f6; }
    h2 { font-family: 'Inter', sans-serif; font-size: 1.125rem; font-weight: 600; color: #fafafa; margin-bottom: 1rem; text-align: center; }
    .info { background: #2a2a2a; border: 1px solid #333338; border-radius: 10px; padding: 1rem; margin-bottom: 1.5rem; font-size: 0.9rem; }
    .info .label { color: #808080; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 500; margin-bottom: 0.25rem; }
    .info .value { color: #fafafa; font-weight: 500; word-break: break-all; }
    .info + .info { margin-top: 0.75rem; }
    .scope-list { margin: 0.5rem 0; padding-left: 1.25rem; }
    .scope-list li { color: #fafafa; font-size: 0.875rem; margin-bottom: 0.25rem; }
    .btn-row { display: flex; gap: 0.75rem; }
    .btn { flex: 1; padding: 0.75rem 1rem; border: none; border-radius: 8px; font-size: 0.95rem; font-weight: 500; font-family: 'Inter', sans-serif; cursor: pointer; text-align: center; text-decoration: none; display: inline-block; transition: all 0.2s ease; }
    .btn-primary { background: #3b82f6; color: #fff; }
    .btn-primary:hover { background: #2563eb; }
    .btn-secondary { background: #2a2a2a; color: #fafafa; border: 1px solid #333338; }
    .btn-secondary:hover { background: #333338; }
    .btn-google { display: flex; align-items: center; justify-content: center; gap: 0.5rem; background: #fff; color: #333; border: 1px solid #ddd; border-radius: 8px; padding: 0.75rem; font-size: 0.95rem; font-weight: 500; font-family: 'Inter', sans-serif; text-decoration: none; width: 100%; transition: all 0.2s ease; }
    .btn-google:hover { background: #f5f5f5; }
    .error-text { color: #ef4444; text-align: center; }
    .divider { border-top: 1px solid #333338; margin: 1.5rem 0; }
    .footer { text-align: center; font-size: 0.8rem; color: #808080; border-top: 1px solid #333338; padding-top: 1rem; margin-top: 1.5rem; }
  </style>
`;

function renderLoginPage(authorizeUrl: string): string {
  const baseUrl = getBaseUrl();
  // The login link points to Google OAuth, which will redirect back to authorize
  const loginUrl = `${baseUrl}/v1/auth/login?provider=google&redirect_uri=${encodeURIComponent(authorizeUrl)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in — Epitome</title>
  ${FONT_LINKS}
  ${PAGE_STYLES}
</head>
<body>
  <div class="card">
    <div class="logo">ep<span>i</span>tome</div>
    <h2>Sign in to connect your AI</h2>
    <p style="text-align:center; color:#808080; font-size:0.9rem; margin-bottom:1.5rem;">
      An AI agent wants to access your Epitome memory. Sign in to continue.
    </p>
    <a href="${escapeHtml(loginUrl)}" class="btn-google">
      <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"/><path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332Z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.166 6.656 3.58 9 3.58Z"/></svg>
      Sign in with Google
    </a>
    <div class="footer">Your data stays yours. Epitome never shares your memory.</div>
  </div>
</body>
</html>`;
}

function renderConsentPage(params: {
  clientName: string;
  scope: string;
  userEmail: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
  resource: string;
  csrfToken: string;
}): string {
  const scopes = params.scope ? params.scope.split(/[\s,]+/).filter(Boolean) : ['full access'];
  const scopeItems = scopes.map((s) => `<li>${escapeHtml(s)}</li>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize — Epitome</title>
  ${FONT_LINKS}
  ${PAGE_STYLES}
</head>
<body>
  <div class="card">
    <div class="logo">ep<span>i</span>tome</div>
    <h2>Authorize Access</h2>

    <div class="info">
      <div class="label">Application</div>
      <div class="value">${escapeHtml(params.clientName)}</div>
    </div>
    <div class="info">
      <div class="label">Signed in as</div>
      <div class="value">${escapeHtml(params.userEmail)}</div>
    </div>
    <div class="info">
      <div class="label">Permissions requested</div>
      <ul class="scope-list">${scopeItems}</ul>
    </div>

    <form method="POST" action="/v1/auth/oauth/authorize">
      <input type="hidden" name="csrf_token" value="${escapeAttr(params.csrfToken)}">
      <input type="hidden" name="client_id" value="${escapeAttr(params.clientId)}">
      <input type="hidden" name="redirect_uri" value="${escapeAttr(params.redirectUri)}">
      <input type="hidden" name="code_challenge" value="${escapeAttr(params.codeChallenge)}">
      <input type="hidden" name="code_challenge_method" value="${escapeAttr(params.codeChallengeMethod)}">
      <input type="hidden" name="state" value="${escapeAttr(params.state)}">
      <input type="hidden" name="scope" value="${escapeAttr(params.scope)}">
      <input type="hidden" name="resource" value="${escapeAttr(params.resource)}">

      <div class="btn-row">
        <button type="submit" name="action" value="deny" class="btn btn-secondary">Deny</button>
        <button type="submit" name="action" value="approve" class="btn btn-primary">Approve</button>
      </div>
    </form>

    <div class="footer">This grants the app access to your Epitome memory.</div>
  </div>
</body>
</html>`;
}

function renderErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error — Epitome</title>
  ${FONT_LINKS}
  ${PAGE_STYLES}
</head>
<body>
  <div class="card">
    <div class="logo">ep<span>i</span>tome</div>
    <h2 class="error-text">${escapeHtml(message)}</h2>
    <div class="footer">Please close this window and try again.</div>
  </div>
</body>
</html>`;
}

// ─── HTML Helpers ───────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
