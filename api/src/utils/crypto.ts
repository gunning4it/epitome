/**
 * Cryptographic Utilities
 *
 * Functions for secure token generation, hashing, encryption, and validation
 */

import crypto from 'crypto';

const ENCRYPTION_KEY_ENV = 'ENCRYPTION_KEY'; // 32-byte hex key (64 hex chars)
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
 * C-1 SECURITY FIX: HMAC-SHA256 signs the payload so attackers cannot
 * forge or tamper with the state parameter.
 *
 * @param provider - OAuth provider
 * @param redirectUri - Optional redirect URI
 * @returns HMAC-signed state token (payload.signature)
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

  const payload = Buffer.from(JSON.stringify(stateData)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', process.env.SESSION_SECRET!)
    .update(payload)
    .digest('base64url');

  return `${payload}.${signature}`;
}

/**
 * Decode and validate an OAuth state parameter
 *
 * C-1 SECURITY FIX: Verifies HMAC-SHA256 signature with constant-time
 * comparison before trusting the payload.
 *
 * @param state - HMAC-signed state token (payload.signature)
 * @returns Decoded state data
 * @throws Error if state is invalid, tampered, or expired (>10 min)
 */
export function decodeOAuthState(state: string): {
  provider: string;
  redirectUri?: string;
  nonce: string;
  timestamp: number;
} {
  const [payload, signature] = state.split('.');
  if (!payload || !signature) {
    throw new Error('Invalid OAuth state format');
  }

  const expectedBuf = crypto
    .createHmac('sha256', process.env.SESSION_SECRET!)
    .update(payload)
    .digest();
  const signatureBuf = Buffer.from(signature, 'base64url');

  if (
    signatureBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(signatureBuf, expectedBuf)
  ) {
    throw new Error('Invalid OAuth state signature');
  }

  try {
    const stateData = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf-8')
    );

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

// ─── AES-256-GCM Encryption (H-3 Security Fix) ─────────────────────

/**
 * Encrypt a plaintext string using AES-256-GCM
 *
 * H-3 SECURITY FIX: Encrypts OAuth provider tokens (access_token,
 * refresh_token) before storage in the database.
 *
 * Format: iv.authTag.ciphertext (all base64)
 *
 * @param plaintext - String to encrypt
 * @returns Encrypted string in iv.authTag.ciphertext format
 * @throws Error if ENCRYPTION_KEY is not configured or invalid
 */
export function encrypt(plaintext: string): string {
  const key = process.env[ENCRYPTION_KEY_ENV];
  if (!key) throw new Error('ENCRYPTION_KEY not configured');
  const keyBuf = Buffer.from(key, 'hex');
  if (keyBuf.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)');

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}.${authTag.toString('base64')}.${encrypted.toString('base64')}`;
}

/**
 * Decrypt an AES-256-GCM encrypted string
 *
 * @param encryptedStr - String in iv.authTag.ciphertext format
 * @returns Decrypted plaintext
 * @throws Error if decryption fails (tampered data, wrong key, etc.)
 */
export function decrypt(encryptedStr: string): string {
  const key = process.env[ENCRYPTION_KEY_ENV];
  if (!key) throw new Error('ENCRYPTION_KEY not configured');
  const keyBuf = Buffer.from(key, 'hex');
  if (keyBuf.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)');

  const [ivB64, tagB64, dataB64] = encryptedStr.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid encrypted format');

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const encrypted = Buffer.from(dataB64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

/**
 * Encrypt a token if ENCRYPTION_KEY is available, otherwise return as-is.
 * Used for non-critical paths where encryption is preferred but not required
 * (e.g., test environments without ENCRYPTION_KEY configured).
 */
export function encryptIfAvailable(plaintext: string): string {
  if (!process.env[ENCRYPTION_KEY_ENV]) return plaintext;
  return encrypt(plaintext);
}

/**
 * Decrypt a token if it looks like an encrypted string (has two dots),
 * otherwise return as-is. Handles migration from unencrypted to encrypted storage.
 */
export function decryptIfEncrypted(value: string): string {
  const parts = value.split('.');
  if (parts.length !== 3) return value; // Not encrypted, return as-is
  if (!process.env[ENCRYPTION_KEY_ENV]) return value; // No key, return as-is
  return decrypt(value);
}
