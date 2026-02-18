/**
 * Reprocess existing user data through the current extraction system.
 *
 * What it does:
 * - Optionally resets derived graph state (entities/edges + their memory_meta rows)
 * - Re-extracts latest profile
 * - Re-extracts every non-deleted row from all user tables in _table_registry
 * - Re-extracts every non-deleted vector using {text + metadata} payload
 * - Runs inter-entity edge backfill once at the end
 *
 * Usage:
 *   cd api
 *   npx tsx src/scripts/reprocessUserData.ts
 *
 * Optional env:
 *   TARGET_USER_ID=<uuid>        # Process only this user (recommended)
 *   RESET_DERIVED_GRAPH=true     # Default true. Set false for additive-only mode.
 */

import { sql, withUserSchema } from '@/db/client';
import { extractEntitiesFromRecord, createInterEntityEdgesLLM } from '@/services/entityExtraction';
import { escapeIdentifier } from '@/services/sqlSandbox.service';

interface UserRow {
  id: string;
  schema_name: string;
  email: string;
}

interface VectorRow {
  id: number;
  collection: string;
  text: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface EntityRefRow {
  id: number;
  name: string;
  type: string;
}

function parseBooleanEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'y'].includes(raw.toLowerCase());
}

async function getUsers(): Promise<UserRow[]> {
  const targetUserId = process.env.TARGET_USER_ID?.trim();
  if (targetUserId) {
    return sql<UserRow[]>`
      SELECT id::text, schema_name, email
      FROM public.users
      WHERE id = ${targetUserId}::uuid
      LIMIT 1
    `;
  }

  return sql<UserRow[]>`
    SELECT id::text, schema_name, email
    FROM public.users
    WHERE schema_name LIKE 'user_%'
    ORDER BY created_at ASC
  `;
}

async function getDerivedCounts(userId: string): Promise<{
  entities: number;
  edges: number;
  entityMeta: number;
  edgeMeta: number;
}> {
  return withUserSchema(userId, async (tx) => {
    const [rows] = await Promise.all([
      tx.unsafe<Array<{
        entities: string;
        edges: string;
        entity_meta: string;
        edge_meta: string;
      }>>(`
        SELECT
          (SELECT COUNT(*) FROM entities WHERE _deleted_at IS NULL) AS entities,
          (SELECT COUNT(*) FROM edges WHERE _deleted_at IS NULL) AS edges,
          (SELECT COUNT(*) FROM memory_meta WHERE source_type = 'entity') AS entity_meta,
          (SELECT COUNT(*) FROM memory_meta WHERE source_type = 'edge') AS edge_meta
      `),
    ]);

    const row = rows[0];
    return {
      entities: Number(row.entities),
      edges: Number(row.edges),
      entityMeta: Number(row.entity_meta),
      edgeMeta: Number(row.edge_meta),
    };
  });
}

async function resetDerivedGraph(userId: string): Promise<void> {
  await withUserSchema(userId, async (tx) => {
    await tx.unsafe(`TRUNCATE TABLE edges, entities RESTART IDENTITY CASCADE`);
    await tx.unsafe(`DELETE FROM memory_meta WHERE source_type IN ('entity', 'edge')`);
  });
}

async function processProfile(userId: string): Promise<number> {
  const profileRows = await withUserSchema(userId, async (tx) => {
    return tx.unsafe<Array<{ data: Record<string, unknown> | null }>>(`
      SELECT data
      FROM profile
      ORDER BY version DESC
      LIMIT 1
    `);
  });

  const profileData = profileRows[0]?.data;
  if (!profileData) return 0;

  const result = await extractEntitiesFromRecord(userId, 'profile', profileData, 'llm_first');
  return result.entities.length;
}

async function processDynamicTables(userId: string): Promise<{ rows: number; entities: number }> {
  const tableRows = await withUserSchema(userId, async (tx) => {
    return tx.unsafe<Array<{ table_name: string }>>(`
      SELECT table_name
      FROM _table_registry
      ORDER BY table_name ASC
    `);
  });

  let totalRows = 0;
  let totalEntities = 0;

  for (const { table_name } of tableRows) {
    const records = await withUserSchema(userId, async (tx) => {
      return tx.unsafe<Array<Record<string, unknown>>>(`
        SELECT *
        FROM ${escapeIdentifier(table_name)}
        WHERE _deleted_at IS NULL
        ORDER BY id ASC
      `);
    });

    totalRows += records.length;
    for (const record of records) {
      const result = await extractEntitiesFromRecord(userId, table_name, record, 'llm_first');
      totalEntities += result.entities.length;
    }
  }

  return { rows: totalRows, entities: totalEntities };
}

async function processVectors(userId: string): Promise<{ rows: number; entities: number }> {
  const vectors = await withUserSchema(userId, async (tx) => {
    return tx.unsafe<VectorRow[]>(`
      SELECT id, collection, text, metadata, created_at
      FROM vectors
      WHERE _deleted_at IS NULL
      ORDER BY id ASC
    `);
  });

  let totalEntities = 0;
  for (const row of vectors) {
    const payload: Record<string, unknown> = {
      id: row.id,
      text: row.text,
      collection: row.collection,
      created_at: row.created_at,
      metadata: row.metadata || {},
    };
    const result = await extractEntitiesFromRecord(userId, row.collection, payload, 'llm_first');
    totalEntities += result.entities.length;
  }

  return { rows: vectors.length, entities: totalEntities };
}

async function processInterEntityEdges(userId: string): Promise<number> {
  const refs = await withUserSchema(userId, async (tx) => {
    return tx.unsafe<EntityRefRow[]>(`
      SELECT id, name, type
      FROM entities
      WHERE _deleted_at IS NULL
      ORDER BY id ASC
    `);
  });

  if (refs.length < 2) return 0;
  const result = await createInterEntityEdgesLLM(userId, refs);
  return result.edges.length;
}

async function main(): Promise<void> {
  const resetDerived = parseBooleanEnv('RESET_DERIVED_GRAPH', true);
  const users = await getUsers();

  console.log('=== Reprocess User Data ===');
  console.log(`Started: ${new Date().toISOString()}`);
  console.log(`Users matched: ${users.length}`);
  console.log(`Reset derived graph: ${resetDerived}`);

  if (users.length === 0) {
    console.log('No users found for reprocessing.');
    await sql.end();
    return;
  }

  for (const user of users) {
    console.log(`\n--- User ${user.id} (${user.email}) ---`);
    const before = await getDerivedCounts(user.id);
    console.log(`Before: entities=${before.entities}, edges=${before.edges}, entityMeta=${before.entityMeta}, edgeMeta=${before.edgeMeta}`);

    if (resetDerived) {
      await resetDerivedGraph(user.id);
      console.log('Derived graph reset complete.');
    }

    const profileEntities = await processProfile(user.id);
    const tableResult = await processDynamicTables(user.id);
    const vectorResult = await processVectors(user.id);
    const interEdges = await processInterEntityEdges(user.id);

    const after = await getDerivedCounts(user.id);
    console.log(`Processed profile entities: ${profileEntities}`);
    console.log(`Processed table rows: ${tableResult.rows}, extracted entities: ${tableResult.entities}`);
    console.log(`Processed vectors: ${vectorResult.rows}, extracted entities: ${vectorResult.entities}`);
    console.log(`Inter-entity edges created: ${interEdges}`);
    console.log(`After: entities=${after.entities}, edges=${after.edges}, entityMeta=${after.entityMeta}, edgeMeta=${after.edgeMeta}`);
  }

  console.log(`\nFinished: ${new Date().toISOString()}`);
  await sql.end();
}

main().catch(async (error) => {
  console.error('Fatal reprocess error:', error);
  await sql.end();
  process.exit(1);
});
