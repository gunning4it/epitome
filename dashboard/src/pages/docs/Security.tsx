import DocPage from '@/components/docs/DocPage';
import { CodeBlock } from '@/components/CodeBlock';

const headings = [
  { id: 'auth-overview', text: 'Authentication Overview', level: 2 },
  { id: 'schema-isolation', text: 'Schema Isolation', level: 2 },
  { id: 'consent-system', text: 'Consent System', level: 2 },
  { id: 'sql-sandbox', text: 'SQL Sandbox', level: 2 },
  { id: 'rate-limiting', text: 'Rate Limiting', level: 2 },
  { id: 'audit-trail', text: 'Audit Trail', level: 2 },
];

export default function Security() {
  return (
    <DocPage
      title="Security Model"
      description="Authentication, authorization, data isolation, and consent architecture."
      headings={headings}
    >
      <h2 id="auth-overview" className="text-xl font-semibold mt-8 mb-4">Authentication Overview</h2>
      <p className="text-muted-foreground mb-4">
        Epitome supports two authentication paths: OAuth sessions for human users (dashboard)
        and API keys for AI agents (MCP and REST). Both paths resolve to a user identity, but
        they have different authorization behaviors.
      </p>

      <div className="space-y-4 mb-6">
        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">OAuth 2.0 (GitHub, Google)</h4>
          <p className="text-sm text-muted-foreground mb-3">
            The dashboard uses standard OAuth 2.0 authorization code flow. Users sign in via GitHub
            or Google. On successful authentication, a secure HTTP-only session cookie is set.
            The session maps to a user record in the <code className="text-foreground bg-muted px-1 rounded">shared.sessions</code> table.
          </p>
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">Session-authenticated requests bypass the consent system</strong> because
            the user is directly interacting with their own data. There is no need for an intermediary
            consent grant when the data owner is the one making the request.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-2">API Keys (AI Agents)</h4>
          <p className="text-sm text-muted-foreground mb-3">
            Each AI agent is issued an API key (prefixed <code className="text-foreground bg-muted px-1 rounded">epi_live_</code> for
            production or <code className="text-foreground bg-muted px-1 rounded">epi_test_</code> for test environments).
            The key is passed in the <code className="text-foreground bg-muted px-1 rounded">Authorization: Bearer</code> header.
            Keys are hashed with Argon2 before storage — the plaintext key is shown only once at creation time.
          </p>
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">API key requests are subject to the consent system.</strong> Before
            an agent can access a resource, the user must grant explicit consent via the dashboard.
          </p>
        </div>
      </div>

      <CodeBlock
        language="text"
        code={`Authentication Flow:

Request arrives
  │
  ├── Has session cookie? → Validate session → Session auth (bypass consent)
  │
  └── Has Authorization header? → Validate API key → Agent auth (check consent)
        │
        ├── Key valid? → Resolve user_id + agent_id
        └── Key invalid? → 401 Unauthorized`}
      />

      <h2 id="schema-isolation" className="text-xl font-semibold mt-10 mb-4">Schema Isolation</h2>
      <p className="text-muted-foreground mb-4">
        Epitome uses PostgreSQL schemas to provide <strong className="text-foreground">hard data isolation</strong> between
        users. Unlike row-level security (RLS), which relies on runtime policies to filter data,
        schema isolation physically separates each user's data into its own namespace.
      </p>
      <p className="text-muted-foreground mb-4">
        This means a bug in a query — a missing WHERE clause, an injection attempt, a malformed
        join — cannot accidentally return another user's data. The search path is locked to the
        authenticated user's schema within the transaction.
      </p>
      <CodeBlock
        language="typescript"
        code={`// How schema isolation is enforced in every database operation
export async function withUserSchema<T>(
  userId: string,
  fn: (tx: Transaction) => Promise<T>
): Promise<T> {
  const schemaName = \`user_\${userId}\`;

  return sql.begin(async (tx) => {
    // Lock the search path to this user's schema for the transaction
    await tx\`SET LOCAL search_path = \${tx(schemaName)}, public\`;

    // All queries in fn() now resolve to user's schema
    return fn(tx);
  });
}`}
      />
      <p className="text-muted-foreground mt-4 mb-4">
        <strong className="text-foreground">Key properties of schema isolation:</strong>
      </p>
      <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-6 ml-2">
        <li>Each user's data lives in a separate PostgreSQL schema (e.g., <code className="text-foreground bg-muted px-1 rounded">user_abc123</code>)</li>
        <li><code className="text-foreground bg-muted px-1 rounded">SET LOCAL search_path</code> is transaction-scoped — it cannot leak between connections</li>
        <li>No composite indexes with user_id needed — tables are inherently single-user</li>
        <li>Per-user backups are trivial: <code className="text-foreground bg-muted px-1 rounded">pg_dump -n user_abc123</code></li>
        <li>User deletion is a clean <code className="text-foreground bg-muted px-1 rounded">DROP SCHEMA user_abc123 CASCADE</code></li>
        <li>No risk of cross-user data leaks even with SQL injection in dynamic queries</li>
      </ul>

      <h2 id="consent-system" className="text-xl font-semibold mt-10 mb-4">Consent System</h2>
      <p className="text-muted-foreground mb-4">
        The consent system controls which resources each AI agent can access. This gives users
        fine-grained control over their data. An agent's first request to a new resource type
        will fail with a <code className="text-foreground bg-muted px-1 rounded">CONSENT_REQUIRED</code> error
        until the user grants permission via the dashboard.
      </p>

      <h3 className="text-lg font-medium mt-6 mb-3">Resource Types</h3>
      <div className="overflow-x-auto mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="pb-2 pr-4 font-medium text-foreground">Resource</th>
              <th className="pb-2 pr-4 font-medium text-foreground">Read Tools</th>
              <th className="pb-2 font-medium text-foreground">Write Tools</th>
            </tr>
          </thead>
          <tbody className="text-muted-foreground">
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs text-foreground">profile</td>
              <td className="py-2 pr-4 text-xs">recall (context)</td>
              <td className="py-2 text-xs">memorize (category:"profile")</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs text-foreground">tables</td>
              <td className="py-2 pr-4 text-xs">recall (mode:"table")</td>
              <td className="py-2 text-xs">memorize (default)</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs text-foreground">vectors</td>
              <td className="py-2 pr-4 text-xs">recall (mode:"memory")</td>
              <td className="py-2 text-xs">memorize (storage:"memory")</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs text-foreground">graph</td>
              <td className="py-2 pr-4 text-xs">recall (mode:"graph")</td>
              <td className="py-2 text-xs">(auto-managed)</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs text-foreground">memory</td>
              <td className="py-2 pr-4 text-xs">review (list)</td>
              <td className="py-2 text-xs">review (resolve)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 className="text-lg font-medium mt-6 mb-3">Hierarchical Matching</h3>
      <p className="text-muted-foreground mb-4">
        Consent uses hierarchical matching. A consent grant for a parent resource automatically
        covers all child resources. For example, granting consent for
        <code className="text-foreground bg-muted px-1 rounded ml-1">graph</code> also grants access to
        <code className="text-foreground bg-muted px-1 rounded ml-1">graph/stats</code>,
        <code className="text-foreground bg-muted px-1 rounded ml-1">graph/query</code>, and
        <code className="text-foreground bg-muted px-1 rounded ml-1">graph/entities</code>.
      </p>
      <CodeBlock
        language="typescript"
        code={`// Consent check pseudocode
function hasConsent(agentId: string, resource: string, permission: string): boolean {
  // Check exact match first
  if (findConsent(agentId, resource, permission)) return true;

  // Check parent resources (hierarchical matching)
  // "graph/stats" → check "graph" → check "*"
  const parts = resource.split('/');
  while (parts.length > 1) {
    parts.pop();
    const parent = parts.join('/');
    if (findConsent(agentId, parent, permission)) return true;
  }

  return false;
}`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">Consent Flow</h3>
      <CodeBlock
        language="text"
        code={`Agent calls memorize (requires 'vectors' write consent)
  │
  ├── Check agent_consent table for (agent_id, 'vectors', 'write'|'read_write')
  │
  ├── Found? → Proceed with request
  │
  └── Not found? → Return 403 CONSENT_REQUIRED
        │
        └── Error includes: { resource: 'vectors', permission: 'write',
              message: "Grant consent in the Epitome dashboard" }
              │
              └── User opens dashboard → Agents page → Grant 'vectors' write to agent
                    │
                    └── Next request succeeds`}
      />

      <h2 id="sql-sandbox" className="text-xl font-semibold mt-10 mb-4">SQL Sandbox</h2>
      <p className="text-muted-foreground mb-4">
        Some features (like advanced table queries) allow parameterized SQL-like operations.
        These are sandboxed to prevent dangerous operations. The sandbox enforces:
      </p>
      <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-6 ml-2">
        <li><strong className="text-foreground">Read-only by default:</strong> Only SELECT queries are allowed through query endpoints. Write operations go through dedicated insert/update/delete endpoints.</li>
        <li><strong className="text-foreground">Schema-locked:</strong> Queries always run with the user's schema search path. There is no way to access another user's schema or the shared schema tables.</li>
        <li><strong className="text-foreground">No DDL:</strong> CREATE, ALTER, DROP, TRUNCATE and other schema-modifying statements are blocked.</li>
        <li><strong className="text-foreground">No system functions:</strong> Calls to <code className="text-foreground bg-muted px-1 rounded">pg_catalog</code>, <code className="text-foreground bg-muted px-1 rounded">information_schema</code>, and system functions are blocked.</li>
        <li><strong className="text-foreground">Statement timeout:</strong> A per-statement timeout (default 5 seconds) prevents runaway queries.</li>
        <li><strong className="text-foreground">Parameterized queries:</strong> All user-provided values are passed as parameters, never interpolated into SQL strings.</li>
      </ul>

      <h2 id="rate-limiting" className="text-xl font-semibold mt-10 mb-4">Rate Limiting</h2>
      <p className="text-muted-foreground mb-4">
        Rate limiting protects the service from abuse and ensures fair resource allocation.
        Limits are applied per-user and per-agent.
      </p>
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="pb-2 pr-4 font-medium text-foreground">Operation</th>
              <th className="pb-2 pr-4 font-medium text-foreground">Limit</th>
              <th className="pb-2 font-medium text-foreground">Window</th>
            </tr>
          </thead>
          <tbody className="text-muted-foreground">
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4">General API requests</td>
              <td className="py-2 pr-4 font-mono text-xs">100 requests</td>
              <td className="py-2 text-xs">per minute per agent</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4">Vector store (memorize)</td>
              <td className="py-2 pr-4 font-mono text-xs">30 requests</td>
              <td className="py-2 text-xs">per minute per agent</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4">Vector search (recall)</td>
              <td className="py-2 pr-4 font-mono text-xs">60 requests</td>
              <td className="py-2 text-xs">per minute per agent</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4">Profile updates</td>
              <td className="py-2 pr-4 font-mono text-xs">10 requests</td>
              <td className="py-2 text-xs">per minute per agent</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4">Entity extraction (async)</td>
              <td className="py-2 pr-4 font-mono text-xs">20 requests</td>
              <td className="py-2 text-xs">per minute per user</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground mb-4">
        Rate limit responses include standard headers:
      </p>
      <CodeBlock
        language="text"
        code={`HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1708185600
Retry-After: 45

{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded. Retry after 45 seconds."
  }
}`}
      />

      <h2 id="audit-trail" className="text-xl font-semibold mt-10 mb-4">Audit Trail</h2>
      <p className="text-muted-foreground mb-4">
        Every significant action is logged to the <code className="text-foreground bg-muted px-1 rounded">activity_log</code> table
        in the user's schema. This provides a complete audit trail of what agents and the user
        have done with their data.
      </p>

      <h3 className="text-lg font-medium mt-6 mb-3">What Gets Logged</h3>
      <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-6 ml-2">
        <li><strong className="text-foreground">MCP tool calls:</strong> Every tool invocation with tool name, parameters, and result status</li>
        <li><strong className="text-foreground">REST API writes:</strong> Profile updates, record inserts/updates/deletes, vector stores</li>
        <li><strong className="text-foreground">Dashboard actions:</strong> Profile edits, consent grants/revocations, entity merges, memory review resolutions</li>
        <li><strong className="text-foreground">Agent events:</strong> Agent registration, key rotation, access revocation</li>
        <li><strong className="text-foreground">System events:</strong> Entity extraction completions, contradiction detections</li>
      </ul>

      <h3 className="text-lg font-medium mt-6 mb-3">Log Entry Structure</h3>
      <CodeBlock
        language="json"
        code={`{
  "id": "act_abc123",
  "agent_id": "agent_claude_desktop",  // null for dashboard/system actions
  "action": "memorize",
  "resource": "vectors/facts",
  "details": {
    "content_preview": "My daughter Emma starts kindergarten...",
    "collection": "family",
    "entities_extracted": ["Emma", "Lincoln Elementary"],
    "confidence": 0.95
  },
  "created_at": "2026-02-17T14:30:00Z"
}`}
      />
      <p className="text-muted-foreground mt-4 mb-4">
        <strong className="text-foreground">Retention:</strong> Activity logs are retained indefinitely
        for self-hosted instances. The hosted service retains logs for 90 days by default, with
        an option to export before deletion. The Activity page in the dashboard provides a
        filterable, searchable view of the complete audit trail.
      </p>
    </DocPage>
  );
}
