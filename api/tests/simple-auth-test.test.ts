/**
 * Simplest possible auth test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { createTestUser, cleanupTestUser, type TestUser } from './helpers/db';
import { createTestAuthHeaders } from './helpers/app';
import { authResolver, requireAuth } from '@/middleware/auth';

describe('Simple auth test', () => {
  let testUser: TestUser;

  beforeEach(async () => {
    testUser = await createTestUser();
  });

  afterEach(async () => {
    await cleanupTestUser(testUser.userId);
  });

  it('should work with custom test app', async () => {
    // Create a minimal test app
    const testApp = new Hono();

    testApp.use('*', authResolver);

    testApp.get('/test-endpoint', requireAuth, async (c) => {
      const userId = c.get('userId');
      return c.json({ success: true, userId });
    });

    console.log('Calling test endpoint...');

    const response = await testApp.request('/test-endpoint', {
      method: 'GET',
      headers: createTestAuthHeaders(testUser),
    });

    console.log('Got response, status:', response.status);

    expect(response.status).toBe(200);

    const data = await response.json();
    console.log('Response data:', data);

    expect(data.success).toBe(true);
    expect(data.userId).toBe(testUser.userId);
  }, 30000);
});
