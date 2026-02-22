import DocPage from '@/components/docs/DocPage';
import { CodeBlock } from '@/components/CodeBlock';

const headings = [
  { id: 'install', text: 'Install', level: 2 },
  { id: 'initialize', text: 'Initialize Client', level: 2 },
  { id: 'direct-usage', text: 'Direct SDK Usage', level: 2 },
  { id: 'profile-tables-graph', text: 'Profile, Tables, Graph', level: 2 },
  { id: 'context', text: 'User Context', level: 2 },
  { id: 'hosted-vs-self-hosted', text: 'Hosted vs Self-Hosted', level: 2 },
  { id: 'auth-errors', text: 'Auth + Error Handling', level: 2 },
  { id: 'browser-cors', text: 'Browser CORS Notes', level: 2 },
];

export default function JavaScriptSdk() {
  return (
    <DocPage
      title="JavaScript SDK"
      description="Build with Epitome using the official TypeScript client package @epitomefyi/sdk."
      headings={headings}
    >
      <p className="text-muted-foreground mb-6">
        The JavaScript SDK wraps Epitome&apos;s REST API with strong TypeScript types and sensible defaults.
        It is the fastest way to add memory, profile access, table queries, and graph queries to your app.
      </p>

      <h2 id="install" className="text-xl font-semibold mt-8 mb-4">Install</h2>
      <CodeBlock
        language="bash"
        code={`npm install @epitomefyi/sdk`}
      />
      <p className="text-muted-foreground mt-3 mb-4">
        Package page:{' '}
        <a
          href="https://www.npmjs.com/package/@epitomefyi/sdk"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:underline"
        >
          npmjs.com/package/@epitomefyi/sdk
        </a>
      </p>

      <h2 id="initialize" className="text-xl font-semibold mt-10 mb-4">Initialize Client</h2>
      <CodeBlock
        language="ts"
        code={`import { EpitomeClient } from '@epitomefyi/sdk';

const client = new EpitomeClient({
  apiKey: process.env.EPITOME_API_KEY!,
  // Optional for self-hosted:
  // baseUrl: 'http://localhost:3000',
  defaultCollection: 'memories',
});`}
      />

      <h2 id="direct-usage" className="text-xl font-semibold mt-10 mb-4">Direct SDK Usage</h2>
      <CodeBlock
        language="ts"
        code={`// Save a memory
await client.saveMemory({
  text: 'Bruce prefers concise execution updates.',
  collection: 'preferences',
  metadata: { source: 'app', channel: 'web' },
});

// Semantic search
const memoryResults = await client.searchMemory({
  query: 'What are my communication preferences?',
  collection: 'preferences',
  limit: 5,
  minSimilarity: 0.72,
});

// Alias (same as searchMemory)
const aliasResults = await client.search({ query: 'execution updates' });`}
      />

      <h2 id="profile-tables-graph" className="text-xl font-semibold mt-10 mb-4">Profile, Tables, Graph</h2>
      <CodeBlock
        language="ts"
        code={`// Profile
const profile = await client.getProfile();
await client.updateProfile({
  patch: {
    timezone: 'America/New_York',
    preferences: { communication: 'concise' },
  },
});

// Tables
await client.addRecord({
  table: 'projects',
  data: { name: 'Epitome SDK', status: 'in_progress' },
});
const tableRows = await client.queryTable({
  table: 'projects',
  filters: { status: 'in_progress' },
  limit: 20,
});
const tables = await client.listTables();

// Graph
const graph = await client.queryGraph({
  query: 'project priorities',
  limit: 10,
});`}
      />

      <h2 id="context" className="text-xl font-semibold mt-10 mb-4">User Context</h2>
      <p className="text-muted-foreground mb-3">
        `getUserContext` returns a structured snapshot (profile, tables, collections, top entities, recent memories)
        and can optionally use a topic hint.
      </p>
      <CodeBlock
        language="ts"
        code={`const context = await client.getUserContext({
  topic: 'project priorities',
});

console.log(context.profile);
console.log(context.tables);
console.log(context.hints.suggestedTools);`}
      />

      <h2 id="hosted-vs-self-hosted" className="text-xl font-semibold mt-10 mb-4">Hosted vs Self-Hosted</h2>
      <ul className="list-disc list-inside text-sm text-muted-foreground space-y-2 mb-6 ml-2">
        <li>
          <strong className="text-foreground">Hosted</strong>: default base URL is
          <code className="text-foreground bg-muted px-1 rounded ml-1">https://epitome.fyi</code>.
        </li>
        <li>
          <strong className="text-foreground">Self-hosted</strong>: set
          <code className="text-foreground bg-muted px-1 rounded ml-1">baseUrl</code>
          {' '}to your API origin, e.g.
          <code className="text-foreground bg-muted px-1 rounded ml-1">http://localhost:3000</code>.
        </li>
      </ul>

      <h2 id="auth-errors" className="text-xl font-semibold mt-10 mb-4">Auth + Error Handling</h2>
      <CodeBlock
        language="ts"
        code={`import {
  EpitomeAuthError,
  EpitomeConsentError,
  EpitomeRateLimitError,
} from '@epitomefyi/sdk';

try {
  await client.getProfile();
} catch (error) {
  if (error instanceof EpitomeAuthError) {
    // 401
  } else if (error instanceof EpitomeConsentError) {
    // 403 / consent denied
  } else if (error instanceof EpitomeRateLimitError) {
    // 429 + rateLimit metadata
    console.log(error.rateLimit);
  } else {
    throw error;
  }
}`}
      />

      <h2 id="browser-cors" className="text-xl font-semibold mt-10 mb-4">Browser CORS Notes</h2>
      <p className="text-muted-foreground mb-4">
        For production apps, prefer calling Epitome from your server/backend and keep API keys off the client.
        If you call from the browser directly, configure allowed origins and key handling carefully.
      </p>
    </DocPage>
  );
}
