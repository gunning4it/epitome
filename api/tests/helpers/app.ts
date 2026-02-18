/**
 * Test App Helpers
 *
 * Utilities for creating test Hono app instances
 */

import { Hono } from 'hono';
import type { TestUser } from './db';

/**
 * Create authenticated request context for testing
 */
export function createAuthContext(user: TestUser) {
  return {
    userId: user.userId,
    schemaName: user.schemaName,
    email: user.email,
  };
}

/**
 * Create bearer token for testing
 */
export function createBearerToken(apiKey: string): string {
  return `Bearer ${apiKey}`;
}

/**
 * Create test auth headers (works around Supertest/Hono incompatibility)
 */
export function createTestAuthHeaders(user: TestUser, agentId?: string) {
  // Return a proper Headers object for Hono's app.request()
  const headers = new Headers();
  headers.set('x-test-user-id', user.userId);
  headers.set('x-test-agent-id', agentId || 'test-agent');
  headers.set('authorization', createBearerToken(user.apiKey));
  headers.set('content-type', 'application/json');
  return headers;
}

/**
 * Create test session auth headers (for user-only endpoints like memory/review, profile/history, activity, export)
 * Sets x-test-auth-type to 'session' so requireUser middleware allows access
 */
export function createTestSessionHeaders(user: TestUser) {
  const headers = new Headers();
  headers.set('x-test-user-id', user.userId);
  headers.set('x-test-auth-type', 'session');
  headers.set('content-type', 'application/json');
  return headers;
}

/**
 * Mock auth middleware for tests
 */
export function mockAuthMiddleware(user: TestUser) {
  return async (c: any, next: any) => {
    c.set('user', createAuthContext(user));
    await next();
  };
}

/**
 * Mock consent middleware that allows all actions
 */
export function mockConsentMiddleware() {
  return async (c: any, next: any) => {
    // Allow all actions in tests
    await next();
  };
}

/**
 * Error response matcher for assertions
 */
export const errorMatchers = {
  unauthorized: (body: any) => {
    return body.error?.includes('Unauthorized') || body.error?.includes('Authentication');
  },
  forbidden: (body: any) => {
    return body.error?.includes('Forbidden') || body.error?.includes('Permission');
  },
  notFound: (body: any) => {
    return body.error?.includes('not found') || body.error?.includes('Not found');
  },
  badRequest: (body: any) => {
    return body.error || body.errors;
  },
};
