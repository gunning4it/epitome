import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { generateApiKey } from '@/utils/crypto';

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
