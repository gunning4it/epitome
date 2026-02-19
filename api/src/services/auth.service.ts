/**
 * Authentication Service
 *
 * Business logic for authentication operations:
 * - OAuth flow (Google, GitHub)
 * - Session management
 * - API key lifecycle
 * - User schema creation
 */

import { db, sql as pgSql } from '@/db/client';
import { eq, and, isNull, gt, lt } from 'drizzle-orm';
import { users, apiKeys, sessions, oauthConnections } from '@/db/schema';
import { generateApiKey, generateSessionToken, hashSessionToken, encryptIfAvailable } from '@/utils/crypto';
import { OAuthProvider } from '@/validators/auth';
import { logger } from '@/utils/logger';
import { initializeProfile } from '@/services/profile.service';
import { grantConsent } from '@/services/consent.service';
import { TierLimitError } from '@/errors/tierLimit';
import { getTierLimits } from './metering.service';

/**
 * OAuth user profile from provider
 */
export interface OAuthProfile {
  id: string; // Provider user ID
  email: string;
  name?: string;
  avatar_url?: string;
  raw_profile?: Record<string, unknown>;
}

/**
 * Session data
 */
export interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
}

/**
 * API key data
 */
export interface ApiKey {
  id: string;
  key: string; // Raw key (only returned once at creation)
  prefix: string; // Display prefix
  userId: string;
  agentId: string | null;
  label: string;
  scopes: string[];
  expiresAt: Date | null;
}

/**
 * Handle OAuth callback
 *
 * 1. Exchange authorization code for access token
 * 2. Fetch user profile from OAuth provider
 * 3. Create or update user in database
 * 4. Create user schema if new user
 * 5. Store OAuth connection
 * 6. Create session
 *
 * @param provider - OAuth provider
 * @param code - Authorization code from OAuth callback
 * @param profile - User profile from OAuth provider
 * @returns Session token and user data
 */
export async function handleOAuthCallback(
  provider: OAuthProvider,
  _code: string,
  profile: OAuthProfile,
  tokens?: { accessToken?: string; refreshToken?: string; expiresIn?: number }
): Promise<{ session: Session; user: typeof users.$inferSelect; isNewUser: boolean }> {
  // Find or create user by email
  let [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, profile.email))
    .limit(1);

  const isNewUser = !user;

  if (!user) {
    // Create new user
    const userId = crypto.randomUUID();
    const schemaName = `user_${userId.replace(/-/g, '')}`;

    [user] = await db
      .insert(users)
      .values({
        id: userId,
        email: profile.email,
        name: profile.name || null,
        avatarUrl: profile.avatar_url || null,
        schemaName,
        tier: 'free',
        onboarded: false,
        embeddingProvider: 'openai',
        embeddingDim: 1536,
      })
      .returning();

    // Create user schema
    await createUserSchema(schemaName, 1536);

    // Seed profile with OAuth name
    if (profile.name) {
      await initializeProfile(userId, { name: profile.name });
    }
  } else {
    // Update existing user profile
    [user] = await db
      .update(users)
      .set({
        name: profile.name || user.name,
        avatarUrl: profile.avatar_url || user.avatarUrl,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();
  }

  // H-3 SECURITY FIX: Encrypt OAuth provider tokens before storage
  const encryptedAccessToken = tokens?.accessToken
    ? encryptIfAvailable(tokens.accessToken)
    : null;
  const encryptedRefreshToken = tokens?.refreshToken
    ? encryptIfAvailable(tokens.refreshToken)
    : null;
  const tokenExpiresAt = tokens?.expiresIn
    ? new Date(Date.now() + tokens.expiresIn * 1000)
    : null;

  // Store or update OAuth connection
  const [existingConnection] = await db
    .select()
    .from(oauthConnections)
    .where(
      and(
        eq(oauthConnections.userId, user.id),
        eq(oauthConnections.provider, provider)
      )
    )
    .limit(1);

  if (existingConnection) {
    await db
      .update(oauthConnections)
      .set({
        providerUserId: profile.id,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenExpiresAt,
        rawProfile: profile.raw_profile || {},
      })
      .where(eq(oauthConnections.id, existingConnection.id));
  } else {
    await db.insert(oauthConnections).values({
      userId: user.id,
      provider,
      providerUserId: profile.id,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      tokenExpiresAt,
      rawProfile: profile.raw_profile || {},
    });
  }

  // Create session
  const sessionToken = generateSessionToken();
  const sessionTtlDays = parseInt(process.env.SESSION_TTL_DAYS || '7');
  const expiresAt = new Date(Date.now() + sessionTtlDays * 24 * 60 * 60 * 1000);

  // H-1 SECURITY FIX: Hash session token before storage
  const tokenHash = hashSessionToken(sessionToken);

  const [session] = await db
    .insert(sessions)
    .values({
      userId: user.id,
      tokenHash,
      expiresAt,
    })
    .returning();

  return {
    session: {
      id: session.id,
      userId: session.userId,
      token: sessionToken, // H-1 FIX: Return raw token (not hash) for cookie
      expiresAt: session.expiresAt,
    },
    user,
    isNewUser,
  };
}

/**
 * Create user schema with all required tables
 *
 * Calls the PostgreSQL function create_user_schema(user_id, embedding_dim)
 *
 * @param userId - User ID
 * @param embeddingDim - Embedding dimension for vectors
 */
export async function createUserSchema(
  schemaName: string,
  embeddingDim: number
): Promise<void> {
  try {
    await pgSql`SELECT create_user_schema(${schemaName}::varchar, ${embeddingDim}::integer)`;

    try {
      await pgSql`SELECT public.ensure_user_audit_log_actions(${schemaName}::varchar)`;
    } catch (auditError) {
      logger.warn('Audit action constraint bootstrap skipped after schema creation', {
        schemaName,
        error: String(auditError),
      });
    }

    try {
      await pgSql`SELECT public.ensure_user_knowledge_ledger_tables(${schemaName}::varchar)`;
    } catch (ledgerError) {
      logger.warn('Ledger table bootstrap skipped after schema creation', {
        schemaName,
        error: String(ledgerError),
      });
    }
  } catch (error) {
    logger.error('Error creating user schema', { error: String(error) });
    throw new Error('Failed to create user schema');
  }
}

/**
 * Create API key
 *
 * Generates a new API key for agent or API access
 *
 * @param userId - User ID
 * @param label - Display label for the key
 * @param agentId - Optional agent ID
 * @param scopes - Permission scopes
 * @param expiresInDays - Optional expiration in days
 * @returns API key data with raw key (only shown once)
 */
export async function createApiKeyForUser(
  userId: string,
  label: string,
  agentId: string | null = null,
  scopes: string[] = ['read', 'write'],
  expiresInDays?: number,
  tier: string = 'free'
): Promise<ApiKey> {
  // Generate API key (stored as SHA-256 hash for high-entropy token lookup)
  const { key, prefix, hash } = await generateApiKey(userId);

  // Calculate expiration
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  // Look up user's current tier so new keys inherit it
  const [user] = await db.select({ tier: users.tier }).from(users).where(eq(users.id, userId)).limit(1);
  const effectiveTier = user?.tier || tier || 'free';

  // Enforce agent limit for agent-specific keys (uses effectiveTier, not caller-supplied tier)
  if (agentId) {
    const limits = await getTierLimits(effectiveTier as 'free' | 'pro' | 'enterprise');
    if (limits.maxAgents !== -1) {
      const countRows = await pgSql`
        SELECT COUNT(DISTINCT agent_id)::int AS count
        FROM public.api_keys
        WHERE user_id = ${userId}
          AND agent_id IS NOT NULL
          AND revoked_at IS NULL
      `;
      const current = countRows[0]?.count ?? 0;
      if (current >= limits.maxAgents) {
        throw new TierLimitError('agents', current, limits.maxAgents);
      }
    }
  }

  // Insert into database
  const [apiKey] = await db
    .insert(apiKeys)
    .values({
      userId,
      keyHash: hash,
      prefix,
      label,
      agentId,
      scopes,
      expiresAt,
      tier: effectiveTier,
    })
    .returning();

  // Auto-grant consent for standard resources when agentId is provided
  if (agentId) {
    const resources = ['profile', 'tables/*', 'vectors/*', 'graph', 'memory'];
    const permission = scopes.includes('write') ? 'write' : 'read';
    for (const resource of resources) {
      try {
        await grantConsent(userId, { agentId, resource, permission });
      } catch (err) {
        logger.error('Failed to auto-grant consent', {
          userId,
          agentId,
          resource,
          permission,
          error: String(err),
        });
        // Continue granting remaining resources even if one fails
      }
    }
  }

  return {
    id: apiKey.id,
    key, // Raw key - only returned at creation
    prefix: apiKey.prefix,
    userId: apiKey.userId,
    agentId: apiKey.agentId || null,
    label: apiKey.label || '',
    scopes: apiKey.scopes as string[],
    expiresAt: apiKey.expiresAt,
  };
}

/**
 * Validate API key
 *
 * Verifies API key and returns user ID if valid
 *
 * @param key - Raw API key (e.g., "epi_...")
 * @returns User ID if valid, null if invalid/expired/revoked
 */
export async function validateApiKey(key: string): Promise<{ userId: string; agentId: string | null } | null> {
  // Import hash utility
  const crypto = await import('crypto');

  // Hash the provided key
  const hash = crypto.createHash('sha256').update(key).digest('hex');

  // Look up API key by hash
  const [apiKey] = await db
    .select()
    .from(apiKeys)
    .where(and(
      eq(apiKeys.keyHash, hash),
      isNull(apiKeys.revokedAt)
    ))
    .limit(1);

  if (!apiKey) {
    return null; // Key not found or revoked
  }

  // Check expiration
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return null; // Key expired
  }

  // Update last used timestamp
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, apiKey.id));

  return { userId: apiKey.userId, agentId: apiKey.agentId };
}

/**
 * Revoke API key
 *
 * Sets revoked_at timestamp on the key
 *
 * @param keyId - API key ID
 * @param userId - User ID (for ownership check)
 */
export async function revokeApiKey(keyId: string, userId: string): Promise<void> {
  const result = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
    .returning();

  if (result.length === 0) {
    throw new Error('NOT_FOUND: API key not found or not owned by user');
  }
}

/**
 * Delete session (logout)
 *
 * Removes session from database
 *
 * @param token - Session token
 */
export async function deleteSession(token: string): Promise<void> {
  const tokenHash = hashSessionToken(token);
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

/**
 * Refresh session
 *
 * Extends session expiration time
 *
 * @param token - Current session token
 * @returns Updated session
 */
export async function refreshSession(token: string): Promise<Session | null> {
  const sessionTtlDays = parseInt(process.env.SESSION_TTL_DAYS || '7');
  const newExpiresAt = new Date(Date.now() + sessionTtlDays * 24 * 60 * 60 * 1000);

  const tokenHash = hashSessionToken(token);

  // H-1 SECURITY FIX: Only refresh sessions that haven't expired yet.
  // Without this check, an expired session token could be refreshed indefinitely.
  const now = new Date();
  const [updated] = await db
    .update(sessions)
    .set({ expiresAt: newExpiresAt })
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .returning();

  if (!updated) {
    return null;
  }

  return {
    id: updated.id,
    userId: updated.userId,
    token, // Return the original token (not the hash)
    expiresAt: updated.expiresAt,
  };
}

/**
 * Get user's API keys
 *
 * Returns all active (not revoked) API keys for a user
 *
 * @param userId - User ID
 * @returns List of API keys (without raw keys)
 */
export async function getUserApiKeys(userId: string): Promise<
  Array<{
    id: string;
    prefix: string;
    label: string;
    agentId: string | null;
    scopes: string[];
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
  }>
> {
  const keys = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .orderBy(apiKeys.createdAt);

  return keys.map((key) => ({
    id: key.id,
    prefix: key.prefix,
    label: key.label || '',
    agentId: key.agentId,
    scopes: key.scopes as string[],
    lastUsedAt: key.lastUsedAt,
    expiresAt: key.expiresAt,
    createdAt: key.createdAt,
  }));
}

/**
 * Clean up expired sessions (L-1 Security Fix)
 *
 * Removes sessions past their expiration time to prevent
 * accumulation of stale session records.
 *
 * @returns Number of expired sessions deleted
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const result = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });
  return result.length;
}
