import DocPage from '@/components/docs/DocPage';
import { CodeBlock } from '@/components/CodeBlock';

const headings = [
  { id: 'overview', text: 'System Overview', level: 2 },
  { id: 'key-decisions', text: 'Key Architectural Decisions', level: 2 },
  { id: 'service-layer', text: 'Service Layer', level: 2 },
  { id: 'entity-extraction', text: 'Entity Extraction Pipeline', level: 2 },
  { id: 'data-flow', text: 'Data Flow', level: 2 },
];

export default function Architecture() {
  return (
    <DocPage
      title="Architecture Overview"
      description="System design, key decisions, and data flow in Epitome."
      headings={headings}
    >
      <h2 id="overview" className="text-xl font-semibold mt-8 mb-4">System Overview</h2>
      <p className="text-muted-foreground mb-4">
        Epitome follows a <strong className="text-foreground">monolithic server</strong> architecture.
        A single Hono application serves the REST API, MCP server, OAuth endpoints, and static
        dashboard assets. PostgreSQL is the sole database, handling structured data, vector
        embeddings (via pgvector), graph relationships, metadata, and audit logs.
      </p>
      <p className="text-muted-foreground mb-4">
        This deliberate simplicity reduces operational overhead, eliminates inter-service
        communication complexity, and makes self-hosting straightforward. The entire system
        can run on a single server or container.
      </p>
      <div className="rounded-lg border border-border bg-card p-5 my-6">
        <pre className="text-sm font-mono text-muted-foreground leading-relaxed overflow-x-auto">
{`┌─────────────────────────────────────────────────────┐
│                   AI Agents                         │
│  (Claude, ChatGPT, custom bots, etc.)               │
└───────────────┬───────────────────┬─────────────────┘
                │ MCP (Streamable HTTP)  │ REST API
                ▼                   ▼
┌─────────────────────────────────────────────────────┐
│                Hono Server (Node.js 22)              │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ MCP      │  │ REST     │  │ Auth (OAuth,     │   │
│  │ Server   │  │ Routes   │  │ Sessions, Keys)  │   │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘   │
│       │              │                  │             │
│  ┌────▼──────────────▼──────────────────▼─────────┐  │
│  │              Service Layer                      │  │
│  │  (Profile, Tables, Vectors, Graph, Activity)    │  │
│  └────────────────────┬───────────────────────────┘  │
│                       │                              │
│  ┌────────────────────▼───────────────────────────┐  │
│  │         Drizzle ORM + postgres.js              │  │
│  └────────────────────┬───────────────────────────┘  │
└───────────────────────┼──────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────┐
│              PostgreSQL 17 + pgvector 0.8             │
│                                                      │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ shared   │  │ user_abc123  │  │ user_def456   │  │
│  │ schema   │  │ schema       │  │ schema        │  │
│  │ (users,  │  │ (profile,    │  │ (profile,     │  │
│  │ accounts │  │  vectors,    │  │  vectors,     │  │
│  │ sessions)│  │  graph,      │  │  graph,       │  │
│  │          │  │  tables,     │  │  tables,      │  │
│  │          │  │  activity)   │  │  activity)    │  │
│  └──────────┘  └──────────────┘  └───────────────┘  │
└──────────────────────────────────────────────────────┘`}
        </pre>
      </div>

      <h2 id="key-decisions" className="text-xl font-semibold mt-10 mb-4">Key Architectural Decisions</h2>
      <p className="text-muted-foreground mb-4">
        The following decisions shape the system and are documented in the tradeoff register
        in the tech spec. Understanding them is important for contributors and self-hosters.
      </p>

      <div className="space-y-4 mb-6">
        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">Hono over Express / Fastify</h4>
          <p className="text-sm text-muted-foreground">
            Hono is lightweight, built on web standards (Request/Response), and has first-class
            TypeScript support. It runs on Node.js, Deno, Bun, and Cloudflare Workers, giving
            us deployment flexibility. Its middleware system is simpler than Express's and it has
            no legacy baggage. The framework is fast, with zero dependencies beyond itself.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">PostgreSQL for Everything (No Redis, No Mongo, No Pinecone)</h4>
          <p className="text-sm text-muted-foreground">
            Using a single database eliminates operational complexity. PostgreSQL handles structured
            data natively. pgvector provides vector similarity search that is fast enough for
            personal-scale data (thousands, not billions of vectors). PostgreSQL's JSONB columns
            handle schema-flexible data. The graph is modeled with entities and edges tables,
            queried with recursive CTEs. One backup covers everything.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">Per-User Schemas over Row-Level Security (RLS)</h4>
          <p className="text-sm text-muted-foreground">
            Each user gets their own PostgreSQL schema (e.g., <code className="text-foreground bg-muted px-1 rounded">user_abc123</code>).
            This provides hard data isolation — a bug in one query cannot leak another user's data.
            It also simplifies indexing (no composite indexes with user_id), makes per-user backups
            trivial, and allows clean data deletion. The tradeoff is slightly more complex connection
            handling (SET LOCAL search_path in transactions) and an upper bound of roughly 10,000
            users per database before schema management overhead becomes noticeable.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">Streamable HTTP for MCP Transport</h4>
          <p className="text-sm text-muted-foreground">
            The hosted MCP service uses Streamable HTTP transport rather than stdio. This allows
            agents to connect over the network without needing a local process. The transport
            supports both request-response patterns and server-sent events for streaming. Agents
            authenticate via their MCP URL token.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">Drizzle over Prisma</h4>
          <p className="text-sm text-muted-foreground">
            Drizzle provides type-safe SQL with a minimal abstraction layer and, critically, a raw
            SQL escape hatch via tagged template literals. This is essential because some queries
            (vector similarity search, graph traversals, dynamic user-table queries) cannot be
            expressed cleanly in any ORM's query builder. Prisma's <code className="text-foreground bg-muted px-1 rounded">$queryRaw</code> exists
            but loses type safety. With Drizzle + postgres.js, we get the best of both worlds.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">React SPA over Next.js</h4>
          <p className="text-sm text-muted-foreground">
            The dashboard is a client-only React SPA. There is no need for server-side rendering —
            the dashboard is behind authentication, not indexed by search engines, and communicates
            entirely via the REST API. A Vite-built SPA is simpler to deploy (static files + API)
            and avoids the complexity of Next.js's server components, caching, and build system.
          </p>
        </div>
      </div>

      <h2 id="service-layer" className="text-xl font-semibold mt-10 mb-4">Service Layer</h2>
      <p className="text-muted-foreground mb-4">
        The codebase follows a clean separation between routes, services, and database access.
        Routes handle HTTP concerns (parsing request, sending response). Services contain
        business logic. Database access uses Drizzle ORM and raw postgres.js queries.
      </p>
      <CodeBlock
        language="text"
        code={`Route Handler (Hono)
  │
  ├── Validates request with Zod
  ├── Extracts user context from auth middleware
  │
  ▼
Service Layer
  │
  ├── Implements business logic
  ├── Calls database via withUserSchema(userId, async (tx) => {...})
  ├── Triggers async side effects (entity extraction, etc.)
  │
  ▼
Database (postgres.js + Drizzle)
  │
  ├── SET LOCAL search_path = 'user_abc123', public;
  ├── Execute queries within transaction
  └── Return typed results`}
      />
      <p className="text-muted-foreground mt-4 mb-4">
        The <code className="text-foreground bg-muted px-1 rounded">withUserSchema()</code> utility
        wraps all per-user database operations in a transaction that sets the PostgreSQL search
        path to the user's schema. This ensures queries automatically resolve to the correct
        tables without explicit schema prefixes.
      </p>
      <CodeBlock
        language="typescript"
        code={`// Example service function
async function getProfile(userId: string) {
  return withUserSchema(userId, async (tx) => {
    const [profile] = await tx\`
      SELECT version, confidence, data, updated_at
      FROM profile
      ORDER BY version DESC
      LIMIT 1
    \`;
    return profile;
  });
}`}
      />
      <p className="text-muted-foreground mt-4 mb-4">
        <strong className="text-foreground">Important pattern:</strong> Never nest
        <code className="text-foreground bg-muted px-1 rounded ml-1">withUserSchema()</code> calls.
        If a service function needs to be called from within an existing transaction, use the
        <code className="text-foreground bg-muted px-1 rounded ml-1">*Internal(tx, ...)</code> variant
        that accepts an existing transaction object.
      </p>

      <h2 id="entity-extraction" className="text-xl font-semibold mt-10 mb-4">Entity Extraction Pipeline</h2>
      <p className="text-muted-foreground mb-4">
        When a memory is stored via <code className="text-foreground bg-muted px-1 rounded">store_memory</code> or
        the vectors API, the system triggers an asynchronous entity extraction pipeline. The API
        returns immediately — extraction happens in the background.
      </p>
      <CodeBlock
        language="text"
        code={`1. Memory Stored (store_memory / POST /v1/vectors/:collection)
   │
   ▼
2. Content embedded (text-embedding-3-small) → vector stored in pgvector
   │
   ▼
3. Async: Entity extraction triggered (background)
   │
   ├── Content sent to gpt-5-mini with structured output schema
   ├── Response parsed: entities[] with {name, type, properties}
   ├── Edges[] with {source, target, type, properties}
   │
   ▼
4. Deduplication
   │
   ├── For each extracted entity:
   │   ├── Fuzzy match against existing entities (pg_trgm similarity)
   │   ├── If match > 0.8: merge with existing entity
   │   └── If no match: create new entity
   │
   ├── For each extracted edge:
   │   ├── Check for existing edge with same source, target, type
   │   └── If exists: update properties; else: create new edge
   │
   ▼
5. Entity mentions recorded (links entity ↔ source vector entry)
   │
   ▼
6. Graph statistics updated`}
      />
      <p className="text-muted-foreground mt-4 mb-4">
        The extraction uses OpenAI's Responses API with structured output (JSON schema with
        <code className="text-foreground bg-muted px-1 rounded ml-1">strict: true</code>) to ensure
        the model returns well-formed entity and edge data. The deduplication step uses PostgreSQL's
        <code className="text-foreground bg-muted px-1 rounded ml-1">pg_trgm</code> extension for
        fuzzy string matching, preventing duplicate entities for slight name variations (e.g.,
        "Bob" vs "Bobby" vs "Robert").
      </p>

      <h2 id="data-flow" className="text-xl font-semibold mt-10 mb-4">Data Flow</h2>
      <p className="text-muted-foreground mb-4">
        Here is the complete lifecycle of a request from an AI agent through the MCP server:
      </p>
      <CodeBlock
        language="text"
        code={`AI Agent (e.g., Claude Desktop)
  │
  │  MCP tool call: store_memory({content: "...", collection: "facts"})
  │  Transport: Streamable HTTP POST to /mcp
  │
  ▼
Hono Server
  │
  ├── 1. Parse MCP request, extract tool name + arguments
  ├── 2. Authenticate: validate MCP token → resolve user_id + agent_id
  ├── 3. Consent check: does this agent have 'vectors' write permission?
  │      └── If no: return CONSENT_REQUIRED error
  ├── 4. Rate limit check: is this agent under its request quota?
  │      └── If no: return RATE_LIMITED error
  │
  ▼
MCP Tool Handler (store_memory)
  │
  ├── 5. Validate arguments with Zod schema
  ├── 6. Call VectorService.store(userId, content, collection, metadata)
  │
  ▼
Vector Service
  │
  ├── 7. Generate embedding via OpenAI text-embedding-3-small
  ├── 8. withUserSchema(userId) → INSERT into vector_entries
  ├── 9. Log activity: {agent_id, action: "store_memory", details: {...}}
  ├── 10. Trigger async entity extraction (non-blocking)
  │
  ▼
Response
  │
  ├── 11. Return MCP tool result: {id, content, collection, confidence, ...}
  └── 12. Agent receives result, continues conversation`}
      />
      <p className="text-muted-foreground mt-4 mb-4">
        The dashboard follows a similar flow but uses REST endpoints with session authentication,
        which bypasses the consent check (since the user is interacting directly with their own data).
      </p>
      <p className="text-muted-foreground mb-4">
        <strong className="text-foreground">Performance note:</strong> Steps 1-6 and 8-12 are synchronous.
        The embedding generation (step 7) adds roughly 200-400ms of latency per request. Entity
        extraction (step 10) is fully asynchronous and does not affect response time.
      </p>
    </DocPage>
  );
}
