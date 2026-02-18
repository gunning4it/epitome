/**
 * Integration Tests - Tables API Endpoints
 *
 * Tests all table endpoints:
 * - GET /v1/tables
 * - POST /v1/tables/:name/records
 * - POST /v1/tables/:name/query
 * - PATCH /v1/tables/:name/records/:id
 * - DELETE /v1/tables/:name/records/:id
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import app from '@/index';
import { createTestUser, cleanupTestUser, type TestUser } from '../../helpers/db';
import { createTestAuthHeaders } from '../../helpers/app';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { grantConsent } from '@/services/consent.service';
import { resetAllRateLimits } from '@/services/rateLimit.service';

describe('Tables API Integration Tests', () => {
  let testUser: TestUser;

  beforeEach(async () => {
    await resetAllRateLimits();
    testUser = await createTestUser();

    // Grant consent for test agent to access tables
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'tables',
      permission: 'write',
    });
    // Grant wildcard consent for tables/* (needed for individual table access)
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'tables/*',
      permission: 'write',
    });
  });

  afterEach(async () => {
    await cleanupTestUser(testUser.userId);
  });

  describe('GET /v1/tables', () => {
    it('should return empty list when no tables exist', async () => {
      const response = await app.request('/v1/tables', {
        method: 'GET',
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data).toEqual([]);
    });

    it('should return list of tables after creation', async () => {
      // Create a table by inserting first record
      await app.request('/v1/tables/workouts/records', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
          body: { exercise: 'Bench Press', reps: 10, weight: 135 },
        }),
      });

      const response = await app.request('/v1/tables', {
        method: 'GET',
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data).toHaveLength(1);
      expect(json.data[0]).toHaveProperty('table_name', 'workouts');
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/tables', { method: 'GET' });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /v1/tables/:name/records', () => {
    it('should create table and insert first record', async () => {
      const recordData = {
        exercise: 'Bench Press',
        reps: 10,
        weight: 135,
        date: '2026-02-12',
      };

      const response = await app.request('/v1/tables/workouts/records', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: recordData }),
      });

      expect(response.status).toBe(201);
      const json = await response.json() as any;
      expect(json.data).toHaveProperty('id');
      expect(json.data.tableName).toBe('workouts');
    });

    it('should infer column types correctly', async () => {
      await app.request('/v1/tables/test_types/records', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({
          body: {
            text_field: 'hello',
            integer_field: 42,
            float_field: 3.14,
            boolean_field: true,
            date_field: '2026-02-12',
          },
        }),
      });

      // Query the tables metadata
      const tablesResponse = await app.request('/v1/tables', {
        method: 'GET',
        headers: createTestAuthHeaders(testUser),
      });

      const tablesData = await tablesResponse.json() as any;
      const table = tablesData.data.find((t: any) => t.table_name === 'test_types');
      expect(table).toBeDefined();
    });

    it('should add new columns when schema evolves', async () => {
      // Insert first record
      await app.request('/v1/tables/evolving/records', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: { field1: 'value1' } }),
      });

      // Insert record with new field
      const response = await app.request('/v1/tables/evolving/records', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: { field1: 'value2', field2: 'new field' } }),
      });

      expect(response.status).toBe(201);
    });

    it('should return 400 with invalid data', async () => {
      const response = await app.request('/v1/tables/test/records', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/tables/test/records', {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ body: { field: 'value' } }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /v1/tables/:name/query', () => {
    beforeEach(async () => {
      // Insert test data
      const records = [
        { exercise: 'Bench Press', reps: 10, weight: 135 },
        { exercise: 'Squat', reps: 8, weight: 225 },
        { exercise: 'Deadlift', reps: 5, weight: 315 },
      ];

      for (const record of records) {
        await app.request('/v1/tables/workouts/records', {
          method: 'POST',
          headers: createTestAuthHeaders(testUser),
          body: JSON.stringify({ body: record }),
        });
      }
    });

    it('should return all records with SELECT *', async () => {
      const response = await app.request('/v1/tables/workouts/query', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: { sql: 'SELECT * FROM workouts' } }),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data).toHaveLength(3);
    });

    it('should filter records with WHERE clause', async () => {
      const response = await app.request('/v1/tables/workouts/query', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: { sql: "SELECT * FROM workouts WHERE exercise = 'Squat'" } }),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data).toHaveLength(1);
      expect(json.data[0].exercise).toBe('Squat');
    });

    it('should support ORDER BY', async () => {
      const response = await app.request('/v1/tables/workouts/query', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: { sql: 'SELECT * FROM workouts ORDER BY weight DESC' } }),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data[0].weight).toBe(315);
    });

    it('should reinforce memory access when SQL results include _meta_id', async () => {
      const metaRows = await db.execute(sql.raw(`
        SELECT _meta_id
        FROM ${testUser.schemaName}.workouts
        WHERE _meta_id IS NOT NULL
        LIMIT 1
      `));
      const metaId = Number((metaRows[0] as any)?._meta_id);
      expect(Number.isInteger(metaId)).toBe(true);

      const beforeRows = await db.execute(sql.raw(`
        SELECT access_count
        FROM ${testUser.schemaName}.memory_meta
        WHERE id = ${metaId}
      `));
      const before = Number((beforeRows[0] as any)?.access_count || 0);

      const response = await app.request('/v1/tables/workouts/query', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: { sql: 'SELECT id, exercise, _meta_id FROM workouts' } }),
      });

      expect(response.status).toBe(200);

      const afterRows = await db.execute(sql.raw(`
        SELECT access_count
        FROM ${testUser.schemaName}.memory_meta
        WHERE id = ${metaId}
      `));
      const after = Number((afterRows[0] as any)?.access_count || 0);
      expect(after).toBeGreaterThan(before);
    });

    it('should block DDL statements', async () => {
      const response = await app.request('/v1/tables/workouts/query', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: { sql: 'DROP TABLE workouts' } }),
      });

      expect(response.status).toBe(400);
      const json = await response.json() as any;
      expect(json.error.message).toMatch(/not allowed|forbidden|blocked|Only SELECT/i);
    });

    it('should block DML statements (INSERT/UPDATE/DELETE)', async () => {
      const response = await app.request('/v1/tables/workouts/query', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: { sql: "DELETE FROM workouts WHERE exercise = 'Squat'" } }),
      });

      expect(response.status).toBe(400);
    });

    it('should block access to system catalogs', async () => {
      const response = await app.request('/v1/tables/workouts/query', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: { sql: 'SELECT * FROM pg_tables' } }),
      });

      expect(response.status).toBe(400);
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/v1/tables/workouts/query', {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ body: { sql: 'SELECT * FROM workouts' } }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe('PATCH /v1/tables/:name/records/:id', () => {
    let recordId: string;

    beforeEach(async () => {
      // Create a record
      const response = await app.request('/v1/tables/workouts/records', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: { exercise: 'Bench Press', reps: 10 } }),
      });

      const json = await response.json() as any;
      recordId = json.data.id;
    });

    it('should update existing record', async () => {
      const response = await app.request(`/v1/tables/workouts/records/${recordId}`, {
        method: 'PATCH',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: { reps: 12 } }),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data.reps).toBe(12);
    });

    it('should register contradictions when record values change', async () => {
      await app.request(`/v1/tables/workouts/records/${recordId}`, {
        method: 'PATCH',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: { reps: 12 } }),
      });

      const rows = await db.execute(sql.raw(`
        SELECT contradictions
        FROM ${testUser.schemaName}.memory_meta
        ORDER BY created_at DESC
        LIMIT 1
      `));
      const contradictions = ((rows[0] as any)?.contradictions || []) as Array<{ field: string }>;
      expect(contradictions.length).toBeGreaterThan(0);
      expect(contradictions[0].field).toBe('workouts.reps');
    });

    it('should return 404 for non-existent record', async () => {
      const fakeId = 999999;
      const response = await app.request(`/v1/tables/workouts/records/${fakeId}`, {
        method: 'PATCH',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: { reps: 12 } }),
      });

      expect(response.status).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request(`/v1/tables/workouts/records/${recordId}`, {
        method: 'PATCH',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ body: { reps: 12 } }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe('DELETE /v1/tables/:name/records/:id', () => {
    let recordId: string;

    beforeEach(async () => {
      // Create a record
      const response = await app.request('/v1/tables/workouts/records', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: { exercise: 'Bench Press', reps: 10 } }),
      });

      const json = await response.json() as any;
      recordId = json.data.id;
    });

    it('should soft-delete record', async () => {
      const response = await app.request(`/v1/tables/workouts/records/${recordId}`, {
        method: 'DELETE',
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data.success).toBe(true);
    });

    it('should not return soft-deleted records in queries', async () => {
      // Delete the record
      await app.request(`/v1/tables/workouts/records/${recordId}`, {
        method: 'DELETE',
        headers: createTestAuthHeaders(testUser),
      });

      // Query should not return deleted record
      const response = await app.request('/v1/tables/workouts/query', {
        method: 'POST',
        headers: createTestAuthHeaders(testUser),
        body: JSON.stringify({ body: { sql: 'SELECT * FROM workouts' } }),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.data).toHaveLength(0);
    });

    it('should return 404 for non-existent record', async () => {
      const fakeId = 999999;
      const response = await app.request(`/v1/tables/workouts/records/${fakeId}`, {
        method: 'DELETE',
        headers: createTestAuthHeaders(testUser),
      });

      expect(response.status).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request(`/v1/tables/workouts/records/${recordId}`, {
        method: 'DELETE',
      });

      expect(response.status).toBe(401);
    });
  });
});
