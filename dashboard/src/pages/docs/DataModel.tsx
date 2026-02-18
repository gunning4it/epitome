import DocPage from '@/components/docs/DocPage';
import { CodeBlock } from '@/components/CodeBlock';

const headings = [
  { id: 'schema-isolation', text: 'Schema Isolation', level: 2 },
  { id: 'core-tables', text: 'Core Tables', level: 2 },
  { id: 'vector-tables', text: 'Vector Tables', level: 2 },
  { id: 'graph-tables', text: 'Graph Tables', level: 2 },
  { id: 'system-tables', text: 'System Tables', level: 2 },
  { id: 'jsonb-contracts', text: 'JSONB Contracts', level: 2 },
];

export default function DataModel() {
  return (
    <DocPage
      title="Data Model Reference"
      description="Database schema, table structures, and JSONB contracts."
      headings={headings}
    >
      <h2 id="schema-isolation" className="text-xl font-semibold mt-8 mb-4">Schema Isolation</h2>
      <p className="text-muted-foreground mb-4">
        Epitome uses <strong className="text-foreground">per-user PostgreSQL schemas</strong> for data
        isolation. When a new user signs up, the system clones the <code className="text-foreground bg-muted px-1 rounded">template_user</code> schema
        into a new schema named <code className="text-foreground bg-muted px-1 rounded">user_{'<user_id>'}</code>. Every query
        for that user runs within a transaction that sets the search path to their schema.
      </p>
      <CodeBlock
        language="sql"
        code={`-- How per-user schema isolation works in each transaction:
BEGIN;
SET LOCAL search_path = 'user_abc123', public;

-- All queries now resolve to tables in the user's schema
SELECT * FROM profile;           -- reads user_abc123.profile
SELECT * FROM vector_entries;    -- reads user_abc123.vector_entries

COMMIT;`}
      />
      <p className="text-muted-foreground mt-4 mb-4">
        There are two categories of schemas in the database:
      </p>
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="pb-2 pr-4 font-medium text-foreground">Schema</th>
              <th className="pb-2 pr-4 font-medium text-foreground">Purpose</th>
              <th className="pb-2 font-medium text-foreground">Tables</th>
            </tr>
          </thead>
          <tbody className="text-muted-foreground">
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs text-foreground">shared</td>
              <td className="py-2 pr-4">Cross-user data</td>
              <td className="py-2 text-xs">users, accounts, sessions, api_keys</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs text-foreground">template_user</td>
              <td className="py-2 pr-4">Blueprint for new users</td>
              <td className="py-2 text-xs">All per-user tables (cloned on signup)</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs text-foreground">user_*</td>
              <td className="py-2 pr-4">One per user</td>
              <td className="py-2 text-xs">profile, user_tables, table_records, vector_collections, vector_entries, entities, entity_edges, entity_mentions, activity_log, memory_review, agent_consent</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="core-tables" className="text-xl font-semibold mt-10 mb-4">Core Tables</h2>
      <p className="text-muted-foreground mb-4">
        These tables store the user's profile and custom structured data.
      </p>

      <h3 className="text-lg font-medium mt-6 mb-3">profile</h3>
      <p className="text-muted-foreground mb-3">
        The profile is a versioned JSONB document. Every update creates a new row with an
        incremented version number. The latest version is the current profile.
      </p>
      <CodeBlock
        language="sql"
        code={`CREATE TABLE profile (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version     INTEGER NOT NULL DEFAULT 1,
  data        JSONB NOT NULL DEFAULT '{}',
  confidence  REAL NOT NULL DEFAULT 0.5,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT  -- agent_id or 'user' for dashboard edits
);

CREATE INDEX idx_profile_version ON profile (version DESC);`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">user_tables</h3>
      <p className="text-muted-foreground mb-3">
        Metadata registry for user-defined tables. Each entry describes a logical table and its
        inferred schema.
      </p>
      <CodeBlock
        language="sql"
        code={`CREATE TABLE user_tables (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  schema      JSONB NOT NULL DEFAULT '{}',  -- inferred column types
  record_count INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">table_records</h3>
      <p className="text-muted-foreground mb-3">
        All user-table records are stored in a single table with the table name as a foreign key.
        Record data is stored as JSONB.
      </p>
      <CodeBlock
        language="sql"
        code={`CREATE TABLE table_records (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name  TEXT NOT NULL REFERENCES user_tables(name) ON DELETE CASCADE,
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_table_records_table ON table_records (table_name);
CREATE INDEX idx_table_records_data ON table_records USING GIN (data);`}
      />

      <h2 id="vector-tables" className="text-xl font-semibold mt-10 mb-4">Vector Tables</h2>
      <p className="text-muted-foreground mb-4">
        The vector system stores semantic memories as text content paired with 1536-dimensional
        embeddings generated by text-embedding-3-small.
      </p>

      <h3 className="text-lg font-medium mt-6 mb-3">vector_collections</h3>
      <CodeBlock
        language="sql"
        code={`CREATE TABLE vector_collections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  entry_count INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">vector_entries</h3>
      <p className="text-muted-foreground mb-3">
        The main vector storage table. Each entry has content, an embedding vector, optional
        metadata, and a confidence score managed by the memory quality engine.
      </p>
      <CodeBlock
        language="sql"
        code={`CREATE TABLE vector_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection   TEXT NOT NULL REFERENCES vector_collections(name) ON DELETE CASCADE,
  content      TEXT NOT NULL,
  embedding    vector(1536) NOT NULL,
  metadata     JSONB DEFAULT '{}',
  confidence   REAL NOT NULL DEFAULT 0.8,
  state        TEXT NOT NULL DEFAULT 'active'
                 CHECK (state IN ('active', 'flagged', 'archived', 'contradicted')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   TEXT  -- agent_id
);

-- HNSW index for fast cosine similarity search
CREATE INDEX idx_vector_entries_embedding
  ON vector_entries USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_vector_entries_collection ON vector_entries (collection);
CREATE INDEX idx_vector_entries_state ON vector_entries (state);`}
      />

      <h2 id="graph-tables" className="text-xl font-semibold mt-10 mb-4">Graph Tables</h2>
      <p className="text-muted-foreground mb-4">
        The knowledge graph uses three tables: entities (nodes), entity_edges (relationships),
        and entity_mentions (links back to source memories).
      </p>

      <h3 className="text-lg font-medium mt-6 mb-3">entities</h3>
      <CodeBlock
        language="sql"
        code={`CREATE TABLE entities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  type          TEXT NOT NULL
                  CHECK (type IN ('person', 'place', 'organization', 'concept', 'event')),
  properties    JSONB DEFAULT '{}',
  mention_count INTEGER NOT NULL DEFAULT 0,
  confidence    REAL NOT NULL DEFAULT 0.7,
  first_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_entities_type ON entities (type);
CREATE INDEX idx_entities_name_trgm ON entities USING GIN (name gin_trgm_ops);`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">entity_edges</h3>
      <CodeBlock
        language="sql"
        code={`CREATE TABLE entity_edges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id     UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_id     UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  properties    JSONB DEFAULT '{}',
  weight        REAL NOT NULL DEFAULT 1.0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, target_id, type)
);

CREATE INDEX idx_entity_edges_source ON entity_edges (source_id);
CREATE INDEX idx_entity_edges_target ON entity_edges (target_id);`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">entity_mentions</h3>
      <p className="text-muted-foreground mb-3">
        Links entities to the vector entries (memories) where they were mentioned. This allows
        tracing an entity back to its source data.
      </p>
      <CodeBlock
        language="sql"
        code={`CREATE TABLE entity_mentions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  vector_id     UUID NOT NULL REFERENCES vector_entries(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_id, vector_id)
);

CREATE INDEX idx_entity_mentions_entity ON entity_mentions (entity_id);
CREATE INDEX idx_entity_mentions_vector ON entity_mentions (vector_id);`}
      />

      <h2 id="system-tables" className="text-xl font-semibold mt-10 mb-4">System Tables</h2>
      <p className="text-muted-foreground mb-4">
        System tables handle audit logging, memory quality review, and agent consent management.
      </p>

      <h3 className="text-lg font-medium mt-6 mb-3">activity_log</h3>
      <CodeBlock
        language="sql"
        code={`CREATE TABLE activity_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    TEXT,
  action      TEXT NOT NULL,
  resource    TEXT,
  details     JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_activity_log_created ON activity_log (created_at DESC);
CREATE INDEX idx_activity_log_agent ON activity_log (agent_id);
CREATE INDEX idx_activity_log_action ON activity_log (action);`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">memory_review</h3>
      <p className="text-muted-foreground mb-3">
        Items flagged by the memory quality engine for human review.
      </p>
      <CodeBlock
        language="sql"
        code={`CREATE TABLE memory_review (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type             TEXT NOT NULL CHECK (type IN ('contradiction', 'stale', 'low_confidence')),
  entry_ids        UUID[] NOT NULL,
  description      TEXT NOT NULL,
  suggested_action TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'resolved', 'dismissed')),
  resolved_at      TIMESTAMPTZ,
  resolution_note  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_memory_review_status ON memory_review (status);`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">agent_consent</h3>
      <p className="text-muted-foreground mb-3">
        Per-resource consent grants for each agent. Controls which resources an agent can read/write.
      </p>
      <CodeBlock
        language="sql"
        code={`CREATE TABLE agent_consent (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    TEXT NOT NULL,
  resource    TEXT NOT NULL,
  permission  TEXT NOT NULL CHECK (permission IN ('read', 'write', 'read_write')),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ,
  UNIQUE (agent_id, resource)
);

CREATE INDEX idx_agent_consent_agent ON agent_consent (agent_id);`}
      />

      <h2 id="jsonb-contracts" className="text-xl font-semibold mt-10 mb-4">JSONB Contracts</h2>
      <p className="text-muted-foreground mb-4">
        Several tables use JSONB columns for flexible data. Here are the expected shapes for the
        most important JSONB documents.
      </p>

      <h3 className="text-lg font-medium mt-6 mb-3">Profile Data Schema</h3>
      <p className="text-muted-foreground mb-3">
        The <code className="text-foreground bg-muted px-1 rounded">profile.data</code> column stores the user's
        personal information. All fields are optional. The schema evolves as agents add new data.
      </p>
      <CodeBlock
        language="typescript"
        code={`interface ProfileData {
  name?: string;
  timezone?: string;
  location?: {
    city?: string;
    state?: string;
    country?: string;
  };
  preferences?: {
    food?: {
      favorites?: string[];
      dietary_restrictions?: string[];
      regional_style?: string;
    };
    communication?: {
      style?: string;
      languages?: string[];
    };
  };
  family?: Array<{
    name?: string;
    relation?: string;
    birthday?: string;
  }>;
  career?: {
    primary_job?: {
      title?: string;
      company?: string;
      industry?: string;
    };
    skills?: string[];
  };
  health?: {
    conditions?: string[];
    dietary_goals?: string[];
  };
  [key: string]: unknown;  // open-ended for new fields
}`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">Entity Properties</h3>
      <p className="text-muted-foreground mb-3">
        The <code className="text-foreground bg-muted px-1 rounded">entities.properties</code> JSONB column stores
        type-specific metadata about each entity.
      </p>
      <CodeBlock
        language="typescript"
        code={`// Person entity
{ relation?: string; age?: number; birthday?: string; occupation?: string }

// Place entity
{ address?: string; city?: string; country?: string; type?: string }

// Organization entity
{ industry?: string; website?: string; role?: string }

// Concept entity
{ category?: string; description?: string }

// Event entity
{ date?: string; location?: string; recurring?: boolean }`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">Edge Metadata</h3>
      <p className="text-muted-foreground mb-3">
        The <code className="text-foreground bg-muted px-1 rounded">entity_edges.properties</code> column carries
        relationship-specific data.
      </p>
      <CodeBlock
        language="typescript"
        code={`// Common edge properties
{
  since?: string;       // when the relationship started
  until?: string;       // when it ended (if applicable)
  context?: string;     // additional context about the relationship
  source_memory?: string; // vector_entry ID where this was extracted
}`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">Vector Entry Metadata</h3>
      <p className="text-muted-foreground mb-3">
        The <code className="text-foreground bg-muted px-1 rounded">vector_entries.metadata</code> column tracks
        provenance and context for each stored memory.
      </p>
      <CodeBlock
        language="typescript"
        code={`interface VectorMetadata {
  source?: string;          // agent name or "dashboard"
  conversation_id?: string; // originating conversation
  tags?: string[];          // user-defined tags
  extracted_entities?: string[]; // entity names found in this memory
  [key: string]: unknown;
}`}
      />
    </DocPage>
  );
}
