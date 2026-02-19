import LegalPage from '@/components/legal/LegalPage';

const headings = [
  { id: 'acceptance', text: 'Acceptance of Terms', level: 2 },
  { id: 'service-description', text: 'Service Description', level: 2 },
  { id: 'accounts', text: 'Accounts', level: 2 },
  { id: 'billing', text: 'Billing & Subscriptions', level: 2 },
  { id: 'acceptable-use', text: 'Acceptable Use', level: 2 },
  { id: 'intellectual-property', text: 'Intellectual Property', level: 2 },
  { id: 'data-ownership', text: 'Data Ownership', level: 2 },
  { id: 'disclaimers', text: 'Disclaimers', level: 2 },
  { id: 'limitation-of-liability', text: 'Limitation of Liability', level: 2 },
  { id: 'termination', text: 'Termination', level: 2 },
  { id: 'governing-law', text: 'Governing Law', level: 2 },
  { id: 'changes', text: 'Changes to These Terms', level: 2 },
];

export default function TermsOfService() {
  return (
    <LegalPage
      title="Terms of Service"
      description="The terms governing your use of the Epitome service."
      effectiveDate="February 18, 2026"
      headings={headings}
    >
      <h2 id="acceptance">Acceptance of Terms</h2>
      <p>
        By accessing or using Epitome ("the Service"), you agree to be bound by
        these Terms of Service. If you do not agree to these terms, do not use
        the Service.
      </p>

      <h2 id="service-description">Service Description</h2>
      <p>
        Epitome is a personal AI database and portable identity layer that
        provides AI agents with shared, persistent memory of you. The Service
        is available in two forms:
      </p>
      <ul>
        <li>
          <strong>Hosted service</strong> — available at{' '}
          <a href="https://epitome.fyi">epitome.fyi</a>, operated by us
        </li>
        <li>
          <strong>Self-hosted</strong> — the open-source codebase licensed under
          the MIT License, which you can run on your own infrastructure
        </li>
      </ul>
      <p>
        These Terms apply to the hosted service. Self-hosted deployments are
        governed by the MIT License and your own policies.
      </p>

      <h2 id="accounts">Accounts</h2>
      <p>
        To use Epitome, you must sign in with a Google account. Each Google
        account corresponds to one Epitome user account. You are responsible
        for maintaining the security of your Google account and for all
        activities that occur under your Epitome account.
      </p>
      <p>
        You must provide accurate information and keep your account details
        current. You must not create accounts for the purpose of abusing the
        Service or other users.
      </p>

      <h2 id="billing">Billing &amp; Subscriptions</h2>
      <p>
        Epitome offers multiple ways to access the Service:
      </p>

      <h3>Free Tier</h3>
      <p>
        The free tier is available at no cost and includes limited resources:
        2 tables, 3 agents, 100 graph entities, and 30-day audit retention.
        Free tier limits may be adjusted with 30 days' notice.
      </p>

      <h3>Pro Subscription</h3>
      <p>
        The Pro plan costs $5 per month, billed monthly via{' '}
        <a href="https://stripe.com" target="_blank" rel="noopener noreferrer">Stripe</a>.
        Subscriptions auto-renew each billing cycle unless cancelled. Payment is
        processed securely by Stripe — we never see or store your full card
        number.
      </p>

      <h3>Cancellation &amp; Downgrades</h3>
      <p>
        You may cancel your Pro subscription at any time through the Billing
        page in the dashboard. Upon cancellation:
      </p>
      <ul>
        <li>Your Pro access continues until the end of the current billing period</li>
        <li>No partial refunds are issued for unused time</li>
        <li>Your account reverts to the free tier at the end of the period</li>
        <li>Existing data is preserved, but creation of new resources may be
            blocked if your usage exceeds free-tier limits</li>
      </ul>

      <h3>Agent Pay-Per-Call (x402)</h3>
      <p>
        AI agents may pay for individual MCP tool calls using USDC
        cryptocurrency on the Base network via the x402 protocol (HTTP 402
        Payment Required). Each payment grants pro-tier access for that
        specific call. These are non-refundable micro-transactions recorded
        on the blockchain.
      </p>

      <h3>Price Changes</h3>
      <p>
        We will provide at least 30 days' notice before any price increases
        take effect. Notice will be provided via email and/or an in-dashboard
        notification. Continued use of the Service after a price change
        constitutes acceptance of the new pricing.
      </p>

      <h2 id="acceptable-use">Acceptable Use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service for any unlawful purpose</li>
        <li>Attempt to access another user's data or schema</li>
        <li>Circumvent rate limits, authentication, or security controls</li>
        <li>Reverse engineer the Service beyond what is permitted by the open-source license</li>
        <li>Use automated tools to scrape or extract data from other users</li>
        <li>Submit content that is illegal, harmful, or violates third-party rights</li>
        <li>Interfere with or disrupt the Service or its infrastructure</li>
        <li>Use the Service to store data on behalf of other individuals without their consent</li>
      </ul>

      <h2 id="intellectual-property">Intellectual Property</h2>
      <p>
        The Epitome codebase is open-source software licensed under the{' '}
        <a
          href="https://opensource.org/licenses/MIT"
          target="_blank"
          rel="noopener noreferrer"
        >
          MIT License
        </a>
        . You may use, modify, and distribute the code in accordance with that
        license.
      </p>
      <p>
        The Epitome name, logo, and branding are trademarks of Epitome and may
        not be used without permission for purposes other than referring to the
        project.
      </p>

      <h2 id="data-ownership">Data Ownership</h2>
      <p>
        <strong>You own all data you store in Epitome.</strong> We do not claim
        any ownership or intellectual property rights over your content. You
        grant us a limited license to process, store, and transmit your data
        solely to provide the Service.
      </p>
      <p>
        You can export your complete dataset at any time via{' '}
        <code>GET /v1/export</code> or the dashboard. You can delete your
        account and all associated data at any time through Settings.
      </p>

      <h2 id="disclaimers">Disclaimers</h2>
      <p>
        The Service is provided <strong>"AS IS"</strong> and{' '}
        <strong>"AS AVAILABLE"</strong> without warranties of any kind, whether
        express or implied, including but not limited to implied warranties of
        merchantability, fitness for a particular purpose, and
        non-infringement.
      </p>
      <p>
        We do not warrant that the Service will be uninterrupted, secure, or
        error-free. AI-generated content (entity extraction, knowledge graph
        relationships) may contain inaccuracies.
      </p>

      <h2 id="limitation-of-liability">Limitation of Liability</h2>
      <p>
        To the maximum extent permitted by law, Epitome and its operators shall
        not be liable for any indirect, incidental, special, consequential, or
        punitive damages, or any loss of profits or revenues, whether incurred
        directly or indirectly, or any loss of data, use, goodwill, or other
        intangible losses resulting from:
      </p>
      <ul>
        <li>Your use or inability to use the Service</li>
        <li>Unauthorized access to or alteration of your data</li>
        <li>Any third-party conduct on the Service</li>
        <li>Any other matter relating to the Service</li>
      </ul>
      <p>
        Our total liability for any claims arising from or related to the
        Service shall not exceed the total amount paid by you to Epitome in the
        12 months preceding the claim, or $100, whichever is greater.
      </p>

      <h2 id="termination">Termination</h2>
      <p>
        You may terminate your account at any time through the Settings page.
        Upon termination:
      </p>
      <ul>
        <li>A 14-day grace period begins during which your data is preserved</li>
        <li>After 14 days, your dedicated PostgreSQL schema is permanently dropped</li>
        <li>This action is irreversible — we cannot recover deleted data</li>
      </ul>
      <p>
        We may suspend or terminate your account if you violate these Terms, with
        notice where practicable. We will provide an opportunity to export your
        data before permanent deletion unless the violation involves illegal
        activity or abuse.
      </p>

      <h2 id="governing-law">Governing Law</h2>
      <p>
        These Terms shall be governed by and construed in accordance with the
        laws of the State of California, United States, without regard to its
        conflict of law provisions.
      </p>

      <h2 id="changes">Changes to These Terms</h2>
      <p>
        We may update these Terms from time to time. We will notify you of
        material changes by posting updated terms on this page and updating the
        effective date. Continued use of the Service after changes constitutes
        acceptance of the revised terms.
      </p>
      <p>
        Questions? Contact us at{' '}
        <a href="mailto:support@epitome.fyi">support@epitome.fyi</a>.
      </p>
    </LegalPage>
  );
}
