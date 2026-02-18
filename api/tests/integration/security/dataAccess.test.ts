/**
 * Data Access Security Tests
 *
 * Tests for security fixes:
 * - H-5: Block explicit schema references in SQL sandbox
 * - H-6: Escape LIKE metacharacters in consent matching
 * - H-7: Zod validation on consent PATCH endpoint
 * - M-1: MCP legacy tool call input validation
 * - M-2: MCP GET /tools requires authentication
 * - M-3: getUserContext per-resource consent checks
 * - M-4: MCP auth on all HTTP methods
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import app from '@/index';
import { createTestUser, cleanupTestUser, type TestUser } from '../../helpers/db';
import { createTestAuthHeaders, createTestSessionHeaders } from '../../helpers/app';
import { validateSqlQuery } from '@/services/sqlSandbox.service';
import {
  grantConsent,
  checkConsent,
  revokeAllAgentConsent,
} from '@/services/consent.service';
import { getUserContext } from '@/mcp/tools/getUserContext';
import type { McpContext } from '@/mcp/server';
import { resetAllRateLimits } from '@/services/rateLimit.service';
import { sql } from 'drizzle-orm';
import { db } from '@/db';

describe('Data Access Security Fixes', () => {
  let testUser: TestUser;

  beforeEach(async () => {
    await resetAllRateLimits();
    testUser = await createTestUser();
  });

  afterEach(async () => {
    await cleanupTestUser(testUser.userId);
  });

  // ============================================================
  // H-5: Block Explicit Schema References in SQL Sandbox
  // ============================================================
  describe('H-5: Block Explicit Schema References in SQL Sandbox', () => {
    it('should block explicit user schema references like user_abc123.profile', () => {
      expect(() => validateSqlQuery('SELECT * FROM user_abc123.profile')).toThrow(
        /SQL_SANDBOX_ERROR.*Explicit schema references are not allowed/
      );
    });

    it('should block explicit public schema references', () => {
      expect(() => validateSqlQuery('SELECT * FROM public.users')).toThrow(
        /SQL_SANDBOX_ERROR.*Explicit schema references are not allowed/
      );
    });

    it('should block system schema access (pg_catalog)', () => {
      expect(() => validateSqlQuery('SELECT * FROM pg_catalog.pg_tables')).toThrow(
        /SQL_SANDBOX_ERROR/
      );
    });

    it('should block information_schema references', () => {
      expect(() => validateSqlQuery('SELECT * FROM information_schema.tables')).toThrow(
        /SQL_SANDBOX_ERROR/
      );
    });

    it('should allow unqualified table names (using search_path)', () => {
      expect(() => validateSqlQuery('SELECT * FROM profile')).not.toThrow();
    });

    it('should allow unqualified queries with WHERE clause', () => {
      expect(() =>
        validateSqlQuery("SELECT * FROM workouts WHERE exercise = 'squat'")
      ).not.toThrow();
    });

    it('should allow unqualified JOINs', () => {
      expect(() =>
        validateSqlQuery(
          'SELECT e.name, r.relation FROM entities e JOIN edges r ON e.id = r.source_id'
        )
      ).not.toThrow();
    });

    it('should block schema references in subqueries', () => {
      expect(() =>
        validateSqlQuery('SELECT * FROM (SELECT * FROM user_other.profile) sub')
      ).toThrow(/SQL_SANDBOX_ERROR.*Explicit schema references are not allowed/);
    });
  });

  // ============================================================
  // H-6: Escape LIKE Metacharacters in Consent Matching
  // ============================================================
  describe('H-6: Escape LIKE Metacharacters in Consent Matching', () => {
    const agentId = 'test-agent';

    beforeEach(async () => {
      // Grant consent for a resource with underscore in name
      await grantConsent(testUser.userId, {
        agentId,
        resource: 'tables/user_notes',
        permission: 'read',
      });
    });

    it('should allow exact match for tables/user_notes', async () => {
      const result = await checkConsent(testUser.userId, agentId, 'tables/user_notes', 'read');
      expect(result).toBe(true);
    });

    it('should deny tables/userXnotes where X exploits _ wildcard', async () => {
      // Without the fix, _ in LIKE acts as single-char wildcard and would match
      const result = await checkConsent(testUser.userId, agentId, 'tables/userXnotes', 'read');
      expect(result).toBe(false);
    });

    it('should deny tables/user0notes (another _ wildcard exploit)', async () => {
      const result = await checkConsent(testUser.userId, agentId, 'tables/user0notes', 'read');
      expect(result).toBe(false);
    });

    it('should allow wildcard consent to still work', async () => {
      // Grant a wildcard consent rule
      await grantConsent(testUser.userId, {
        agentId,
        resource: 'vectors/*',
        permission: 'read',
      });

      const result = await checkConsent(testUser.userId, agentId, 'vectors/journal', 'read');
      expect(result).toBe(true);
    });

    it('should allow hierarchical consent matching', async () => {
      await grantConsent(testUser.userId, {
        agentId,
        resource: 'graph',
        permission: 'read',
      });

      // graph consent should match graph/stats via hierarchical pattern
      const result = await checkConsent(testUser.userId, agentId, 'graph/stats', 'read');
      expect(result).toBe(true);
    });

    it('should deny resource with % in path that could match anything', async () => {
      // If someone stored a resource pattern with a literal %, it should not match everything
      await grantConsent(testUser.userId, {
        agentId,
        resource: 'tables/test%data',
        permission: 'read',
      });

      // This should only match the literal 'tables/test%data', not 'tables/testXXXdata'
      const exactMatch = await checkConsent(testUser.userId, agentId, 'tables/test%data', 'read');
      expect(exactMatch).toBe(true);

      const exploitMatch = await checkConsent(testUser.userId, agentId, 'tables/testABCdata', 'read');
      expect(exploitMatch).toBe(false);
    });
  });

  // ============================================================
  // H-7: Zod Validation on Consent PATCH Endpoint
  // ============================================================
  describe('H-7: Zod Validation on Consent PATCH Endpoint', () => {
    it('should reject request with empty body', async () => {
      const headers = createTestSessionHeaders(testUser);
      const response = await app.request('/v1/consent/test-agent', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('BAD_REQUEST');
    });

    it('should reject request with invalid permission value', async () => {
      const headers = createTestSessionHeaders(testUser);
      const response = await app.request('/v1/consent/test-agent', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          permissions: [{ resource: 'profile', permission: 'admin' }],
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should reject request with invalid resource characters', async () => {
      const headers = createTestSessionHeaders(testUser);
      const response = await app.request('/v1/consent/test-agent', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          permissions: [{ resource: 'profile; DROP TABLE users', permission: 'read' }],
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should reject request with empty permissions array', async () => {
      const headers = createTestSessionHeaders(testUser);
      const response = await app.request('/v1/consent/test-agent', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ permissions: [] }),
      });

      expect(response.status).toBe(400);
    });

    it('should reject request with extra unknown fields', async () => {
      const headers = createTestSessionHeaders(testUser);
      const response = await app.request('/v1/consent/test-agent', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          permissions: [{ resource: 'profile', permission: 'read' }],
          extraField: 'should not be here',
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should accept valid consent update', async () => {
      const headers = createTestSessionHeaders(testUser);
      const response = await app.request('/v1/consent/test-agent', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          permissions: [
            { resource: 'profile', permission: 'read' },
            { resource: 'tables', permission: 'write' },
          ],
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.agent_id).toBe('test-agent');
      expect(body.data.permissions.length).toBe(2);
    });

    it('should reject agentId with invalid characters', async () => {
      const headers = createTestSessionHeaders(testUser);
      const response = await app.request('/v1/consent/agent;DROP TABLE', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          permissions: [{ resource: 'profile', permission: 'read' }],
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('BAD_REQUEST');
    });
  });

  // ============================================================
  // M-1: MCP Legacy Tool Call Input Validation
  // ============================================================
  describe('M-1: MCP Legacy Tool Call Input Validation', () => {
    it('should return 400 for unknown tool name', async () => {
      const headers = createTestAuthHeaders(testUser);
      const response = await app.request('/mcp/call/nonexistent_tool', {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error.message).toContain('Unknown tool');
    });

    it('should return 400 for array body (not object)', async () => {
      const headers = createTestAuthHeaders(testUser);

      // Grant consent so the tool name check passes
      await grantConsent(testUser.userId, {
        agentId: 'test-agent',
        resource: 'profile',
        permission: 'read',
      });

      const response = await app.request('/mcp/call/get_user_context', {
        method: 'POST',
        headers,
        body: JSON.stringify([1, 2, 3]),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.message).toContain('JSON object');
    });

    it('should accept valid tool call with proper body', async () => {
      const headers = createTestAuthHeaders(testUser);

      // Grant consent
      await grantConsent(testUser.userId, {
        agentId: 'test-agent',
        resource: 'profile',
        permission: 'read',
      });
      await grantConsent(testUser.userId, {
        agentId: 'test-agent',
        resource: 'tables',
        permission: 'read',
      });

      const response = await app.request('/mcp/call/get_user_context', {
        method: 'POST',
        headers,
        body: JSON.stringify({ topic: 'food' }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
    });
  });

  // ============================================================
  // M-2: MCP GET /tools Requires Authentication
  // ============================================================
  describe('M-2: MCP GET /tools Requires Authentication', () => {
    it('should return 401 when no auth is provided', async () => {
      const response = await app.request('/mcp/tools', { method: 'GET' });

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toContain('Authentication required');
    });

    it('should return tool list when authenticated', async () => {
      const headers = createTestAuthHeaders(testUser);
      const response = await app.request('/mcp/tools', {
        method: 'GET',
        headers,
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.tools).toBeInstanceOf(Array);
      expect(body.tools.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // M-3: getUserContext Per-Resource Consent Checks
  // ============================================================
  describe('M-3: getUserContext Per-Resource Consent Checks', () => {
    let mcpContext: McpContext;

    beforeEach(async () => {
      mcpContext = {
        userId: testUser.userId,
        agentId: 'limited-agent',
      };

      // Setup test data
      await db.execute(sql.raw(`
        UPDATE ${testUser.schemaName}.profile
        SET data = '{"name": "Test User"}'::jsonb
        WHERE version = 1
      `));

      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}.entities
        (type, name, mention_count, confidence)
        VALUES ('person', 'Alice', 5, 0.8)
      `));

      await db.execute(sql.raw(`
        INSERT INTO ${testUser.schemaName}._table_registry (table_name, description)
        VALUES ('workouts', 'Exercise tracking')
      `));
    });

    it('should return only profile when agent has only profile:read consent', async () => {
      // Grant only profile consent
      await grantConsent(testUser.userId, {
        agentId: 'limited-agent',
        resource: 'profile',
        permission: 'read',
      });

      const result = await getUserContext({}, mcpContext);

      // Profile should be populated
      expect(result.profile).toBeDefined();
      expect(result.profile).not.toBeNull();

      // Everything else should be empty
      expect(result.tables).toEqual([]);
      expect(result.collections).toEqual([]);
      expect(result.topEntities).toEqual([]);
      expect(result.recentMemories).toEqual([]);
    });

    it('should include tables when agent has tables consent', async () => {
      await grantConsent(testUser.userId, {
        agentId: 'limited-agent',
        resource: 'profile',
        permission: 'read',
      });
      await grantConsent(testUser.userId, {
        agentId: 'limited-agent',
        resource: 'tables',
        permission: 'read',
      });

      const result = await getUserContext({}, mcpContext);

      expect(result.profile).not.toBeNull();
      expect(result.tables.length).toBeGreaterThan(0);
      // No graph/vectors consent
      expect(result.topEntities).toEqual([]);
      expect(result.recentMemories).toEqual([]);
    });

    it('should include entities when agent has graph consent', async () => {
      await grantConsent(testUser.userId, {
        agentId: 'limited-agent',
        resource: 'profile',
        permission: 'read',
      });
      await grantConsent(testUser.userId, {
        agentId: 'limited-agent',
        resource: 'graph',
        permission: 'read',
      });

      const result = await getUserContext({}, mcpContext);

      expect(result.profile).not.toBeNull();
      expect(result.topEntities.length).toBeGreaterThan(0);
      // No tables/vectors consent
      expect(result.tables).toEqual([]);
      expect(result.recentMemories).toEqual([]);
    });

    it('should throw when agent has no profile consent at all', async () => {
      // No consent granted for this agent
      await expect(getUserContext({}, mcpContext)).rejects.toThrow(/CONSENT_DENIED/);
    });
  });

  // ============================================================
  // M-4: MCP Auth on All HTTP Methods
  // ============================================================
  describe('M-4: MCP Auth on All HTTP Methods', () => {
    it('should return 401 for unauthenticated GET to /mcp', async () => {
      const response = await app.request('/mcp', { method: 'GET' });

      expect(response.status).toBe(401);
    });

    it('should return 401 for unauthenticated DELETE to /mcp', async () => {
      const response = await app.request('/mcp', { method: 'DELETE' });

      expect(response.status).toBe(401);
    });

    it('should return 401 for unauthenticated POST to /mcp', async () => {
      const response = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      });

      expect(response.status).toBe(401);
    });
  });
});
