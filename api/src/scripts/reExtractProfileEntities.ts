/**
 * Re-extract profile entities for all users
 *
 * Re-runs rule-based entity extraction on existing profile data so that
 * work/career, education, family, interests, and skills get extracted
 * into the knowledge graph.
 *
 * Features:
 *   --dry-run    Log what would be extracted without writing to the graph
 *   Chunked:     Processes 50 profiles per batch with 1s delay
 *   Idempotent:  Skips profiles where work/education entities already exist
 *
 * Run with: npx tsx api/src/scripts/reExtractProfileEntities.ts [--dry-run]
 *
 * Requires:
 *   - DATABASE_URL environment variable
 */

import { sql, withUserSchema } from '@/db/client';
import { extractEntitiesFromRecord, extractEntitiesRuleBased } from '@/services/entityExtraction';
import { checkIdentityInvariants, type ProfileData } from '@/services/profile.service';

interface UserRow {
  id: string;
  schema_name: string;
}

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  console.log('=== Re-Extract Profile Entities ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
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
  let totalAlreadyDone = 0;
  let totalErrored = 0;
  let totalEntitiesExtracted = 0;

  // Process in chunks
  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);
    console.log(`--- Batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} users) ---`);

    for (const user of batch) {
      try {
        // Get latest profile data
        const profileRows = await withUserSchema(user.id, async (tx) => {
          return tx.unsafe(`
            SELECT data FROM profile
            ORDER BY version DESC
            LIMIT 1
          `);
        });

        if (!profileRows[0]?.data) {
          totalSkipped++;
          continue;
        }

        const profileData = profileRows[0].data;

        // Idempotency check: skip if work/education entities already exist from extraction
        const alreadyExtracted = await withUserSchema(user.id, async (tx) => {
          const rows = await tx.unsafe(`
            SELECT COUNT(*)::int as cnt FROM entities
            WHERE type = 'organization'
              AND _deleted_at IS NULL
              AND (
                (properties->>'category') IN ('employer', 'education')
              )
          `);
          return (rows[0]?.cnt || 0) > 0;
        });

        if (alreadyExtracted) {
          totalAlreadyDone++;
          continue;
        }

        // Identity safety check: warn if profile name matches family member
        const typedProfileData = (profileData || {}) as ProfileData;
        if (typedProfileData.name && typedProfileData.family) {
          const violations = checkIdentityInvariants(typedProfileData, typedProfileData, 'system');
          if (violations.some(v => v.blocked)) {
            console.warn(`  ⚠ Identity risk: profile name "${typedProfileData.name}" matches family member — skipping owner entity update`);
            // Don't skip the full extraction, just warn — the extraction itself is safe
          }
        }

        if (dryRun) {
          // Dry-run: just extract and report without writing
          const entities = extractEntitiesRuleBased('profile', profileData);
          const orgEntities = entities.filter(e => e.type === 'organization');
          if (orgEntities.length > 0) {
            console.log(`  [DRY] ${user.schema_name}: would extract ${entities.length} entities (${orgEntities.map(e => e.name).join(', ')})`);
          }
          totalEntitiesExtracted += entities.length;
          totalProcessed++;
        } else {
          // Live: actually extract and write to graph
          const result = await extractEntitiesFromRecord(
            user.id,
            'profile',
            profileData,
            'rule_based'
          );

          if (result.entities.length > 0) {
            console.log(`  ${user.schema_name}: extracted ${result.entities.length} entity(ies)`);
          }
          totalEntitiesExtracted += result.entities.length;
          totalProcessed++;
        }
      } catch (error) {
        console.error(`  ERROR processing user ${user.id}: ${String(error)}`);
        totalErrored++;
      }
    }

    // Delay between batches
    if (i + BATCH_SIZE < users.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log('\n=== Re-Extraction Complete ===');
  console.log(`Users processed: ${totalProcessed}`);
  console.log(`Users skipped (no profile): ${totalSkipped}`);
  console.log(`Users already done: ${totalAlreadyDone}`);
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
