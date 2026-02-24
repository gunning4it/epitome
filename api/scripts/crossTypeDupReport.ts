/**
 * Cross-Type Duplicate Report
 *
 * One-shot read-only script that finds entities sharing the same name
 * across different types. Produces a JSON report with merge recommendations.
 *
 * Run locally:
 *   NODE_ENV=production npx tsx -r dotenv/config scripts/crossTypeDupReport.ts
 *
 * No mutations — read-only.
 */

import { sql as pgSql, closeDatabase } from '../src/db/client';

interface DuplicateGroup {
  name: string;
  entities: Array<{
    id: number;
    type: string;
    mentionCount: number;
    confidence: number;
  }>;
  recommendation: 'merge' | 'review';
}

async function main() {
  console.log('Cross-Type Duplicate Report');
  console.log('==========================\n');

  // Find all user schemas
  const users = await pgSql`
    SELECT id, schema_name FROM public.users WHERE schema_name IS NOT NULL
  `;

  console.log(`Found ${users.length} users to scan\n`);

  for (const user of users) {
    const userId = user.id;
    const schema = user.schema_name;

    // Set search_path first, then query separately
    await pgSql.unsafe(`SET search_path TO ${schema}, public`);

    // Find entity names that appear under multiple types
    const duplicates = await pgSql.unsafe<
      Array<{ lower_name: string; type_count: string }>
    >(`
      SELECT lower(name) AS lower_name, COUNT(DISTINCT type)::text AS type_count
      FROM entities
      WHERE _deleted_at IS NULL
      GROUP BY lower(name)
      HAVING COUNT(DISTINCT type) > 1
      ORDER BY COUNT(DISTINCT type) DESC, lower(name)
    `);

    if (duplicates.length === 0) {
      console.log(`User ${userId}: no cross-type duplicates found`);
      continue;
    }

    console.log(`User ${userId}: ${duplicates.length} cross-type duplicate groups\n`);

    const groups: DuplicateGroup[] = [];

    for (const dup of duplicates) {
      const entities = await pgSql.unsafe<
        Array<{ id: number; type: string; name: string; mention_count: number; confidence: number }>
      >(`
        SELECT id, type, name, mention_count, confidence
        FROM entities
        WHERE lower(name) = $1
          AND _deleted_at IS NULL
        ORDER BY confidence DESC, mention_count DESC
      `, [dup.lower_name]);

      // Recommend merge if all entities share exact same name (case-insensitive)
      const uniqueNames = new Set(entities.map(e => e.name.toLowerCase()));
      const recommendation = uniqueNames.size === 1 ? 'merge' : 'review';

      const group: DuplicateGroup = {
        name: entities[0].name,
        entities: entities.map(e => ({
          id: e.id,
          type: e.type,
          mentionCount: e.mention_count,
          confidence: e.confidence,
        })),
        recommendation,
      };

      groups.push(group);

      // Print human-readable output
      const recBadge = recommendation === 'merge' ? '[MERGE]' : '[REVIEW]';
      console.log(`  ${recBadge} "${group.name}"`);
      for (const e of group.entities) {
        console.log(`    - id=${e.id} type=${e.type} mentions=${e.mentionCount} confidence=${e.confidence}`);
      }
    }

    // Output JSON report
    const report = { userId, schema, groups };
    console.log(`\nJSON Report for ${userId}:`);
    console.log(JSON.stringify(report, null, 2));
  }

  // Reset search_path
  await pgSql.unsafe('SET search_path TO public');
  await closeDatabase();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
