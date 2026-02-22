/**
 * Reclassify Mistyped Entities + Fix Reversed Edges
 *
 * 1. Finds entities that are targets of works_at/attended but aren't typed
 *    as 'organization' (or 'event' for attended). Skips 'person' entities —
 *    those indicate reversed edges, not wrong entity types.
 *
 * 2. Fixes reversed attended/works_at edges where source is an event/org
 *    and target is a person (swaps source_id and target_id, or soft-deletes
 *    if a correct edge already exists).
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

/**
 * Low-signal names that should be soft-deleted rather than reclassified.
 * Mirrors LOW_SIGNAL_NAMES from entityExtraction.ts.
 */
const LOW_SIGNAL_NAMES = new Set([
  'add_record', 'save_memory', 'mcp_add_record', 'mcp_save_memory',
  'unknown', 'none', 'null', 'undefined', 'value', 'test',
  'true', 'false', 'yes', 'no', 'n/a',
  'user', 'profile', 'data', 'record', 'entry', 'item', 'thing',
  'update', 'note', 'notes', 'info', 'general', 'other', 'misc',
  'default', 'new', 'old', 'current', 'previous', 'latest',
]);

/**
 * Check if an entity name should be dropped (soft-deleted) instead of reclassified.
 * Matches the logic from shouldDropExtractedEntity() in entityExtraction.ts.
 */
function shouldDropEntity(name: string): boolean {
  const lower = name.toLowerCase().trim();
  if (!lower || lower.length < 2 || lower.length > 120) return true;
  if (LOW_SIGNAL_NAMES.has(lower)) return true;
  // snake_case system identifiers
  if (/^[a-z]+(?:_[a-z0-9]+)+$/.test(lower) && !lower.includes(' ')) return true;
  // System/metadata prefix
  if (/^(profile|table|collection|vector|memory|audit|system)\b/i.test(lower)) return true;
  // Pure numeric
  if (/^\d+$/.test(lower)) return true;
  return false;
}

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

interface ReversedEdge {
  id: number;
  source_id: number;
  target_id: number;
  source_name: string;
  source_type: string;
  target_name: string;
  target_type: string;
  relation: string;
  has_correct: boolean;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  console.log('=== Reclassify Mistyped Entities + Fix Reversed Edges ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Started at ${new Date().toISOString()}\n`);

  const users = await sql<UserRow[]>`
    SELECT id, schema_name FROM public.users
    WHERE schema_name LIKE 'user_%'
    ORDER BY schema_name
  `;

  let totalReclassified = 0;
  let totalReclassifiedFound = 0;
  let totalReversedFixed = 0;
  let totalReversedFound = 0;
  let totalSoftDeleted = 0;

  for (const user of users) {
    try {
      // --- Phase 1: Fix reversed edges ---
      const reversed = await withUserSchema(user.id, async (tx) => {
        // Edges where source is event/org and target is person for attended/works_at
        return await tx.unsafe<ReversedEdge[]>(`
          SELECT e.id, e.source_id, e.target_id,
                 s.name as source_name, s.type as source_type,
                 t.name as target_name, t.type as target_type,
                 e.relation,
                 EXISTS (
                   SELECT 1 FROM edges e2
                   WHERE e2.source_id = e.target_id
                     AND e2.target_id = e.source_id
                     AND e2.relation = e.relation
                     AND e2._deleted_at IS NULL
                 ) as has_correct
          FROM edges e
          JOIN entities s ON s.id = e.source_id
          JOIN entities t ON t.id = e.target_id
          WHERE e.relation IN ('attended', 'works_at')
            AND s.type IN ('event', 'organization')
            AND t.type = 'person'
            AND e._deleted_at IS NULL
            AND s._deleted_at IS NULL
            AND t._deleted_at IS NULL
        `);
      });

      if (reversed.length > 0) {
        totalReversedFound += reversed.length;
        for (const edge of reversed) {
          if (edge.has_correct) {
            // Correct edge already exists — soft-delete the reversed one
            if (dryRun) {
              console.log(`  [DRY] ${user.schema_name}: DELETE reversed edge #${edge.id} [${edge.source_type}] ${edge.source_name} --${edge.relation}--> [${edge.target_type}] ${edge.target_name} (correct edge exists)`);
            } else {
              await withUserSchema(user.id, async (tx) => {
                await tx.unsafe(`UPDATE edges SET _deleted_at = NOW() WHERE id = $1`, [edge.id]);
              });
              console.log(`  DELETED reversed edge #${edge.id}: ${edge.source_name} --${edge.relation}--> ${edge.target_name}`);
              totalReversedFixed++;
            }
          } else {
            // No correct edge — swap source and target
            if (dryRun) {
              console.log(`  [DRY] ${user.schema_name}: SWAP reversed edge #${edge.id} [${edge.source_type}] ${edge.source_name} --${edge.relation}--> [${edge.target_type}] ${edge.target_name}`);
            } else {
              await withUserSchema(user.id, async (tx) => {
                await tx.unsafe(
                  `UPDATE edges SET source_id = $1, target_id = $2 WHERE id = $3`,
                  [edge.target_id, edge.source_id, edge.id]
                );
              });
              console.log(`  SWAPPED edge #${edge.id}: now ${edge.target_name} --${edge.relation}--> ${edge.source_name}`);
              totalReversedFixed++;
            }
          }
        }
      }

      // --- Phase 2: Reclassify non-person mistyped entities ---
      const mistyped = await withUserSchema(user.id, async (tx) => {
        // Find entities that are targets of works_at but not typed 'organization'
        // Exclude 'person' — those are reversed edge issues, not type issues
        const worksAtTargets = await tx.unsafe<MistypedEntity[]>(`
          SELECT DISTINCT t.id, t.name, t.type, e.relation
          FROM edges e
          JOIN entities t ON t.id = e.target_id
          WHERE e.relation = 'works_at'
            AND t.type NOT IN ('organization', 'person')
            AND t._deleted_at IS NULL
            AND e._deleted_at IS NULL
        `);

        // Find entities that are targets of attended but not typed 'organization' or 'event'
        // Exclude 'person' — those are reversed edge issues, not type issues
        const attendedTargets = await tx.unsafe<MistypedEntity[]>(`
          SELECT DISTINCT t.id, t.name, t.type, e.relation
          FROM edges e
          JOIN entities t ON t.id = e.target_id
          WHERE e.relation = 'attended'
            AND t.type NOT IN ('organization', 'event', 'person')
            AND t._deleted_at IS NULL
            AND e._deleted_at IS NULL
        `);

        return [...worksAtTargets, ...attendedTargets];
      });

      if (mistyped.length === 0) continue;

      totalReclassifiedFound += mistyped.length;

      for (const entity of mistyped) {
        // Safety check: if the entity name is low-signal junk, soft-delete instead of reclassifying
        if (shouldDropEntity(entity.name)) {
          if (dryRun) {
            console.log(`  [DRY] ${user.schema_name}: SOFT-DELETE "${entity.name}" (low-signal name, would be dropped by extraction filter)`);
          } else {
            await withUserSchema(user.id, async (tx) => {
              await tx.unsafe(
                `UPDATE entities SET _deleted_at = NOW() WHERE id = $1`,
                [entity.id]
              );
            });
            console.log(`  SOFT-DELETED ${user.schema_name}: "${entity.name}" (low-signal name)`);
            totalSoftDeleted++;
          }
          continue;
        }

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
          totalReclassified++;
        }
      }
    } catch (error) {
      console.error(`  ERROR processing user ${user.id}: ${String(error)}`);
    }
  }

  console.log('\n=== Results ===');
  console.log(`Reversed edges found: ${totalReversedFound}`);
  console.log(`Reversed edges fixed: ${dryRun ? '0 (dry run)' : totalReversedFixed}`);
  console.log(`Mistyped entities found: ${totalReclassifiedFound}`);
  console.log(`Entities soft-deleted (low-signal): ${dryRun ? '0 (dry run)' : totalSoftDeleted}`);
  console.log(`Entities reclassified: ${dryRun ? '0 (dry run)' : totalReclassified}`);
  console.log(`Finished at ${new Date().toISOString()}`);

  await sql.end();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
