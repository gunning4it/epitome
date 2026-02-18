/**
 * Minimal test to verify app.request() works
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import app from '@/index';
import { createTestUser, cleanupTestUser, type TestUser } from './helpers/db';
import { createTestAuthHeaders } from './helpers/app';
import { resetAllRateLimits } from '@/services/rateLimit.service';

describe('Minimal app.request() test', () => {
  it('should call /health endpoint', async () => {
    console.log('Starting health check test...');

    const response = await app.request('/health', {
      method: 'GET',
    });

    console.log('Got response, status:', response.status);

    expect(response.status).toBe(200);

    const data = await response.json();
    console.log('Response data:', data);

    expect(data.status).toBe('ok');
  }, 15000); // 15 second timeout

  describe('With auth', () => {
    let testUser: TestUser;

    beforeEach(async () => {
      await resetAllRateLimits();
      console.log('Creating test user...');
      testUser = await createTestUser();
      console.log('Test user created:', testUser.userId);
    });

    afterEach(async () => {
      console.log('Cleaning up test user...');
      await cleanupTestUser(testUser.userId);
      console.log('Test user cleaned up');
    });

    it('should call /health with auth headers', async () => {
      console.log('Starting health test with auth headers...');

      const response = await app.request('/health', {
        method: 'GET',
        headers: createTestAuthHeaders(testUser),
      });

      console.log('Got response, status:', response.status);

      expect(response.status).toBe(200);

      const data = await response.json();
      console.log('Response data:', data);

      expect(data.status).toBe('ok');
    }, 15000); // 15 second timeout

    it('should call /v1/graph/entities with auth headers', async () => {
      console.log('Starting authenticated graph test...');

      const headers = createTestAuthHeaders(testUser);
      headers.set('x-test-auth-type', 'session');
      const response = await app.request('/v1/graph/entities', {
        method: 'GET',
        headers,
      });

      console.log('Got response, status:', response.status);

      const data = await response.json();
      console.log('Response data:', data);

      expect(response.status).toBe(200);
      expect(data.entities).toBeInstanceOf(Array);
    }, 15000); // 15 second timeout
  });
});
