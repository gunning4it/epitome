-- =====================================================
-- EPITOME DATABASE INITIALIZATION SCRIPT
-- =====================================================
-- Version: 1.0
-- PostgreSQL: 17.7
-- Extensions: pgvector 0.8+, pg_trgm, pg_cron 1.6+
--
-- This script initializes the Epitome database with:
-- 1. Required PostgreSQL extensions
-- 2. Public schema (multi-tenant system tables)
-- 3. Helper functions for user schema creation
-- 4. Utility functions and triggers
-- =====================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- =====================================================
-- PUBLIC SCHEMA: MULTI-TENANT SYSTEM TABLES
-- =====================================================

-- -----------------------------------------------------
-- Table: public.users
-- -----------------------------------------------------
-- Master user account table. One row per registered user.
CREATE TABLE IF NOT EXISTS public.users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             VARCHAR(320) NOT NULL UNIQUE,
  name              VARCHAR(200),
  avatar_url        VARCHAR(2048),
  schema_name       VARCHAR(100) NOT NULL UNIQUE,
  tier              VARCHAR(20) NOT NULL DEFAULT 'free'
                      CHECK (tier IN ('free', 'pro', 'enterprise')),
  onboarded         BOOLEAN NOT NULL DEFAULT false,
  embedding_provider VARCHAR(50) NOT NULL DEFAULT 'openai'
                      CHECK (embedding_provider IN ('openai', 'nomic', 'custom')),
  embedding_dim     INTEGER NOT NULL DEFAULT 1536
                      CHECK (embedding_dim IN (256, 512, 768, 1024, 1536)),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_tier ON public.users(tier);

-- -----------------------------------------------------
-- Table: public.api_keys
-- -----------------------------------------------------
-- Bearer tokens for MCP agents and REST API consumers
CREATE TABLE IF NOT EXISTS public.api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  key_hash    VARCHAR(128) NOT NULL UNIQUE,
  prefix      VARCHAR(12) NOT NULL,
  label       VARCHAR(200),
  agent_id    VARCHAR(100),
  scopes      JSONB NOT NULL DEFAULT '["read","write"]',
  tier        VARCHAR(20) NOT NULL DEFAULT 'free',
  last_used_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON public.api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON public.api_keys(prefix);
-- Active keys only (for auth lookup)
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON public.api_keys(key_hash)
  WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW());

-- -----------------------------------------------------
-- Table: public.sessions
-- -----------------------------------------------------
-- Dashboard login sessions
CREATE TABLE IF NOT EXISTS public.sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token       VARCHAR(256),
  token_hash  VARCHAR(64) UNIQUE,
  ip_address  VARCHAR(45),
  user_agent  VARCHAR(500),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON public.sessions(token)
  WHERE expires_at > NOW();
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON public.sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON public.sessions(user_id);

-- -----------------------------------------------------
-- Table: public.oauth_connections
-- -----------------------------------------------------
-- Links to OAuth providers (Google, GitHub)
CREATE TABLE IF NOT EXISTS public.oauth_connections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider         VARCHAR(50) NOT NULL CHECK (provider IN ('google', 'github')),
  provider_user_id VARCHAR(200) NOT NULL,
  access_token     VARCHAR(2048),
  refresh_token    VARCHAR(2048),
  token_expires_at TIMESTAMPTZ,
  raw_profile      JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_user ON public.oauth_connections(user_id);

-- -----------------------------------------------------
-- Table: public.oauth_clients
-- -----------------------------------------------------
-- OAuth dynamic client registration for MCP connectors
CREATE TABLE IF NOT EXISTS public.oauth_clients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       VARCHAR(200) NOT NULL UNIQUE,
  client_secret   VARCHAR(200),
  client_name     VARCHAR(200),
  redirect_uris   JSONB NOT NULL DEFAULT '[]',
  grant_types     JSONB NOT NULL DEFAULT '["authorization_code"]',
  response_types  JSONB NOT NULL DEFAULT '["code"]',
  token_endpoint_auth_method VARCHAR(50) NOT NULL DEFAULT 'none',
  scope           VARCHAR(1000),
  client_uri      VARCHAR(2048),
  logo_uri        VARCHAR(2048),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------
-- Table: public.oauth_authorization_codes
-- -----------------------------------------------------
-- OAuth authorization code + PKCE storage for MCP OAuth flow
CREATE TABLE IF NOT EXISTS public.oauth_authorization_codes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  VARCHAR(128) NOT NULL UNIQUE,
  client_id             VARCHAR(200) NOT NULL,
  user_id               UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  redirect_uri          VARCHAR(2048) NOT NULL,
  scope                 VARCHAR(1000),
  code_challenge        VARCHAR(128) NOT NULL,
  code_challenge_method VARCHAR(10) NOT NULL DEFAULT 'S256',
  state                 VARCHAR(500),
  expires_at            TIMESTAMPTZ NOT NULL,
  used_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_clients_client_id ON public.oauth_clients(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_auth_codes_code ON public.oauth_authorization_codes(code);
CREATE INDEX IF NOT EXISTS idx_oauth_auth_codes_user ON public.oauth_authorization_codes(user_id);

-- -----------------------------------------------------
-- Table: public.agent_registry
-- -----------------------------------------------------
-- Metadata about registered AI agents
CREATE TABLE IF NOT EXISTS public.agent_registry (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  agent_id      VARCHAR(100) NOT NULL,
  name          VARCHAR(200) NOT NULL,
  platform      VARCHAR(50),
  mcp_url       VARCHAR(2048),
  last_seen_at  TIMESTAMPTZ,
  total_reads   INTEGER NOT NULL DEFAULT 0,
  total_writes  INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_registry_user ON public.agent_registry(user_id);

-- -----------------------------------------------------
-- Table: public.system_config
-- -----------------------------------------------------
-- Global configuration: feature flags, default embedding model
CREATE TABLE IF NOT EXISTS public.system_config (
  key        VARCHAR(100) PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed system configuration
INSERT INTO public.system_config (key, value) VALUES
  ('default_embedding_provider', '"openai"'),
  ('default_embedding_dim', '1536'),
  ('free_tier_limits', '{"max_tables": 5, "max_agents": 3, "max_graph_entities": 100, "audit_retention_days": 30}'),
  ('pro_tier_limits', '{"max_tables": -1, "max_agents": -1, "max_graph_entities": -1, "audit_retention_days": 365}'),
  ('maintenance_mode', 'false')
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------
-- Table: public.enrichment_jobs
-- -----------------------------------------------------
-- Durable queue for async graph enrichment work
CREATE TABLE IF NOT EXISTS public.enrichment_jobs (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source_type   VARCHAR(20) NOT NULL CHECK (source_type IN ('profile', 'table', 'vector')),
  source_ref    VARCHAR(255) NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'retry', 'done', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_run_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_sched
  ON public.enrichment_jobs(status, next_run_at, created_at);
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_user
  ON public.enrichment_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_source
  ON public.enrichment_jobs(user_id, source_type, source_ref);

-- -----------------------------------------------------
-- Table: public.pending_vectors
-- -----------------------------------------------------
-- Stores vector writes that could not be embedded yet
CREATE TABLE IF NOT EXISTS public.pending_vectors (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  collection    VARCHAR(100) NOT NULL,
  text          TEXT NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  changed_by    VARCHAR(100),
  origin        VARCHAR(20),
  source_ref    VARCHAR(255),
  vector_id     INTEGER,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'retry', 'done', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_run_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_vectors_sched
  ON public.pending_vectors(status, next_run_at, created_at);
CREATE INDEX IF NOT EXISTS idx_pending_vectors_user
  ON public.pending_vectors(user_id, created_at DESC);

-- =====================================================
-- UTILITY FUNCTIONS (PUBLIC SCHEMA)
-- =====================================================

-- -----------------------------------------------------
-- Function: generate_api_key
-- -----------------------------------------------------
-- Generates a secure API key with the format: epi_<random_32_chars>
CREATE OR REPLACE FUNCTION public.generate_api_key()
RETURNS VARCHAR AS $$
DECLARE
  chars VARCHAR := 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  result VARCHAR := 'epi_';
  i INTEGER;
BEGIN
  FOR i IN 1..32 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------
-- Function: validate_jsonb_schema
-- -----------------------------------------------------
-- Validates JSONB data against a schema (basic validation)
-- For production, use pg_jsonschema extension or application-level Zod
CREATE OR REPLACE FUNCTION public.validate_jsonb_schema(
  data JSONB,
  schema JSONB
)
RETURNS BOOLEAN AS $$
BEGIN
  -- Placeholder for schema validation
  -- In production, this would validate against JSON Schema
  -- For now, just check that data is valid JSONB
  RETURN data IS NOT NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- -----------------------------------------------------
-- Function: epitome_batch_extract_entities
-- -----------------------------------------------------
-- Method B nightly batch helper: enqueue extraction jobs for table rows.
CREATE OR REPLACE FUNCTION public.epitome_batch_extract_entities(
  p_user_schema TEXT,
  p_limit INTEGER DEFAULT 100
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_table RECORD;
  v_inserted INTEGER := 0;
  v_total INTEGER := 0;
  v_sql TEXT;
BEGIN
  IF p_user_schema IS NULL OR p_user_schema !~ '^user_[a-z0-9]+$' THEN
    RAISE EXCEPTION 'Invalid user schema: %', p_user_schema;
  END IF;

  SELECT u.id
  INTO v_user_id
  FROM public.users u
  WHERE u.schema_name = p_user_schema
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN 0;
  END IF;

  IF to_regclass(format('%I._table_registry', p_user_schema)) IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_table IN EXECUTE format(
    'SELECT table_name
     FROM %I._table_registry
     WHERE table_name NOT LIKE ''\_%'' ESCAPE ''\''
     ORDER BY updated_at DESC
     LIMIT 25',
    p_user_schema
  )
  LOOP
    v_sql := format($q$
      WITH candidates AS (
        SELECT
          r.id,
          to_jsonb(r) - '_deleted_at' AS record_payload
        FROM %I.%I r
        WHERE r._deleted_at IS NULL
        ORDER BY r.updated_at DESC NULLS LAST, r.created_at DESC NULLS LAST
        LIMIT %s
      )
      INSERT INTO public.enrichment_jobs (
        user_id,
        source_type,
        source_ref,
        payload,
        status,
        attempt_count,
        next_run_at,
        created_at,
        updated_at
      )
      SELECT
        %L::uuid,
        'table',
        concat(%L, ':', c.id::text),
        jsonb_build_object('tableName', %L, 'record', c.record_payload),
        'pending',
        0,
        NOW(),
        NOW(),
        NOW()
      FROM candidates c
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.enrichment_jobs j
        WHERE j.user_id = %L::uuid
          AND j.source_type = 'table'
          AND j.source_ref = concat(%L, ':', c.id::text)
          AND j.status IN ('pending', 'processing', 'retry', 'done')
      )
    $q$,
      p_user_schema,
      v_table.table_name,
      GREATEST(1, p_limit),
      v_user_id::text,
      v_table.table_name,
      v_table.table_name,
      v_user_id::text,
      v_table.table_name
    );

    EXECUTE v_sql;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_total := v_total + COALESCE(v_inserted, 0);
  END LOOP;

  RETURN v_total;
END;
$$;

ALTER FUNCTION public.epitome_batch_extract_entities(TEXT, INTEGER)
  SET search_path = public;

-- =====================================================
-- USER SCHEMA CREATION FUNCTION
-- =====================================================

-- -----------------------------------------------------
-- Function: create_user_schema
-- -----------------------------------------------------
-- Creates a complete isolated schema for a new user with all tables, indexes, triggers, and functions
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
-- COMPLETION MESSAGE
-- =====================================================
DO $$
BEGIN
  RAISE NOTICE 'Epitome database initialization complete!';
  RAISE NOTICE 'Extensions enabled: uuid-ossp, vector (pgvector), pg_trgm, pg_cron';
  RAISE NOTICE 'Public schema tables created: users, api_keys, sessions, oauth_connections, oauth_clients, oauth_authorization_codes, agent_registry, system_config';
  RAISE NOTICE 'User schema creation function: public.create_user_schema(schema_name, embedding_dim)';
  RAISE NOTICE 'Batch extraction function: public.epitome_batch_extract_entities(user_schema, limit)';
  RAISE NOTICE '';
  RAISE NOTICE 'To create a user schema, run:';
  RAISE NOTICE '  SELECT public.create_user_schema(''user_abc123'', 1536);';
END $$;
