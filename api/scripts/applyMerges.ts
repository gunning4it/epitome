/**
 * Apply Cross-Type Merges
 *
 * One-shot script to merge duplicate cross-type entities identified by
 * crossTypeDupReport.ts. Merges sources into the highest-mention survivor,
 * then re-types the survivor.
 *
 * Run:
 *   NODE_ENV=production npx tsx scripts/applyMerges.ts
 */

import { sql as pgSql, closeDatabase } from '../src/db/client';
import { withUserSchema } from '../src/db/client';
import { mergeEntities } from '../src/services/deduplication';

const USER_ID = '350f5ccf-97cb-4414-933a-3bfe2014a6fc';

interface MergeGroup {
  survivorId: number;
  sourceIds: number[];
  retypeTo?: string;
  label: string;
}

const MERGE_GROUPS: MergeGroup[] = [
  {
    label: 'Gunning family',
    survivorId: 8,          // organization, 935 mentions — highest
    sourceIds: [12, 9, 22], // person(7), custom(1), topic(1)
    retypeTo: 'person',     // family → person
  },
  {
    label: 'Gunning',
    survivorId: 14,         // topic, 7 mentions — highest
    sourceIds: [20],        // custom(1)
    retypeTo: 'person',     // surname → person
  },
];

async function main() {
  console.log('Cross-Type Merge Script');
  console.log('=======================\n');

  for (const group of MERGE_GROUPS) {
    console.log(`Processing "${group.label}" (survivor: id=${group.survivorId})`);

    // Merge each source into the survivor
    for (const sourceId of group.sourceIds) {
      console.log(`  Merging id=${sourceId} → id=${group.survivorId}...`);
      await mergeEntities(USER_ID, sourceId, group.survivorId);
      console.log(`  ✓ Merged id=${sourceId}`);
    }

    // Re-type the survivor
    if (group.retypeTo) {
      console.log(`  Retyping id=${group.survivorId} → ${group.retypeTo}...`);
      await withUserSchema(USER_ID, async (tx) => {
        await tx`
          UPDATE entities
          SET type = ${group.retypeTo!}
          WHERE id = ${group.survivorId}
            AND _deleted_at IS NULL
        `;
      });
      console.log(`  ✓ Retyped to ${group.retypeTo}`);
    }

    console.log(`  Done.\n`);
  }

  // Verify results
  console.log('Verification:');
  await pgSql.unsafe(`SET search_path TO user_350f5ccf97cb4414933a3bfe2014a6fc, public`);
  const remaining = await pgSql.unsafe(`
    SELECT id, name, type, mention_count, confidence, _deleted_at IS NOT NULL AS deleted
    FROM entities
    WHERE lower(name) IN ('gunning family', 'gunning')
    ORDER BY name, id
  `);

  for (const e of remaining) {
    const status = e.deleted ? '(DELETED)' : '(ACTIVE)';
    console.log(`  id=${e.id} "${e.name}" type=${e.type} mentions=${e.mention_count} ${status}`);
  }

  await pgSql.unsafe('SET search_path TO public');
  await closeDatabase();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
