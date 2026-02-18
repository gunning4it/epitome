import LegalPage from '@/components/legal/LegalPage';

const headings = [
  { id: 'security-architecture', text: 'Security Architecture', level: 2 },
  { id: 'authentication', text: 'Authentication', level: 2 },
  { id: 'data-isolation', text: 'Data Isolation', level: 2 },
  { id: 'encryption', text: 'Encryption', level: 2 },
  { id: 'access-controls', text: 'Access Controls', level: 2 },
  { id: 'audit-logging', text: 'Audit Logging', level: 2 },
  { id: 'gdpr', text: 'GDPR Compliance', level: 2 },
  { id: 'ccpa', text: 'CCPA Compliance', level: 2 },
  { id: 'eu-ai-act', text: 'EU AI Act', level: 2 },
  { id: 'incident-response', text: 'Incident Response', level: 2 },
  { id: 'responsible-disclosure', text: 'Responsible Disclosure', level: 2 },
];

export default function SecurityCompliance() {
  return (
    <LegalPage
      title="Security & Compliance"
      description="How Epitome protects your data and meets regulatory requirements."
      effectiveDate="February 18, 2026"
      headings={headings}
    >
      <h2 id="security-architecture">Security Architecture</h2>
      <p>
        Epitome is designed with security as a foundational principle, not an
        afterthought. Our architecture employs defense in depth — multiple
        independent security layers so that no single failure compromises user
        data.
      </p>
      <ul>
        <li>Per-user PostgreSQL schema isolation</li>
        <li>OAuth 2.0 authentication (no passwords stored)</li>
        <li>Argon2-hashed API keys</li>
        <li>AES-256-GCM encrypted OAuth tokens</li>
        <li>Read-only SQL sandbox with AST validation</li>
        <li>6-tier rate limiting</li>
        <li>Per-agent consent system</li>
        <li>Append-only audit trail</li>
      </ul>

      <h2 id="authentication">Authentication</h2>
      <p>
        Epitome uses Google OAuth 2.0 for user authentication. We never store
        passwords. Authentication flows include:
      </p>
      <ul>
        <li>
          <strong>Dashboard sessions</strong> — secure, HttpOnly, SameSite=Lax
          cookies with 30-day expiration
        </li>
        <li>
          <strong>API keys</strong> — for programmatic access, hashed with Argon2
          before storage. Only a prefix is stored in plaintext for
          identification; the full key is shown once at creation and cannot be
          retrieved
        </li>
        <li>
          <strong>MCP OAuth</strong> — agents authenticate via OAuth 2.0
          authorization code flow with PKCE
        </li>
      </ul>

      <h2 id="data-isolation">Data Isolation</h2>
      <p>
        Each user's data is stored in a dedicated PostgreSQL schema (e.g.,{' '}
        <code>user_&lt;uuid&gt;</code>). This provides hard data isolation at
        the database level — not row-level security (RLS), but actual schema
        separation.
      </p>
      <ul>
        <li>Users cannot query across schemas</li>
        <li>Schema search path is set per-transaction using <code>SET LOCAL search_path</code></li>
        <li>Account deletion executes <code>DROP SCHEMA CASCADE</code>, permanently removing all tables and data</li>
      </ul>

      <h2 id="encryption">Encryption</h2>
      <table>
        <thead>
          <tr>
            <th>Layer</th>
            <th>Method</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>In transit</td>
            <td>TLS 1.3</td>
            <td>All connections between client, API, and database</td>
          </tr>
          <tr>
            <td>At rest</td>
            <td>AES-256</td>
            <td>Supabase-managed disk encryption</td>
          </tr>
          <tr>
            <td>OAuth tokens</td>
            <td>AES-256-GCM</td>
            <td>Application-level encryption before database storage</td>
          </tr>
          <tr>
            <td>API keys</td>
            <td>Argon2</td>
            <td>One-way hash — keys cannot be recovered</td>
          </tr>
        </tbody>
      </table>

      <h2 id="access-controls">Access Controls</h2>
      <h3>Rate Limiting</h3>
      <p>Epitome enforces 6 tiers of rate limiting to prevent abuse:</p>
      <ul>
        <li>Global request rate limits per IP</li>
        <li>Per-user API rate limits</li>
        <li>Per-agent rate limits</li>
        <li>Expensive operation throttling (exports, graph queries)</li>
        <li>Authentication attempt limits</li>
        <li>MCP connection limits</li>
      </ul>

      <h3>Per-Agent Consent</h3>
      <p>
        AI agents must receive explicit user consent before accessing data
        categories. Consent uses hierarchical matching — granting access to{' '}
        <code>graph</code> includes <code>graph/stats</code>,{' '}
        <code>graph/query</code>, etc. Users can grant, revoke, or audit agent
        permissions at any time through the dashboard.
      </p>

      <h3>SQL Sandbox</h3>
      <p>
        Custom queries submitted through the API are executed in a hardened
        sandbox:
      </p>
      <ul>
        <li>Read-only access (SELECT only)</li>
        <li>AST-level query validation (no DDL, DML, or system catalog access)</li>
        <li>Statement timeout enforcement</li>
        <li>Restricted to the user's own schema</li>
      </ul>

      <h2 id="audit-logging">Audit Logging</h2>
      <p>
        All significant actions are recorded in an append-only{' '}
        <code>activity_log</code> table. Logged events include:
      </p>
      <ul>
        <li>Authentication events (sign in, sign out, API key creation)</li>
        <li>Data access (reads, writes, exports)</li>
        <li>Agent consent changes (grants, revocations)</li>
        <li>Account lifecycle events (creation, deletion)</li>
        <li>Administrative actions</li>
      </ul>
      <p>
        Audit logs are retained for the lifetime of the account and are included
        in data exports.
      </p>

      <h2 id="gdpr">GDPR Compliance</h2>
      <p>
        Epitome supports the rights of data subjects under the General Data
        Protection Regulation:
      </p>
      <table>
        <thead>
          <tr>
            <th>Right</th>
            <th>Implementation</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Access (Art. 15)</td>
            <td>Full data export via <code>GET /v1/export</code> or dashboard</td>
          </tr>
          <tr>
            <td>Rectification (Art. 16)</td>
            <td>Edit any data through the dashboard or API</td>
          </tr>
          <tr>
            <td>Erasure (Art. 17)</td>
            <td>Account deletion via Settings (<code>DROP SCHEMA CASCADE</code>)</td>
          </tr>
          <tr>
            <td>Portability (Art. 20)</td>
            <td>JSON export of complete dataset</td>
          </tr>
          <tr>
            <td>Restrict Processing (Art. 18)</td>
            <td>Per-agent consent revocation</td>
          </tr>
          <tr>
            <td>Object (Art. 21)</td>
            <td>Opt out of AI processing by revoking agent consent</td>
          </tr>
        </tbody>
      </table>
      <p>
        <strong>Legal basis for processing:</strong> consent (for AI agent
        access) and contract performance (for core service delivery).
      </p>

      <h2 id="ccpa">CCPA Compliance</h2>
      <p>
        For California residents, we comply with the California Consumer Privacy
        Act. See our dedicated{' '}
        <a href="/legal/ccpa">CCPA Privacy Notice</a> for full details
        including data categories, rights, and how to exercise them.
      </p>
      <p>Key points:</p>
      <ul>
        <li>We do not sell personal information</li>
        <li>We do not share data for cross-context behavioral advertising</li>
        <li>Users can access, delete, and export all their data</li>
        <li>We respond to verifiable requests within 45 days</li>
      </ul>

      <h2 id="eu-ai-act">EU AI Act</h2>
      <p>
        Epitome uses AI systems (OpenAI gpt-5-mini) for entity extraction and
        relationship identification. In the spirit of transparency required by
        the EU AI Act:
      </p>
      <ul>
        <li>
          <strong>AI processing disclosure</strong> — we clearly identify that
          entity extraction and vector embeddings are generated by AI (OpenAI)
        </li>
        <li>
          <strong>Human oversight</strong> — users can review, edit, and delete
          all AI-generated entities through the dashboard
        </li>
        <li>
          <strong>Opt-out capability</strong> — users can revoke AI processing
          consent for specific agents or data categories
        </li>
        <li>
          <strong>Risk classification</strong> — Epitome is a personal data
          management tool, not a high-risk AI system under the EU AI Act
          classification
        </li>
      </ul>

      <h2 id="incident-response">Incident Response</h2>
      <p>In the event of a security incident:</p>
      <ul>
        <li>Affected users will be notified within 72 hours of confirmed breach (per GDPR Art. 33)</li>
        <li>Relevant supervisory authorities will be notified as required</li>
        <li>Incident details, scope, and remediation steps will be published on our status page</li>
        <li>Post-incident reports will be made available to affected users</li>
      </ul>

      <h2 id="responsible-disclosure">Responsible Disclosure</h2>
      <p>
        We welcome responsible security research. If you discover a
        vulnerability in Epitome:
      </p>
      <ul>
        <li>
          Email <a href="mailto:support@epitome.fyi">support@epitome.fyi</a>{' '}
          with details of the vulnerability
        </li>
        <li>Allow reasonable time for us to investigate and fix the issue before public disclosure</li>
        <li>Do not access, modify, or delete other users' data during research</li>
        <li>
          The open-source codebase is available on{' '}
          <a
            href="https://github.com/gunning4it/epitome"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>{' '}
          for security review
        </li>
      </ul>
    </LegalPage>
  );
}
