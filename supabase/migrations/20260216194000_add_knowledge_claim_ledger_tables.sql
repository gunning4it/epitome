-- Add append-only claim ledger tables to each user schema.
-- Includes a helper function for bootstrap and applies it to existing users.

CREATE OR REPLACE FUNCTION public.ensure_user_knowledge_ledger_tables(
  p_schema_name VARCHAR
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_schema_name IS NULL OR p_schema_name !~ '^user_[a-z0-9]+$' THEN
    RAISE EXCEPTION 'Invalid user schema: %', p_schema_name;
  END IF;

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I.knowledge_claims (
      id BIGSERIAL PRIMARY KEY,
      claim_type VARCHAR(50) NOT NULL,
      subject JSONB NOT NULL DEFAULT ''{}''::jsonb,
      predicate VARCHAR(200) NOT NULL,
      object JSONB NOT NULL DEFAULT ''{}''::jsonb,
      confidence REAL NOT NULL DEFAULT 0.5
        CHECK (confidence >= 0 AND confidence <= 1),
      status VARCHAR(20) NOT NULL DEFAULT ''proposed''
        CHECK (status IN (''proposed'', ''active'', ''superseded'', ''rejected'', ''review'')),
      method VARCHAR(50) NOT NULL DEFAULT ''unknown'',
      origin VARCHAR(20)
        CHECK (origin IS NULL OR origin IN (''user_stated'', ''user_typed'', ''ai_stated'', ''ai_inferred'', ''ai_pattern'', ''imported'', ''system'')),
      source_ref VARCHAR(200),
      write_id VARCHAR(100),
      agent_id VARCHAR(100),
      model VARCHAR(200),
      memory_meta_id INTEGER REFERENCES %I.memory_meta(id) ON DELETE SET NULL,
      valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      valid_to TIMESTAMPTZ,
      superseded_by BIGINT REFERENCES %I.knowledge_claims(id) ON DELETE SET NULL,
      metadata JSONB NOT NULL DEFAULT ''{}''::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )',
    p_schema_name,
    p_schema_name,
    p_schema_name
  );

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I.knowledge_claim_events (
      id BIGSERIAL PRIMARY KEY,
      claim_id BIGINT NOT NULL REFERENCES %I.knowledge_claims(id) ON DELETE CASCADE,
      event_type VARCHAR(40) NOT NULL
        CHECK (event_type IN (''created'', ''promoted'', ''demoted'', ''superseded'', ''rejected'', ''reopened'', ''confidence_changed'', ''evidence_added'', ''contradiction_detected'', ''resolved'')),
      from_status VARCHAR(20),
      to_status VARCHAR(20),
      actor_type VARCHAR(20) NOT NULL DEFAULT ''system'',
      actor_id VARCHAR(100),
      reason TEXT,
      old_confidence REAL,
      new_confidence REAL,
      payload JSONB NOT NULL DEFAULT ''{}''::jsonb,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )',
    p_schema_name,
    p_schema_name
  );

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I.knowledge_claim_evidence (
      id BIGSERIAL PRIMARY KEY,
      claim_id BIGINT NOT NULL REFERENCES %I.knowledge_claims(id) ON DELETE CASCADE,
      evidence_type VARCHAR(40) NOT NULL
        CHECK (evidence_type IN (''table_row'', ''vector'', ''profile_version'', ''extraction'', ''artifact'', ''memory_meta'', ''manual'')),
      source_ref VARCHAR(200),
      table_name VARCHAR(100),
      record_id BIGINT,
      vector_id BIGINT,
      profile_version INTEGER,
      confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
      extraction_artifact JSONB NOT NULL DEFAULT ''{}''::jsonb,
      metadata JSONB NOT NULL DEFAULT ''{}''::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )',
    p_schema_name,
    p_schema_name
  );

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I.context_feedback (
      id BIGSERIAL PRIMARY KEY,
      context_key VARCHAR(200) NOT NULL,
      intent VARCHAR(200),
      token_budget INTEGER,
      time_horizon VARCHAR(50),
      strictness VARCHAR(20),
      resources JSONB NOT NULL DEFAULT ''{}''::jsonb,
      served_claim_ids BIGINT[] NOT NULL DEFAULT ''{}''::BIGINT[],
      feedback VARCHAR(20) NOT NULL
        CHECK (feedback IN (''used'', ''partially_used'', ''corrected'', ''rejected'', ''ignored'')),
      correction JSONB NOT NULL DEFAULT ''{}''::jsonb,
      agent_id VARCHAR(100),
      model VARCHAR(200),
      source_ref VARCHAR(200),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )',
    p_schema_name
  );

  EXECUTE format('ALTER TABLE %I.memory_meta ADD COLUMN IF NOT EXISTS claim_id BIGINT', p_schema_name);

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_knowledge_claims_status ON %I.knowledge_claims(status)',
    p_schema_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_knowledge_claims_confidence ON %I.knowledge_claims(confidence DESC)',
    p_schema_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_knowledge_claims_source_ref ON %I.knowledge_claims(source_ref)',
    p_schema_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_knowledge_claims_write_id ON %I.knowledge_claims(write_id)',
    p_schema_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_knowledge_claims_subject_gin ON %I.knowledge_claims USING gin(subject jsonb_path_ops)',
    p_schema_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_knowledge_claims_object_gin ON %I.knowledge_claims USING gin(object jsonb_path_ops)',
    p_schema_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_knowledge_claims_valid_from ON %I.knowledge_claims(valid_from DESC)',
    p_schema_name
  );

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_knowledge_claim_events_claim_id ON %I.knowledge_claim_events(claim_id, occurred_at DESC)',
    p_schema_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_knowledge_claim_events_type ON %I.knowledge_claim_events(event_type, occurred_at DESC)',
    p_schema_name
  );

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_knowledge_claim_evidence_claim_id ON %I.knowledge_claim_evidence(claim_id)',
    p_schema_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_knowledge_claim_evidence_type ON %I.knowledge_claim_evidence(evidence_type)',
    p_schema_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_knowledge_claim_evidence_source_ref ON %I.knowledge_claim_evidence(source_ref)',
    p_schema_name
  );

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_context_feedback_context_key ON %I.context_feedback(context_key)',
    p_schema_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_context_feedback_created_at ON %I.context_feedback(created_at DESC)',
    p_schema_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_context_feedback_feedback ON %I.context_feedback(feedback)',
    p_schema_name
  );

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_memory_meta_claim_id ON %I.memory_meta(claim_id)',
    p_schema_name
  );
END;
$$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schema_name
    FROM public.users
    WHERE schema_name ~ '^user_[a-z0-9]+$'
  LOOP
    PERFORM public.ensure_user_knowledge_ledger_tables(r.schema_name);
  END LOOP;
END;
$$;
