/**
 * Backfill inter-entity edges for existing entities
 *
 * Creates LLM-powered edges between existing food, preference, and topic
 * entities that were created before the inter-entity edge feature was added.
 *
 * Run with: npx tsx api/src/scripts/backfillInterEntityEdges.ts
 *
 * Requires:
 *   - DATABASE_URL environment variable
 *   - ANTHROPIC_API_KEY environment variable
 */

import { sql, withUserSchema } from '@/db/client';
import { createInterEntityEdgesLLM } from '@/services/entityExtraction';

interface UserRow {
  id: string;
  schema_name: string;
}

interface EntityRow {
  id: number;
  name: string;
  type: string;
}

const DELAY_BETWEEN_USERS_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  console.log('=== Backfill Inter-Entity Edges ===');
  console.log(`Started at ${new Date().toISOString()}`);

  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY environment variable is required');
    process.exit(1);
  }

  // Get all user schemas
  const users = await sql<UserRow[]>`
    SELECT id, schema_name FROM public.users
    WHERE schema_name LIKE 'user_%'
    ORDER BY schema_name
  `;

  console.log(`Found ${users.length} user schema(s) to process\n`);

  let totalUsersProcessed = 0;
  let totalUsersSkipped = 0;
  let totalUsersErrored = 0;
  let totalEdgesCreated = 0;

  for (const user of users) {
    try {
      console.log(`Processing user ${user.id} (${user.schema_name})...`);

      // Get all non-deleted food, preference, and topic entities
      const entities = await withUserSchema(user.id, async (tx) => {
        const rows = await tx<EntityRow[]>`
          SELECT id, name, type FROM entities
          WHERE type IN ('food', 'preference', 'topic')
            AND _deleted_at IS NULL
          ORDER BY type, name
        `.execute();
        return rows;
      });

      if (entities.length < 2) {
        console.log(`  Skipped: only ${entities.length} eligible entity(ies)`);
        totalUsersSkipped++;
        continue;
      }

      console.log(`  Found ${entities.length} entities (${summarizeByType(entities)})`);

      // Call LLM to create inter-entity edges
      const result = await createInterEntityEdgesLLM(user.id, entities);

      console.log(`  Created ${result.edges.length} inter-entity edge(s)`);
      totalEdgesCreated += result.edges.length;
      totalUsersProcessed++;

      // Rate limit between users to avoid hitting API limits
      if (users.indexOf(user) < users.length - 1) {
        await sleep(DELAY_BETWEEN_USERS_MS);
      }
    } catch (error) {
      console.error(`  ERROR processing user ${user.id}: ${String(error)}`);
      totalUsersErrored++;
    }
  }

  console.log('\n=== Backfill Complete ===');
  console.log(`Users processed: ${totalUsersProcessed}`);
  console.log(`Users skipped (< 2 entities): ${totalUsersSkipped}`);
  console.log(`Users errored: ${totalUsersErrored}`);
  console.log(`Total edges created: ${totalEdgesCreated}`);
  console.log(`Finished at ${new Date().toISOString()}`);

  // Close the database connection pool
  await sql.end();
}

function summarizeByType(entities: EntityRow[]): string {
  const counts: Record<string, number> = {};
  for (const e of entities) {
    counts[e.type] = (counts[e.type] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([type, count]) => `${count} ${type}`)
    .join(', ');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
