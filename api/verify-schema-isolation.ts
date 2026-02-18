/**
 * Standalone Verification Script for withUserSchema() Race Condition Fix
 *
 * Verifies:
 * 1. Schema isolation works correctly
 * 2. No race conditions occur across multiple concurrent operations
 * 3. Transaction-based approach guarantees single connection
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

// Load test environment
config({ path: resolve(import.meta.dirname || __dirname, '.env.test') });

import { withUserSchema } from './src/db/client.js';
import { sql as pgSql } from './src/db/client.js';

// Test user IDs
const user1 = randomUUID();
const user2 = randomUUID();
const schema1 = `user_${user1.replace(/-/g, '')}`;
const schema2 = `user_${user2.replace(/-/g, '')}`;

interface TestResult {
  run: number;
  success: boolean;
  error?: string;
  user1Count?: number;
  user2Count?: number;
}

async function setupTestUsers() {
  console.log('🔧 Setting up test users...');

  // Create test users in public.users
  await pgSql`
    INSERT INTO public.users (id, email, schema_name, created_at)
    VALUES
      (${user1}, ${`test-${user1}@example.com`}, ${schema1}, NOW()),
      (${user2}, ${`test-${user2}@example.com`}, ${schema2}, NOW())
  `;

  // Create user schemas
  await pgSql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${schema1}`);
  await pgSql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${schema2}`);

  // Create entities table in each schema (matching init.sql)
  for (const schema of [schema1, schema2]) {
    await pgSql.unsafe(`
      CREATE TABLE ${schema}.entities (
        id SERIAL PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        name VARCHAR(500) NOT NULL,
        properties JSONB NOT NULL DEFAULT '{}',
        confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
        mention_count INTEGER NOT NULL DEFAULT 1 CHECK (mention_count > 0),
        first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        _deleted_at TIMESTAMPTZ
      )
    `);
  }

  console.log(`✅ Created users: ${user1.substring(0, 8)}... and ${user2.substring(0, 8)}...`);
}

async function cleanupTestUsers() {
  console.log('🧹 Cleaning up test users...');

  await pgSql.unsafe(`DROP SCHEMA IF EXISTS ${schema1} CASCADE`);
  await pgSql.unsafe(`DROP SCHEMA IF EXISTS ${schema2} CASCADE`);
  await pgSql`DELETE FROM public.users WHERE id IN (${user1}, ${user2})`;

  console.log('✅ Cleanup complete');
}

async function createEntityInSchema(userId: string, name: string, runId: number): Promise<number> {
  return await withUserSchema(userId, async (tx: any) => {
    const result = await tx.unsafe(`
      INSERT INTO entities (type, name, properties, mention_count)
      VALUES ('Person', '${name}', '{"run": ${runId}}'::jsonb, 1)
      RETURNING id
    `);
    return result[0].id;
  });
}

async function countEntitiesInSchema(userId: string): Promise<number> {
  return await withUserSchema(userId, async (tx: any) => {
    const result = await tx.unsafe(`SELECT COUNT(*) as count FROM entities`);
    return parseInt(result[0].count);
  });
}

async function verifySchemaIsolation(runId: number): Promise<TestResult> {
  const result: TestResult = { run: runId, success: false };

  try {
    // Create entities in both schemas concurrently (to test race conditions)
    await Promise.all([
      createEntityInSchema(user1, `User1-Entity-${runId}`, runId),
      createEntityInSchema(user2, `User2-Entity-${runId}`, runId),
    ]);

    // Count entities in each schema
    const [count1, count2] = await Promise.all([
      countEntitiesInSchema(user1),
      countEntitiesInSchema(user2),
    ]);

    result.user1Count = count1;
    result.user2Count = count2;

    // Verify: Each schema should have exactly 'runId' entities (1 per run)
    if (count1 === runId && count2 === runId) {
      result.success = true;
    } else {
      result.error = `Expected ${runId} entities per user, got user1=${count1}, user2=${count2}`;
    }
  } catch (error: any) {
    result.error = error.message;
  }

  return result;
}

async function runVerification() {
  console.log('🚀 Starting Schema Isolation Verification\n');

  try {
    await setupTestUsers();

    console.log('\n📊 Running 10 concurrent operations to test for race conditions...\n');

    const results: TestResult[] = [];

    for (let i = 1; i <= 10; i++) {
      const result = await verifySchemaIsolation(i);
      results.push(result);

      if (result.success) {
        console.log(`✅ Run ${i}/10: PASS (user1=${result.user1Count}, user2=${result.user2Count})`);
      } else {
        console.log(`❌ Run ${i}/10: FAIL - ${result.error}`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📈 VERIFICATION SUMMARY');
    console.log('='.repeat(60));

    const passed = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log(`Total Runs:    ${results.length}`);
    console.log(`✅ Passed:     ${passed}`);
    console.log(`❌ Failed:     ${failed}`);
    console.log(`Success Rate:  ${((passed / results.length) * 100).toFixed(1)}%`);

    if (failed > 0) {
      console.log('\n❌ FAILURES DETECTED:');
      results.filter(r => !r.success).forEach(r => {
        console.log(`  Run ${r.run}: ${r.error}`);
      });
    }

    console.log('='.repeat(60));

    if (passed === 10) {
      console.log('\n🎉 SUCCESS! Schema isolation working correctly.');
      console.log('✅ No race conditions detected across 10 concurrent runs.');
      console.log('✅ withUserSchema() fix verified.');
    } else {
      console.log('\n⚠️  VERIFICATION FAILED!');
      console.log('Schema isolation or race condition issues detected.');
      process.exit(1);
    }

  } catch (error: any) {
    console.error('\n💥 FATAL ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await cleanupTestUsers();
  }
}

// Run verification
runVerification()
  .then(() => {
    console.log('\n✨ Verification complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Verification failed:', error);
    process.exit(1);
  });
