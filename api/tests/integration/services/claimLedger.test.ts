import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { createKnowledgeClaim } from '@/services/claimLedger.service';
import { createTestUser, cleanupTestUser, type TestUser } from '../../helpers/db';

describe('Claim Ledger Service Integration Tests', () => {
  let testUser: TestUser;

  beforeEach(async () => {
    testUser = await createTestUser();

    await db.execute(sql.raw(`
      CREATE TABLE ${testUser.schemaName}.knowledge_claims (
        id BIGSERIAL PRIMARY KEY,
        claim_type VARCHAR(50) NOT NULL,
        subject JSONB NOT NULL DEFAULT '{}'::jsonb,
        predicate VARCHAR(200) NOT NULL,
        object JSONB NOT NULL DEFAULT '{}'::jsonb,
        confidence REAL NOT NULL DEFAULT 0.5,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        method VARCHAR(50) NOT NULL DEFAULT 'deterministic',
        origin VARCHAR(20),
        source_ref VARCHAR(200),
        write_id VARCHAR(100),
        agent_id VARCHAR(100),
        model VARCHAR(200),
        memory_meta_id INTEGER REFERENCES ${testUser.schemaName}.memory_meta(id) ON DELETE SET NULL,
        valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        valid_to TIMESTAMPTZ,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));

    await db.execute(sql.raw(`
      CREATE TABLE ${testUser.schemaName}.knowledge_claim_events (
        id BIGSERIAL PRIMARY KEY,
        claim_id BIGINT NOT NULL REFERENCES ${testUser.schemaName}.knowledge_claims(id) ON DELETE CASCADE,
        event_type VARCHAR(40) NOT NULL,
        from_status VARCHAR(20),
        to_status VARCHAR(20),
        actor_type VARCHAR(20) NOT NULL DEFAULT 'system',
        actor_id VARCHAR(100),
        reason TEXT,
        old_confidence REAL,
        new_confidence REAL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));

    await db.execute(sql.raw(`
      CREATE TABLE ${testUser.schemaName}.knowledge_claim_evidence (
        id BIGSERIAL PRIMARY KEY,
        claim_id BIGINT NOT NULL REFERENCES ${testUser.schemaName}.knowledge_claims(id) ON DELETE CASCADE,
        evidence_type VARCHAR(40) NOT NULL,
        source_ref VARCHAR(200),
        table_name VARCHAR(100),
        record_id BIGINT,
        vector_id BIGINT,
        profile_version INTEGER,
        confidence REAL,
        extraction_artifact JSONB NOT NULL DEFAULT '{}'::jsonb,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));
  });

  afterEach(async () => {
    await cleanupTestUser(testUser.userId);
  });

  it('should create a knowledge claim without explicit valid_from/valid_to', async () => {
    const claim = await createKnowledgeClaim(testUser.userId, {
      claimType: 'profile_update',
      subject: { kind: 'profile', path: '$' },
      predicate: 'profile_updated',
      object: { patch: { timezone: 'America/Los_Angeles' } },
      status: 'active',
      method: 'deterministic',
      origin: 'ai_stated',
      sourceRef: 'profile:v2',
      writeId: 'write-123',
      agentId: 'test-agent',
    });

    expect(Number(claim.id)).toBeGreaterThan(0);
    expect(claim.validFrom).toBeInstanceOf(Date);
    expect(claim.validTo).toBeNull();
  });

  it('should create a knowledge claim with explicit Date validity bounds', async () => {
    const validFrom = new Date('2026-02-16T20:00:00.000Z');
    const validTo = new Date('2026-03-01T00:00:00.000Z');

    const claim = await createKnowledgeClaim(testUser.userId, {
      claimType: 'profile_update',
      subject: { kind: 'profile', path: '$' },
      predicate: 'profile_updated',
      object: { patch: { timezone: 'America/New_York' } },
      validFrom,
      validTo,
      status: 'active',
      method: 'deterministic',
      origin: 'ai_stated',
      sourceRef: 'profile:v3',
      writeId: 'write-456',
      agentId: 'test-agent',
    });

    expect(claim.validFrom.toISOString()).toBe(validFrom.toISOString());
    expect(claim.validTo?.toISOString()).toBe(validTo.toISOString());
  });
});
