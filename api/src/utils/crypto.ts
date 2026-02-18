/**
 * Cryptographic Utilities
 *
 * Functions for secure token generation, hashing, and validation
 */

import crypto from 'crypto';
import { logger } from '@/utils/logger';

/**
 * Generate a cryptographically secure API key
 *
 * Format: epi_{prefix}_{random}
 * - prefix: First 4 chars of user_id (for display)
 * - random: 32 random hex chars
 *
 * @param userId - User ID for prefix
 * @returns Tuple of [raw key, prefix for display, hash for storage]
 */
export async function generateApiKey(
  userId: string
): Promise<{ key: string; prefix: string; hash: string }> {
  // Generate 32 bytes of random data (64 hex chars)
  const randomBytes = crypto.randomBytes(32).toString('hex');

  // Create prefix from first 4 chars of user ID
  const userPrefix = userId.replace(/-/g, '').substring(0, 4);

  // Construct the full key
  const key = `epi_${userPrefix}_${randomBytes}`;

  // Create display prefix (first 12 chars, fits varchar(12))
  const prefix = key.substring(0, 12);

  // Hash the key for storage using SHA-256
  // API keys are high-entropy (32 random bytes), so SHA-256 is sufficient.
  // Argon2 is only needed for low-entropy secrets like passwords.
  // This also matches how validateApiKey looks up keys.
  const hash = crypto.createHash('sha256').update(key).digest('hex');

  return { key, prefix, hash };
}

/**
 * Generate a secure session token
 *
 * @returns Random session token (64 hex chars)
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash a session token with SHA-256
 *
 * H-1 SECURITY FIX: Session tokens are hashed before storage to prevent
 * account takeover if the database is breached.
 *
 * @param token - Raw session token
 * @returns SHA-256 hash (hex string, 64 chars)
 */
export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time string comparison
 *
 * H-4 SECURITY: Prevents timing attacks by ensuring comparison
 * takes the same time regardless of where strings differ.
 *
 * @param a - First string
 * @param b - Second string
 * @returns True if strings are equal
 */
export function constantTimeCompare(a: string, b: string): boolean {
  try {
    // Convert to buffers for constant-time comparison
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');

    // Length check is not timing-safe, but needed for timingSafeEqual
    if (bufA.length !== bufB.length) {
      // Still do a dummy comparison to maintain timing
      crypto.timingSafeEqual(bufA, bufA);
      return false;
    }

    return crypto.timingSafeEqual(bufA, bufB);
  } catch (error) {
    logger.error('Error in constant time comparison', { error: String(error) });
    return false;
  }
}

/**
 * Generate a CSRF token
 *
 * @returns Random CSRF token (32 hex chars)
 */
export function generateCsrfToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate an OAuth authorization code
 *
 * @returns 128 hex chars (64 random bytes)
 */
export function generateAuthorizationCode(): string {
  return crypto.randomBytes(64).toString('hex');
}

/**
 * Generate an OAuth client ID for dynamic registration
 *
 * @returns 32 hex chars (16 random bytes)
 */
export function generateOAuthClientId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate an OAuth client secret
 *
 * @returns 64 hex chars (32 random bytes)
 */
export function generateOAuthClientSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Verify PKCE S256 code challenge
 *
 * Computes SHA-256(code_verifier) → base64url and compares
 * against the stored code_challenge using constant-time comparison.
 *
 * @param codeVerifier - The PKCE code verifier from token request
 * @param codeChallenge - The stored code challenge from authorize request
 * @returns True if verification passes
 */
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  const hash = crypto.createHash('sha256').update(codeVerifier).digest();
  const computed = hash.toString('base64url');
  return constantTimeCompare(computed, codeChallenge);
}

/**
 * Generate an OAuth state parameter
 *
 * Encodes provider and redirect_uri in a secure token
 *
 * @param provider - OAuth provider
 * @param redirectUri - Optional redirect URI
 * @returns Base64-encoded state token
 */
export function generateOAuthState(
  provider: string,
  redirectUri?: string
): string {
  const stateData = {
    provider,
    redirectUri,
    nonce: crypto.randomBytes(16).toString('hex'),
    timestamp: Date.now(),
  };

  return Buffer.from(JSON.stringify(stateData)).toString('base64');
}

/**
 * Decode and validate an OAuth state parameter
 *
 * @param state - Base64-encoded state token
 * @returns Decoded state data
 * @throws Error if state is invalid or expired (>10 min)
 */
export function decodeOAuthState(state: string): {
  provider: string;
  redirectUri?: string;
  nonce: string;
  timestamp: number;
} {
  try {
    const decoded = Buffer.from(state, 'base64').toString('utf-8');
    const stateData = JSON.parse(decoded);

    // Validate state is not older than 10 minutes
    const age = Date.now() - stateData.timestamp;
    if (age > 10 * 60 * 1000) {
      throw new Error('OAuth state expired');
    }

    return stateData;
  } catch (error) {
    throw new Error(
      `Invalid OAuth state: ${error instanceof Error ? error.message : 'unknown error'}`
    );
  }
}
