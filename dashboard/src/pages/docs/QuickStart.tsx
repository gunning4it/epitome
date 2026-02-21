import DocPage from '@/components/docs/DocPage';
import { CodeBlock } from '@/components/CodeBlock';
import { Badge } from '@/components/ui/badge';

const headings = [
  { id: 'prerequisites', text: 'Prerequisites', level: 2 },
  { id: 'hosted-setup', text: 'Hosted Setup', level: 2 },
  { id: 'self-hosted-setup', text: 'Self-Hosted Setup', level: 2 },
  { id: 'connect-agent', text: 'Connect Your First Agent', level: 2 },
  { id: 'system-prompt', text: 'System Prompt Template', level: 2 },
  { id: 'verify', text: 'Verify It Works', level: 2 },
];

export default function QuickStart() {
  return (
    <DocPage
      title="Quick Start"
      description="Get Epitome running and connect your first AI agent in under 2 minutes."
      headings={headings}
    >
      <h2 id="prerequisites" className="text-xl font-semibold mt-8 mb-4">Prerequisites</h2>
      <p className="text-muted-foreground mb-4">
        Depending on whether you use the hosted service or self-host, you will need different tools installed.
      </p>
      <div className="space-y-2 mb-6">
        <div className="flex items-center gap-3">
          <Badge className="bg-green-500/10 text-green-400 border-green-500/20">Hosted</Badge>
          <span className="text-sm text-muted-foreground">No local tools required. Just sign up at epitome.fyi.</span>
        </div>
        <div className="flex items-center gap-3">
          <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20">Self-hosted</Badge>
          <span className="text-sm text-muted-foreground">The following are required for self-hosting:</span>
        </div>
      </div>
      <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-6 ml-2">
        <li><strong className="text-foreground">Node.js 22+</strong> — Runtime for the API server</li>
        <li><strong className="text-foreground">PostgreSQL 17</strong> with <strong className="text-foreground">pgvector 0.8+</strong> — Primary datastore with vector search</li>
        <li><strong className="text-foreground">Docker</strong> (optional) — Simplest way to run everything locally</li>
        <li><strong className="text-foreground">OpenAI API key</strong> — Required for entity extraction and embeddings (gpt-5-mini + text-embedding-3-small)</li>
      </ul>

      <h2 id="hosted-setup" className="text-xl font-semibold mt-10 mb-4">Hosted Setup</h2>
      <p className="text-muted-foreground mb-4">
        The fastest way to get started is with the hosted version at <strong className="text-foreground">epitome.fyi</strong>.
        There is nothing to install — you get a fully managed Epitome instance with your own
        isolated database schema.
      </p>
      <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-2 mb-4 ml-2">
        <li>Visit <strong className="text-foreground">epitome.fyi</strong> and sign in with GitHub or Google</li>
        <li>Copy your personal MCP URL from the dashboard Settings page</li>
        <li>Configure your AI agent to use that URL (see <a href="#connect-agent" className="text-blue-400 hover:underline">Connect Your First Agent</a> below)</li>
      </ol>
      <p className="text-muted-foreground mb-4">
        Your MCP URL will look something like this:
      </p>
      <CodeBlock
        language="text"
        code="https://epitome.fyi/mcp/usr_abc123def456"
      />

      <h2 id="self-hosted-setup" className="text-xl font-semibold mt-10 mb-4">Self-Hosted Setup</h2>
      <p className="text-muted-foreground mb-4">
        Clone the repository and start the services with Docker Compose:
      </p>
      <CodeBlock
        language="bash"
        code={`# Clone the repository
git clone https://github.com/gunning4it/epitome.git
cd epitome

# Copy and configure environment variables
cp .env.example .env
# Edit .env with your DATABASE_URL, JWT_SECRET, OPENAI_API_KEY, etc.

# Start everything with Docker Compose
docker compose up -d

# The API will be available at http://localhost:3000
# The dashboard will be available at http://localhost:5173`}
      />
      <p className="text-muted-foreground mt-4 mb-4">
        Docker Compose starts three containers: the PostgreSQL database (with pgvector pre-installed),
        the Hono API server, and the React dashboard. The <code className="text-foreground bg-muted px-1 rounded">init.sql</code> file
        runs automatically on first startup to create the shared schema, extensions, and bootstrap data.
      </p>
      <p className="text-muted-foreground mb-4">
        If you prefer to run services individually (without Docker), see the{' '}
        <a href="/docs/self-hosting" className="text-blue-400 hover:underline">Self-Hosting Guide</a> for
        detailed instructions.
      </p>

      <h2 id="connect-agent" className="text-xl font-semibold mt-10 mb-4">Connect Your First Agent</h2>
      <p className="text-muted-foreground mb-4">
        Epitome uses the Model Context Protocol (MCP) to communicate with AI agents.
        Configure your agent with Epitome's MCP server URL and it will gain access to 3 tools
        for reading/writing your profile, memories, tables, knowledge graph, and activity log.
      </p>

      <h3 className="text-lg font-medium mt-6 mb-3">Claude Desktop</h3>
      <p className="text-muted-foreground mb-3">
        Add the following to your Claude Desktop MCP configuration file
        (<code className="text-foreground bg-muted px-1 rounded">claude_desktop_config.json</code>):
      </p>
      <CodeBlock
        language="json"
        code={`{
  "mcpServers": {
    "epitome": {
      "url": "https://epitome.fyi/mcp/YOUR_MCP_TOKEN"
    }
  }
}`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">Claude Code</h3>
      <p className="text-muted-foreground mb-3">
        Add Epitome as an MCP server in your project or global settings:
      </p>
      <CodeBlock
        language="bash"
        code={`claude mcp add epitome \\
  --transport streamable-http \\
  https://epitome.fyi/mcp/YOUR_MCP_TOKEN`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">OpenClaw</h3>
      <p className="text-muted-foreground mb-3">
        Running agents locally
        with <a href="https://openclaw.ai" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">OpenClaw</a>?
        Epitome works seamlessly as the shared memory layer — every local agent gets the same context.
        See the <a href="/docs/architecture#integrations" className="text-blue-400 hover:underline">Architecture</a> page
        for the full integration pattern.
      </p>

      <h3 className="text-lg font-medium mt-6 mb-3">Self-hosted</h3>
      <p className="text-muted-foreground mb-3">
        For self-hosted instances, replace the URL with your local server and use an API key for authentication:
      </p>
      <CodeBlock
        language="json"
        code={`{
  "mcpServers": {
    "epitome": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`}
      />

      <h2 id="system-prompt" className="text-xl font-semibold mt-10 mb-4">System Prompt Template</h2>
      <p className="text-muted-foreground mb-4">
        For the best experience, include the following in your agent's system prompt so it knows
        how to use Epitome effectively. This template tells the agent what tools are available
        and when to use them:
      </p>
      <CodeBlock
        language="text"
        code={`You have access to Epitome, the user's personal AI database. Use it to:

1. RECALL at the start of every conversation by calling recall() with no arguments.
   This loads the user's profile, tables, collections, and key entities.
   When you need specific information, call recall({ topic: "..." }) to search.

2. MEMORIZE facts the user shares by calling memorize().
   For structured data: memorize({ text: "...", category: "meals", data: {...} })
   For personal info: memorize({ text: "...", category: "profile", data: {...} })
   For experiences: memorize({ text: "...", storage: "memory", collection: "journal" })

3. REVIEW contradictions when corrections arise by calling review({ action: "list" })
   then resolving with review({ action: "resolve", metaId: "...", resolution: "confirm" }).

Guidelines:
- Always recall context first in a new conversation.
- Save information proactively when the user shares personal data.
- Search with recall({ topic: "..." }) before giving personalized advice.
- Never fabricate information — if you don't know, search first.
- Respect the user's privacy: only store what they share directly.`}
      />

      <h2 id="verify" className="text-xl font-semibold mt-10 mb-4">Verify It Works</h2>
      <p className="text-muted-foreground mb-4">
        Once your agent is configured, verify the connection by asking it to interact with Epitome:
      </p>
      <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-3 mb-6 ml-2">
        <li>
          <strong className="text-foreground">Read your profile:</strong> Ask the agent{' '}
          <code className="text-foreground bg-muted px-1 rounded">"What do you know about me?"</code>{' '}
          — it should call <code className="text-foreground bg-muted px-1 rounded">recall</code> and return your profile data (or an empty profile if this is your first time).
        </li>
        <li>
          <strong className="text-foreground">Store a memory:</strong> Tell the agent something about yourself,
          like <code className="text-foreground bg-muted px-1 rounded">"I love hiking in the Cascades"</code>.
          It should call <code className="text-foreground bg-muted px-1 rounded">memorize</code>.
        </li>
        <li>
          <strong className="text-foreground">Search memories:</strong> In a new conversation, ask{' '}
          <code className="text-foreground bg-muted px-1 rounded">"What are my outdoor hobbies?"</code>{' '}
          — it should call <code className="text-foreground bg-muted px-1 rounded">recall</code> with a topic and find the hiking memory.
        </li>
        <li>
          <strong className="text-foreground">Check the dashboard:</strong> Open the Epitome dashboard and
          navigate to the Memories page. You should see the stored memory with its vector embedding
          and confidence score.
        </li>
      </ol>
      <p className="text-muted-foreground mb-4">
        If the agent reports connection errors, see the{' '}
        <a href="/docs/troubleshooting" className="text-blue-400 hover:underline">Troubleshooting</a> page for
        common issues and solutions.
      </p>
    </DocPage>
  );
}
