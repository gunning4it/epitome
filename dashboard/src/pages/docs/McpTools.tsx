import DocPage from '@/components/docs/DocPage';
import { CodeBlock } from '@/components/CodeBlock';
import { ToolBlock } from '@/components/docs/ToolBlock';
import { Badge } from '@/components/ui/badge';

const headings = [
  { id: 'overview', text: 'Overview', level: 2 },
  { id: 'transport', text: 'Transport & Authentication', level: 2 },
  { id: 'read-profile', text: 'read_profile', level: 2 },
  { id: 'update-profile', text: 'update_profile', level: 2 },
  { id: 'query-table', text: 'query_table', level: 2 },
  { id: 'insert-record', text: 'insert_record', level: 2 },
  { id: 'search-memory', text: 'search_memory', level: 2 },
  { id: 'store-memory', text: 'store_memory', level: 2 },
  { id: 'query-graph', text: 'query_graph', level: 2 },
  { id: 'get-entity-neighbors', text: 'get_entity_neighbors', level: 2 },
  { id: 'log-activity', text: 'log_activity', level: 2 },
];

export default function McpTools() {
  return (
    <DocPage
      title="MCP Tools Reference"
      description="Complete reference for all 9 MCP tools available to AI agents."
      headings={headings}
    >
      <h2 id="overview" className="text-xl font-semibold mt-8 mb-4">Overview</h2>
      <p className="text-muted-foreground mb-4">
        Epitome exposes 9 tools through the Model Context Protocol (MCP). These tools allow
        any MCP-compatible AI agent to read and write your personal data, search memories,
        explore the knowledge graph, and log activity. All tools require authentication and
        are subject to the consent system.
      </p>
      <div className="flex flex-wrap gap-2 mb-6">
        <Badge className="bg-green-500/10 text-green-400 border-green-500/20">read_profile</Badge>
        <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20">update_profile</Badge>
        <Badge className="bg-green-500/10 text-green-400 border-green-500/20">query_table</Badge>
        <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20">insert_record</Badge>
        <Badge className="bg-purple-500/10 text-purple-400 border-purple-500/20">search_memory</Badge>
        <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20">store_memory</Badge>
        <Badge className="bg-green-500/10 text-green-400 border-green-500/20">query_graph</Badge>
        <Badge className="bg-green-500/10 text-green-400 border-green-500/20">get_entity_neighbors</Badge>
        <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20">log_activity</Badge>
      </div>

      <h2 id="transport" className="text-xl font-semibold mt-10 mb-4">Transport & Authentication</h2>
      <p className="text-muted-foreground mb-4">
        The MCP server uses <strong className="text-foreground">Streamable HTTP</strong> transport for
        the hosted service. Agents authenticate using their MCP URL token, which maps to an
        API key and user account. The server validates each request and checks the agent's
        consent grants before executing any tool.
      </p>
      <p className="text-muted-foreground mb-4">
        If an agent calls a tool for a resource it has not been granted consent to access,
        the server returns a consent-required error with instructions for the user to grant
        permission via the dashboard.
      </p>

      {/* Tool 1: read_profile */}
      <h2 id="read-profile" className="text-xl font-semibold mt-10 mb-4">read_profile</h2>
      <ToolBlock
        name="read_profile"
        description="Read the user's complete profile, including name, timezone, preferences, family, work, health, and any other stored profile data. This should be called at the start of every conversation to personalize the interaction."
      >
        <p className="text-xs text-muted-foreground mb-3">This tool takes no parameters.</p>
        <p className="text-xs text-muted-foreground mb-3">
          <strong className="text-foreground">Returns:</strong> The full profile JSONB document with
          version number, confidence score, and last-updated timestamp.
        </p>
        <CodeBlock
          language="json"
          code={`// Example response
{
  "version": 12,
  "confidence": 0.87,
  "updated_at": "2026-02-15T10:30:00Z",
  "data": {
    "name": "Alice Chen",
    "timezone": "America/Los_Angeles",
    "preferences": {
      "food": { "favorites": ["sushi", "pad thai"], "regional_style": "Pacific Northwest" }
    },
    "family": [
      { "name": "Bob", "relation": "spouse" },
      { "name": "Emma", "relation": "daughter", "birthday": "2019-03-15" }
    ],
    "career": {
      "primary_job": { "title": "Staff Engineer", "company": "Acme Corp" }
    }
  }
}`}
        />
      </ToolBlock>

      {/* Tool 2: update_profile */}
      <h2 id="update-profile" className="text-xl font-semibold mt-10 mb-4">update_profile</h2>
      <ToolBlock
        name="update_profile"
        description="Update one or more fields in the user's profile. Uses deep merge — only the specified fields are changed; all other data is preserved. Creates a new profile version for history tracking."
        params={[
          { name: 'data', type: 'object', required: true, description: 'An object containing the profile fields to update. Supports nested paths via dot notation or nested objects.' },
        ]}
      >
        <CodeBlock
          language="json"
          code={`// Example: update timezone and add a food preference
{
  "data": {
    "timezone": "America/New_York",
    "preferences": {
      "food": {
        "favorites": ["sushi", "pad thai", "pizza"]
      }
    }
  }
}`}
        />
      </ToolBlock>

      {/* Tool 3: query_table */}
      <h2 id="query-table" className="text-xl font-semibold mt-10 mb-4">query_table</h2>
      <ToolBlock
        name="query_table"
        description="Query records from one of the user's custom tables. Tables are user-defined structured collections (e.g., 'reading_list', 'projects', 'recipes'). Returns matching records with pagination support."
        params={[
          { name: 'table', type: 'string', required: true, description: 'Name of the table to query (e.g., "reading_list", "habits").' },
          { name: 'filters', type: 'object', required: false, description: 'Key-value pairs to filter records. Keys are column names, values are the expected values.' },
          { name: 'limit', type: 'number', required: false, description: 'Maximum number of records to return (default: 50, max: 200).' },
          { name: 'offset', type: 'number', required: false, description: 'Number of records to skip for pagination (default: 0).' },
        ]}
      >
        <CodeBlock
          language="json"
          code={`// Example: query the reading list for unread books
{
  "table": "reading_list",
  "filters": { "status": "unread" },
  "limit": 10
}

// Example response
{
  "records": [
    { "id": "rec_001", "title": "Dune", "author": "Frank Herbert", "status": "unread" },
    { "id": "rec_002", "title": "Neuromancer", "author": "William Gibson", "status": "unread" }
  ],
  "total": 15,
  "limit": 10,
  "offset": 0
}`}
        />
      </ToolBlock>

      {/* Tool 4: insert_record */}
      <h2 id="insert-record" className="text-xl font-semibold mt-10 mb-4">insert_record</h2>
      <ToolBlock
        name="insert_record"
        description="Insert a new record into one of the user's custom tables. If the table does not exist, it is automatically created with the schema inferred from the first record's fields."
        params={[
          { name: 'table', type: 'string', required: true, description: 'Name of the table to insert into. Created automatically if it does not exist.' },
          { name: 'data', type: 'object', required: true, description: 'The record data as key-value pairs. Keys become column names.' },
        ]}
      >
        <CodeBlock
          language="json"
          code={`// Example: add a book to the reading list
{
  "table": "reading_list",
  "data": {
    "title": "Snow Crash",
    "author": "Neal Stephenson",
    "status": "unread",
    "added_date": "2026-02-17"
  }
}

// Example response
{
  "id": "rec_003",
  "table": "reading_list",
  "data": {
    "title": "Snow Crash",
    "author": "Neal Stephenson",
    "status": "unread",
    "added_date": "2026-02-17"
  },
  "created_at": "2026-02-17T14:20:00Z"
}`}
        />
      </ToolBlock>

      {/* Tool 5: search_memory */}
      <h2 id="search-memory" className="text-xl font-semibold mt-10 mb-4">search_memory</h2>
      <ToolBlock
        name="search_memory"
        description="Perform semantic vector search across the user's stored memories. Uses pgvector cosine similarity to find memories that are conceptually related to the query, even if they don't share exact keywords. Essential for personalized recommendations and context-aware responses."
        params={[
          { name: 'query', type: 'string', required: true, description: 'The natural-language search query. Converted to a vector embedding for similarity search.' },
          { name: 'collection', type: 'string', required: false, description: 'Limit search to a specific vector collection (e.g., "conversations", "facts"). Omit to search all collections.' },
          { name: 'limit', type: 'number', required: false, description: 'Maximum number of results to return (default: 10, max: 50).' },
          { name: 'min_similarity', type: 'number', required: false, description: 'Minimum cosine similarity threshold, from 0 to 1 (default: 0.3). Higher values return fewer but more relevant results.' },
        ]}
      >
        <CodeBlock
          language="json"
          code={`// Example: search for outdoor activity memories
{
  "query": "outdoor hobbies and activities",
  "limit": 5,
  "min_similarity": 0.4
}

// Example response
{
  "results": [
    {
      "id": "vec_001",
      "content": "I love hiking in the Cascades, especially the PCT section near Snoqualmie Pass.",
      "collection": "interests",
      "similarity": 0.89,
      "metadata": { "source": "claude-desktop" },
      "created_at": "2026-02-10T09:15:00Z"
    },
    {
      "id": "vec_002",
      "content": "Started rock climbing at the local gym three times a week.",
      "collection": "activities",
      "similarity": 0.72,
      "metadata": { "source": "chatgpt" },
      "created_at": "2026-01-28T16:45:00Z"
    }
  ]
}`}
        />
      </ToolBlock>

      {/* Tool 6: store_memory */}
      <h2 id="store-memory" className="text-xl font-semibold mt-10 mb-4">store_memory</h2>
      <ToolBlock
        name="store_memory"
        description="Store a new memory as a vector embedding. The content is automatically embedded using text-embedding-3-small and stored in pgvector for semantic search. Also triggers async entity extraction to update the knowledge graph."
        params={[
          { name: 'content', type: 'string', required: true, description: 'The text content of the memory to store. Should be a meaningful statement or fact about the user.' },
          { name: 'collection', type: 'string', required: false, description: 'The vector collection to store in (e.g., "facts", "preferences", "conversations"). Defaults to "general".' },
          { name: 'metadata', type: 'object', required: false, description: 'Optional metadata to attach (e.g., source agent, conversation ID, tags).' },
        ]}
      >
        <CodeBlock
          language="json"
          code={`// Example: store a new memory
{
  "content": "My daughter Emma starts kindergarten in September 2026 at Lincoln Elementary.",
  "collection": "family",
  "metadata": {
    "source": "claude-desktop",
    "conversation_id": "conv_abc123"
  }
}

// Example response
{
  "id": "vec_003",
  "content": "My daughter Emma starts kindergarten in September 2026 at Lincoln Elementary.",
  "collection": "family",
  "confidence": 0.95,
  "entities_extracted": ["Emma", "Lincoln Elementary"],
  "created_at": "2026-02-17T14:30:00Z"
}`}
        />
      </ToolBlock>

      {/* Tool 7: query_graph */}
      <h2 id="query-graph" className="text-xl font-semibold mt-10 mb-4">query_graph</h2>
      <ToolBlock
        name="query_graph"
        description="Query entities in the user's knowledge graph. The graph contains people, places, organizations, and concepts extracted from memories, with typed edges representing relationships between them."
        params={[
          { name: 'entity_type', type: 'string', required: false, description: 'Filter by entity type: "person", "place", "organization", "concept", "event". Omit to return all types.' },
          { name: 'name', type: 'string', required: false, description: 'Filter entities by name (case-insensitive substring match).' },
          { name: 'limit', type: 'number', required: false, description: 'Maximum number of entities to return (default: 50, max: 200).' },
        ]}
      >
        <CodeBlock
          language="json"
          code={`// Example: find all people in the graph
{
  "entity_type": "person",
  "limit": 20
}

// Example response
{
  "entities": [
    {
      "id": "ent_001",
      "name": "Emma",
      "type": "person",
      "properties": { "relation": "daughter", "age": 6 },
      "mention_count": 12,
      "first_seen": "2026-01-05T10:00:00Z",
      "last_seen": "2026-02-17T14:30:00Z"
    },
    {
      "id": "ent_002",
      "name": "Bob",
      "type": "person",
      "properties": { "relation": "spouse" },
      "mention_count": 8,
      "first_seen": "2026-01-05T10:00:00Z",
      "last_seen": "2026-02-15T09:20:00Z"
    }
  ]
}`}
        />
      </ToolBlock>

      {/* Tool 8: get_entity_neighbors */}
      <h2 id="get-entity-neighbors" className="text-xl font-semibold mt-10 mb-4">get_entity_neighbors</h2>
      <ToolBlock
        name="get_entity_neighbors"
        description="Get all entities connected to a specific entity in the knowledge graph. Returns the entity's direct neighbors along with the typed edges connecting them. Useful for exploring relationships and building context about a person, place, or concept."
        params={[
          { name: 'entity_id', type: 'string', required: true, description: 'The ID of the entity whose neighbors to retrieve.' },
        ]}
      >
        <CodeBlock
          language="json"
          code={`// Example: get neighbors of Emma
{
  "entity_id": "ent_001"
}

// Example response
{
  "entity": {
    "id": "ent_001",
    "name": "Emma",
    "type": "person",
    "properties": { "relation": "daughter", "age": 6 }
  },
  "neighbors": [
    {
      "entity": { "id": "ent_002", "name": "Bob", "type": "person" },
      "edge": { "type": "family_member", "direction": "outgoing", "properties": { "relation": "father" } }
    },
    {
      "entity": { "id": "ent_005", "name": "Lincoln Elementary", "type": "organization" },
      "edge": { "type": "attends", "direction": "outgoing", "properties": { "start_date": "2026-09" } }
    }
  ]
}`}
        />
      </ToolBlock>

      {/* Tool 9: log_activity */}
      <h2 id="log-activity" className="text-xl font-semibold mt-10 mb-4">log_activity</h2>
      <ToolBlock
        name="log_activity"
        description="Log an activity entry to the user's audit trail. Use this to record significant actions taken by the agent, such as making recommendations, updating records, or performing research. Helps the user track what their AI agents have been doing."
        params={[
          { name: 'action', type: 'string', required: true, description: 'A short description of the action performed (e.g., "recommended_recipe", "updated_reading_list").' },
          { name: 'details', type: 'object', required: false, description: 'Optional additional details about the action (e.g., what was recommended, what changed).' },
        ]}
      >
        <CodeBlock
          language="json"
          code={`// Example: log a recommendation action
{
  "action": "recommended_recipe",
  "details": {
    "recipe": "Salmon Teriyaki Bowl",
    "reason": "Matches user's preference for Pacific Northwest cuisine and fish",
    "dietary_check": "no known allergies"
  }
}

// Example response
{
  "id": "act_001",
  "agent_id": "agent_claude_desktop",
  "action": "recommended_recipe",
  "details": { ... },
  "created_at": "2026-02-17T14:35:00Z"
}`}
        />
      </ToolBlock>
    </DocPage>
  );
}
