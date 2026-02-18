/**
 * Authentication Routes
 *
 * OAuth flows, session management, and API key operations
 *
 * Routes:
 * - GET  /v1/auth/login?provider=google|github
 * - GET  /v1/auth/callback?code=...&state=...
 * - GET  /v1/auth/session
 * - POST /v1/auth/logout
 * - POST /v1/auth/refresh
 * - GET  /v1/auth/api-keys
 * - POST /v1/auth/api-keys
 * - DELETE /v1/auth/api-keys/:id
 */

import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { zValidator } from '@hono/zod-validator';
import type { HonoEnv } from '@/types/hono';
import {
  loginQuerySchema,
  callbackQuerySchema,
  createApiKeySchema,
  apiKeyIdSchema,
  OAuthProvider,
} from '@/validators/auth';
import {
  handleOAuthCallback,
  createApiKeyForUser,
  revokeApiKey,
  deleteSession,
  refreshSession,
  getUserApiKeys,
  OAuthProfile,
} from '@/services/auth.service';
import { generateOAuthState, decodeOAuthState } from '@/utils/crypto';
import { requireAuth } from '@/middleware/auth';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/utils/logger';

const auth = new Hono<HonoEnv>();

/**
 * GET /v1/auth/login?provider=google|github
 *
 * Initiates OAuth flow by redirecting to provider's authorization URL
 */
auth.get('/login', zValidator('query', loginQuerySchema), async (c) => {
  const { provider, redirect_uri } = c.req.valid('query');

  // Generate OAuth state parameter
  const state = generateOAuthState(provider, redirect_uri);

  // Get OAuth configuration
  const clientId =
    provider === 'google'
      ? process.env.GOOGLE_CLIENT_ID
      : process.env.GITHUB_CLIENT_ID;

  const redirectUri =
    provider === 'google'
      ? process.env.GOOGLE_CALLBACK_URL
      : process.env.GITHUB_CALLBACK_URL;

  if (!clientId || !redirectUri) {
    return c.json(
      {
        error: {
          code: 'OAUTH_CONFIG_ERROR',
          message: `OAuth provider ${provider} is not configured`,
        },
      },
      500
    );
  }

  // Build authorization URL
  const authUrl = new URL(
    provider === 'google'
      ? 'https://accounts.google.com/o/oauth2/v2/auth'
      : 'https://github.com/login/oauth/authorize'
  );

  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('response_type', 'code');

  // Add provider-specific scopes
  if (provider === 'google') {
    authUrl.searchParams.set('scope', 'openid profile email');
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
  } else if (provider === 'github') {
    authUrl.searchParams.set('scope', 'read:user user:email');
  }

  // Redirect to OAuth provider
  return c.redirect(authUrl.toString());
});

/**
 * GET /v1/auth/callback?code=...&state=...
 *
 * OAuth callback handler
 * Exchanges code for tokens, creates/updates user, creates session
 */
auth.get('/callback', zValidator('query', callbackQuerySchema), async (c) => {
  const { code, state } = c.req.valid('query');

  // Decode and validate state
  let stateData;
  try {
    stateData = decodeOAuthState(state);
  } catch (error) {
    return c.json(
      {
        error: {
          code: 'INVALID_STATE',
          message: 'Invalid or expired OAuth state',
        },
      },
      400
    );
  }

  const provider = stateData.provider as OAuthProvider;

  // Exchange code for access token
  const tokenData = await exchangeOAuthCode(provider, code);

  if (!tokenData) {
    return c.json(
      {
        error: {
          code: 'OAUTH_TOKEN_ERROR',
          message: 'Failed to exchange authorization code for access token',
        },
      },
      500
    );
  }

  // Fetch user profile from OAuth provider
  const profile = await fetchOAuthProfile(provider, tokenData.access_token);

  if (!profile) {
    return c.json(
      {
        error: {
          code: 'OAUTH_PROFILE_ERROR',
          message: 'Failed to fetch user profile from OAuth provider',
        },
      },
      500
    );
  }

  // Handle OAuth callback (create/update user, create session)
  const { session, isNewUser } = await handleOAuthCallback(
    provider,
    code,
    profile
  );

  // Set session cookie
  const sessionTtlDays = parseInt(process.env.SESSION_TTL_DAYS || '7');
  // When COOKIE_DOMAIN is set (e.g. .epitome.fyi), API and dashboard share eTLD+1 → use Lax
  // Without it (staging on fly.dev PSL), they're cross-site → need None
  setCookie(c, 'epitome_session', session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.COOKIE_DOMAIN ? 'Lax' : (process.env.NODE_ENV === 'production' ? 'None' : 'Lax'),
    maxAge: sessionTtlDays * 24 * 60 * 60,
    path: '/',
    domain: process.env.COOKIE_DOMAIN || undefined,
  });

  // Redirect after login
  const dashboardUrl = process.env.CORS_ORIGIN || 'http://localhost:5173';
  const redirectTarget = stateData.redirectUri || '/profile';

  if (isNewUser) {
    return c.redirect(`${dashboardUrl}/profile`);
  }

  // If redirectUri is an absolute URL (e.g. OAuth authorize page), redirect directly to it
  if (redirectTarget.startsWith('http://') || redirectTarget.startsWith('https://')) {
    return c.redirect(redirectTarget);
  }

  // Otherwise it's a relative dashboard path
  return c.redirect(`${dashboardUrl}${redirectTarget}`);
});

/**
 * GET /v1/auth/session
 *
 * Returns current user session info (user_id and email)
 */
auth.get('/session', requireAuth, async (c) => {
  const userId = c.get('userId') as string;

  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name, tier: users.tier, onboarded: users.onboarded })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return c.json(
      {
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
        },
      },
      404
    );
  }

  return c.json({
    user_id: user.id,
    email: user.email,
    name: user.name,
    tier: user.tier,
    onboarded: user.onboarded,
  });
});

/**
 * POST /v1/auth/logout
 *
 * Invalidates current session
 */
auth.post('/logout', requireAuth, async (c) => {
  const sessionToken = getCookie(c, 'epitome_session');

  if (sessionToken) {
    await deleteSession(sessionToken);
  }

  // Clear session cookie
  deleteCookie(c, 'epitome_session', {
    path: '/',
    domain: process.env.COOKIE_DOMAIN || undefined,
  });

  return c.json({
    data: { success: true },
    meta: {},
  });
});

/**
 * POST /v1/auth/refresh
 *
 * Refreshes session expiration
 */
auth.post('/refresh', async (c) => {
  const sessionToken = getCookie(c, 'epitome_session');

  if (!sessionToken) {
    return c.json(
      {
        error: {
          code: 'NO_SESSION',
          message: 'No session found',
        },
      },
      401
    );
  }

  const session = await refreshSession(sessionToken);

  if (!session) {
    return c.json(
      {
        error: {
          code: 'INVALID_SESSION',
          message: 'Invalid or expired session',
        },
      },
      401
    );
  }

  // Update session cookie
  const sessionTtlDays = parseInt(process.env.SESSION_TTL_DAYS || '7');
  setCookie(c, 'epitome_session', session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.COOKIE_DOMAIN ? 'Lax' : (process.env.NODE_ENV === 'production' ? 'None' : 'Lax'),
    maxAge: sessionTtlDays * 24 * 60 * 60,
    path: '/',
    domain: process.env.COOKIE_DOMAIN || undefined,
  });

  return c.json({
    data: {
      expiresAt: session.expiresAt.toISOString(),
    },
    meta: {},
  });
});

/**
 * GET /v1/auth/api-keys
 *
 * List all API keys for authenticated user
 */
auth.get('/api-keys', requireAuth, async (c) => {
  const userId = c.get('userId') as string;

  const keys = await getUserApiKeys(userId);

  return c.json({
    data: keys,
    meta: {
      total: keys.length,
    },
  });
});

/**
 * POST /v1/auth/api-keys
 *
 * Create a new API key
 */
auth.post('/api-keys', requireAuth, zValidator('json', createApiKeySchema), async (c) => {
  const userId = c.get('userId') as string;
  const { label, agent_id, scopes, expires_in_days } = c.req.valid('json');

  const apiKey = await createApiKeyForUser(
    userId,
    label,
    agent_id || null,
    scopes,
    expires_in_days
  );

  return c.json(
    {
      data: {
        id: apiKey.id,
        key: apiKey.key, // Raw key - only shown once
        prefix: apiKey.prefix,
        label: apiKey.label,
        agentId: apiKey.agentId,
        scopes: apiKey.scopes,
        expiresAt: apiKey.expiresAt?.toISOString() || null,
      },
      meta: {
        warning: 'Save this key securely. It will not be shown again.',
      },
    },
    201
  );
});

/**
 * DELETE /v1/auth/api-keys/:id
 *
 * Revoke an API key
 */
auth.delete('/api-keys/:id', requireAuth, zValidator('param', apiKeyIdSchema), async (c) => {
  const userId = c.get('userId') as string;
  const { id } = c.req.valid('param');

  await revokeApiKey(id, userId);

  return c.json({
    data: { success: true },
    meta: {},
  });
});

/**
 * OAuth token response type
 */
interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
}

/**
 * Helper: Exchange OAuth authorization code for access token
 */
async function exchangeOAuthCode(
  provider: OAuthProvider,
  code: string
): Promise<OAuthTokenResponse | null> {
  const clientId =
    provider === 'google'
      ? process.env.GOOGLE_CLIENT_ID
      : process.env.GITHUB_CLIENT_ID;

  const clientSecret =
    provider === 'google'
      ? process.env.GOOGLE_CLIENT_SECRET
      : process.env.GITHUB_CLIENT_SECRET;

  const redirectUri =
    provider === 'google'
      ? process.env.GOOGLE_CALLBACK_URL
      : process.env.GITHUB_CALLBACK_URL;

  const tokenUrl =
    provider === 'google'
      ? 'https://oauth2.googleapis.com/token'
      : 'https://github.com/login/oauth/access_token';

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as OAuthTokenResponse;
    return data;
  } catch (error) {
    logger.error('Error exchanging OAuth code', { error: String(error) });
    return null;
  }
}

/**
 * Google OAuth profile response
 */
interface GoogleProfile {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  [key: string]: unknown;
}

/**
 * GitHub OAuth profile response
 */
interface GitHubProfile {
  id: number;
  email?: string;
  name?: string;
  avatar_url?: string;
  [key: string]: unknown;
}

/**
 * GitHub email response
 */
interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

/**
 * Helper: Fetch user profile from OAuth provider
 */
async function fetchOAuthProfile(
  provider: OAuthProvider,
  accessToken: string
): Promise<OAuthProfile | null> {
  const userInfoUrl =
    provider === 'google'
      ? 'https://www.googleapis.com/oauth2/v2/userinfo'
      : 'https://api.github.com/user';

  try {
    const response = await fetch(userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return null;
    }

    // Normalize profile data between providers
    if (provider === 'google') {
      const data = await response.json() as GoogleProfile;
      return {
        id: data.id,
        email: data.email,
        name: data.name,
        avatar_url: data.picture,
        raw_profile: data,
      };
    } else if (provider === 'github') {
      const data = await response.json() as GitHubProfile;
      // GitHub may not return email in user endpoint
      let email = data.email;

      if (!email) {
        // Fetch emails separately
        const emailsResponse = await fetch('https://api.github.com/user/emails', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        });

        if (emailsResponse.ok) {
          const emails = await emailsResponse.json() as GitHubEmail[];
          const primaryEmail = emails.find((e) => e.primary);
          email = primaryEmail?.email || emails[0]?.email;
        }
      }

      return {
        id: String(data.id),
        email: email || '',
        name: data.name,
        avatar_url: data.avatar_url,
        raw_profile: data,
      };
    }

    return null;
  } catch (error) {
    logger.error('Error fetching OAuth profile', { error: String(error) });
    return null;
  }
}

export default auth;
