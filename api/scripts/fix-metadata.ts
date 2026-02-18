/**
 * Fix double-serialized JSONB metadata in vectors table
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function fix() {
  const schemas = await sql`
    SELECT schema_name FROM information_schema.schemata
    WHERE schema_name LIKE 'user_%'
  `;

  for (const { schema_name } of schemas) {
    const fixed = await sql.unsafe(
      `UPDATE "${schema_name}".vectors
       SET metadata = (metadata #>> '{}')::jsonb
       WHERE jsonb_typeof(metadata) = 'string'
       RETURNING id, jsonb_typeof(metadata) as jtyp`
    );
    console.log(`${schema_name}: fixed ${fixed.length} vectors`);
    for (const r of fixed) {
      console.log(`  id=${r.id} now jsonb_typeof=${r.jtyp}`);
    }
  }

  await sql.end();
}

fix().catch((e) => { console.error(e); process.exit(1); });
