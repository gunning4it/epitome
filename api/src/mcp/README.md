# Epitome MCP Server

Model Context Protocol server implementation for Epitome.

## Architecture

The MCP server is integrated into the Hono API server as a set of routes at `/mcp/*`. This design:

- Shares the same process and database connection pool as the REST API
- Enforces consent rules on every tool invocation
- Logs all tool calls to the audit trail
- Supports both API key authentication and OAuth 2.0 discovery

## Endpoints

### GET /mcp/tools

List all available tools with their schemas.

**Response:**
```json
{
  "tools": [
    {
      "name": "get_user_context",
      "description": "Load user's profile, preferences, and recent context...",
      "inputSchema": { ... }
    },
    ...
  ]
}
```

### POST /mcp/call/:toolName

Execute a specific MCP tool.

**Headers:**
- `Authorization: Bearer epi_...` (required) - API key
- `X-Agent-ID: claude` (optional) - Agent identifier

**Request Body:**
```json
{
  "arg1": "value1",
  "arg2": "value2"
}
```

**Response (Success):**
```json
{
  "success": true,
  "result": { ... }
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": {
    "code": "CONSENT_DENIED",
    "message": "Agent 'claude' does not have write access to tables/meals"
  }
}
```

### GET /.well-known/oauth-authorization-server

OAuth 2.0 authorization server metadata for AI platforms that support MCP OAuth.

## The 9 MCP Tools

### 1. get_user_context

**Purpose:** Load user profile + top entities + recent memories within ~2000 token budget

**Arguments:**
- `topic` (optional): Topic for relevance ranking

**Returns:**
- User profile data
- Table inventory
- Vector collection list
- Top 20 entities by composite score
- Last 10 memories

**Consent Required:** `profile:read`

**Example:**
```bash
curl -X POST http://localhost:3000/mcp/call/get_user_context \
  -H "Authorization: Bearer epi_..." \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 2. update_profile

**Purpose:** Update user profile with deep-merge (RFC 7396)

**Arguments:**
- `data` (required): Partial profile data to merge
- `reason` (optional): Description of what changed

**Returns:** Updated profile

**Consent Required:** `profile:write`

**Example:**
```bash
curl -X POST http://localhost:3000/mcp/call/update_profile \
  -H "Authorization: Bearer epi_..." \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "preferences": {
        "dietary": ["vegetarian"]
      }
    },
    "reason": "user mentioned new dietary preference"
  }'
```

### 3. list_tables

**Purpose:** List all user tables with metadata

**Arguments:** None

**Returns:** Array of table metadata

**Consent Required:** `tables/*:read`

### 4. query_table

**Purpose:** Query table records with filters or SQL

**Arguments:**
- `tableName` (required): Table name
- `filters` (optional): Structured filters
- `sql` (optional): Read-only SQL query
- `limit` (optional): Max results (default 50, max 1000)
- `offset` (optional): Pagination offset

**Returns:** Array of records

**Consent Required:** `tables/<tableName>:read`

### 5. add_record

**Purpose:** Insert a record into a table (auto-creates table/columns)

**Arguments:**
- `tableName` (required): Table name
- `data` (required): Record data as key-value pairs
- `tableDescription` (optional): Table description

**Returns:** Created record

**Consent Required:** `tables/<tableName>:write`

**Side Effects:**
- Auto-creates table if doesn't exist
- Auto-adds columns for new fields
- Triggers async entity extraction (non-blocking)

### 6. search_memory

**Purpose:** Semantic search across vector collections

**Arguments:**
- `collection` (required): Collection name
- `query` (required): Search query text
- `minSimilarity` (optional): Min threshold (default 0.7)
- `limit` (optional): Max results (default 10)

**Returns:** Array of matching memories with similarity scores

**Consent Required:** `vectors/<collection>:read`

### 7. save_memory

**Purpose:** Save a memory vector with embedding generation

**Arguments:**
- `collection` (required): Collection name
- `text` (required): Memory text
- `metadata` (optional): Additional metadata

**Returns:** Vector ID

**Consent Required:** `vectors/<collection>:write`

**Side Effects:**
- Generates embedding via OpenAI API
- Triggers async entity extraction (non-blocking)
- Triggers async thread linking (non-blocking)

### 8. query_graph

**Purpose:** Graph traversal and pattern-based queries

**Arguments:**
- `queryType` (required): "traverse" or "pattern"
- For traverse:
  - `entityId` (required): Starting entity ID
  - `relation` (optional): Relation type to follow
  - `maxHops` (optional): Max hops (default 2, max 3)
- For pattern:
  - `pattern` (required): Search criteria object

**Returns:** Entities and edges matching the query

**Consent Required:** `graph:read`

### 9. review_memories

**Purpose:** Get and resolve memory contradictions

**Arguments:**
- `action` (required): "list" or "resolve"
- For resolve:
  - `metaId` (required): Memory meta ID
  - `resolution` (required): "confirm", "reject", or "keep_both"

**Returns:**
- For list: Array of contradictions (max 5)
- For resolve: Success confirmation

**Consent Required:**
- List: `memory:read`
- Resolve: `memory:write`

## Authentication Flow

1. User generates API key in dashboard
2. User configures AI agent with:
   - MCP URL: `http://localhost:3000/mcp`
   - API Key: `epi_...`
3. Agent sends requests with `Authorization: Bearer epi_...`
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
- `FORBIDDEN` (403): No consent for resource
- `CONSENT_DENIED` (403): Agent lacks required permission
- `NOT_FOUND` (404): Tool not found
- `INVALID_ARGS` (400): Missing or invalid arguments
- `INTERNAL_ERROR` (500): Server error

## System Prompt Template

Provide this to users for configuring their AI:

```
I have Epitome connected with my personal data, including a profile,
data tables, semantic memories, and a knowledge graph of my preferences
and relationships. At the start of conversations, call get_user_context
to load my profile and understand what data I track. When I share new
personal info, save it automatically (don't ask to confirm). When I ask
about patterns, relationships, or history, use query_graph and query_table
to find connections. If something I say contradicts what you know about me,
note it — Epitome handles conflicts automatically.
```

## Development

### Testing Locally

```bash
# List tools
curl http://localhost:3000/mcp/tools

# Call get_user_context
curl -X POST http://localhost:3000/mcp/call/get_user_context \
  -H "Authorization: Bearer epi_..." \
  -H "Content-Type: application/json" \
  -d '{}'

# Add a meal record
curl -X POST http://localhost:3000/mcp/call/add_record \
  -H "Authorization: Bearer epi_..." \
  -H "Content-Type: application/json" \
  -d '{
    "tableName": "meals",
    "data": {
      "food": "pizza",
      "calories": 800,
      "date": "2026-02-12"
    }
  }'
```

### Adding New Tools

1. Create tool handler in `src/mcp/tools/<toolName>.ts`
2. Export async function matching signature: `(args: any, context: McpContext) => Promise<any>`
3. Add tool to registry in `src/mcp/server.ts`
4. Add tool definition to `getToolDefinitions()` in `src/mcp/server.ts`

## References

- EPITOME_TECH_SPEC.md §8 - MCP Server Design
- EPITOME_TECH_SPEC.md §11 - Sequence Diagrams
- .claude/skills/mcp-server/SKILL.md - Implementation guide
