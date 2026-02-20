-- Sync production database with init.sql
-- Fills 3 gaps found between init.sql and production:
--   A) idempotency_ledger table (never migrated)
--   B) create_user_schema() stale since migration 7
--   C) ensure_user_edge_quarantine_table missing SET search_path

-- =====================================================
-- SECTION A: Create idempotency_ledger table
-- =====================================================
CREATE TABLE IF NOT EXISTS public.idempotency_ledger (
  user_id         UUID NOT NULL,
  tool_name       VARCHAR(64) NOT NULL,
  idempotency_key UUID NOT NULL,
  request_hash    VARCHAR(64) NOT NULL,
  status          VARCHAR(16) NOT NULL DEFAULT 'reserved',
  owner_token     UUID NOT NULL,
  response        JSONB,
  reserved_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  PRIMARY KEY (user_id, tool_name, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_cleanup
  ON public.idempotency_ledger (status, reserved_at)
  WHERE status = 'reserved';

CREATE INDEX IF NOT EXISTS idx_idempotency_completed_cleanup
  ON public.idempotency_ledger (status, completed_at)
  WHERE status = 'completed';

ALTER TABLE public.idempotency_ledger ENABLE ROW LEVEL SECURITY;

-- Revoke anon/authenticated grants (matches init.sql pattern)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.idempotency_ledger FROM anon, authenticated;
  END IF;
END $$;

-- =====================================================
-- SECTION B: Replace create_user_schema() function
-- =====================================================
-- Brings the function up to date with init.sql.
-- Adds: knowledge_claims + events + evidence, context_feedback,
--        edge_quarantine, claim_id on memory_meta, full audit_log CHECK.
-- Only affects NEW user signups. Existing users already patched by ensure_* helpers.

CREATE OR REPLACE FUNCTION public.create_user_schema(
  p_schema_name VARCHAR,
  p_embedding_dim INTEGER DEFAULT 1536
)
RETURNS void AS $$
BEGIN
  -- Create isolated schema
  EXECUTE format('CREATE SCHEMA %I', p_schema_name);
  EXECUTE format('SET search_path TO %I, public', p_schema_name);

  -- Schema version tracking
  CREATE TABLE _schema_version (
    version     INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  INSERT INTO _schema_version (version, description) VALUES (1, 'Initial schema');

  -- Profile (versioned JSONB)
  CREATE TABLE profile (
    id              SERIAL PRIMARY KEY,
    data            JSONB NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    changed_by      VARCHAR(100),
    changed_fields  JSONB,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _meta_id        INTEGER
  );
  CREATE UNIQUE INDEX idx_profile_version ON profile(version);
  CREATE INDEX idx_profile_latest ON profile(version DESC);

  -- Memory metadata (must exist before tables that reference it)
  CREATE TABLE memory_meta (
    id              SERIAL PRIMARY KEY,
    source_type     VARCHAR(20) NOT NULL
                      CHECK (source_type IN ('table','vector','profile','entity','edge')),
    source_ref      VARCHAR(200) NOT NULL,
    origin          VARCHAR(20) NOT NULL
                      CHECK (origin IN ('user_stated','user_typed','ai_stated','ai_inferred','ai_pattern','imported','system')),
    agent_source    VARCHAR(100),
    confidence      REAL NOT NULL DEFAULT 0.5
                      CHECK (confidence >= 0 AND confidence <= 1),
    status          VARCHAR(20) NOT NULL DEFAULT 'active'
                      CHECK (status IN ('unvetted','active','trusted','review','decayed','rejected')),
    access_count    INTEGER NOT NULL DEFAULT 0,
    last_accessed   TIMESTAMPTZ,
    last_reinforced TIMESTAMPTZ,
    contradictions  JSONB NOT NULL DEFAULT '[]',
    promote_history JSONB NOT NULL DEFAULT '[]',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX idx_meta_status ON memory_meta(status);
  CREATE INDEX idx_meta_confidence ON memory_meta(confidence DESC);
  CREATE INDEX idx_meta_source ON memory_meta(source_type, source_ref);
  CREATE INDEX idx_meta_decay_candidates ON memory_meta(last_accessed)
    WHERE status = 'active' AND origin != 'user_stated';
  CREATE INDEX idx_meta_review ON memory_meta(created_at DESC)
    WHERE status = 'review';

  -- Add FK to profile now that memory_meta exists
  ALTER TABLE profile ADD CONSTRAINT fk_profile_meta
    FOREIGN KEY (_meta_id) REFERENCES memory_meta(id);

  -- Vectors (semantic memory)
  EXECUTE format('CREATE TABLE vectors (
    id          SERIAL PRIMARY KEY,
    collection  VARCHAR(100) NOT NULL,
    text        TEXT NOT NULL,
    embedding   vector(%s) NOT NULL,
    metadata    JSONB NOT NULL DEFAULT ''{}''::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _deleted_at TIMESTAMPTZ,
    _meta_id    INTEGER REFERENCES memory_meta(id)
  )', p_embedding_dim);
  CREATE INDEX idx_vectors_collection ON vectors(collection)
    WHERE _deleted_at IS NULL;
  CREATE INDEX idx_vectors_embedding ON vectors
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
  CREATE INDEX idx_vectors_created ON vectors(created_at DESC)
    WHERE _deleted_at IS NULL;
  CREATE INDEX idx_vectors_metadata ON vectors
    USING gin (metadata jsonb_path_ops);

  -- Knowledge graph: entities
  CREATE TABLE entities (
    id            SERIAL PRIMARY KEY,
    type          VARCHAR(50) NOT NULL,
    name          VARCHAR(500) NOT NULL,
    properties    JSONB NOT NULL DEFAULT '{}',
    confidence    REAL NOT NULL DEFAULT 0.5
                    CHECK (confidence >= 0 AND confidence <= 1),
    mention_count INTEGER NOT NULL DEFAULT 1 CHECK (mention_count > 0),
    first_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _deleted_at   TIMESTAMPTZ
  );
  CREATE INDEX idx_entities_type ON entities(type)
    WHERE _deleted_at IS NULL;
  CREATE INDEX idx_entities_name_trgm ON entities
    USING gin (name gin_trgm_ops);
  CREATE UNIQUE INDEX idx_entities_type_name_unique ON entities(type, lower(name))
    WHERE _deleted_at IS NULL;
  CREATE INDEX idx_entities_confidence ON entities(confidence DESC)
    WHERE _deleted_at IS NULL;
  CREATE INDEX idx_entities_name_text ON entities
    USING gin (to_tsvector('english', name));

  -- Knowledge graph: edges
  CREATE TABLE edges (
    id          SERIAL PRIMARY KEY,
    source_id   INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    target_id   INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    relation    VARCHAR(100) NOT NULL,
    weight      REAL NOT NULL DEFAULT 1.0
                  CHECK (weight >= 0 AND weight <= 10),
    confidence  REAL NOT NULL DEFAULT 0.5
                  CHECK (confidence >= 0 AND confidence <= 1),
    evidence    JSONB NOT NULL DEFAULT '[]',
    first_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    properties  JSONB NOT NULL DEFAULT '{}',
    _deleted_at TIMESTAMPTZ
  );
  CREATE INDEX idx_edges_source ON edges(source_id);
  CREATE INDEX idx_edges_target ON edges(target_id);
  CREATE INDEX idx_edges_relation ON edges(relation);
  CREATE INDEX idx_edges_traverse ON edges(source_id, relation, target_id);
  CREATE INDEX idx_edges_traverse_rev ON edges(target_id, relation, source_id);
  CREATE UNIQUE INDEX idx_edges_unique_rel ON edges(source_id, target_id, relation);
  CREATE INDEX idx_edges_weight ON edges(weight DESC);

  -- Claim ledger (append-only claims + lifecycle + evidence + feedback)
  ALTER TABLE memory_meta ADD COLUMN claim_id BIGINT;

  CREATE TABLE knowledge_claims (
    id            BIGSERIAL PRIMARY KEY,
    claim_type    VARCHAR(50) NOT NULL,
    subject       JSONB NOT NULL DEFAULT '{}',
    predicate     VARCHAR(200) NOT NULL,
    object        JSONB NOT NULL DEFAULT '{}',
    confidence    REAL NOT NULL DEFAULT 0.5
                    CHECK (confidence >= 0 AND confidence <= 1),
    status        VARCHAR(20) NOT NULL DEFAULT 'proposed'
                    CHECK (status IN ('proposed', 'active', 'superseded', 'rejected', 'review')),
    method        VARCHAR(50) NOT NULL DEFAULT 'unknown',
    origin        VARCHAR(20)
                    CHECK (origin IS NULL OR origin IN ('user_stated','user_typed','ai_stated','ai_inferred','ai_pattern','imported','system')),
    source_ref    VARCHAR(200),
    write_id      VARCHAR(100),
    agent_id      VARCHAR(100),
    model         VARCHAR(200),
    memory_meta_id INTEGER REFERENCES memory_meta(id) ON DELETE SET NULL,
    valid_from    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_to      TIMESTAMPTZ,
    superseded_by BIGINT REFERENCES knowledge_claims(id) ON DELETE SET NULL,
    metadata      JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX idx_knowledge_claims_status ON knowledge_claims(status);
  CREATE INDEX idx_knowledge_claims_confidence ON knowledge_claims(confidence DESC);
  CREATE INDEX idx_knowledge_claims_source_ref ON knowledge_claims(source_ref);
  CREATE INDEX idx_knowledge_claims_write_id ON knowledge_claims(write_id);
  CREATE INDEX idx_knowledge_claims_subject_gin ON knowledge_claims
    USING gin (subject jsonb_path_ops);
  CREATE INDEX idx_knowledge_claims_object_gin ON knowledge_claims
    USING gin (object jsonb_path_ops);
  CREATE INDEX idx_knowledge_claims_valid_from ON knowledge_claims(valid_from DESC);
  CREATE INDEX idx_memory_meta_claim_id ON memory_meta(claim_id);

  CREATE TABLE knowledge_claim_events (
    id             BIGSERIAL PRIMARY KEY,
    claim_id       BIGINT NOT NULL REFERENCES knowledge_claims(id) ON DELETE CASCADE,
    event_type     VARCHAR(40) NOT NULL
                     CHECK (event_type IN ('created','promoted','demoted','superseded','rejected','reopened','confidence_changed','evidence_added','contradiction_detected','resolved')),
    from_status    VARCHAR(20),
    to_status      VARCHAR(20),
    actor_type     VARCHAR(20) NOT NULL DEFAULT 'system',
    actor_id       VARCHAR(100),
    reason         TEXT,
    old_confidence REAL,
    new_confidence REAL,
    payload        JSONB NOT NULL DEFAULT '{}',
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX idx_knowledge_claim_events_claim_id ON knowledge_claim_events(claim_id, occurred_at DESC);
  CREATE INDEX idx_knowledge_claim_events_type ON knowledge_claim_events(event_type, occurred_at DESC);

  CREATE TABLE knowledge_claim_evidence (
    id                  BIGSERIAL PRIMARY KEY,
    claim_id            BIGINT NOT NULL REFERENCES knowledge_claims(id) ON DELETE CASCADE,
    evidence_type       VARCHAR(40) NOT NULL
                          CHECK (evidence_type IN ('table_row','vector','profile_version','extraction','artifact','memory_meta','manual')),
    source_ref          VARCHAR(200),
    table_name          VARCHAR(100),
    record_id           BIGINT,
    vector_id           BIGINT,
    profile_version     INTEGER,
    confidence          REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    extraction_artifact JSONB NOT NULL DEFAULT '{}',
    metadata            JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX idx_knowledge_claim_evidence_claim_id ON knowledge_claim_evidence(claim_id);
  CREATE INDEX idx_knowledge_claim_evidence_type ON knowledge_claim_evidence(evidence_type);
  CREATE INDEX idx_knowledge_claim_evidence_source_ref ON knowledge_claim_evidence(source_ref);

  CREATE TABLE context_feedback (
    id               BIGSERIAL PRIMARY KEY,
    context_key      VARCHAR(200) NOT NULL,
    intent           VARCHAR(200),
    token_budget     INTEGER,
    time_horizon     VARCHAR(50),
    strictness       VARCHAR(20),
    resources        JSONB NOT NULL DEFAULT '{}',
    served_claim_ids BIGINT[] NOT NULL DEFAULT '{}',
    feedback         VARCHAR(20) NOT NULL
                       CHECK (feedback IN ('used', 'partially_used', 'corrected', 'rejected', 'ignored')),
    correction       JSONB NOT NULL DEFAULT '{}',
    agent_id         VARCHAR(100),
    model            VARCHAR(200),
    source_ref       VARCHAR(200),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX idx_context_feedback_context_key ON context_feedback(context_key);
  CREATE INDEX idx_context_feedback_created_at ON context_feedback(created_at DESC);
  CREATE INDEX idx_context_feedback_feedback ON context_feedback(feedback);

  -- Edge quarantine (holds edges that failed validation during extraction)
  CREATE TABLE edge_quarantine (
    id          SERIAL PRIMARY KEY,
    source_type VARCHAR(50),
    target_type VARCHAR(50),
    relation    VARCHAR(100),
    source_name VARCHAR(500),
    target_name VARCHAR(500),
    reason      TEXT,
    payload     JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW()
  );

  -- Audit log (partitioned)
  CREATE TABLE audit_log (
    id          BIGSERIAL,
    agent_id    VARCHAR(100) NOT NULL,
    agent_name  VARCHAR(100),
    action      VARCHAR(20) NOT NULL
                  CHECK (action IN (
                    'read','write','update','delete','search','query',
                    'graph_query','profile_read','profile_write','write_pipeline',
                    'consent_check','consent_granted','consent_revoked',
                    'all_consent_revoked','revoke_all_consent',
                    'mcp_get_user_context','mcp_save_memory','mcp_search_memory',
                    'mcp_query_graph','mcp_query_table','mcp_add_record',
                    'mcp_list_tables','mcp_update_profile','mcp_review_memories'
                  )),
    resource    VARCHAR(200) NOT NULL,
    details     JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
  ) PARTITION BY RANGE (created_at);

  -- Create initial partition (current month)
  EXECUTE format(
    'CREATE TABLE audit_log_%s PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)',
    to_char(NOW(), 'YYYY_MM'),
    date_trunc('month', NOW()),
    date_trunc('month', NOW()) + INTERVAL '1 month'
  );

  CREATE INDEX idx_audit_agent ON audit_log(agent_id);
  CREATE INDEX idx_audit_time ON audit_log(created_at DESC);
  CREATE INDEX idx_audit_action ON audit_log(action);
  CREATE INDEX idx_audit_resource ON audit_log(resource);

  -- Consent rules
  CREATE TABLE consent_rules (
    id          SERIAL PRIMARY KEY,
    agent_id    VARCHAR(100) NOT NULL,
    resource    VARCHAR(200) NOT NULL,
    permission  VARCHAR(10) NOT NULL CHECK (permission IN ('read', 'write', 'none')),
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at  TIMESTAMPTZ,
    UNIQUE (agent_id, resource)
  );
  CREATE INDEX idx_consent_active ON consent_rules(agent_id, resource)
    WHERE revoked_at IS NULL;

  -- Table registry (metadata about dynamic tables)
  CREATE TABLE _table_registry (
    table_name   VARCHAR(100) PRIMARY KEY,
    description  TEXT,
    columns      JSONB NOT NULL,
    record_count INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Vector collection registry
  EXECUTE format('CREATE TABLE _vector_collections (
    collection    VARCHAR(100) PRIMARY KEY,
    description   TEXT,
    entry_count   INTEGER NOT NULL DEFAULT 0,
    embedding_dim INTEGER NOT NULL DEFAULT %s,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )', p_embedding_dim);

  -- =====================================================
  -- USER SCHEMA UTILITY FUNCTIONS
  -- =====================================================

  -- Trigger function: Auto-update updated_at timestamp
  CREATE FUNCTION update_updated_at() RETURNS TRIGGER AS $fn$
  BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
  END;
  $fn$ LANGUAGE plpgsql;

  -- Trigger function: Update table registry record count
  CREATE FUNCTION increment_record_count() RETURNS TRIGGER AS $fn$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      UPDATE _table_registry
      SET record_count = record_count + 1, updated_at = NOW()
      WHERE table_name = TG_TABLE_NAME;
    ELSIF TG_OP = 'DELETE' THEN
      UPDATE _table_registry
      SET record_count = GREATEST(0, record_count - 1), updated_at = NOW()
      WHERE table_name = TG_TABLE_NAME;
    END IF;
    RETURN NULL;
  END;
  $fn$ LANGUAGE plpgsql;

  -- Trigger function: Handle entity soft delete
  CREATE FUNCTION soft_delete_entity_edges() RETURNS TRIGGER AS $fn$
  BEGIN
    -- When entity is soft-deleted, preserve edges for potential restoration
    -- Hard cascades are handled by ON DELETE CASCADE on FK
    IF NEW._deleted_at IS NOT NULL AND OLD._deleted_at IS NULL THEN
      NULL; -- Placeholder for future edge handling logic
    END IF;
    RETURN NEW;
  END;
  $fn$ LANGUAGE plpgsql;

  -- Create trigger for entity soft deletes
  CREATE TRIGGER trg_entity_soft_delete
    BEFORE UPDATE ON entities
    FOR EACH ROW
    WHEN (NEW._deleted_at IS NOT NULL AND OLD._deleted_at IS NULL)
    EXECUTE FUNCTION soft_delete_entity_edges();

  -- Function: Detect contradictions
  CREATE FUNCTION detect_contradictions(
    p_source_type VARCHAR,
    p_field_path VARCHAR,
    p_new_confidence REAL
  )
  RETURNS TABLE(
    meta_id INTEGER,
    source_ref VARCHAR,
    old_confidence REAL,
    status VARCHAR
  ) AS $fn$
    SELECT mm.id, mm.source_ref, mm.confidence, mm.status
    FROM memory_meta mm
    WHERE mm.source_type = p_source_type
      AND mm.source_ref LIKE p_field_path || '%'
      AND mm.status IN ('active', 'trusted')
      AND mm.confidence > 0.5
    ORDER BY mm.confidence DESC;
  $fn$ LANGUAGE sql STABLE;

  -- Function: Reinforce edge weight
  CREATE FUNCTION reinforce_edge(
    p_source_id INTEGER,
    p_target_id INTEGER,
    p_relation VARCHAR,
    p_evidence JSONB DEFAULT NULL
  )
  RETURNS void AS $fn$
  BEGIN
    UPDATE edges SET
      weight = LEAST(10.0, weight + 0.5),
      last_seen = NOW(),
      evidence = CASE
        WHEN p_evidence IS NOT NULL THEN evidence || p_evidence
        ELSE evidence
      END
    WHERE source_id = p_source_id
      AND target_id = p_target_id
      AND relation = p_relation;
  END;
  $fn$ LANGUAGE plpgsql;

  -- Seed empty profile
  INSERT INTO profile (data, version, changed_by)
  VALUES ('{}', 1, 'system');

  -- Reset search_path
  RESET search_path;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- SECTION C: Harden ensure_user_edge_quarantine_table
-- =====================================================
-- Pin search_path on SECURITY DEFINER function (matches migration 14 pattern)
ALTER FUNCTION public.ensure_user_edge_quarantine_table(VARCHAR)
  SET search_path = public;
