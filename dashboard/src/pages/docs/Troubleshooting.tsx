import DocPage from '@/components/docs/DocPage';
import { CodeBlock } from '@/components/CodeBlock';

const headings = [
  { id: 'connection-issues', text: 'Connection Issues', level: 2 },
  { id: 'mcp-issues', text: 'MCP Connection Issues', level: 2 },
  { id: 'performance', text: 'Performance Issues', level: 2 },
  { id: 'faq', text: 'Frequently Asked Questions', level: 2 },
];

export default function Troubleshooting() {
  return (
    <DocPage
      title="Troubleshooting / FAQ"
      description="Solutions to common issues and frequently asked questions."
      headings={headings}
    >
      <h2 id="connection-issues" className="text-xl font-semibold mt-8 mb-4">Connection Issues</h2>

      <div className="space-y-6 mb-6">
        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">
            "Tenant or user not found" when connecting to the database
          </h4>
          <p className="text-sm text-muted-foreground mb-3">
            This error occurs when using a Supabase pooler URL instead of the direct connection.
            The pooler (on port 6543) uses a different authentication format than the direct
            connection (port 5432).
          </p>
          <p className="text-sm text-muted-foreground mb-3">
            <strong className="text-foreground">Fix:</strong> Use the direct connection URL with port 5432:
          </p>
          <CodeBlock
            language="text"
            code={`# Wrong (pooler) - causes "Tenant or user not found"
postgres://postgres.PROJECT_REF:password@pooler.supabase.com:6543/postgres

# Correct (direct connection)
postgres://postgres:password@db.PROJECT_REF.supabase.co:5432/postgres`}
          />
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">
            SSL connection error in production
          </h4>
          <p className="text-sm text-muted-foreground mb-3">
            When <code className="text-foreground bg-muted px-1 rounded">NODE_ENV=production</code>, the database
            connection requires SSL. If your PostgreSQL instance does not have SSL configured
            (common in local Docker setups), you will see SSL-related connection errors.
          </p>
          <p className="text-sm text-muted-foreground mb-3">
            <strong className="text-foreground">Fix:</strong> For local development, set <code className="text-foreground bg-muted px-1 rounded">NODE_ENV=development</code>.
            For production with services like Supabase, SSL is already configured — just ensure
            your connection string does not include <code className="text-foreground bg-muted px-1 rounded">sslmode=disable</code>.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">
            "pgvector extension not found" / "type 'vector' does not exist"
          </h4>
          <p className="text-sm text-muted-foreground mb-3">
            The pgvector extension is required but is not installed by default on all PostgreSQL
            installations. Managed services like Fly.io Postgres do not include pgvector.
          </p>
          <p className="text-sm text-muted-foreground mb-3">
            <strong className="text-foreground">Fix:</strong> Use one of these options:
          </p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 ml-2">
            <li>Use the <code className="text-foreground bg-muted px-1 rounded">pgvector/pgvector:pg17</code> Docker image (includes pgvector)</li>
            <li>Use Supabase (includes pgvector on all plans)</li>
            <li>Install pgvector manually: <code className="text-foreground bg-muted px-1 rounded">apt install postgresql-17-pgvector</code></li>
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">
            Database connection pool exhaustion
          </h4>
          <p className="text-sm text-muted-foreground mb-3">
            If you see "too many clients" or connection timeout errors, the connection pool is
            exhausted. This typically happens when running tests in parallel or when the pool
            size is too small for the workload.
          </p>
          <p className="text-sm text-muted-foreground mb-3">
            <strong className="text-foreground">Fix:</strong> Increase the pool size in the DATABASE_URL or
            reduce concurrent connections. For testing, ensure <code className="text-foreground bg-muted px-1 rounded">fileParallelism: false</code> and
            <code className="text-foreground bg-muted px-1 rounded ml-1">singleFork: true</code> are set in vitest.config.ts.
          </p>
        </div>
      </div>

      <h2 id="mcp-issues" className="text-xl font-semibold mt-10 mb-4">MCP Connection Issues</h2>

      <div className="space-y-6 mb-6">
        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">
            Agent cannot connect to the MCP server
          </h4>
          <p className="text-sm text-muted-foreground mb-3">
            Verify the MCP URL is correct and the server is running. For self-hosted instances,
            ensure the agent can reach the server on the network.
          </p>
          <p className="text-sm text-muted-foreground mb-3">
            <strong className="text-foreground">Checklist:</strong>
          </p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 ml-2 mb-3">
            <li>Is the API server running? Check with <code className="text-foreground bg-muted px-1 rounded">curl http://localhost:3000/health</code></li>
            <li>Is the MCP URL correct? It should end with your token, not a trailing slash</li>
            <li>Is the transport type correct? Epitome uses Streamable HTTP, not stdio</li>
            <li>Is the firewall allowing connections on the API port?</li>
          </ul>
          <CodeBlock
            language="bash"
            code={`# Test the MCP endpoint directly
curl -X POST http://localhost:3000/mcp \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'`}
          />
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">
            "CONSENT_REQUIRED" error when calling a tool
          </h4>
          <p className="text-sm text-muted-foreground mb-3">
            The agent has not been granted consent to access the requested resource. Each agent
            must be explicitly authorized by the user through the dashboard.
          </p>
          <p className="text-sm text-muted-foreground mb-3">
            <strong className="text-foreground">Fix:</strong> Open the Epitome dashboard, go to the Agents page,
            find the agent, and grant the required permissions (e.g., "vectors: read_write" for
            recall (memory mode) and memorize (memory storage)).
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">
            "Tool not found" error
          </h4>
          <p className="text-sm text-muted-foreground mb-3">
            The agent is trying to call a tool that does not exist. This can happen if the agent's
            tool list is cached or outdated.
          </p>
          <p className="text-sm text-muted-foreground mb-3">
            <strong className="text-foreground">Fix:</strong> Verify the tool name matches exactly (e.g.,
            <code className="text-foreground bg-muted px-1 rounded">memorize</code>, not <code className="text-foreground bg-muted px-1 rounded">Memorize</code>).
            Restart the agent to refresh its tool list. The available tools are:
            recall, memorize, review.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">
            Agent sees empty results from recall
          </h4>
          <p className="text-sm text-muted-foreground mb-3">
            If search returns empty results when you know there are stored memories, the issue
            may be the similarity threshold or the embedding model configuration.
          </p>
          <p className="text-sm text-muted-foreground mb-3">
            <strong className="text-foreground">Fix:</strong> Lower the minimum similarity using memory mode:
            <code className="text-foreground bg-muted px-1 rounded">recall({'{'} mode: "memory", memory: {'{'} minSimilarity: 0.2 {'}'} {'}'})</code>.
            Verify that the <code className="text-foreground bg-muted px-1 rounded">OPENAI_EMBEDDING_MODEL</code> environment
            variable matches the model used to create the embeddings. If you changed models,
            existing embeddings will not match new queries.
          </p>
        </div>
      </div>

      <h2 id="performance" className="text-xl font-semibold mt-10 mb-4">Performance Issues</h2>

      <div className="space-y-6 mb-6">
        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">
            Slow vector search queries
          </h4>
          <p className="text-sm text-muted-foreground mb-3">
            Vector search performance depends on the HNSW index. If queries are slow, the index
            may not have been created or may need tuning.
          </p>
          <p className="text-sm text-muted-foreground mb-3">
            <strong className="text-foreground">Fix:</strong> Verify the HNSW index exists:
          </p>
          <CodeBlock
            language="sql"
            code={`-- Check if the HNSW index exists
SELECT indexname FROM pg_indexes
WHERE tablename = 'vector_entries'
AND indexdef LIKE '%hnsw%';

-- If missing, create it
CREATE INDEX idx_vector_entries_embedding
ON vector_entries USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);`}
          />
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">
            Deadlocks in withUserSchema
          </h4>
          <p className="text-sm text-muted-foreground mb-3">
            Deadlocks can occur if <code className="text-foreground bg-muted px-1 rounded">withUserSchema()</code> calls
            are nested. Each call acquires a database connection from the pool and opens a
            transaction. With a small pool, the inner call may wait for a connection that the
            outer call is holding.
          </p>
          <p className="text-sm text-muted-foreground mb-3">
            <strong className="text-foreground">Fix:</strong> Never nest <code className="text-foreground bg-muted px-1 rounded">withUserSchema()</code> calls.
            Instead, use the <code className="text-foreground bg-muted px-1 rounded">*Internal(tx, ...)</code> variant
            of service functions that accepts an existing transaction:
          </p>
          <CodeBlock
            language="typescript"
            code={`// Wrong - causes deadlock
await withUserSchema(userId, async (tx) => {
  const profile = await getProfile(userId); // opens another withUserSchema!
});

// Correct - pass the transaction
await withUserSchema(userId, async (tx) => {
  const profile = await getProfileInternal(tx); // reuses existing transaction
});`}
          />
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">
            High latency on memorize calls
          </h4>
          <p className="text-sm text-muted-foreground mb-3">
            The <code className="text-foreground bg-muted px-1 rounded">memorize</code> tool generates an embedding
            via the OpenAI API, which adds 200-400ms of latency. Entity extraction runs
            asynchronously and does not affect response time.
          </p>
          <p className="text-sm text-muted-foreground mb-3">
            <strong className="text-foreground">Fix:</strong> This latency is expected. If it is too high, check
            your OpenAI API response times separately. You can also batch multiple memories in
            quick succession — each call is independent.
          </p>
        </div>
      </div>

      <h2 id="faq" className="text-xl font-semibold mt-10 mb-4">Frequently Asked Questions</h2>

      <div className="space-y-6 mb-6">
        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">
            Can multiple agents share the same Epitome account?
          </h4>
          <p className="text-sm text-muted-foreground">
            Yes! That is the core design of Epitome. Each AI agent (Claude, ChatGPT, custom bots)
            gets its own API key and consent permissions, but they all read from and write to the
            same user data. This means Claude can see what ChatGPT stored, and vice versa. You
            control what each agent can access via the consent system.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">
            How is my data protected from other users?
          </h4>
          <p className="text-sm text-muted-foreground">
            Epitome uses per-user PostgreSQL schemas for hard data isolation. Your data lives in
            a completely separate namespace from every other user. Even if there were a SQL
            injection bug, it could only access data within your own schema. See the{' '}
            <a href="/docs/security#schema-isolation" className="text-blue-400 hover:underline">Schema Isolation</a> section
            for technical details.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">
            Can I export all my data?
          </h4>
          <p className="text-sm text-muted-foreground">
            Yes. For self-hosted instances, you can use <code className="text-foreground bg-muted px-1 rounded">pg_dump</code> to
            export your entire schema. For the hosted service, the dashboard Settings page provides
            a data export feature that generates a JSON archive of all your data (profile, memories,
            tables, knowledge graph, activity log).
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">
            What happens if I delete my account?
          </h4>
          <p className="text-sm text-muted-foreground">
            Account deletion drops your entire PostgreSQL schema (<code className="text-foreground bg-muted px-1 rounded">DROP SCHEMA CASCADE</code>),
            removing all profile data, memories, tables, graph entities, activity logs, and
            consent records. This is irreversible. Your shared account record and API keys are
            also deleted.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">
            Does Epitome send my data to OpenAI?
          </h4>
          <p className="text-sm text-muted-foreground">
            Epitome sends two types of data to OpenAI: (1) text content for embedding generation
            (via text-embedding-3-small), and (2) memory content for entity extraction (via
            gpt-5-mini). Both are API calls subject to OpenAI's data usage policies for API
            customers (your data is not used for training). For maximum privacy, you can self-host
            and swap in a local embedding model, though entity extraction currently requires
            OpenAI.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">
            How many memories can Epitome store?
          </h4>
          <p className="text-sm text-muted-foreground">
            There is no hard limit. PostgreSQL with pgvector handles hundreds of thousands of
            1536-dimensional vectors efficiently with HNSW indexing. For personal use (thousands
            to tens of thousands of memories), performance remains excellent. The hosted service
            may impose storage quotas per plan.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">
            Can I use Epitome with agents that do not support MCP?
          </h4>
          <p className="text-sm text-muted-foreground">
            Yes. Epitome exposes a full REST API alongside the MCP server. Any agent or application
            that can make HTTP requests can use the REST API with API key authentication. The MCP
            server is simply a convenient wrapper for MCP-native agents like Claude.
          </p>
        </div>
      </div>
    </DocPage>
  );
}
