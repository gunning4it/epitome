/**
 * One-time backfill: re-extract graph entities from existing profiles
 *
 * Run locally:
 *   NODE_ENV=production npx tsx -r dotenv/config scripts/backfill-graph-extraction.ts
 *
 * This script:
 * 1. Finds all user schemas
 * 2. For each user, reads their latest profile
 * 3. Runs extractEntitiesFromRecord('profile', profileData) to populate the graph
 */

import { sql as pgSql, closeDatabase } from '../src/db/client';
import { extractEntitiesFromRecord } from '../src/services/entityExtraction';
import { logger } from '../src/utils/logger';

async function main() {
  console.log('Starting graph extraction backfill...');

  // Find all user schemas
  const users = await pgSql`
    SELECT id, schema_name FROM public.users WHERE schema_name IS NOT NULL
  `;

  console.log(`Found ${users.length} users to process`);

  for (const user of users) {
    const userId = user.id;
    const schema = user.schema_name;
    console.log(`\nProcessing user ${userId} (${schema})...`);

    try {
      // Read latest profile
      const profiles = await pgSql.unsafe(`
        SELECT data FROM ${schema}.profile
        ORDER BY version DESC
        LIMIT 1
      `);

      if (profiles.length === 0) {
        console.log(`  No profile found, skipping`);
        continue;
      }

      const profileData = profiles[0].data;
      console.log(`  Profile keys: ${Object.keys(profileData).join(', ')}`);

      // Run extraction
      const result = await extractEntitiesFromRecord(userId, 'profile', profileData, 'rule_based');
      console.log(`  Extracted ${result.entities.length} entities`);

      // Log entity names for visibility
      for (const entity of result.entities) {
        const src = entity.edge?.sourceRef ? ` (from ${entity.edge.sourceRef.name})` : ' (from owner)';
        console.log(`    - ${entity.type}: "${entity.name}" [${entity.edge?.relation}]${src}`);
      }
    } catch (err) {
      console.error(`  Error processing user ${userId}:`, err);
    }
  }

  console.log('\nBackfill complete!');
  await closeDatabase();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
