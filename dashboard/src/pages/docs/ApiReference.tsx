import DocPage from '@/components/docs/DocPage';
import { CodeBlock } from '@/components/CodeBlock';
import { EndpointBlock } from '@/components/docs/EndpointBlock';

const headings = [
  { id: 'authentication', text: 'Authentication', level: 2 },
  { id: 'profile', text: 'Profile', level: 2 },
  { id: 'tables', text: 'Tables', level: 2 },
  { id: 'vectors', text: 'Vectors', level: 2 },
  { id: 'memory-router', text: 'Memory Router', level: 2 },
  { id: 'graph', text: 'Graph', level: 2 },
  { id: 'memory', text: 'Memory', level: 2 },
  { id: 'activity', text: 'Activity', level: 2 },
  { id: 'agents', text: 'Agents', level: 2 },
  { id: 'errors', text: 'Error Handling', level: 2 },
];

export default function ApiReference() {
  return (
    <DocPage
      title="API Reference"
      description="Complete REST API reference with 22 endpoints grouped by resource."
      headings={headings}
    >
      <p className="text-muted-foreground mb-6">
        The Epitome REST API is served by a Hono application at <code className="text-foreground bg-muted px-1 rounded">/v1</code>.
        All endpoints return JSON responses and require authentication. The base URL is
        <code className="text-foreground bg-muted px-1 rounded ml-1">https://epitome.fyi/v1</code> for the hosted service,
        or <code className="text-foreground bg-muted px-1 rounded ml-1">http://localhost:3000/v1</code> for self-hosted instances.
      </p>

      {/* Authentication */}
      <h2 id="authentication" className="text-xl font-semibold mt-10 mb-4">Authentication</h2>
      <p className="text-muted-foreground mb-4">
        The API supports two authentication methods:
      </p>
      <div className="space-y-4 mb-6">
        <div className="rounded-lg border border-border bg-card p-4">
          <h4 className="text-sm font-semibold text-foreground mb-2">Session Cookies (Dashboard)</h4>
          <p className="text-sm text-muted-foreground">
            Used by the React dashboard. After OAuth sign-in, a secure HTTP-only session cookie
            is set. All subsequent requests from the dashboard include this cookie automatically.
            Session-authenticated requests bypass the consent system since the user is interacting
            directly with their own data.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h4 className="text-sm font-semibold text-foreground mb-2">API Keys (Agents & Programmatic Access)</h4>
          <p className="text-sm text-muted-foreground mb-3">
            Used by AI agents and external integrations. Pass the API key in the Authorization header.
            API key requests are subject to the consent system — agents must be granted per-resource
            permissions by the user.
          </p>
          <CodeBlock
            language="bash"
            code={`curl -H "Authorization: Bearer epi_live_abc123..." \\
  https://epitome.fyi/v1/profile`}
          />
        </div>
      </div>

      {/* Profile */}
      <h2 id="profile" className="text-xl font-semibold mt-10 mb-4">Profile</h2>
      <p className="text-muted-foreground mb-4">
        The profile is a versioned JSONB document containing the user's personal information.
        Every update creates a new version, preserving the full edit history.
      </p>

      <EndpointBlock
        method="GET"
        path="/v1/profile"
        description="Retrieve the user's current profile with all fields, version number, and confidence score."
        auth="Session / API Key"
      >
        <CodeBlock
          language="json"
          code={`// Response
{
  "version": 12,
  "confidence": 0.87,
  "updated_at": "2026-02-15T10:30:00Z",
  "data": {
    "name": "Alice Chen",
    "timezone": "America/Los_Angeles",
    ...
  }
}`}
        />
      </EndpointBlock>

      <EndpointBlock
        method="PATCH"
        path="/v1/profile"
        description="Update the user's profile using deep merge. Only specified fields are changed; all other data is preserved. Creates a new version."
        auth="Session / API Key"
      >
        <CodeBlock
          language="json"
          code={`// Request body
{
  "timezone": "America/New_York",
  "preferences": { "food": { "favorites": ["sushi", "pizza"] } }
}

// Response: updated profile (same format as GET)`}
        />
      </EndpointBlock>

      <EndpointBlock
        method="GET"
        path="/v1/profile/history"
        description="Retrieve the version history of the user's profile, showing all past versions with timestamps and change summaries."
        auth="Session / API Key"
      >
        <CodeBlock
          language="json"
          code={`// Response
[
  { "version": 12, "updated_at": "2026-02-15T10:30:00Z", "changed_fields": ["timezone"] },
  { "version": 11, "updated_at": "2026-02-14T08:00:00Z", "changed_fields": ["preferences.food"] },
  ...
]`}
        />
      </EndpointBlock>

      {/* Tables */}
      <h2 id="tables" className="text-xl font-semibold mt-10 mb-4">Tables</h2>
      <p className="text-muted-foreground mb-4">
        User tables are dynamic, schema-flexible collections for structured data. The schema is
        inferred from the first record inserted and can evolve over time.
      </p>

      <EndpointBlock
        method="GET"
        path="/v1/tables"
        description="List all user-defined tables with their record counts and schemas."
        auth="Session / API Key"
      />

      <EndpointBlock
        method="GET"
        path="/v1/tables/:name"
        description="Query records from a specific table. Supports filtering, sorting, pagination."
        auth="Session / API Key"
      >
        <CodeBlock
          language="text"
          code={`Query parameters:
  ?filter[status]=unread    Filter by field value
  ?sort=-created_at         Sort descending by field
  ?limit=20&offset=0        Pagination`}
        />
      </EndpointBlock>

      <EndpointBlock
        method="POST"
        path="/v1/tables/:name"
        description="Insert a new record into a table. The table is created automatically if it does not exist."
        auth="Session / API Key"
      >
        <CodeBlock
          language="json"
          code={`// Request body
{
  "title": "Snow Crash",
  "author": "Neal Stephenson",
  "status": "unread"
}`}
        />
      </EndpointBlock>

      <EndpointBlock
        method="PATCH"
        path="/v1/tables/:name/:id"
        description="Update an existing record. Only specified fields are changed."
        auth="Session / API Key"
      >
        <CodeBlock
          language="json"
          code={`// Request body
{ "status": "reading" }`}
        />
      </EndpointBlock>

      <EndpointBlock
        method="DELETE"
        path="/v1/tables/:name/:id"
        description="Delete a record from a table. Returns the deleted record."
        auth="Session / API Key"
      />

      {/* Vectors */}
      <h2 id="vectors" className="text-xl font-semibold mt-10 mb-4">Vectors</h2>
      <p className="text-muted-foreground mb-4">
        Vector endpoints manage the semantic memory system. Content is automatically embedded
        using text-embedding-3-small and stored in pgvector for cosine similarity search.
      </p>

      <EndpointBlock
        method="POST"
        path="/v1/vectors/:collection/search"
        description="Perform semantic vector search within a collection (or across all collections if collection is 'all')."
        auth="Session / API Key"
      >
        <CodeBlock
          language="json"
          code={`// Request body
{
  "query": "outdoor hobbies",
  "limit": 10,
  "min_similarity": 0.3
}`}
        />
      </EndpointBlock>

      <EndpointBlock
        method="GET"
        path="/v1/vectors/recent"
        description="Retrieve recently added vector entries across all collections, ordered by creation date."
        auth="Session / API Key"
      />

      <EndpointBlock
        method="POST"
        path="/v1/vectors/:collection"
        description="Store a new vector entry. The content is embedded automatically and entity extraction runs asynchronously."
        auth="Session / API Key"
      >
        <CodeBlock
          language="json"
          code={`// Request body
{
  "content": "I love hiking in the Cascades.",
  "metadata": { "source": "claude-desktop" }
}`}
        />
      </EndpointBlock>

      <EndpointBlock
        method="GET"
        path="/v1/vectors/collections"
        description="List all vector collections with entry counts and most recent activity."
        auth="Session / API Key"
      />

      {/* Memory Router */}
      <h2 id="memory-router" className="text-xl font-semibold mt-10 mb-4">Memory Router</h2>
      <p className="text-muted-foreground mb-4">
        Memory Router proxies supported provider calls through Epitome to inject context before generation
        and save conversation turns asynchronously after responses.
      </p>

      <EndpointBlock
        method="POST"
        path="/v1/memory-router/openai/v1/chat/completions"
        description="Proxy an OpenAI chat completion call with optional memory injection."
        auth="API Key / Session"
      >
        <CodeBlock
          language="text"
          code={`Required headers:
  X-API-Key: epi_live_...                (Epitome key)
  Authorization: Bearer sk-openai-...    (OpenAI key)

Optional headers:
  x-epitome-memory-mode: auto | off
  x-epitome-memory-collection: memories
  x-epitome-idempotency-key: req-123`}
        />
      </EndpointBlock>

      <EndpointBlock
        method="POST"
        path="/v1/memory-router/anthropic/v1/messages"
        description="Proxy an Anthropic messages call with optional memory injection."
        auth="API Key / Session"
      >
        <CodeBlock
          language="text"
          code={`Required headers:
  X-API-Key: epi_live_...                   (Epitome key)
  x-anthropic-api-key: sk-ant-...           (Anthropic key)
  anthropic-version: 2023-06-01`}
        />
      </EndpointBlock>

      <EndpointBlock
        method="GET"
        path="/v1/memory-router/settings"
        description="Get per-user Memory Router settings (dashboard/session auth only)."
        auth="Session only"
      />

      <EndpointBlock
        method="PATCH"
        path="/v1/memory-router/settings"
        description="Update per-user Memory Router settings (enable flag + default collection)."
        auth="Session only"
      >
        <CodeBlock
          language="json"
          code={`{
  "body": {
    "enabled": true,
    "defaultCollection": "memories"
  }
}`}
        />
      </EndpointBlock>

      {/* Graph */}
      <h2 id="graph" className="text-xl font-semibold mt-10 mb-4">Graph</h2>
      <p className="text-muted-foreground mb-4">
        The knowledge graph stores entities (people, places, organizations, concepts) and their
        typed relationships. Entities are extracted automatically from stored memories.
      </p>

      <EndpointBlock
        method="GET"
        path="/v1/graph/entities"
        description="List entities in the knowledge graph. Supports filtering by type and name search."
        auth="Session / API Key"
      >
        <CodeBlock
          language="text"
          code={`Query parameters:
  ?type=person              Filter by entity type
  ?name=Emma                Search by name (substring match)
  ?limit=50&offset=0        Pagination`}
        />
      </EndpointBlock>

      <EndpointBlock
        method="GET"
        path="/v1/graph/entities/:id/neighbors"
        description="Get all entities connected to a specific entity, along with the edges between them."
        auth="Session / API Key"
      />

      <EndpointBlock
        method="PATCH"
        path="/v1/graph/entities/:id"
        description="Update an entity's properties or name. Useful for correcting auto-extracted data."
        auth="Session / API Key"
      >
        <CodeBlock
          language="json"
          code={`// Request body
{
  "name": "Emma Chen",
  "properties": { "age": 7, "school": "Lincoln Elementary" }
}`}
        />
      </EndpointBlock>

      <EndpointBlock
        method="DELETE"
        path="/v1/graph/entities/:id"
        description="Delete an entity and all its edges. Use with caution — this cannot be undone."
        auth="Session / API Key"
      />

      <EndpointBlock
        method="POST"
        path="/v1/graph/entities/merge"
        description="Merge two duplicate entities into one. Combines edges, mentions, and properties. The target entity is kept; the source entity is deleted."
        auth="Session / API Key"
      >
        <CodeBlock
          language="json"
          code={`// Request body
{
  "source_id": "ent_003",
  "target_id": "ent_001"
}`}
        />
      </EndpointBlock>

      <EndpointBlock
        method="GET"
        path="/v1/graph/stats"
        description="Get summary statistics about the knowledge graph: entity counts by type, edge counts by type, total mentions."
        auth="Session / API Key"
      />

      {/* Memory */}
      <h2 id="memory" className="text-xl font-semibold mt-10 mb-4">Memory</h2>
      <p className="text-muted-foreground mb-4">
        The memory quality engine identifies contradictions, stale data, and low-confidence
        facts for human review. These endpoints power the Review page in the dashboard.
      </p>

      <EndpointBlock
        method="GET"
        path="/v1/memory/review"
        description="List memory entries flagged for review. Includes contradictions, stale data, and low-confidence items with suggested resolutions."
        auth="Session only"
      >
        <CodeBlock
          language="json"
          code={`// Response
{
  "items": [
    {
      "id": "rev_001",
      "type": "contradiction",
      "entries": ["vec_010", "vec_015"],
      "description": "Conflicting timezone: 'Pacific Time' vs 'Eastern Time'",
      "suggested_action": "keep_newer",
      "created_at": "2026-02-16T12:00:00Z"
    }
  ]
}`}
        />
      </EndpointBlock>

      <EndpointBlock
        method="POST"
        path="/v1/memory/review/:id/resolve"
        description="Resolve a flagged memory review item. The user chooses which data to keep, merge, or discard."
        auth="Session only"
      >
        <CodeBlock
          language="json"
          code={`// Request body
{
  "action": "keep_newer",
  "note": "I moved to the East Coast in January"
}`}
        />
      </EndpointBlock>

      {/* Activity */}
      <h2 id="activity" className="text-xl font-semibold mt-10 mb-4">Activity</h2>
      <p className="text-muted-foreground mb-4">
        The activity log provides an audit trail of all agent and user actions. Every MCP tool
        call, API request, and dashboard action is logged.
      </p>

      <EndpointBlock
        method="GET"
        path="/v1/activity"
        description="Retrieve the activity log with filtering by agent, action type, and date range."
        auth="Session / API Key"
      >
        <CodeBlock
          language="text"
          code={`Query parameters:
  ?agent_id=agent_001       Filter by agent
  ?action=write_pipeline      Filter by action type
  ?from=2026-02-01          Start date (ISO 8601)
  ?to=2026-02-17            End date (ISO 8601)
  ?limit=50&offset=0        Pagination`}
        />
      </EndpointBlock>

      {/* Agents */}
      <h2 id="agents" className="text-xl font-semibold mt-10 mb-4">Agents</h2>
      <p className="text-muted-foreground mb-4">
        Manage the AI agents that have access to your Epitome data. Each agent has its own API
        key and consent permissions.
      </p>

      <EndpointBlock
        method="GET"
        path="/v1/agents"
        description="List all registered agents with their names, last active times, and consent grants."
        auth="Session only"
      />

      <EndpointBlock
        method="PATCH"
        path="/v1/agents/:id"
        description="Update an agent's name or consent permissions."
        auth="Session only"
      >
        <CodeBlock
          language="json"
          code={`// Request body
{
  "name": "My Claude Desktop",
  "consent": {
    "profile": "read",
    "tables": "read_write",
    "vectors": "read_write",
    "graph": "read"
  }
}`}
        />
      </EndpointBlock>

      <EndpointBlock
        method="DELETE"
        path="/v1/agents/:id"
        description="Revoke an agent's access and delete its API key. The agent will no longer be able to connect."
        auth="Session only"
      />

      {/* Error Handling */}
      <h2 id="errors" className="text-xl font-semibold mt-10 mb-4">Error Handling</h2>
      <p className="text-muted-foreground mb-4">
        All API errors follow a consistent JSON format. The HTTP status code indicates the error
        category, and the response body provides details.
      </p>
      <CodeBlock
        language="json"
        code={`// Standard error response format
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request body",
    "details": [
      { "field": "content", "message": "Required field is missing" }
    ]
  }
}`}
      />
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="pb-2 pr-4 font-medium text-foreground">Status</th>
              <th className="pb-2 pr-4 font-medium text-foreground">Code</th>
              <th className="pb-2 font-medium text-foreground">Description</th>
            </tr>
          </thead>
          <tbody className="text-muted-foreground">
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs">400</td>
              <td className="py-2 pr-4 font-mono text-xs">VALIDATION_ERROR</td>
              <td className="py-2 text-xs">Request body or query parameters failed validation</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs">401</td>
              <td className="py-2 pr-4 font-mono text-xs">UNAUTHORIZED</td>
              <td className="py-2 text-xs">Missing or invalid authentication credentials</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs">403</td>
              <td className="py-2 pr-4 font-mono text-xs">CONSENT_REQUIRED</td>
              <td className="py-2 text-xs">Agent lacks consent for the requested resource</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs">404</td>
              <td className="py-2 pr-4 font-mono text-xs">NOT_FOUND</td>
              <td className="py-2 text-xs">Resource does not exist</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs">429</td>
              <td className="py-2 pr-4 font-mono text-xs">RATE_LIMITED</td>
              <td className="py-2 text-xs">Too many requests — wait and retry</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs">500</td>
              <td className="py-2 pr-4 font-mono text-xs">INTERNAL_ERROR</td>
              <td className="py-2 text-xs">Unexpected server error</td>
            </tr>
          </tbody>
        </table>
      </div>
    </DocPage>
  );
}
