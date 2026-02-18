import LegalPage from '@/components/legal/LegalPage';

const headings = [
  { id: 'scope', text: 'Scope', level: 2 },
  { id: 'categories-collected', text: 'Categories of Information Collected', level: 2 },
  { id: 'sources', text: 'Sources of Information', level: 2 },
  { id: 'business-purposes', text: 'Business Purposes', level: 2 },
  { id: 'third-party-sharing', text: 'Third-Party Sharing', level: 2 },
  { id: 'right-to-know', text: 'Right to Know', level: 2 },
  { id: 'right-to-delete', text: 'Right to Delete', level: 2 },
  { id: 'right-to-opt-out', text: 'Right to Opt-Out of Sale', level: 2 },
  { id: 'non-discrimination', text: 'Non-Discrimination', level: 2 },
  { id: 'exercising-rights', text: 'Exercising Your Rights', level: 2 },
  { id: 'contact', text: 'Contact', level: 2 },
];

export default function CcpaPolicy() {
  return (
    <LegalPage
      title="CCPA Privacy Notice"
      description="California Consumer Privacy Act disclosures for California residents."
      effectiveDate="February 18, 2026"
      headings={headings}
    >
      <h2 id="scope">Scope</h2>
      <p>
        This notice supplements our{' '}
        <a href="/legal/privacy">Privacy Policy</a> and applies solely to
        residents of California, as required by the California Consumer Privacy
        Act (CCPA) and the California Privacy Rights Act (CPRA).
      </p>

      <h2 id="categories-collected">Categories of Information Collected</h2>
      <p>
        In the preceding 12 months, we have collected the following categories
        of personal information:
      </p>
      <table>
        <thead>
          <tr>
            <th>CCPA Category</th>
            <th>Examples</th>
            <th>Collected</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>A. Identifiers</td>
            <td>Name, email address, Google account ID</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>B. Personal Information (Cal. Civ. Code §1798.80)</td>
            <td>Name, email</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>D. Commercial Information</td>
            <td>N/A — Epitome is free</td>
            <td>No</td>
          </tr>
          <tr>
            <td>F. Internet or Network Activity</td>
            <td>API request logs, agent interaction history</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>G. Geolocation Data</td>
            <td>N/A — not collected</td>
            <td>No</td>
          </tr>
          <tr>
            <td>K. Inferences</td>
            <td>AI-extracted entities, knowledge graph relationships</td>
            <td>Yes</td>
          </tr>
        </tbody>
      </table>

      <h2 id="sources">Sources of Information</h2>
      <ul>
        <li><strong>Directly from you</strong> — profile data, preferences, and information you add through the dashboard</li>
        <li><strong>From AI agents</strong> — memories, context, and interactions submitted through the API or MCP protocol on your behalf</li>
        <li><strong>AI-derived</strong> — entities and relationships extracted by OpenAI gpt-5-mini from your stored data</li>
      </ul>

      <h2 id="business-purposes">Business Purposes</h2>
      <p>We use personal information for the following business purposes:</p>
      <ul>
        <li>Providing and maintaining the Epitome service</li>
        <li>Authenticating your identity via Google OAuth</li>
        <li>Processing your data to build your personal knowledge graph</li>
        <li>Generating vector embeddings for semantic search</li>
        <li>Auditing and security (rate limiting, access logs)</li>
      </ul>

      <h2 id="third-party-sharing">Third-Party Sharing</h2>
      <p>
        We do <strong>not sell</strong> personal information to third parties.
        We do <strong>not share</strong> personal information for cross-context
        behavioral advertising.
      </p>
      <p>We disclose personal information to the following service providers for business purposes only:</p>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Purpose</th>
            <th>Data Shared</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>OpenAI</td>
            <td>Entity extraction and vector embeddings</td>
            <td>Text content from memories and journal entries</td>
          </tr>
          <tr>
            <td>Google</td>
            <td>Authentication</td>
            <td>OAuth tokens (no user data shared back)</td>
          </tr>
          <tr>
            <td>Supabase</td>
            <td>Database hosting</td>
            <td>All user data (encrypted at rest)</td>
          </tr>
          <tr>
            <td>Fly.io</td>
            <td>Application hosting</td>
            <td>Data in transit (TLS encrypted)</td>
          </tr>
        </tbody>
      </table>

      <h2 id="right-to-know">Right to Know</h2>
      <p>
        You have the right to request that we disclose what personal information
        we have collected, used, disclosed, and sold about you in the preceding
        12 months. You can access all your data at any time through:
      </p>
      <ul>
        <li>The Epitome dashboard (view all stored data)</li>
        <li>The data export API (<code>GET /v1/export</code>)</li>
      </ul>

      <h2 id="right-to-delete">Right to Delete</h2>
      <p>
        You have the right to request deletion of your personal information. You
        can exercise this right through:
      </p>
      <ul>
        <li>The Settings page in the dashboard (account deletion)</li>
        <li>Contacting us at <a href="mailto:support@epitome.fyi">support@epitome.fyi</a></li>
      </ul>
      <p>
        Account deletion executes a <code>DROP SCHEMA CASCADE</code> on your
        dedicated PostgreSQL schema, permanently removing all your data. This
        action is irreversible after the 14-day grace period.
      </p>

      <h2 id="right-to-opt-out">Right to Opt-Out of Sale</h2>
      <p>
        Epitome does <strong>not sell</strong> your personal information to third
        parties. Because we do not engage in data sales, there is no need to
        opt out. If this ever changes, we will provide a clear "Do Not Sell My
        Personal Information" mechanism.
      </p>

      <h2 id="non-discrimination">Non-Discrimination</h2>
      <p>
        We will not discriminate against you for exercising any of your CCPA
        rights. We will not deny you services, charge different prices, or
        provide a different quality of service because you exercised your privacy
        rights.
      </p>

      <h2 id="exercising-rights">Exercising Your Rights</h2>
      <p>To exercise your CCPA rights, you may:</p>
      <ul>
        <li>Use the built-in dashboard tools (export, deletion)</li>
        <li>Email us at <a href="mailto:support@epitome.fyi">support@epitome.fyi</a></li>
      </ul>
      <p>
        We will verify your identity through your authenticated Epitome session
        or by confirming your Google OAuth email address. We will respond to
        verifiable requests within 45 days.
      </p>

      <h2 id="contact">Contact</h2>
      <p>
        For questions about this CCPA notice, contact us at{' '}
        <a href="mailto:support@epitome.fyi">support@epitome.fyi</a>.
      </p>
    </LegalPage>
  );
}
