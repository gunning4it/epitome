/**
 * Load Tests - Concurrent Agent/User Traffic
 *
 * Run explicitly with: RUN_LOAD_TESTS=true npx vitest run tests/load/concurrent-agents.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import app from '@/index';
import { createTestUser, cleanupTestUser, type TestUser } from '../helpers/db';
import { createTestSessionHeaders } from '../helpers/app';
import { resetAllRateLimits } from '@/services/rateLimit.service';

const loadDescribe = process.env.RUN_LOAD_TESTS === 'true' ? describe : describe.skip;

loadDescribe('Load Tests - Concurrent Agents', () => {
  let testUser: TestUser;

  beforeAll(async () => {
    await resetAllRateLimits();
    testUser = await createTestUser();
  }, 30000);

  afterAll(async () => {
    if (testUser) {
      await cleanupTestUser(testUser.userId);
    }
  }, 30000);

  it('handles 50 concurrent profile reads', async () => {
    const requests = Array.from({ length: 50 }, () =>
      app.request('/v1/profile', {
        method: 'GET',
        headers: createTestSessionHeaders(testUser),
      })
    );

    const results = await Promise.all(requests);
    const failed = results.filter((res) => res.status !== 200);

    expect(failed.length).toBe(0);
  }, 30000);

  it('handles concurrent writes to one table without dropping requests', async () => {
    const requests = Array.from({ length: 40 }, (_, i) =>
      app.request('/v1/tables/load_test/records', {
        method: 'POST',
        headers: createTestSessionHeaders(testUser),
        body: JSON.stringify({
          body: {
            index: i,
            value: `value-${i}`,
            category: i % 2 === 0 ? 'even' : 'odd',
          },
        }),
      })
    );

    const results = await Promise.all(requests);
    const failed = results.filter((res) => res.status !== 201);
    expect(failed.length).toBe(0);

    const queryResponse = await app.request('/v1/tables/load_test/query', {
      method: 'POST',
      headers: createTestSessionHeaders(testUser),
      body: JSON.stringify({
        body: {
          limit: 1000,
        },
      }),
    });

    expect(queryResponse.status).toBe(200);
    const queryJson = await queryResponse.json() as { data: Array<{ id: number }> };
    expect(queryJson.data.length).toBeGreaterThanOrEqual(40);
  }, 45000);

  it('blocks concurrent SQL sandbox write attempts', async () => {
    const attempts = Array.from({ length: 30 }, (_, i) =>
      app.request('/v1/tables/load_test/query', {
        method: 'POST',
        headers: createTestSessionHeaders(testUser),
        body: JSON.stringify({
          body: {
            sql: i % 2 === 0
              ? 'DELETE FROM load_test'
              : 'UPDATE load_test SET value = \'tampered\'',
          },
        }),
      })
    );

    const results = await Promise.all(attempts);
    const accepted = results.filter((res) => res.status < 400);
    expect(accepted.length).toBe(0);
  }, 30000);
});

