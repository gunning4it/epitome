# Epitome MCP Server

Model Context Protocol server implementation for Epitome.

## Architecture

The MCP server is integrated into the Hono API server as a set of routes at `/mcp/*`. This design:

- Shares the same process and database connection pool as the REST API
- Enforces consent rules on every tool invocation
- Logs all tool calls to the audit trail
- Supports both API key authentication and OAuth 2.0 discovery
- Runs strict canonical MCP by default (`recall`, `memorize`, `review` only)

## Endpoint

### `/mcp` (Streamable HTTP, JSON-RPC 2.0)

Epitome exposes MCP through a single protocol endpoint. MCP clients should call JSON-RPC methods on `/mcp`:

- `initialize`
- `tools/list`
- `tools/call`

**Headers:**
- `Authorization: Bearer epi_...` (required)
- `Content-Type: application/json`
- `Accept: application/json, text/event-stream`
- `X-Agent-ID: <agent-id>` (optional fallback for agent attribution)

**Example: tools/list**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

**Example: tools/call (recall)**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "recall",
    "arguments": {
      "topic": "books"
    }
  }
}
```

### Legacy REST compatibility

- `GET /mcp/tools` and `POST /mcp/call/:toolName` are legacy compatibility routes.
- They are disabled by default and return `410 LEGACY_ENDPOINT_DISABLED`.
- Re-enable only for temporary compatibility via:
  - `MCP_ENABLE_LEGACY_REST_ENDPOINTS=true`
  - `MCP_ENABLE_LEGACY_TOOL_TRANSLATION=true` (optional legacy tool alias translation)

### GET /.well-known/oauth-authorization-server

OAuth 2.0 authorization server metadata for AI platforms that support MCP OAuth.

## The 3 MCP Tools

Epitome exposes 3 intent-based facade tools that internally delegate to the appropriate service-layer functions. This keeps the tool surface small and easy for agents to reason about.

### 1. recall

**Purpose:** Retrieve information from all data sources.

**Arguments:**
- `topic` (optional): What to search for. Empty = general context at conversation start.
- `budget` (optional): `"small"` | `"medium"` | `"deep"` — retrieval depth.
- `mode` (optional): `"context"` | `"knowledge"` | `"memory"` | `"graph"` | `"table"` — explicit routing.
- `memory` (optional): For mode `"memory"` — `{ collection, query, minSimilarity?, limit? }`
- `graph` (optional): For mode `"graph"` — `{ queryType, entityId?, relation?, maxHops?, pattern? }`
- `table` (optional): For mode `"table"` — `"table_name"` shorthand or `{ table?, filters?, sql?, limit?, offset? }`
- `tableName` / `sql` / `filters` (optional): Additional top-level shorthands for table mode.

**Default behavior (no mode):**
- No topic → loads user context (profile, tables, collections, entities, hints)
- With topic → federated search across all sources with fusion ranking

**Advanced modes:**
- `mode:"memory"` → collection-specific vector search (requires `memory` object)
- `mode:"graph"` → graph traversal or pattern matching (requires `graph` object)
- `mode:"table"` → sandboxed SQL or filter-based table query (supports `table` string/object and top-level `tableName`/`sql`/`filters` shorthands)

**Consent Required:** Depends on routing — `profile:read`, `tables:read`, `vectors:read`, or `graph:read`

**Examples:**
```bash
# Load user context at conversation start
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer epi_..." \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"recall","arguments":{}}}'

# Federated search for a topic
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer epi_..." \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"recall","arguments":{"topic":"food preferences"}}}'

# Direct vector search
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer epi_..." \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"recall","arguments":{"mode":"memory","memory":{"collection":"journal","query":"coffee"}}}}'

# SQL query against a specific table
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer epi_..." \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"recall","arguments":{"mode":"table","table":"meals","sql":"SELECT * FROM meals WHERE calories > 500 LIMIT 10"}}}'
```

### 2. memorize

**Purpose:** Save or delete a fact, experience, or event.

**Arguments:**
- `text` (required): The fact/experience to save or forget.
- `category` (optional): Organizer — `"books"`, `"meals"`, `"profile"`, etc.
- `data` (optional): Structured fields (e.g., `{title: "Dune", rating: 5}`)
- `action` (optional): `"save"` (default) or `"delete"`
- `storage` (optional): `"record"` (default) or `"memory"` — `"memory"` = vector-only save.
- `collection` (optional): For `storage:"memory"` — vector collection name. Defaults to category.
- `metadata` (optional): For `storage:"memory"` — optional metadata. Defaults to data.

**Routing order:**
1. Validate text (empty → INVALID_ARGS)
2. `action:"delete"` → semantic search + soft-delete matching vectors
3. `storage:"memory"` → vector-only save via saveMemory
4. `category:"profile"` → deep-merge profile update
5. Default → addRecord (dual-writes table row + auto-vectorized memory)

**Consent Required:** `tables:write`, `vectors:write`, or `profile:write` (depends on route)

**Side Effects:**
- Auto-creates tables/columns for new data
- Triggers async entity extraction (non-blocking)
- Checks for contradictions after save

**Examples:**
```bash
# Save a structured record
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer epi_..." \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"memorize","arguments":{"text":"Finished reading Dune","category":"books","data":{"title":"Dune","rating":5}}}}'

# Save a journal entry (vector-only)
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer epi_..." \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"memorize","arguments":{"text":"Had a wonderful sunset walk today","storage":"memory","collection":"journal"}}}'

# Update profile
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer epi_..." \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"memorize","arguments":{"text":"I am vegetarian","category":"profile","data":{"dietary":["vegetarian"]}}}}'
```

### 3. review

**Purpose:** Check for or resolve memory contradictions.

**Arguments:**
- `action` (required): `"list"` or `"resolve"`
- `metaId` (optional): For resolve — ID of memory_meta entry
- `resolution` (optional): `"confirm"` | `"reject"` | `"keep_both"`

**Returns:**
- For list: Array of contradictions (max 5)
- For resolve: Success confirmation

**Consent Required:**
- List: `memory:read`
- Resolve: `memory:write`

**Example:**
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer epi_..." \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":20,"method":"tools/call","params":{"name":"review","arguments":{"action":"list"}}}'
```

## Authentication Flow

1. User generates API key in dashboard
2. User configures AI agent with:
   - MCP URL: `http://localhost:3000/mcp`
   - API Key: `epi_...`
3. Agent sends JSON-RPC requests (`initialize`, `tools/list`, `tools/call`) with `Authorization: Bearer epi_...`
4. Server validates API key → resolves user ID → sets search_path
5. Each tool call checks consent_rules for the agent

## Consent Enforcement

Every MCP tool invocation:
1. Extracts agent ID from request
2. Checks consent_rules table for permission
3. Most specific rule wins (e.g., `tables/meals` beats `tables/*`)
4. No rule = deny by default
5. Logs permission check to audit_log

## Error Codes

- `UNAUTHORIZED` (401): Missing/invalid API key
- `CONSENT_DENIED` (403): Agent lacks required permission
- `NOT_FOUND` (404): Tool not found
- `INVALID_ARGS` (400): Missing or invalid arguments
- `RATE_LIMITED` (429): Rate limit exceeded
- `INTERNAL_ERROR` (500): Server error

## System Prompt Template

Provide this to users for configuring their AI:

```
I have Epitome connected with my personal data, including a profile,
data tables, semantic memories, and a knowledge graph of my preferences
and relationships. At the start of conversations, call recall() with no
arguments to load my profile and understand what data I track. When I share
new personal info, save it with memorize(). When I ask about patterns,
relationships, or history, use recall() with a topic or specific mode.
If something I say contradicts what you know about me, note it — Epitome
handles conflicts automatically via review().
```

## Development

### Testing Locally

```bash
# List tools (JSON-RPC)
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer epi_..." \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# Load user context
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer epi_..." \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"recall","arguments":{}}}'

# Save a memory
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer epi_..." \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memorize","arguments":{"text":"Had pizza for dinner","category":"meals","data":{"food":"pizza","calories":800}}}}'
```

## References

- EPITOME_TECH_SPEC.md §8 - MCP Server Design
- EPITOME_TECH_SPEC.md §11 - Sequence Diagrams
- docs/reliability-redesign-validation.md - rollout validation checks
- .claude/skills/mcp-server/SKILL.md - Implementation guide
