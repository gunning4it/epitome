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
 *
 * Key design decision: Reuses epi_... API keys as OAuth access tokens.
 * The existing authResolver middleware validates them automatically.
 */

import { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { db } from '@/db/client';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { oauthClients, oauthAuthorizationCodes, users, sessions } from '@/db/schema';
import {
  generateAuthorizationCode,
  generateOAuthClientId,
  verifyPkceS256,
  hashSessionToken,
} from '@/utils/crypto';
import { createApiKeyForUser } from '@/services/auth.service';
import { logger } from '@/utils/logger';

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

  return c.json(
    {
      client_id: clientId,
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope,
    },
    201
  );
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

  // Generate authorization code (10 min TTL)
  const code = generateAuthorizationCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await db.insert(oauthAuthorizationCodes).values({
    code,
    clientId,
    userId: session.userId,
    redirectUri,
    scope,
    codeChallenge,
    codeChallengeMethod,
    state,
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

  const contentType = c.req.header('Content-Type') || '';

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const body = await c.req.parseBody();
    grantType = body['grant_type'] as string;
    code = body['code'] as string;
    redirectUri = body['redirect_uri'] as string;
    codeVerifier = body['code_verifier'] as string;
    clientId = body['client_id'] as string;
  } else {
    try {
      const body = await c.req.json();
      grantType = body.grant_type;
      code = body.code;
      redirectUri = body.redirect_uri;
      codeVerifier = body.code_verifier;
      clientId = body.client_id;
    } catch {
      return c.json({ error: 'invalid_request', error_description: 'Invalid request body' }, 400);
    }
  }

  if (grantType !== 'authorization_code') {
    return c.json({ error: 'unsupported_grant_type', error_description: 'Only authorization_code is supported' }, 400);
  }

  if (!code || !codeVerifier) {
    return c.json({ error: 'invalid_request', error_description: 'code and code_verifier are required' }, 400);
  }

  // Look up the authorization code
  const now = new Date();
  const [authCode] = await db
    .select()
    .from(oauthAuthorizationCodes)
    .where(
      and(
        eq(oauthAuthorizationCodes.code, code),
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

    const apiKey = await createApiKeyForUser(
      authCode.userId,
      `MCP OAuth (${client?.clientName || authCode.clientId})`,
      agentId,
      ['read', 'write'],
      365 // 1 year expiry
    );

    return c.json({
      access_token: apiKey.key,
      token_type: 'Bearer',
      expires_in: 31536000, // 1 year in seconds
    });
  } catch (error) {
    logger.error('Failed to create access token', { error: String(error) });
    return c.json({ error: 'server_error', error_description: 'Failed to create access token' }, 500);
  }
}

// ─── HTML Page Renderers ────────────────────────────────────────────

const PAGE_STYLES = `
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #171717; border: 1px solid #262626; border-radius: 12px; padding: 2rem; max-width: 420px; width: 100%; }
    .logo { font-size: 1.5rem; font-weight: 700; color: #fff; margin-bottom: 1.5rem; text-align: center; }
    .logo span { color: #818cf8; }
    h2 { font-size: 1.1rem; color: #d4d4d4; margin-bottom: 1rem; text-align: center; }
    .info { background: #1e1e1e; border: 1px solid #333; border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; font-size: 0.9rem; }
    .info .label { color: #a3a3a3; font-size: 0.8rem; margin-bottom: 0.25rem; }
    .info .value { color: #fff; word-break: break-all; }
    .info + .info { margin-top: 0.75rem; }
    .scope-list { margin: 0.5rem 0; padding-left: 1.25rem; }
    .scope-list li { color: #d4d4d4; margin-bottom: 0.25rem; }
    .btn-row { display: flex; gap: 0.75rem; }
    .btn { flex: 1; padding: 0.75rem 1rem; border: none; border-radius: 8px; font-size: 0.95rem; font-weight: 600; cursor: pointer; text-align: center; text-decoration: none; display: inline-block; }
    .btn-primary { background: #818cf8; color: #fff; }
    .btn-primary:hover { background: #6366f1; }
    .btn-secondary { background: #262626; color: #d4d4d4; border: 1px solid #404040; }
    .btn-secondary:hover { background: #333; }
    .btn-google { display: flex; align-items: center; justify-content: center; gap: 0.5rem; background: #fff; color: #333; border: 1px solid #ddd; border-radius: 8px; padding: 0.75rem; font-size: 0.95rem; font-weight: 500; text-decoration: none; width: 100%; }
    .btn-google:hover { background: #f5f5f5; }
    .error-text { color: #f87171; text-align: center; }
    .divider { border-top: 1px solid #333; margin: 1.5rem 0; }
    .footer { text-align: center; font-size: 0.8rem; color: #737373; margin-top: 1rem; }
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
  ${PAGE_STYLES}
</head>
<body>
  <div class="card">
    <div class="logo">ep<span>i</span>tome</div>
    <h2>Sign in to connect your AI</h2>
    <p style="text-align:center; color:#a3a3a3; font-size:0.9rem; margin-bottom:1.5rem;">
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
}): string {
  const scopes = params.scope ? params.scope.split(/[\s,]+/).filter(Boolean) : ['full access'];
  const scopeItems = scopes.map((s) => `<li>${escapeHtml(s)}</li>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize — Epitome</title>
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
      <input type="hidden" name="client_id" value="${escapeAttr(params.clientId)}">
      <input type="hidden" name="redirect_uri" value="${escapeAttr(params.redirectUri)}">
      <input type="hidden" name="code_challenge" value="${escapeAttr(params.codeChallenge)}">
      <input type="hidden" name="code_challenge_method" value="${escapeAttr(params.codeChallengeMethod)}">
      <input type="hidden" name="state" value="${escapeAttr(params.state)}">
      <input type="hidden" name="scope" value="${escapeAttr(params.scope)}">

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
