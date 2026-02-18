import DocPage from '@/components/docs/DocPage';
import { CodeBlock } from '@/components/CodeBlock';

const headings = [
  { id: 'dev-setup', text: 'Development Setup', level: 2 },
  { id: 'project-structure', text: 'Project Structure', level: 2 },
  { id: 'running-tests', text: 'Running Tests', level: 2 },
  { id: 'code-style', text: 'Code Style', level: 2 },
  { id: 'pr-process', text: 'Pull Request Process', level: 2 },
];

export default function Contributing() {
  return (
    <DocPage
      title="Contributing Guide"
      description="How to set up your development environment and contribute to Epitome."
      headings={headings}
    >
      <h2 id="dev-setup" className="text-xl font-semibold mt-8 mb-4">Development Setup</h2>
      <p className="text-muted-foreground mb-4">
        Follow these steps to get a development environment running locally.
      </p>

      <h3 className="text-lg font-medium mt-6 mb-3">1. Clone and Install</h3>
      <CodeBlock
        language="bash"
        code={`# Clone the repository
git clone https://github.com/nickarino/epitome.git
cd epitome

# Install API dependencies
cd api && npm install && cd ..

# Install dashboard dependencies
cd dashboard && npm install && cd ..`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">2. Start the Database</h3>
      <p className="text-muted-foreground mb-3">
        The easiest way to get PostgreSQL with pgvector running locally is with Docker:
      </p>
      <CodeBlock
        language="bash"
        code={`# Start only the database container
docker compose up db -d

# Verify it's running
docker compose ps
# Should show: epitome-db-1  running  0.0.0.0:5432->5432/tcp`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">3. Configure Environment</h3>
      <CodeBlock
        language="bash"
        code={`# Copy the example env file
cp .env.example api/.env

# Edit api/.env with your settings:
#   DATABASE_URL=postgres://postgres:your_password@localhost:5432/epitome
#   JWT_SECRET=any-random-string-for-dev
#   OPENAI_API_KEY=sk-...  (required for entity extraction and embeddings)
#   NODE_ENV=development`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">4. Initialize the Database</h3>
      <CodeBlock
        language="bash"
        code={`# Run the init script (creates schemas, tables, extensions)
psql -h localhost -U postgres -d epitome -f init.sql`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">5. Start the Dev Servers</h3>
      <CodeBlock
        language="bash"
        code={`# Terminal 1: Start the API server (with hot reload)
cd api && npm run dev

# Terminal 2: Start the dashboard (Vite dev server)
cd dashboard && npm run dev`}
      />
      <p className="text-muted-foreground mt-3 mb-4">
        The API server will be available at <code className="text-foreground bg-muted px-1 rounded">http://localhost:3000</code> and
        the dashboard at <code className="text-foreground bg-muted px-1 rounded">http://localhost:5173</code>.
      </p>

      <h2 id="project-structure" className="text-xl font-semibold mt-10 mb-4">Project Structure</h2>
      <CodeBlock
        language="text"
        code={`epitome/
├── api/                          # Hono API server
│   ├── src/
│   │   ├── routes/               # Endpoint handlers (profile, tables, vectors, graph, etc.)
│   │   ├── services/             # Business logic (profileService, vectorService, etc.)
│   │   ├── middleware/           # Auth, rate limiting, consent, error handling
│   │   ├── mcp/                 # MCP server and 9 tool implementations
│   │   ├── validators/          # Zod schemas for request validation
│   │   └── db/                  # Database connection, withUserSchema, Drizzle config
│   ├── tests/                   # Test files (mirrors src/ structure)
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsup.config.ts           # Build config (used for production builds)
│   └── Dockerfile
│
├── dashboard/                    # React SPA
│   ├── src/
│   │   ├── components/          # Reusable UI components
│   │   │   ├── ui/              # shadcn/ui primitives (card, badge, button, etc.)
│   │   │   └── docs/            # Documentation components (DocPage, EndpointBlock, etc.)
│   │   ├── pages/               # Route pages (Profile, Graph, Memories, etc.)
│   │   │   └── docs/            # Documentation pages (you are here!)
│   │   ├── hooks/               # React hooks (useApi, useScrollSpy, etc.)
│   │   └── lib/                 # Utilities, types, API client
│   ├── vite.config.ts
│   ├── package.json
│   └── Dockerfile
│
├── init.sql                      # Database initialization script
├── docker-compose.yml            # Docker Compose for local dev / self-hosting
├── .env.example                  # Template environment variables
├── EPITOME_TECH_SPEC.md          # Technical specification (canonical)
└── EPITOME_DATA_MODEL.md         # Data model specification (canonical)`}
      />

      <h2 id="running-tests" className="text-xl font-semibold mt-10 mb-4">Running Tests</h2>
      <p className="text-muted-foreground mb-4">
        Epitome uses Vitest for unit and integration tests. The test suite is configured for
        serial execution to avoid database connection pool contention.
      </p>
      <CodeBlock
        language="bash"
        code={`# Run all tests
cd api && npm test

# Run tests in watch mode (re-runs on file change)
cd api && npm run test:watch

# Run a specific test file
cd api && npx vitest run tests/services/vectorService.test.ts

# Run tests matching a pattern
cd api && npx vitest run -t "profile"

# Run with coverage report
cd api && npx vitest run --coverage`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">Test Patterns</h3>
      <p className="text-muted-foreground mb-4">
        The test suite uses several patterns for database and API testing:
      </p>
      <ul className="list-disc list-inside text-sm text-muted-foreground space-y-2 mb-6 ml-2">
        <li>
          <strong className="text-foreground">Hono app.request():</strong> Use Hono's built-in testing
          method rather than Supertest. This tests the full middleware stack without starting
          a network server.
        </li>
        <li>
          <strong className="text-foreground">Test headers:</strong> Use <code className="text-foreground bg-muted px-1 rounded">x-test-user-id</code> and
          <code className="text-foreground bg-muted px-1 rounded ml-1">x-test-agent-id</code> headers to simulate
          authenticated requests in test mode.
        </li>
        <li>
          <strong className="text-foreground">Session auth bypass:</strong> Set <code className="text-foreground bg-muted px-1 rounded">x-test-auth-type: 'session'</code> to
          simulate dashboard (session) authentication, which bypasses consent checks.
        </li>
        <li>
          <strong className="text-foreground">Consent grants:</strong> When testing agent-authenticated requests,
          call <code className="text-foreground bg-muted px-1 rounded">grantConsent()</code> in the <code className="text-foreground bg-muted px-1 rounded">beforeEach</code> hook
          to grant the necessary permissions.
        </li>
        <li>
          <strong className="text-foreground">Serial execution:</strong> Tests run with <code className="text-foreground bg-muted px-1 rounded">fileParallelism: false</code> and
          <code className="text-foreground bg-muted px-1 rounded ml-1">singleFork: true</code> to prevent connection pool exhaustion.
        </li>
      </ul>
      <CodeBlock
        language="typescript"
        code={`// Example test
import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/app';

describe('Profile API', () => {
  beforeEach(async () => {
    // Setup test user schema, seed data, etc.
  });

  it('should return the user profile', async () => {
    const res = await app.request('/v1/profile', {
      headers: {
        'x-test-user-id': 'test-user-001',
        'x-test-auth-type': 'session',
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.version).toBeGreaterThan(0);
  });
});`}
      />

      <h2 id="code-style" className="text-xl font-semibold mt-10 mb-4">Code Style</h2>
      <p className="text-muted-foreground mb-4">
        The project follows these conventions:
      </p>
      <ul className="list-disc list-inside text-sm text-muted-foreground space-y-2 mb-6 ml-2">
        <li>
          <strong className="text-foreground">TypeScript strict mode:</strong> Both the API and dashboard
          use <code className="text-foreground bg-muted px-1 rounded">strict: true</code> in tsconfig.json.
          No <code className="text-foreground bg-muted px-1 rounded">any</code> types unless absolutely necessary (and documented).
        </li>
        <li>
          <strong className="text-foreground">ESM modules:</strong> The project uses ES modules throughout.
          Use <code className="text-foreground bg-muted px-1 rounded">import</code>/<code className="text-foreground bg-muted px-1 rounded">export</code>, not
          <code className="text-foreground bg-muted px-1 rounded ml-1">require</code>/<code className="text-foreground bg-muted px-1 rounded">module.exports</code>.
        </li>
        <li>
          <strong className="text-foreground">Naming conventions:</strong> camelCase for variables and functions,
          PascalCase for types/interfaces/components, snake_case for database columns and API
          response fields, UPPER_SNAKE_CASE for constants.
        </li>
        <li>
          <strong className="text-foreground">File naming:</strong> camelCase for service/utility files
          (e.g., <code className="text-foreground bg-muted px-1 rounded">profileService.ts</code>),
          PascalCase for React components (e.g., <code className="text-foreground bg-muted px-1 rounded">Profile.tsx</code>).
        </li>
        <li>
          <strong className="text-foreground">Path aliases:</strong> Use <code className="text-foreground bg-muted px-1 rounded">@/</code> alias
          for imports from the src directory (both API and dashboard).
        </li>
        <li>
          <strong className="text-foreground">Zod validation:</strong> All external inputs (request bodies, query params, MCP tool arguments)
          must be validated with Zod schemas before use.
        </li>
      </ul>

      <h2 id="pr-process" className="text-xl font-semibold mt-10 mb-4">Pull Request Process</h2>
      <p className="text-muted-foreground mb-4">
        We welcome contributions! Here is the process for submitting changes:
      </p>

      <h3 className="text-lg font-medium mt-6 mb-3">1. Branch Naming</h3>
      <p className="text-muted-foreground mb-3">
        Use descriptive branch names with a prefix indicating the type of change:
      </p>
      <CodeBlock
        language="text"
        code={`feat/add-export-endpoint     # New feature
fix/vector-search-threshold  # Bug fix
docs/update-api-reference    # Documentation
refactor/extract-service     # Code refactoring
test/add-graph-tests         # Test additions`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">2. Commit Messages</h3>
      <p className="text-muted-foreground mb-3">
        Follow conventional commit format:
      </p>
      <CodeBlock
        language="text"
        code={`feat: add vector collection deletion endpoint
fix: prevent deadlock in nested withUserSchema calls
docs: add self-hosting backup instructions
test: add consent system integration tests
refactor: extract embedding logic into shared utility`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">3. PR Requirements</h3>
      <ul className="list-disc list-inside text-sm text-muted-foreground space-y-2 mb-6 ml-2">
        <li><strong className="text-foreground">Tests:</strong> All new features and bug fixes must include tests. Test coverage should not decrease.</li>
        <li><strong className="text-foreground">TypeScript:</strong> No type errors. Run <code className="text-foreground bg-muted px-1 rounded">tsc --noEmit</code> to verify.</li>
        <li><strong className="text-foreground">All tests pass:</strong> Run <code className="text-foreground bg-muted px-1 rounded">npm test</code> before submitting.</li>
        <li><strong className="text-foreground">Schema changes:</strong> Any database schema changes must include a migration file created via <code className="text-foreground bg-muted px-1 rounded">supabase migration new</code>.</li>
        <li><strong className="text-foreground">Documentation:</strong> Update relevant documentation if the change affects the API, MCP tools, or user-facing behavior.</li>
      </ul>

      <h3 className="text-lg font-medium mt-6 mb-3">4. Review Process</h3>
      <p className="text-muted-foreground mb-4">
        PRs are reviewed for correctness, test coverage, code style, and alignment with the
        technical specification. Schema changes are reviewed by the database architect. API
        changes require agreement between the API builder and MCP engineer to ensure consistency
        between REST and MCP interfaces.
      </p>
      <p className="text-muted-foreground mb-4">
        Thank you for contributing to Epitome! If you have questions, open a discussion on GitHub
        or reach out in the project's community channels.
      </p>
    </DocPage>
  );
}
