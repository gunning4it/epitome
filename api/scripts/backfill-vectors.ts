/**
 * One-time backfill: vectorize existing profile + table records
 *
 * Run on staging via:
 *   fly ssh console --app epitome-staging-api -C "node -e \"require('./dist/index.js')\""
 *   (or directly with npx tsx)
 *
 * This script:
 * 1. Finds all user schemas
 * 2. For each user, vectorizes the current profile snapshot
 * 3. For each user table with records, vectorizes each record
 */

import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY not set');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { ssl: 'require' });

async function generateEmbedding(text: string): Promise<number[]> {
  const model = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ input: text, model }),
  });
  if (!res.ok) throw new Error(`Embedding API error: ${await res.text()}`);
  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}

async function addVectorDirect(
  schema: string,
  collection: string,
  text: string,
  metadata: Record<string, unknown>
) {
  const embedding = await generateEmbedding(text);

  await sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL search_path TO "${schema}", public`);

    // Ensure collection exists
    const exists = await tx.unsafe(
      `SELECT EXISTS (SELECT 1 FROM _vector_collections WHERE collection = $1) as exists`,
      [collection]
    );
    if (!exists[0].exists) {
      await tx.unsafe(
        `INSERT INTO _vector_collections (collection, description, entry_count, embedding_dim, created_at, updated_at)
         VALUES ($1, $2, 0, $3, NOW(), NOW())`,
        [collection, null, embedding.length]
      );
    }

    // Create memory_meta (matches createMemoryMetaInternal production shape)
    const metaRows = await tx.unsafe(
      `INSERT INTO memory_meta (
        source_type, source_ref, origin, agent_source,
        confidence, status, access_count,
        contradictions, promote_history, created_at
      ) VALUES (
        'vector', $1, 'ai_stated', 'backfill',
        0.6, 'active', 0,
        '[]', '[]', NOW()
      ) RETURNING id`,
      [`${collection}:backfill`]
    );
    const metaId = metaRows[0].id;

    // Insert vector (metadata passed as object — postgres.js serializes for JSONB)
    await tx.unsafe(
      `INSERT INTO vectors (collection, text, embedding, metadata, created_at, _meta_id)
       VALUES ($1, $2, $3, $4, NOW(), $5)`,
      [collection, text, JSON.stringify(embedding), JSON.stringify(metadata), metaId]
    );

    // Update collection count
    await tx.unsafe(
      `UPDATE _vector_collections SET entry_count = entry_count + 1, updated_at = NOW() WHERE collection = $1`,
      [collection]
    );
  });
}

async function backfill() {
  // Find user schemas
  const schemas = await sql`
    SELECT schema_name FROM information_schema.schemata
    WHERE schema_name LIKE 'user_%'
    ORDER BY schema_name
  `;
  console.log(`Found ${schemas.length} user schema(s)`);

  for (const { schema_name: schema } of schemas) {
    const userId = schema.replace('user_', '').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
    console.log(`\nProcessing ${schema} (user: ${userId})`);

    // Check if vectors already exist
    const vecCount = await sql.unsafe(
      `SELECT COUNT(*) as c FROM "${schema}".vectors WHERE _deleted_at IS NULL`
    );
    if (Number(vecCount[0].c) > 0) {
      console.log(`  Skipping — already has ${vecCount[0].c} vectors`);
      continue;
    }

    // 1. Vectorize current profile
    const profile = await sql.unsafe(
      `SELECT data, version, changed_at FROM "${schema}".profile ORDER BY version DESC LIMIT 1`
    );
    if (profile.length > 0 && profile[0].data) {
      const data = profile[0].data as Record<string, unknown>;
      // Create a comprehensive profile summary
      const parts: string[] = [];
      if (data.name) parts.push(`Name: ${data.name}`);
      if (data.timezone) parts.push(`Timezone: ${data.timezone}`);

      if (data.family && typeof data.family === 'object') {
        const fam = data.family as Record<string, { name?: string; birthday?: string; [k: string]: unknown }>;
        for (const [relation, info] of Object.entries(fam)) {
          const details = [info.name, info.birthday ? `birthday ${info.birthday}` : ''].filter(Boolean).join(', ');
          parts.push(`Family - ${relation}: ${details}`);
        }
      }

      if (data.health && typeof data.health === 'object') {
        const h = data.health as Record<string, unknown>;
        if (Array.isArray(h.conditions)) parts.push(`Health conditions: ${h.conditions.join(', ')}`);
        if (Array.isArray(h.dietary_goals)) parts.push(`Dietary goals: ${h.dietary_goals.join(', ')}`);
      }

      if (data.preferences && typeof data.preferences === 'object') {
        const p = data.preferences as Record<string, unknown>;
        if (p.food && typeof p.food === 'object') {
          const food = p.food as Record<string, unknown>;
          if (Array.isArray(food.favorites)) parts.push(`Favorite foods: ${food.favorites.join(', ')}`);
          if (food.regional_style) parts.push(`Food style: ${food.regional_style}`);
        }
      }

      const summaryText = `Profile: ${parts.join('. ')}`;
      console.log(`  Vectorizing profile (${summaryText.length} chars)...`);
      await addVectorDirect(schema, 'profile', summaryText, {
        source: 'backfill',
        version: profile[0].version,
      });
      console.log(`  ✓ Profile vectorized`);
    }

    // 2. Vectorize table records
    const tables = await sql.unsafe(
      `SELECT table_name, description FROM "${schema}"._table_registry`
    );
    for (const table of tables) {
      const records = await sql.unsafe(
        `SELECT * FROM "${schema}"."${table.table_name}" WHERE _deleted_at IS NULL`
      );
      console.log(`  Table "${table.table_name}": ${records.length} record(s)`);

      for (const record of records) {
        const fields = Object.entries(record)
          .filter(([k]) => !k.startsWith('_') && k !== 'id' && k !== 'created_at' && k !== 'updated_at')
          .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
          .join(', ');
        const memoryText = `${table.table_name}: ${fields}`;
        console.log(`    Vectorizing record ${record.id} (${memoryText.length} chars)...`);
        await addVectorDirect(schema, table.table_name, memoryText, {
          source: 'backfill',
          table: table.table_name,
          record_id: record.id,
        });
        console.log(`    ✓ Record ${record.id} vectorized`);
      }
    }
  }

  console.log('\nBackfill complete!');
  await sql.end();
}

backfill().catch((e) => {
  console.error('Backfill failed:', e);
  process.exit(1);
});
