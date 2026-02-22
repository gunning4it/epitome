import DocPage from '@/components/docs/DocPage';
import { CodeBlock } from '@/components/CodeBlock';
import { ToolBlock } from '@/components/docs/ToolBlock';
import { Badge } from '@/components/ui/badge';

const headings = [
  { id: 'overview', text: 'Overview', level: 2 },
  { id: 'transport', text: 'Transport & Authentication', level: 2 },
  { id: 'recall', text: 'recall', level: 2 },
  { id: 'memorize', text: 'memorize', level: 2 },
  { id: 'review', text: 'review', level: 2 },
];

export default function McpTools() {
  return (
    <DocPage
      title="MCP Tools Reference"
      description="Complete reference for the 3 intent-based facade tools available to AI agents."
      headings={headings}
    >
      <h2 id="overview" className="text-xl font-semibold mt-8 mb-4">Overview</h2>
      <p className="text-muted-foreground mb-4">
        Epitome exposes 3 intent-based facade tools through the Model Context Protocol (MCP).
        These tools internally delegate to the appropriate service-layer functions, keeping the
        tool surface small and easy for agents to reason about. Any MCP-compatible AI agent can
        use them to retrieve context, save knowledge, and manage memory quality. All tools
        require authentication and are subject to the consent system.
      </p>
      <div className="flex flex-wrap gap-2 mb-6">
        <Badge className="bg-green-500/10 text-green-400 border-green-500/20">recall</Badge>
        <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20">memorize</Badge>
        <Badge className="bg-purple-500/10 text-purple-400 border-purple-500/20">review</Badge>
      </div>

      <h2 id="transport" className="text-xl font-semibold mt-10 mb-4">Transport & Authentication</h2>
      <p className="text-muted-foreground mb-4">
        The MCP server uses <strong className="text-foreground">Streamable HTTP</strong> transport for
        the hosted service. Agents authenticate using their MCP URL token, which maps to an
        API key and user account. The server validates each request and checks the agent's
        consent grants before executing any tool.
      </p>
      <p className="text-muted-foreground mb-4">
        Tool invocation is protocol-native via JSON-RPC methods on <code className="text-xs">POST /mcp</code>{' '}
        (<code className="text-xs">initialize</code>, <code className="text-xs">tools/list</code>, <code className="text-xs">tools/call</code>).
        Legacy REST compatibility endpoints are disabled by default.
      </p>
      <p className="text-muted-foreground mb-4">
        If an agent calls a tool for a resource it has not been granted consent to access,
        the server returns a consent-required error with instructions for the user to grant
        permission via the dashboard.
      </p>

      {/* Tool 1: recall */}
      <h2 id="recall" className="text-xl font-semibold mt-10 mb-4">recall</h2>
      <ToolBlock
        name="recall"
        description="Retrieve information from all data sources. Call with no arguments at conversation start to load context, or with a topic for federated search across all sources."
        params={[
          { name: 'topic', type: 'string', required: false, description: 'What to search for. Empty = general context load.' },
          { name: 'budget', type: 'string', required: false, description: '"small" | "medium" | "deep" — retrieval depth.' },
          { name: 'mode', type: 'string', required: false, description: '"context" | "knowledge" | "memory" | "graph" | "table" — explicit routing to a specific data source.' },
          { name: 'memory', type: 'object', required: false, description: 'For mode "memory" — { collection, query, minSimilarity?, limit? }' },
          { name: 'graph', type: 'object', required: false, description: 'For mode "graph" — { queryType, entityId?, relation?, maxHops?, pattern? }' },
          { name: 'table', type: 'object', required: false, description: 'For mode "table" — { table?, filters?, sql?, limit?, offset? }' },
        ]}
      >
        <p className="text-xs text-muted-foreground mb-3">
          <strong className="text-foreground">Default behavior (no mode):</strong> When called with no
          topic, loads the user's full context (profile, tables, collections, entities, hints). When
          called with a topic, performs a federated search across all sources with fusion ranking.
        </p>
        <p className="text-xs text-muted-foreground mb-3">
          <strong className="text-foreground">Advanced modes:</strong>{' '}
          <code className="text-xs">mode:"memory"</code> routes to collection-specific vector search,{' '}
          <code className="text-xs">mode:"graph"</code> routes to graph traversal or pattern matching, and{' '}
          <code className="text-xs">mode:"table"</code> routes to sandboxed SQL or filter-based table queries.
        </p>
        <CodeBlock
          language="json"
          code={`// 1. Empty context load (call at conversation start)
{}

// 2. Federated search with topic
{"topic": "food preferences"}

// 3. mode:"memory" — vector search in a specific collection
{
  "mode": "memory",
  "memory": {
    "collection": "journal",
    "query": "coffee"
  }
}

// 4. mode:"graph" — pattern query
{
  "mode": "graph",
  "graph": {
    "queryType": "pattern",
    "pattern": "what food do I like?"
  }
}

// 5. mode:"table" — sandboxed SQL query
{
  "mode": "table",
  "table": {
    "table": "meals",
    "sql": "SELECT * FROM meals WHERE calories > 500 LIMIT 10"
  }
}`}
        />
      </ToolBlock>

      {/* Tool 2: memorize */}
      <h2 id="memorize" className="text-xl font-semibold mt-10 mb-4">memorize</h2>
      <ToolBlock
        name="memorize"
        description="Save or delete a fact, experience, or event. Routes to the appropriate storage layer based on category, storage mode, and action."
        params={[
          { name: 'text', type: 'string', required: true, description: 'The fact/experience to save or forget.' },
          { name: 'category', type: 'string', required: false, description: 'Organizer — "books", "meals", "profile", etc.' },
          { name: 'data', type: 'object', required: false, description: 'Structured fields (e.g., {title: "Dune", rating: 5}).' },
          { name: 'action', type: 'string', required: false, description: '"save" (default) or "delete".' },
          { name: 'storage', type: 'string', required: false, description: '"record" (default) or "memory" — "memory" = vector-only save.' },
          { name: 'collection', type: 'string', required: false, description: 'For storage:"memory" — vector collection name.' },
          { name: 'metadata', type: 'object', required: false, description: 'For storage:"memory" — optional metadata.' },
        ]}
      >
        <p className="text-xs text-muted-foreground mb-3">
          <strong className="text-foreground">Routing order:</strong>
        </p>
        <ol className="text-xs text-muted-foreground mb-3 list-decimal list-inside space-y-1">
          <li>Validate text (empty text returns INVALID_ARGS)</li>
          <li><code className="text-xs">action:"delete"</code> — semantic search + soft-delete matching vectors</li>
          <li><code className="text-xs">storage:"memory"</code> — vector-only save</li>
          <li><code className="text-xs">category:"profile"</code> — deep-merge profile update</li>
          <li>Default — addRecord (dual-writes table row + auto-vectorized memory)</li>
        </ol>
        <p className="text-xs text-muted-foreground mb-3">
          <strong className="text-foreground">Side effects:</strong> Auto-creates tables and columns
          for new data, triggers async entity extraction, and checks for contradictions after save.
        </p>
        <CodeBlock
          language="json"
          code={`// 1. Structured record (dual-writes table row + vector memory)
{
  "text": "Finished reading Dune",
  "category": "books",
  "data": {
    "title": "Dune",
    "rating": 5
  }
}

// 2. Vector-only journal entry
{
  "text": "Had a wonderful sunset walk today",
  "storage": "memory",
  "collection": "journal"
}

// 3. Profile update (deep-merge)
{
  "text": "I am vegetarian",
  "category": "profile",
  "data": {
    "dietary": ["vegetarian"]
  }
}`}
        />
      </ToolBlock>

      {/* Tool 3: review */}
      <h2 id="review" className="text-xl font-semibold mt-10 mb-4">review</h2>
      <ToolBlock
        name="review"
        description="Check for or resolve memory contradictions. Use to list pending contradictions or resolve them by confirming, rejecting, or keeping both entries."
        params={[
          { name: 'action', type: 'string', required: true, description: '"list" or "resolve".' },
          { name: 'metaId', type: 'number', required: false, description: 'For resolve — ID of the memory_meta entry to resolve.' },
          { name: 'resolution', type: 'string', required: false, description: '"confirm" | "reject" | "keep_both".' },
        ]}
      >
        <CodeBlock
          language="json"
          code={`// 1. List pending contradictions
{"action": "list"}

// 2. Resolve a specific contradiction
{
  "action": "resolve",
  "metaId": 123,
  "resolution": "confirm"
}`}
        />
      </ToolBlock>
    </DocPage>
  );
}
