import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { sql } from 'drizzle-orm';
import app from '@/index';
import { db } from '@/db';
import { createTestUser, cleanupTestUser, type TestUser } from '../../helpers/db';
import { resetAllRateLimits } from '@/services/rateLimit.service';

describe('API key hashing integration', () => {
  let testUser: TestUser | null = null;

  beforeEach(async () => {
    await resetAllRateLimits();
    testUser = await createTestUser();
  });

  afterEach(async () => {
    if (testUser?.userId) {
      await cleanupTestUser(testUser.userId);
    }
    testUser = null;
  });

  it('should authenticate only when key_hash stores SHA-256(key), not plaintext key', async () => {
    const apiKey = `epi_test_${crypto.randomBytes(32).toString('hex')}`;
    const prefix = apiKey.substring(0, 12);

    await db.execute(sql`
      UPDATE public.api_keys
      SET key_hash = ${apiKey},
          prefix = ${prefix},
          agent_id = NULL,
          revoked_at = NULL,
          expires_at = NULL
      WHERE user_id = ${testUser!.userId}
    `);

    const headers = new Headers();
    headers.set('authorization', `Bearer ${apiKey}`);

    const plaintextHashResponse = await app.request('/v1/profile', {
      method: 'GET',
      headers,
    });
    expect(plaintextHashResponse.status).toBe(401);

    const sha256Hash = crypto.createHash('sha256').update(apiKey).digest('hex');

    await db.execute(sql`
      UPDATE public.api_keys
      SET key_hash = ${sha256Hash},
          prefix = ${prefix}
      WHERE user_id = ${testUser!.userId}
    `);

    const shaResponse = await app.request('/v1/profile', {
      method: 'GET',
      headers,
    });
    expect(shaResponse.status).toBe(200);
  });
});
