-- Fix create_user_schema: include 'public' in search_path so vector/trgm types are visible
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
                      CHECK (origin IN ('user_stated','ai_inferred','ai_pattern','imported','system')),
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

  -- Audit log (partitioned)
  CREATE TABLE audit_log (
    id          BIGSERIAL,
    agent_id    VARCHAR(100) NOT NULL,
    agent_name  VARCHAR(100),
    action      VARCHAR(20) NOT NULL
                  CHECK (action IN ('read','write','update','delete','search',
                                    'graph_query','profile_read','profile_write',
                                    'consent_check')),
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
    IF NEW._deleted_at IS NOT NULL AND OLD._deleted_at IS NULL THEN
      NULL;
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
