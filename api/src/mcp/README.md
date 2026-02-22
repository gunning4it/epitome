# Epitome MCP Server

Model Context Protocol server implementation for Epitome.

## Architecture

The MCP server is integrated into the Hono API server at `/mcp`. This design:

- Shares process/runtime and DB pool with the REST API
- Enforces consent on every tool invocation
- Logs tool calls to per-user audit trails
- Supports API-key auth and OAuth 2.0 discovery flows

## Protocol Endpoint

### POST /mcp

Use MCP JSON-RPC 2.0 messages over Streamable HTTP. Supported method flow:

1. `initialize`
2. `tools/list`
3. `tools/call`

The only canonical public tools are:

- `recall`
- `memorize`
- `review`

### Legacy compatibility endpoints

Legacy REST endpoints are disabled by default:

- `GET /mcp/tools`
- `POST /mcp/call/:toolName`

Opt-in compatibility flags:

- `MCP_ENABLE_LEGACY_REST_ENDPOINTS=true`
- `MCP_ENABLE_LEGACY_TOOL_TRANSLATION=true` (for legacy tool names like `list_tables`)

## MCP Request Examples

```bash
# initialize
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer epi_..." \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc":"2.0",
    "id":1,
    "method":"initialize",
    "params":{
      "protocolVersion":"2025-03-26",
      "capabilities":{},
      "clientInfo":{"name":"local-client","version":"1.0.0"}
    }
  }'

# list tools
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer epi_..." \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc":"2.0",
    "id":2,
    "method":"tools/list",
    "params":{}
  }'

# call recall
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer epi_..." \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc":"2.0",
    "id":3,
    "method":"tools/call",
    "params":{
      "name":"recall",
      "arguments":{"topic":"food preferences","budget":"medium"}
    }
  }'
```

## The 3 MCP Tools

### 1. `recall`

Retrieve information from profile/tables/vectors/graph with optional routing mode.

### 2. `memorize`

Save or delete user knowledge. Routes to profile/table/vector paths based on args.

### 3. `review`

List/resolve memory contradictions and quality-review items.

## Authentication Flow

1. User generates API key in dashboard
2. Agent configures MCP URL: `http://localhost:3000/mcp`
3. Agent sends `Authorization: Bearer epi_...`
4. Server resolves user + agent context
5. Tool call executes only if consent is granted

## Consent Enforcement

Every MCP tool invocation:

1. Resolves `userId` + `agentId`
2. Checks `consent_rules`
3. Applies most-specific grant precedence
4. Denies by default if no grant exists
5. Audits invocation in `audit_log`

## Error Codes

- `UNAUTHORIZED` (401): Missing/invalid API key
- `CONSENT_DENIED` (403): Missing required grant
- `TOOL_NOT_FOUND` (protocol error / isError result): Unknown tool name
- `INVALID_ARGS` (400): Invalid tool arguments
- `RATE_LIMITED` (429): Rate limits exceeded
- `INTERNAL_ERROR` (500): Server error

## References

- `EPITOME_TECH_SPEC.md` — MCP architecture and sequence docs
- `.claude/skills/mcp-server/SKILL.md` — implementation guidance
