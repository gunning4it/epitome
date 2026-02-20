/**
 * Reclassify Mistyped Entities
 *
 * Finds entities that have works_at edges but aren't typed as 'organization'
 * and fixes their type. This catches entities created before the ontology
 * enforcement was added.
 *
 * Features:
 *   --dry-run    Show what would be changed without writing
 *
 * Run with: npx tsx api/src/scripts/reclassifyMistypedEntities.ts [--dry-run]
 *
 * Requires:
 *   - DATABASE_URL environment variable
 */

import { sql, withUserSchema } from '@/db/client';

interface UserRow {
  id: string;
  schema_name: string;
}

interface MistypedEntity {
  id: number;
  name: string;
  type: string;
  relation: string;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  console.log('=== Reclassify Mistyped Entities ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Started at ${new Date().toISOString()}\n`);

  const users = await sql<UserRow[]>`
    SELECT id, schema_name FROM public.users
    WHERE schema_name LIKE 'user_%'
    ORDER BY schema_name
  `;

  let totalFixed = 0;
  let totalFound = 0;

  for (const user of users) {
    try {
      const mistyped = await withUserSchema(user.id, async (tx) => {
        // Find entities that are targets of works_at but not typed 'organization'
        const worksAtTargets = await tx.unsafe<MistypedEntity[]>(`
          SELECT DISTINCT t.id, t.name, t.type, e.relation
          FROM edges e
          JOIN entities t ON t.id = e.target_id
          WHERE e.relation = 'works_at'
            AND t.type != 'organization'
            AND t._deleted_at IS NULL
            AND e._deleted_at IS NULL
        `);

        // Find entities that are targets of attended but not typed 'organization'
        const attendedTargets = await tx.unsafe<MistypedEntity[]>(`
          SELECT DISTINCT t.id, t.name, t.type, e.relation
          FROM edges e
          JOIN entities t ON t.id = e.target_id
          WHERE e.relation = 'attended'
            AND t.type != 'organization'
            AND t.type != 'event'
            AND t._deleted_at IS NULL
            AND e._deleted_at IS NULL
        `);

        return [...worksAtTargets, ...attendedTargets];
      });

      if (mistyped.length === 0) continue;

      totalFound += mistyped.length;

      for (const entity of mistyped) {
        if (dryRun) {
          console.log(`  [DRY] ${user.schema_name}: "${entity.name}" (${entity.type} → organization, via ${entity.relation})`);
        } else {
          await withUserSchema(user.id, async (tx) => {
            await tx.unsafe(
              `UPDATE entities SET type = 'organization', last_seen = NOW() WHERE id = $1`,
              [entity.id]
            );
          });
          console.log(`  FIXED ${user.schema_name}: "${entity.name}" (${entity.type} → organization)`);
          totalFixed++;
        }
      }
    } catch (error) {
      console.error(`  ERROR processing user ${user.id}: ${String(error)}`);
    }
  }

  console.log('\n=== Reclassification Complete ===');
  console.log(`Mistyped entities found: ${totalFound}`);
  console.log(`Entities fixed: ${dryRun ? '0 (dry run)' : totalFixed}`);
  console.log(`Finished at ${new Date().toISOString()}`);

  await sql.end();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
