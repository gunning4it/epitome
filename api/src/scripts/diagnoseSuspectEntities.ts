/**
 * Diagnose Suspect Entities
 *
 * Audits entities to find problematic ones across categories:
 * - Role-artifact entities (system/metadata names)
 * - Meta-nodes (profile, table_registry, system)
 * - Owner contamination (owner entity with family member name)
 * - Orphan entities (no edges)
 * - Duplicate candidates (similar names, same type)
 *
 * Always dry-run — never modifies data.
 *
 * Usage:
 *   npx tsx api/src/scripts/diagnoseSuspectEntities.ts [--user-id <id>]
 */

import { sql, withUserSchema } from '@/db/client';

interface UserRow {
  id: string;
  schema_name: string;
}

interface SuspectEntity {
  id: number;
  name: string;
  type: string;
  category: string;
  reason: string;
  confidence: number;
}

const SYSTEM_META_NAMES = new Set([
  'user', 'profile', 'data', 'record', 'entry', 'item', 'thing',
  'update', 'note', 'notes', 'info', 'general', 'other', 'misc',
  'default', 'new', 'old', 'current', 'previous', 'latest',
  'add_record', 'save_memory', 'mcp_add_record', 'mcp_save_memory',
  'unknown', 'none', 'null', 'undefined', 'value', 'test',
  'true', 'false', 'yes', 'no', 'n/a',
]);

async function diagnoseUser(userId: string): Promise<SuspectEntity[]> {
  const suspects: SuspectEntity[] = [];

  await withUserSchema(userId, async (tx) => {
    // 1. Role-artifact and meta-node entities
    const entities = await tx.unsafe<Array<{
      id: number; name: string; type: string; confidence: number;
      properties: Record<string, unknown> | null;
    }>>(`
      SELECT id, name, type, confidence, properties
      FROM entities
      WHERE _deleted_at IS NULL
    `);

    for (const entity of entities) {
      const lower = entity.name.toLowerCase().trim();

      // Role-artifact: matches system/meta names
      if (SYSTEM_META_NAMES.has(lower)) {
        suspects.push({
          ...entity,
          category: 'role-artifact',
          reason: `Name "${entity.name}" matches system/metadata term`,
        });
        continue;
      }

      // System-prefix names
      if (/^(profile|table|collection|vector|memory|audit|system)\b/i.test(lower)) {
        suspects.push({
          ...entity,
          category: 'meta-node',
          reason: `Name "${entity.name}" starts with system prefix`,
        });
        continue;
      }

      // Pure numeric
      if (/^\d+$/.test(lower)) {
        suspects.push({
          ...entity,
          category: 'role-artifact',
          reason: `Name "${entity.name}" is pure numeric`,
        });
        continue;
      }
    }

    // 2. Owner contamination: owner entity with family member name
    const ownerEntities = entities.filter(
      e => e.type === 'person' && e.properties && (e.properties as any).is_owner === true
    );

    if (ownerEntities.length > 0) {
      // Get profile family data
      const profileRows = await tx.unsafe<Array<{ data: Record<string, unknown> }>>(`
        SELECT data FROM profile ORDER BY version DESC LIMIT 1
      `);
      const profileData = profileRows[0]?.data;
      if (profileData) {
        const familyNames = new Set<string>();
        const family = profileData.family;
        if (family) {
          const members: Array<Record<string, unknown>> = [];
          if (Array.isArray(family)) {
            for (const m of family) {
              if (m && typeof m === 'object') members.push(m as Record<string, unknown>);
            }
          } else if (typeof family === 'object') {
            for (const [, val] of Object.entries(family as Record<string, unknown>)) {
              if (Array.isArray(val)) {
                for (const m of val) {
                  if (m && typeof m === 'object') members.push(m as Record<string, unknown>);
                }
              }
            }
          }
          for (const member of members) {
            if (member.name && typeof member.name === 'string') {
              familyNames.add(member.name.toLowerCase());
              familyNames.add(member.name.split(' ')[0].toLowerCase());
            }
            if (member.nickname && typeof member.nickname === 'string') {
              familyNames.add(member.nickname.toLowerCase());
            }
          }
        }

        for (const owner of ownerEntities) {
          if (familyNames.has(owner.name.toLowerCase())) {
            suspects.push({
              ...owner,
              category: 'owner-contamination',
              reason: `Owner entity "${owner.name}" matches family member name`,
            });
          }
        }
      }
    }

    // 3. Orphan entities (no edges)
    const orphans = await tx.unsafe<Array<{ id: number; name: string; type: string; confidence: number }>>(`
      SELECT e.id, e.name, e.type, e.confidence
      FROM entities e
      LEFT JOIN edges src ON e.id = src.source_id AND src._deleted_at IS NULL
      LEFT JOIN edges tgt ON e.id = tgt.target_id AND tgt._deleted_at IS NULL
      WHERE e._deleted_at IS NULL
        AND src.id IS NULL
        AND tgt.id IS NULL
    `);

    for (const orphan of orphans) {
      suspects.push({
        ...orphan,
        category: 'orphan',
        reason: `Entity "${orphan.name}" has no edges`,
      });
    }

    // 4. Duplicate candidates (similar names, same type)
    const dupes = await tx.unsafe<Array<{
      id1: number; name1: string; id2: number; name2: string;
      type: string; sim: number;
    }>>(`
      SELECT
        a.id as id1, a.name as name1,
        b.id as id2, b.name as name2,
        a.type,
        similarity(a.name, b.name) as sim
      FROM entities a
      JOIN entities b ON a.type = b.type AND a.id < b.id
      WHERE a._deleted_at IS NULL AND b._deleted_at IS NULL
        AND similarity(a.name, b.name) > 0.8
      ORDER BY sim DESC
      LIMIT 50
    `);

    for (const dupe of dupes) {
      suspects.push({
        id: dupe.id1,
        name: `${dupe.name1} / ${dupe.name2}`,
        type: dupe.type,
        category: 'duplicate-candidate',
        reason: `"${dupe.name1}" (id=${dupe.id1}) similar to "${dupe.name2}" (id=${dupe.id2}) at ${(dupe.sim * 100).toFixed(0)}%`,
        confidence: dupe.sim,
      });
    }
  });

  return suspects;
}

async function main(): Promise<void> {
  const userIdArg = process.argv.indexOf('--user-id');
  const targetUserId = userIdArg >= 0 ? process.argv[userIdArg + 1] : null;

  console.log('=== Diagnose Suspect Entities ===');
  console.log(`Mode: DRY RUN (always read-only)`);
  if (targetUserId) console.log(`Scoped to user: ${targetUserId}`);
  console.log(`Started at ${new Date().toISOString()}\n`);

  let users: UserRow[];
  if (targetUserId) {
    users = await sql<UserRow[]>`
      SELECT id, schema_name FROM public.users WHERE id = ${targetUserId}
    `;
  } else {
    users = await sql<UserRow[]>`
      SELECT id, schema_name FROM public.users
      WHERE schema_name LIKE 'user_%'
      ORDER BY schema_name
    `;
  }

  console.log(`Found ${users.length} user(s) to audit\n`);

  const categoryCounts: Record<string, number> = {};
  let totalSuspects = 0;

  for (const user of users) {
    try {
      const suspects = await diagnoseUser(user.id);
      if (suspects.length > 0) {
        console.log(`--- User ${user.schema_name} (${user.id}): ${suspects.length} suspect(s) ---`);
        for (const s of suspects) {
          console.log(`  [${s.category}] ${s.reason}`);
          categoryCounts[s.category] = (categoryCounts[s.category] || 0) + 1;
        }
        totalSuspects += suspects.length;
      }
    } catch (err) {
      console.error(`Error processing ${user.schema_name}: ${err}`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total suspects: ${totalSuspects}`);
  for (const [category, count] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${category}: ${count}`);
  }
  console.log(`\nCompleted at ${new Date().toISOString()}`);

  await sql.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
