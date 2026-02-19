// api/tests/parity/getUserContext.parity.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestUser, cleanupTestUser, type TestUser } from '../helpers/db';
import { grantConsent } from '@/services/consent.service';
import { db } from '@/db';
import { sql } from 'drizzle-orm';

// Legacy handler
import { getUserContext as legacyGetUserContext } from '@/mcp/tools/getUserContext';
import type { McpContext } from '@/mcp/server';

// New service + adapter
import { getUserContext as getUserContextService } from '@/services/tools/getUserContext';
import { mcpAdapter } from '@/services/tools/adapters';
import { buildToolContext } from '@/services/tools/context';

const AGENT_ID = 'parity-agent';

async function seedTestData(userId: string) {
  const schemaName = `user_${userId.replace(/-/g, '')}`;

  // Seed profile
  await db.execute(sql.raw(`
    UPDATE ${schemaName}.profile
    SET data = '{"name": "Alice", "timezone": "America/Los_Angeles"}'::jsonb
    WHERE version = 1
  `));

  // Seed a table registry entry
  await db.execute(sql.raw(`
    INSERT INTO ${schemaName}._table_registry (table_name, description, columns, record_count)
    VALUES ('meals', 'Daily meals', '[]', 5)
  `));

  // Seed a vector collection
  await db.execute(sql.raw(`
    INSERT INTO ${schemaName}._vector_collections (collection, description, entry_count)
    VALUES ('journal', 'Journal entries', 3)
  `));

  // Seed an entity
  await db.execute(sql.raw(`
    INSERT INTO ${schemaName}.entities (type, name, properties, confidence, mention_count, first_seen, last_seen)
    VALUES ('person', 'Bob', '{"role": "friend"}'::jsonb, 0.9, 5, NOW(), NOW())
  `));

  // Seed a memory_meta entry
  await db.execute(sql.raw(`
    INSERT INTO ${schemaName}.memory_meta (source_type, source_ref, origin, confidence, status)
    VALUES ('vector', 'vec-1', 'user_stated', 0.85, 'active')
  `));

  // Seed a vector (with embedding)
  const dim = 1536;
  const embedding = Array(dim).fill(0.01).join(',');
  await db.execute(sql.raw(`
    INSERT INTO ${schemaName}.vectors (collection, text, embedding, metadata, _meta_id)
    VALUES ('journal', 'Had coffee with Bob', '[${embedding}]'::vector, '{"source": "chat"}'::jsonb, 1)
  `));
}

/**
 * Normalize data for comparison — strips Date serialization differences
 * (legacy returns Date objects which JSON.stringify handles differently from
 * the service layer that may produce identical strings).
 */
function normalize(obj: unknown): unknown {
  return JSON.parse(JSON.stringify(obj));
}

describe('getUserContext parity: legacy vs service+adapter', () => {
  let testUser: TestUser;
  let legacyCtx: McpContext;

  beforeEach(async () => {
    testUser = await createTestUser();
    legacyCtx = {
      userId: testUser.userId,
      agentId: AGENT_ID,
      tier: 'pro',
    };
    await seedTestData(testUser.userId);
  });

  afterEach(async () => {
    await cleanupTestUser(testUser.userId);
  });

  it('produces identical output with full consent', async () => {
    // Grant all necessary consent
    await grantConsent(testUser.userId, { agentId: AGENT_ID, resource: 'profile', permission: 'read' });
    await grantConsent(testUser.userId, { agentId: AGENT_ID, resource: 'tables', permission: 'read' });
    await grantConsent(testUser.userId, { agentId: AGENT_ID, resource: 'vectors', permission: 'read' });
    await grantConsent(testUser.userId, { agentId: AGENT_ID, resource: 'graph', permission: 'read' });

    const legacyResult = await legacyGetUserContext({}, legacyCtx);

    const serviceCtx = buildToolContext({
      userId: testUser.userId,
      agentId: AGENT_ID,
      tier: 'pro',
      authType: 'api_key',
    });
    const serviceResult = await getUserContextService({}, serviceCtx);
    const adapted = mcpAdapter(serviceResult);

    expect(adapted.isError).toBeUndefined();
    expect(normalize(JSON.parse(adapted.content[0].text))).toEqual(normalize(legacyResult));
  });

  it('produces identical partial output when graph consent is denied', async () => {
    // Grant all consent except graph
    await grantConsent(testUser.userId, { agentId: AGENT_ID, resource: 'profile', permission: 'read' });
    await grantConsent(testUser.userId, { agentId: AGENT_ID, resource: 'tables', permission: 'read' });
    await grantConsent(testUser.userId, { agentId: AGENT_ID, resource: 'vectors', permission: 'read' });
    // No graph consent

    const legacyResult = await legacyGetUserContext({}, legacyCtx);

    const serviceCtx = buildToolContext({
      userId: testUser.userId,
      agentId: AGENT_ID,
      tier: 'pro',
      authType: 'api_key',
    });
    const serviceResult = await getUserContextService({}, serviceCtx);
    const adapted = mcpAdapter(serviceResult);

    expect(adapted.isError).toBeUndefined();

    const serviceData = normalize(JSON.parse(adapted.content[0].text));
    const legacyData = normalize(legacyResult);

    // Both should have empty topEntities but populated profile/tables/collections/recentMemories
    expect(serviceData).toEqual(legacyData);
  });

  it('produces identical partial output when vectors consent is denied', async () => {
    // Grant all consent except vectors
    await grantConsent(testUser.userId, { agentId: AGENT_ID, resource: 'profile', permission: 'read' });
    await grantConsent(testUser.userId, { agentId: AGENT_ID, resource: 'tables', permission: 'read' });
    await grantConsent(testUser.userId, { agentId: AGENT_ID, resource: 'graph', permission: 'read' });
    // No vectors consent

    const legacyResult = await legacyGetUserContext({}, legacyCtx);

    const serviceCtx = buildToolContext({
      userId: testUser.userId,
      agentId: AGENT_ID,
      tier: 'pro',
      authType: 'api_key',
    });
    const serviceResult = await getUserContextService({}, serviceCtx);
    const adapted = mcpAdapter(serviceResult);

    expect(adapted.isError).toBeUndefined();

    const serviceData = normalize(JSON.parse(adapted.content[0].text));
    const legacyData = normalize(legacyResult);

    // Both should have empty collections and recentMemories
    expect(serviceData).toEqual(legacyData);
  });
});
