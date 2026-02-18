/**
 * Re-extract profile entities for all users
 *
 * Re-runs rule-based entity extraction on existing profile data so that
 * family members stored as objects (e.g. { wife: { name, birthday } })
 * get extracted into the knowledge graph.
 *
 * Run with: npx tsx api/src/scripts/reExtractProfileEntities.ts
 *
 * Requires:
 *   - DATABASE_URL environment variable
 */

import { sql, withUserSchema } from '@/db/client';
import { extractEntitiesFromRecord } from '@/services/entityExtraction';

interface UserRow {
  id: string;
  schema_name: string;
}

async function main(): Promise<void> {
  console.log('=== Re-Extract Profile Entities ===');
  console.log(`Started at ${new Date().toISOString()}`);

  // Get all user schemas
  const users = await sql<UserRow[]>`
    SELECT id, schema_name FROM public.users
    WHERE schema_name LIKE 'user_%'
    ORDER BY schema_name
  `;

  console.log(`Found ${users.length} user schema(s) to process\n`);

  let totalProcessed = 0;
  let totalSkipped = 0;
  let totalErrored = 0;
  let totalEntitiesExtracted = 0;

  for (const user of users) {
    try {
      console.log(`Processing user ${user.id} (${user.schema_name})...`);

      // Get latest profile data
      const profileRows = await withUserSchema(user.id, async (tx) => {
        return tx.unsafe(`
          SELECT data FROM profile
          ORDER BY version DESC
          LIMIT 1
        `);
      });

      if (!profileRows[0]?.data) {
        console.log('  Skipped: no profile data');
        totalSkipped++;
        continue;
      }

      const profileData = profileRows[0].data;
      console.log(`  Profile name: ${profileData.name || '(unnamed)'}`);

      // Run entity extraction on the profile
      const result = await extractEntitiesFromRecord(
        user.id,
        'profile',
        profileData,
        'rule_based'
      );

      console.log(`  Extracted ${result.entities.length} entity(ies)`);
      totalEntitiesExtracted += result.entities.length;
      totalProcessed++;
    } catch (error) {
      console.error(`  ERROR processing user ${user.id}: ${String(error)}`);
      totalErrored++;
    }
  }

  console.log('\n=== Re-Extraction Complete ===');
  console.log(`Users processed: ${totalProcessed}`);
  console.log(`Users skipped (no profile): ${totalSkipped}`);
  console.log(`Users errored: ${totalErrored}`);
  console.log(`Total entities extracted: ${totalEntitiesExtracted}`);
  console.log(`Finished at ${new Date().toISOString()}`);

  // Close the database connection pool
  await sql.end();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
