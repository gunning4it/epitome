# Epitome

A personal AI database, portable identity layer, and knowledge graph that gives every AI agent a shared, persistent memory of the user.

## Tech Stack

- **Runtime:** Node.js ≥ 22 LTS
- **API Framework:** Hono 4.11.x
- **Database:** PostgreSQL 17.7 with pgvector 0.8.x, pg_trgm, pg_cron 1.6.x
- **ORM:** Drizzle ORM 0.39.x
- **MCP Server:** @modelcontextprotocol/sdk 1.26.x
- **Frontend:** React 19.x + Tailwind CSS 4.x + shadcn/ui 3.x
- **Validation:** Zod 3.x
- **Testing:** Vitest

## Quick Start

### Prerequisites

- Docker & Docker Compose (recommended)
- OR PostgreSQL 17.7 + Node.js 22+ (manual setup)

### Option 1: Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/gunning4it/epitome.git
cd epitome

# Copy environment configuration
cp .env.example .env
# Edit .env with your values

# Start PostgreSQL with pgvector
docker compose up -d postgres

# Wait for database to initialize (check logs)
docker compose logs -f postgres

# Verify database is ready
docker compose exec postgres psql -U postgres -d epitome_dev -c "SELECT version();"
```

### Option 2: Manual Setup

```bash
# Install PostgreSQL 17.7
brew install postgresql@17  # macOS
# OR
sudo apt install postgresql-17  # Ubuntu

# Install pgvector extension
# Follow instructions at: https://github.com/pgvector/pgvector

# Install pg_cron extension
# Follow instructions at: https://github.com/citusdata/pg_cron

# Create database
createdb epitome_dev

# Run initialization script
psql -U postgres -d epitome_dev -f init.sql
```

## Database Schema

### Public Schema (Multi-Tenant)

The `public` schema contains system-wide tables:

- **users** — User accounts with tier, embedding config
- **api_keys** — Bearer tokens for API/MCP authentication
- **sessions** — Dashboard login sessions
- **oauth_connections** — Google/GitHub OAuth tokens
- **agent_registry** — Registered AI agent metadata
- **system_config** — Feature flags and global settings

### Per-User Schema Isolation

Each user gets an isolated PostgreSQL schema (`user_{id}`) containing:

- **profile** — Versioned JSONB identity document
- **vectors** — Semantic memory with pgvector embeddings
- **entities** — Knowledge graph nodes (person, place, food, etc.)
- **edges** — Knowledge graph relationships
- **memory_meta** — Confidence scoring & lifecycle tracking
- **audit_log** — Append-only activity log (partitioned by month)
- **consent_rules** — Per-agent resource permissions
- **_table_registry** — Metadata for dynamic user tables
- **_vector_collections** — Metadata for vector collections
- **[dynamic tables]** — meals, workouts, medications, etc.

## Schema Verification

### Test Database Initialization

```bash
# Connect to database
docker compose exec postgres psql -U postgres -d epitome_dev

# Check extensions
SELECT * FROM pg_extension WHERE extname IN ('pgvector', 'pg_trgm', 'pg_cron', 'uuid-ossp');

# Expected output:
#   extname   | extversion
# ------------+------------
#  uuid-ossp  | 1.1
#  pgvector   | 0.8.0
#  pg_trgm    | 1.6
#  pg_cron    | 1.6.0

# Check public schema tables
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

# Expected tables:
#  tablename
# -------------------
#  agent_registry
#  api_keys
#  oauth_connections
#  sessions
#  system_config
#  users

# Check system config seeding
SELECT key, value FROM system_config;
```

### Test User Schema Creation

```bash
# Create a test user schema
docker compose exec postgres psql -U postgres -d epitome_dev -c "SELECT public.create_user_schema('user_test123', 1536);"

# Verify schema creation
docker compose exec postgres psql -U postgres -d epitome_dev -c "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'user_%';"

# Expected output:
#  schema_name
# ---------------
#  user_test123

# Check user schema tables
docker compose exec postgres psql -U postgres -d epitome_dev -c "SET search_path TO user_test123; SELECT tablename FROM pg_tables WHERE schemaname = 'user_test123' ORDER BY tablename;"

# Expected tables (9 core + 2 registries):
#  tablename
# ---------------------
#  _schema_version
#  _table_registry
#  _vector_collections
#  audit_log
#  audit_log_2026_02     (partition)
#  consent_rules
#  edges
#  entities
#  memory_meta
#  profile
#  vectors

# Verify empty profile was seeded
docker compose exec postgres psql -U postgres -d epitome_dev -c "SET search_path TO user_test123; SELECT id, version, data, changed_by FROM profile;"

# Expected output:
#  id | version | data | changed_by
# ----+---------+------+------------
#   1 |       1 | {}   | system

# Check indexes
docker compose exec postgres psql -U postgres -d epitome_dev -c "SET search_path TO user_test123; SELECT indexname FROM pg_indexes WHERE schemaname = 'user_test123' ORDER BY indexname;"

# Should see 35+ indexes including:
#  - idx_vectors_embedding (HNSW)
#  - idx_entities_name_trgm (GIN trigram)
#  - idx_edges_traverse (composite)
#  - etc.
```

### Test Vector Operations

```bash
# Insert a test vector
docker compose exec postgres psql -U postgres -d epitome_dev << 'SQL'
SET search_path TO user_test123;

-- Create memory_meta first
INSERT INTO memory_meta (source_type, source_ref, origin, confidence)
VALUES ('vector', 'journal:1', 'user_stated', 0.95)
RETURNING id;

-- Insert vector with random embedding
INSERT INTO vectors (collection, text, embedding, metadata, _meta_id)
VALUES (
  'journal',
  'Had a great dinner at Bestia with Sarah tonight',
  array_fill(random()::float4, ARRAY[1536])::vector,
  '{"mood": "happy", "people": ["Sarah"], "location": "Bestia"}',
  1
);

-- Verify insertion
SELECT id, collection, text, metadata FROM vectors;
SQL
```

### Test Knowledge Graph

```bash
# Create test entities and edges
docker compose exec postgres psql -U postgres -d epitome_dev << 'SQL'
SET search_path TO user_test123;

-- Create entities
INSERT INTO entities (type, name, properties, confidence)
VALUES
  ('person', 'Sarah', '{"relation": "wife"}', 0.95),
  ('place', 'Bestia', '{"cuisine": "Italian", "address": "2121 E 7th Pl, LA"}', 0.90),
  ('food', 'Italian food', '{"cuisine": "Italian"}', 0.80);

-- Create relationships
INSERT INTO edges (source_id, target_id, relation, weight, confidence)
VALUES
  (1, 2, 'visited', 2.0, 0.90),      -- Sarah visited Bestia
  (1, 3, 'likes', 3.0, 0.85);        -- Sarah likes Italian food

-- Query graph: "What does Sarah like?"
SELECT
  e1.name as person,
  edge.relation,
  e2.name as target,
  edge.weight,
  edge.confidence
FROM edges edge
JOIN entities e1 ON edge.source_id = e1.id
JOIN entities e2 ON edge.target_id = e2.id
WHERE e1.name = 'Sarah' AND e1.type = 'person';
SQL
```

## Architecture

### Data Isolation

Epitome uses **PostgreSQL schema isolation** for hard multi-tenancy:

- Each user's data lives in a separate Postgres schema: `user_{uuid_no_hyphens}`
- Cross-schema access is impossible at the SQL level
- No RLS (Row-Level Security) overhead
- Full data isolation for compliance (GDPR, HIPAA)

### Memory Quality Engine

Every piece of data is tracked through `memory_meta`:

- **Confidence scores** (0.0–1.0) based on origin and corroboration
- **Lifecycle states**: unvetted → active → trusted (or review/decayed/rejected)
- **Contradiction detection** with automatic flagging
- **Time decay** for stale memories (90+ days inactive)

### Knowledge Graph

Entities (people, places, foods, events, etc.) and their relationships are extracted from:

- User-stated profile data
- Table records (meals, workouts, etc.)
- Vector embeddings (journal entries, bookmarks)
- Import sources (Google Calendar, Apple Health)

**Example:**
```
(User) —married_to→ (Sarah) —likes→ (Italian food)
                     ↓
                  visited
                     ↓
                  (Bestia)
```

## Deployment

### Self-Hosting with Docker Compose

Epitome can be self-hosted using Docker Compose for easy deployment.

#### Prerequisites

- Docker 24+ with Docker Compose
- 2GB RAM minimum
- PostgreSQL port 5432 available (or configure custom port)
- OpenAI API key for embeddings
- OAuth credentials (Google and/or GitHub)

#### Quick Start

```bash
# 1. Clone repository
git clone https://github.com/gunning4it/epitome.git
cd epitome

# 2. Configure environment
cp .env.example .env

# 3. Edit .env with your credentials
# Required:
#   - OPENAI_API_KEY
#   - GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (or GitHub)
#   - SESSION_SECRET (generate with: openssl rand -base64 32)
#   - ENCRYPTION_KEY (generate with: openssl rand -base64 32)
#   - POSTGRES_PASSWORD (change from default)

# 4. Start all services
docker compose up -d

# 5. Verify health
docker compose ps
# All services should show "healthy" status

# 6. View logs
docker compose logs -f api
docker compose logs -f dashboard
```

#### Access Points

- **Dashboard:** http://localhost:5173
- **API:** http://localhost:3000
- **Database:** localhost:5432 (postgres/postgres)
- **pgAdmin (optional):** http://localhost:5050 (start with `docker compose --profile debug up`)

#### First User Setup

1. Navigate to http://localhost:5173/onboarding
2. Sign in with Google or GitHub OAuth
3. Complete profile setup
4. Your user schema will be automatically created in PostgreSQL

#### Data Persistence

All data is persisted in Docker volumes:
- `epitome_postgres_data` — Database files
- `epitome_pgadmin_data` — pgAdmin config (if using debug profile)

To reset everything:
```bash
docker compose down -v  # WARNING: Deletes all data
docker compose up -d
```

#### Stopping Services

```bash
# Stop all services (keeps data)
docker compose down

# Stop and remove volumes (deletes all data)
docker compose down -v

# Restart services
docker compose restart
```

### Production Deployment

For production deployment to Railway, Fly.io, or DigitalOcean:

#### Railway (Recommended)

```bash
# 1. Install Railway CLI
npm install -g @railway/cli

# 2. Login and create project
railway login
railway init

# 3. Add PostgreSQL
railway add postgres

# 4. Set environment variables
railway variables set OPENAI_API_KEY=sk-...
railway variables set GOOGLE_CLIENT_ID=...
railway variables set GOOGLE_CLIENT_SECRET=...
railway variables set SESSION_SECRET=$(openssl rand -base64 32)
railway variables set ENCRYPTION_KEY=$(openssl rand -base64 32)
railway variables set NODE_ENV=production

# 5. Deploy
railway up
```

#### Fly.io

```bash
# 1. Install Fly CLI
curl -L https://fly.io/install.sh | sh

# 2. Login and launch app
fly auth login
fly launch

# 3. Add PostgreSQL
fly postgres create

# 4. Set secrets
fly secrets set OPENAI_API_KEY=sk-...
fly secrets set GOOGLE_CLIENT_ID=...
fly secrets set SESSION_SECRET=$(openssl rand -base64 32)

# 5. Deploy
fly deploy
```

#### Environment Variables for Production

Required environment variables for production:

```bash
# Database (use managed PostgreSQL with SSL)
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
DB_POOL_SIZE=20

# OAuth (update redirect URIs in provider settings)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...  # Optional
GITHUB_CLIENT_SECRET=...  # Optional
OAUTH_REDIRECT_URI=https://api.yourdomain.com/auth/callback

# Security (generate random values)
SESSION_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -base64 32)
SESSION_TTL_DAYS=7

# OpenAI
OPENAI_API_KEY=sk-...

# Server
PORT=3000
NODE_ENV=production
LOG_LEVEL=warn

# CORS (set to your dashboard domain)
CORS_ORIGIN=https://yourdomain.com
```

#### Production Checklist

- [ ] Use managed PostgreSQL (Railway Postgres, Supabase, or Neon)
- [ ] Enable SSL for database connections (`?sslmode=require`)
- [ ] Set strong random secrets for SESSION_SECRET and ENCRYPTION_KEY
- [ ] Configure OAuth redirect URIs to match production domain
- [ ] Set CORS_ORIGIN to dashboard domain
- [ ] Enable production mode (NODE_ENV=production)
- [ ] Set appropriate database pool size for instance RAM
- [ ] Configure HTTPS/TLS certificates
- [ ] Set up monitoring and alerting
- [ ] Configure automated backups for PostgreSQL
- [ ] Test full OAuth flow in production

#### Scaling Recommendations

| Users | Configuration |
|-------|--------------|
| 0–1K | Single Railway instance + shared Postgres |
| 1K–10K | Dedicated Postgres + read replicas + PgBouncer |
| 10K–100K | Multi-region API instances + sharded Postgres |
| 100K+ | Dedicated graph service + TimescaleDB + CDN |

#### Cost Estimates (Hosted)

Per user per month (at scale):
- PostgreSQL: ~$0.30
- OpenAI embeddings: ~$0.02
- Graph extraction: ~$0.01
- API compute: ~$0.05
- **Total: ~$0.38/user/month**

Pro tier at $5/mo → 92% gross margin.

## Next Steps

### Implementation Status ✅

All core features are implemented and tested:

- ✅ **Phase 1.1:** PostgreSQL Schema (public + per-user schema isolation)
- ✅ **Phase 1.2:** Authentication System (OAuth + API keys + sessions)
- ✅ **Phase 2.1:** Core Services (8 services)
- ✅ **Phase 2.2:** API Endpoints (22 REST endpoints)
- ✅ **Phase 3.1:** Entity Extraction & Deduplication Pipeline
- ✅ **Phase 3.2:** Advanced Graph Queries
- ✅ **Phase 4:** MCP Server (9 tools with consent management)
- ✅ **Phase 5.1:** Dashboard Pages 1-6 (Profile, Memory, Tables)
- ✅ **Phase 5.2:** Dashboard Pages 7-9 (Graph, Agents, Settings)
- ✅ **Phase 6.1:** Comprehensive Testing (176 test cases, CI/CD pipeline)
- ✅ **Phase 6.2:** DevOps & Deployment (Docker Compose, production guides)

**Total: ~19,250 lines of production-ready code**

### Roadmap

Future enhancements:
- Web import tools (Gmail, Google Calendar, Apple Health)
- Advanced graph algorithms (community detection, influence propagation)
- Multi-LLM support (Anthropic Claude, local LLMs)
- Mobile apps (iOS/Android)
- Collaborative memory sharing between users

## Documentation

- **[EPITOME_TECH_SPEC.md](/.claude/docs/EPITOME_TECH_SPEC.md)** — Complete architecture, API design, tradeoffs
- **[EPITOME_DATA_MODEL.md](/.claude/docs/EPITOME_DATA_MODEL.md)** — Every table, column, index, trigger, JSONB contract
- **[.claude/CLAUDE.md](/.claude/CLAUDE.md)** — Project configuration for Claude Code

## Contributing

This is an open-source project under the MIT license. Contributions welcome!

## License

MIT License - see LICENSE file for details
