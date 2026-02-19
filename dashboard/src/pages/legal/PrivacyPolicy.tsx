import LegalPage from '@/components/legal/LegalPage';

const headings = [
  { id: 'information-we-collect', text: 'Information We Collect', level: 2 },
  { id: 'how-we-use-your-data', text: 'How We Use Your Data', level: 2 },
  { id: 'third-party-services', text: 'Third-Party Services', level: 2 },
  { id: 'data-storage-security', text: 'Data Storage & Security', level: 2 },
  { id: 'data-retention', text: 'Data Retention', level: 2 },
  { id: 'your-rights', text: 'Your Rights', level: 2 },
  { id: 'childrens-privacy', text: "Children's Privacy", level: 2 },
  { id: 'changes', text: 'Changes to This Policy', level: 2 },
  { id: 'contact', text: 'Contact', level: 2 },
];

export default function PrivacyPolicy() {
  return (
    <LegalPage
      title="Privacy Policy"
      description="How Epitome collects, uses, and protects your personal data."
      effectiveDate="February 18, 2026"
      headings={headings}
    >
      <h2 id="information-we-collect">Information We Collect</h2>
      <p>Epitome collects information in the following categories:</p>

      <h3>Account Data</h3>
      <p>
        When you sign in with Google OAuth, we receive your email address, name,
        and profile avatar. We do not receive or store your Google password.
      </p>

      <h3>User-Provided Data</h3>
      <p>
        Information you explicitly add through the dashboard or API, including:
      </p>
      <ul>
        <li>Profile information (name, timezone, preferences)</li>
        <li>Dietary preferences and family member details</li>
        <li>Work and education information</li>
        <li>Custom data in dynamic tables (meals, medications, workouts, etc.)</li>
      </ul>

      <h3>Agent-Submitted Data</h3>
      <p>
        AI agents that you authorize can store memories and context on your
        behalf through the API or MCP (Model Context Protocol) interface. Each
        agent must receive your explicit consent before accessing your data.
      </p>

      <h3>AI-Processed Data</h3>
      <ul>
        <li>
          <strong>Vector embeddings</strong> — text from journal entries and
          bookmarks is sent to OpenAI to generate semantic search embeddings
          using the <code>text-embedding-3-small</code> model
        </li>
        <li>
          <strong>Knowledge graph entities</strong> — your stored data is
          processed by OpenAI <code>gpt-5-mini</code> to automatically extract
          people, places, organizations, and other entities and their
          relationships
        </li>
      </ul>

      <h3>Payment Data</h3>
      <p>
        If you subscribe to a paid plan, payment processing is handled by{' '}
        <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer">Stripe</a>.
        We store your Stripe customer ID and subscription ID to manage your
        account, but we never receive or store your full credit card number.
        Stripe processes card details under their own PCI-DSS compliance.
      </p>
      <p>
        For x402 agent payments, we record blockchain transaction hashes (which
        are public data on the Base network) to verify payments and maintain
        transaction history.
      </p>

      <h2 id="how-we-use-your-data">How We Use Your Data</h2>
      <p>We use your information to:</p>
      <ul>
        <li>Provide and maintain the Epitome service</li>
        <li>Authenticate your identity and manage sessions</li>
        <li>Build and maintain your personal knowledge graph</li>
        <li>Generate vector embeddings for semantic search</li>
        <li>Enforce per-agent consent and access controls</li>
        <li>Monitor service health and enforce rate limits</li>
      </ul>
      <p>
        We do <strong>not</strong> sell your data. We do <strong>not</strong>{' '}
        use your data to train AI models. We do <strong>not</strong> serve
        advertising or build marketing profiles.
      </p>

      <h2 id="third-party-services">Third-Party Services</h2>
      <p>Epitome uses the following third-party services to operate:</p>
      <table>
        <thead>
          <tr>
            <th>Service</th>
            <th>Purpose</th>
            <th>Data Shared</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>OpenAI</td>
            <td>Entity extraction (gpt-5-mini) and vector embeddings (text-embedding-3-small)</td>
            <td>Text content from memories and journal entries</td>
          </tr>
          <tr>
            <td>Google</td>
            <td>OAuth 2.0 authentication</td>
            <td>OAuth tokens exchanged during sign-in</td>
          </tr>
          <tr>
            <td>Supabase</td>
            <td>PostgreSQL database hosting</td>
            <td>All user data (stored in your dedicated schema)</td>
          </tr>
          <tr>
            <td>Fly.io</td>
            <td>Application compute hosting</td>
            <td>Data in transit (TLS 1.3 encrypted)</td>
          </tr>
          <tr>
            <td>Stripe</td>
            <td>Payment processing for Pro subscriptions</td>
            <td>Stripe customer ID, subscription status, invoice records (Stripe processes card details under their own PCI-DSS compliance; we never see or store card numbers)</td>
          </tr>
        </tbody>
      </table>
      <p>
        Each third-party provider processes data under their own privacy
        policies and data processing agreements. OpenAI's API data usage policy
        states that API inputs are not used to train their models.
      </p>

      <h2 id="data-storage-security">Data Storage &amp; Security</h2>
      <ul>
        <li>
          <strong>Schema isolation</strong> — each user's data is stored in a
          dedicated PostgreSQL schema, providing hard data isolation (not
          row-level security)
        </li>
        <li>
          <strong>Encryption at rest</strong> — database storage is encrypted by
          Supabase using AES-256
        </li>
        <li>
          <strong>Encryption in transit</strong> — all connections use TLS 1.3
        </li>
        <li>
          <strong>OAuth token encryption</strong> — Google OAuth refresh tokens
          are encrypted with AES-256-GCM before storage
        </li>
        <li>
          <strong>API key hashing</strong> — API keys are hashed with Argon2 and
          cannot be retrieved in plaintext
        </li>
        <li>
          <strong>SQL sandbox</strong> — custom queries run in a read-only,
          AST-validated sandbox with statement timeouts
        </li>
      </ul>
      <p>
        For more details, see our{' '}
        <a href="/legal/security">Security &amp; Compliance</a> page.
      </p>

      <h2 id="data-retention">Data Retention</h2>
      <p>
        Your data is retained for as long as your account is active. Memory
        confidence scores decay over time through our quality engine, but data is
        not automatically deleted.
      </p>
      <p>
        When you delete your account, all your data is permanently removed after
        a 14-day grace period. Deletion executes a{' '}
        <code>DROP SCHEMA CASCADE</code> on your dedicated PostgreSQL schema,
        removing all tables, data, and associated records.
      </p>

      <h2 id="your-rights">Your Rights</h2>
      <p>You have the right to:</p>
      <ul>
        <li>
          <strong>Access</strong> — view all your data through the dashboard or
          export it via <code>GET /v1/export</code>
        </li>
        <li>
          <strong>Delete</strong> — remove your account and all associated data
          through Settings
        </li>
        <li>
          <strong>Portability</strong> — export your complete dataset in a
          standard JSON format
        </li>
        <li>
          <strong>Consent management</strong> — grant or revoke per-agent access
          to specific data categories at any time through the Agents page
        </li>
        <li>
          <strong>Rectification</strong> — edit or correct any of your stored
          data through the dashboard or API
        </li>
      </ul>
      <p>
        For CCPA-specific rights, see our{' '}
        <a href="/legal/ccpa">CCPA Privacy Notice</a>.
      </p>

      <h2 id="childrens-privacy">Children's Privacy</h2>
      <p>
        Epitome is not directed at children under 13. We do not knowingly
        collect personal information from children under 13. If you believe a
        child has provided us with personal information, please contact us and
        we will delete it promptly.
      </p>

      <h2 id="changes">Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. We will notify you
        of material changes by posting the updated policy on this page and
        updating the effective date. Continued use of Epitome after changes
        constitutes acceptance of the revised policy.
      </p>

      <h2 id="contact">Contact</h2>
      <p>
        For privacy-related questions or to exercise your rights, contact us at{' '}
        <a href="mailto:support@epitome.fyi">support@epitome.fyi</a>.
      </p>
    </LegalPage>
  );
}
