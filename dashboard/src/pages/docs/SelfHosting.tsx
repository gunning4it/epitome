import DocPage from '@/components/docs/DocPage';
import { CodeBlock } from '@/components/CodeBlock';

const headings = [
  { id: 'requirements', text: 'System Requirements', level: 2 },
  { id: 'docker-setup', text: 'Docker Compose Setup', level: 2 },
  { id: 'environment', text: 'Environment Variables', level: 2 },
  { id: 'database-setup', text: 'Database Setup', level: 2 },
  { id: 'reverse-proxy', text: 'Reverse Proxy', level: 2 },
  { id: 'backups', text: 'Backup Strategy', level: 2 },
];

export default function SelfHosting() {
  return (
    <DocPage
      title="Self-Hosting Guide"
      description="Deploy your own Epitome instance with Docker Compose."
      headings={headings}
    >
      <h2 id="requirements" className="text-xl font-semibold mt-8 mb-4">System Requirements</h2>
      <p className="text-muted-foreground mb-4">
        Epitome is designed to run on modest hardware. A single-server deployment handles
        most personal use cases comfortably.
      </p>
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="pb-2 pr-4 font-medium text-foreground">Component</th>
              <th className="pb-2 pr-4 font-medium text-foreground">Minimum</th>
              <th className="pb-2 font-medium text-foreground">Recommended</th>
            </tr>
          </thead>
          <tbody className="text-muted-foreground">
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 text-foreground font-medium">CPU</td>
              <td className="py-2 pr-4">1 vCPU</td>
              <td className="py-2">2+ vCPU</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 text-foreground font-medium">RAM</td>
              <td className="py-2 pr-4">1 GB</td>
              <td className="py-2">2+ GB</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 text-foreground font-medium">Storage</td>
              <td className="py-2 pr-4">5 GB</td>
              <td className="py-2">20+ GB SSD</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 text-foreground font-medium">OS</td>
              <td className="py-2 pr-4" colSpan={2}>Linux, macOS, or Windows with Docker</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground mb-4">
        <strong className="text-foreground">Software requirements:</strong>
      </p>
      <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-6 ml-2">
        <li><strong className="text-foreground">Docker 24+</strong> and <strong className="text-foreground">Docker Compose v2</strong></li>
        <li><strong className="text-foreground">Node.js 22+</strong> (only needed if running without Docker)</li>
        <li><strong className="text-foreground">PostgreSQL 17</strong> with <strong className="text-foreground">pgvector 0.8+</strong> (only needed if running without Docker)</li>
      </ul>

      <h2 id="docker-setup" className="text-xl font-semibold mt-10 mb-4">Docker Compose Setup</h2>
      <p className="text-muted-foreground mb-4">
        The easiest way to deploy Epitome is with Docker Compose. The provided
        <code className="text-foreground bg-muted px-1 rounded ml-1">docker-compose.yml</code> configures
        three services: PostgreSQL (with pgvector), the Hono API server, and the React dashboard.
      </p>
      <CodeBlock
        language="yaml"
        code={`# docker-compose.yml (simplified)
services:
  db:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_DB: epitome
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: \${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 5

  api:
    build: ./api
    environment:
      DATABASE_URL: postgres://postgres:\${DB_PASSWORD}@db:5432/epitome
      JWT_SECRET: \${JWT_SECRET}
      OPENAI_API_KEY: \${OPENAI_API_KEY}
      NODE_ENV: production
    ports:
      - "3000:3000"
    depends_on:
      db:
        condition: service_healthy

  dashboard:
    build: ./dashboard
    environment:
      VITE_API_URL: http://localhost:3000
    ports:
      - "5173:8080"
    depends_on:
      - api

volumes:
  pgdata:`}
      />
      <p className="text-muted-foreground mt-4 mb-4">
        Start all services:
      </p>
      <CodeBlock
        language="bash"
        code={`# Start in the background
docker compose up -d

# View logs
docker compose logs -f

# Stop everything
docker compose down

# Stop and remove volumes (deletes all data!)
docker compose down -v`}
      />

      <h2 id="environment" className="text-xl font-semibold mt-10 mb-4">Environment Variables</h2>
      <p className="text-muted-foreground mb-4">
        Copy <code className="text-foreground bg-muted px-1 rounded">.env.example</code> to
        <code className="text-foreground bg-muted px-1 rounded ml-1">.env</code> and fill in the required values.
        Here is a complete reference of all environment variables:
      </p>
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="pb-2 pr-4 font-medium text-foreground">Variable</th>
              <th className="pb-2 pr-4 font-medium text-foreground">Required</th>
              <th className="pb-2 font-medium text-foreground">Description</th>
            </tr>
          </thead>
          <tbody className="text-muted-foreground">
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs text-foreground">DATABASE_URL</td>
              <td className="py-2 pr-4 text-green-400 text-xs">Yes</td>
              <td className="py-2 text-xs">PostgreSQL connection string. Example: postgres://user:pass@host:5432/epitome</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs text-foreground">JWT_SECRET</td>
              <td className="py-2 pr-4 text-green-400 text-xs">Yes</td>
              <td className="py-2 text-xs">Secret key for signing JWTs. Use a random 64-character hex string.</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs text-foreground">OPENAI_API_KEY</td>
              <td className="py-2 pr-4 text-green-400 text-xs">Yes</td>
              <td className="py-2 text-xs">OpenAI API key for embeddings (text-embedding-3-small) and entity extraction (gpt-5-mini).</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs text-foreground">OPENAI_MODEL</td>
              <td className="py-2 pr-4 text-muted-foreground text-xs">No</td>
              <td className="py-2 text-xs">Model for entity extraction. Default: gpt-5-mini</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs text-foreground">OPENAI_EMBEDDING_MODEL</td>
              <td className="py-2 pr-4 text-muted-foreground text-xs">No</td>
              <td className="py-2 text-xs">Model for embeddings. Default: text-embedding-3-small</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs text-foreground">PORT</td>
              <td className="py-2 pr-4 text-muted-foreground text-xs">No</td>
              <td className="py-2 text-xs">API server port. Default: 3000</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs text-foreground">NODE_ENV</td>
              <td className="py-2 pr-4 text-muted-foreground text-xs">No</td>
              <td className="py-2 text-xs">Set to "production" for production deployments. Enables SSL for database connections.</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs text-foreground">GITHUB_CLIENT_ID</td>
              <td className="py-2 pr-4 text-muted-foreground text-xs">No</td>
              <td className="py-2 text-xs">GitHub OAuth client ID for sign-in. Only needed if enabling GitHub auth.</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs text-foreground">GITHUB_CLIENT_SECRET</td>
              <td className="py-2 pr-4 text-muted-foreground text-xs">No</td>
              <td className="py-2 text-xs">GitHub OAuth client secret.</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs text-foreground">GOOGLE_CLIENT_ID</td>
              <td className="py-2 pr-4 text-muted-foreground text-xs">No</td>
              <td className="py-2 text-xs">Google OAuth client ID for sign-in.</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono text-xs text-foreground">GOOGLE_CLIENT_SECRET</td>
              <td className="py-2 pr-4 text-muted-foreground text-xs">No</td>
              <td className="py-2 text-xs">Google OAuth client secret.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <CodeBlock
        language="bash"
        code={`# Generate a secure JWT_SECRET
openssl rand -hex 32`}
      />

      <h2 id="database-setup" className="text-xl font-semibold mt-10 mb-4">Database Setup</h2>
      <p className="text-muted-foreground mb-4">
        If you are using Docker Compose, the database is initialized automatically via the
        <code className="text-foreground bg-muted px-1 rounded ml-1">init.sql</code> file mounted
        into the PostgreSQL container. If you are running PostgreSQL separately, you need to
        initialize it manually.
      </p>
      <CodeBlock
        language="bash"
        code={`# Connect to your PostgreSQL instance
psql -h localhost -U postgres -d epitome

# Run the init script
\\i init.sql`}
      />
      <p className="text-muted-foreground mt-4 mb-4">
        The init script performs the following:
      </p>
      <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1 mb-6 ml-2">
        <li>Enables required extensions: <code className="text-foreground bg-muted px-1 rounded">vector</code>, <code className="text-foreground bg-muted px-1 rounded">pg_trgm</code>, <code className="text-foreground bg-muted px-1 rounded">uuid-ossp</code></li>
        <li>Creates the <code className="text-foreground bg-muted px-1 rounded">shared</code> schema for cross-user data (users, accounts, sessions)</li>
        <li>Creates the <code className="text-foreground bg-muted px-1 rounded">template_user</code> schema with all per-user tables, triggers, and indexes</li>
        <li>Sets up functions for cloning the template schema when new users sign up</li>
      </ol>
      <p className="text-muted-foreground mb-4">
        <strong className="text-foreground">Important:</strong> The pgvector extension must be available
        in your PostgreSQL installation. If you are using a managed database service, ensure it
        supports pgvector 0.8+. The Docker image <code className="text-foreground bg-muted px-1 rounded">pgvector/pgvector:pg17</code> includes it.
      </p>

      <h2 id="reverse-proxy" className="text-xl font-semibold mt-10 mb-4">Reverse Proxy</h2>
      <p className="text-muted-foreground mb-4">
        For production deployments, you should put Epitome behind a reverse proxy to handle
        TLS termination, HTTP/2, and caching. Here are example configurations for popular reverse proxies.
      </p>

      <h3 className="text-lg font-medium mt-6 mb-3">Caddy (Recommended)</h3>
      <p className="text-muted-foreground mb-3">
        Caddy automatically provisions TLS certificates via Let's Encrypt:
      </p>
      <CodeBlock
        language="text"
        code={`# Caddyfile
epitome.example.com {
    # API
    handle /v1/* {
        reverse_proxy localhost:3000
    }

    # MCP endpoint
    handle /mcp/* {
        reverse_proxy localhost:3000
    }

    # Dashboard (catch-all for SPA routing)
    handle {
        reverse_proxy localhost:5173
    }
}`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">Nginx</h3>
      <CodeBlock
        language="nginx"
        code={`server {
    listen 443 ssl http2;
    server_name epitome.example.com;

    ssl_certificate     /etc/letsencrypt/live/epitome.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/epitome.example.com/privkey.pem;

    # API and MCP
    location /v1/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /mcp/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }

    # Dashboard
    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_set_header Host $host;
    }
}`}
      />

      <h2 id="backups" className="text-xl font-semibold mt-10 mb-4">Backup Strategy</h2>
      <p className="text-muted-foreground mb-4">
        Your Epitome database contains irreplaceable personal data. Set up regular backups.
      </p>

      <h3 className="text-lg font-medium mt-6 mb-3">Manual Backup</h3>
      <CodeBlock
        language="bash"
        code={`# Full database dump (compressed)
pg_dump -h localhost -U postgres -d epitome \\
  --format=custom --compress=9 \\
  -f epitome_backup_$(date +%Y%m%d_%H%M%S).dump

# Restore from backup
pg_restore -h localhost -U postgres -d epitome \\
  --clean --if-exists \\
  epitome_backup_20260217_143000.dump`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">Automated Daily Backups</h3>
      <p className="text-muted-foreground mb-3">
        Add a cron job for daily automated backups with 30-day retention:
      </p>
      <CodeBlock
        language="bash"
        code={`# Add to crontab (crontab -e)
# Run backup daily at 2:00 AM, keep 30 days
0 2 * * * pg_dump -h localhost -U postgres -d epitome \\
  --format=custom --compress=9 \\
  -f /backups/epitome_$(date +\\%Y\\%m\\%d).dump \\
  && find /backups -name "epitome_*.dump" -mtime +30 -delete`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">Docker Volume Backup</h3>
      <p className="text-muted-foreground mb-3">
        If you are running PostgreSQL in Docker, you can also back up the volume directly:
      </p>
      <CodeBlock
        language="bash"
        code={`# Backup the Docker volume
docker run --rm \\
  -v epitome_pgdata:/data \\
  -v $(pwd)/backups:/backups \\
  alpine tar czf /backups/pgdata_$(date +%Y%m%d).tar.gz -C /data .`}
      />
      <p className="text-muted-foreground mt-4">
        <strong className="text-foreground">Recommendation:</strong> Store backups in at least two
        locations (e.g., local disk + cloud storage like S3 or Backblaze B2). Test your restore
        procedure periodically to ensure backups are valid.
      </p>
    </DocPage>
  );
}
