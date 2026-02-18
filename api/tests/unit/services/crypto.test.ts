import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { generateApiKey, encrypt, decrypt, encryptIfAvailable, decryptIfEncrypted } from '@/utils/crypto';

describe('crypto.generateApiKey', () => {
  it('should generate epi_* key and store SHA-256 hash for lookup', async () => {
    const userId = '8f4e5f92-3bd4-4c14-98b9-a9f4dc8723d4';
    const { key, prefix, hash } = await generateApiKey(userId);

    expect(key).toMatch(/^epi_[a-z0-9]{4}_[a-f0-9]{64}$/);
    expect(prefix).toBe(key.substring(0, 12));

    const expectedHash = crypto.createHash('sha256').update(key).digest('hex');
    expect(hash).toBe(expectedHash);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('crypto.encrypt/decrypt (H-3 AES-256-GCM)', () => {
  const TEST_KEY = crypto.randomBytes(32).toString('hex'); // 64 hex chars

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  it('should round-trip encrypt and decrypt plaintext', () => {
    const plaintext = 'ya29.a0ARrdaM-test-google-access-token';
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertext for same plaintext (unique IV)', () => {
    const plaintext = 'same-token-value';
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
    // Both should still decrypt to the same plaintext
    expect(decrypt(a)).toBe(plaintext);
    expect(decrypt(b)).toBe(plaintext);
  });

  it('should use iv.authTag.ciphertext format', () => {
    const encrypted = encrypt('test');
    const parts = encrypted.split('.');
    expect(parts).toHaveLength(3);
    // Each part should be valid base64
    for (const part of parts) {
      expect(() => Buffer.from(part, 'base64')).not.toThrow();
    }
  });

  it('should reject tampered ciphertext', () => {
    const encrypted = encrypt('sensitive-data');
    const [iv, tag, data] = encrypted.split('.');
    // Tamper with the data
    const tampered = `${iv}.${tag}.${Buffer.from('tampered').toString('base64')}`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it('should reject tampered auth tag', () => {
    const encrypted = encrypt('sensitive-data');
    const [iv, _tag, data] = encrypted.split('.');
    const fakeTag = crypto.randomBytes(16).toString('base64');
    const tampered = `${iv}.${fakeTag}.${data}`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it('should reject invalid format', () => {
    expect(() => decrypt('not-encrypted')).toThrow('Invalid encrypted format');
    expect(() => decrypt('only.two')).toThrow('Invalid encrypted format');
  });

  it('should throw if ENCRYPTION_KEY not set', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY not configured');
    expect(() => decrypt('a.b.c')).toThrow('ENCRYPTION_KEY not configured');
  });

  it('should throw if ENCRYPTION_KEY is wrong length', () => {
    process.env.ENCRYPTION_KEY = 'tooshort';
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY must be 32 bytes');
  });
});

describe('crypto.encryptIfAvailable/decryptIfEncrypted', () => {
  const TEST_KEY = crypto.randomBytes(32).toString('hex');

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  it('should pass through when ENCRYPTION_KEY is not set', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(encryptIfAvailable('plaintext')).toBe('plaintext');
    expect(decryptIfEncrypted('plaintext')).toBe('plaintext');
  });

  it('should encrypt/decrypt when ENCRYPTION_KEY is set', () => {
    process.env.ENCRYPTION_KEY = TEST_KEY;
    const encrypted = encryptIfAvailable('token-value');
    expect(encrypted).not.toBe('token-value');
    expect(encrypted.split('.')).toHaveLength(3);
    expect(decryptIfEncrypted(encrypted)).toBe('token-value');
  });

  it('should handle unencrypted values gracefully during migration', () => {
    process.env.ENCRYPTION_KEY = TEST_KEY;
    // A plain token without dots should pass through
    expect(decryptIfEncrypted('plain-token-no-dots')).toBe('plain-token-no-dots');
  });
});
