import DocPage from '@/components/docs/DocPage';
import { CodeBlock } from '@/components/CodeBlock';
import { Badge } from '@/components/ui/badge';

const headings = [
  { id: 'plans-and-pricing', text: 'Plans & Pricing', level: 2 },
  { id: 'upgrading-to-pro', text: 'Upgrading to Pro', level: 2 },
  { id: 'managing-your-subscription', text: 'Managing Your Subscription', level: 2 },
  { id: 'tier-limits', text: 'Tier Limits & Enforcement', level: 2 },
  { id: 'agent-pay-per-call', text: 'Agent Pay-Per-Call (x402)', level: 2 },
  { id: 'billing-api', text: 'Billing API Endpoints', level: 2 },
  { id: 'faq', text: 'FAQ', level: 2 },
];

export default function Billing() {
  return (
    <DocPage
      title="Billing & Agents"
      description="Plans, pricing, tier limits, and x402 agent pay-per-call."
      headings={headings}
    >
      {/* Section 1: Plans & Pricing */}
      <h2 id="plans-and-pricing" className="text-xl font-semibold mt-8 mb-4">Plans & Pricing</h2>
      <p className="text-muted-foreground mb-4">
        Epitome offers three ways to access the platform: a free tier for getting started,
        a Pro subscription for power users, and agent pay-per-call for AI agents that need
        pro-tier access without a subscription.
      </p>
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-3 px-4 text-muted-foreground font-medium"></th>
              <th className="text-left py-3 px-4 text-muted-foreground font-medium">Free</th>
              <th className="text-left py-3 px-4 text-muted-foreground font-medium">Pro</th>
              <th className="text-left py-3 px-4 text-muted-foreground font-medium">Agent Pay-Per-Call</th>
            </tr>
          </thead>
          <tbody className="text-muted-foreground">
            <tr className="border-b border-border/50">
              <td className="py-3 px-4 font-medium text-foreground">Price</td>
              <td className="py-3 px-4">$0</td>
              <td className="py-3 px-4">$5/month</td>
              <td className="py-3 px-4">$0.01/call</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-3 px-4 font-medium text-foreground">Tables</td>
              <td className="py-3 px-4">2</td>
              <td className="py-3 px-4">Unlimited</td>
              <td className="py-3 px-4">Pro-tier per call</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-3 px-4 font-medium text-foreground">Agents</td>
              <td className="py-3 px-4">3</td>
              <td className="py-3 px-4">Unlimited</td>
              <td className="py-3 px-4">Pro-tier per call</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-3 px-4 font-medium text-foreground">Graph Entities</td>
              <td className="py-3 px-4">100</td>
              <td className="py-3 px-4">Unlimited</td>
              <td className="py-3 px-4">Pro-tier per call</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-3 px-4 font-medium text-foreground">Audit Retention</td>
              <td className="py-3 px-4">30 days</td>
              <td className="py-3 px-4">365 days</td>
              <td className="py-3 px-4">Pro-tier per call</td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-3 px-4 font-medium text-foreground">API Access</td>
              <td className="py-3 px-4">MCP + REST</td>
              <td className="py-3 px-4">MCP + REST</td>
              <td className="py-3 px-4">MCP only</td>
            </tr>
            <tr>
              <td className="py-3 px-4 font-medium text-foreground">Payment</td>
              <td className="py-3 px-4">&mdash;</td>
              <td className="py-3 px-4">Stripe</td>
              <td className="py-3 px-4">USDC on Base</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Section 2: Upgrading to Pro */}
      <h2 id="upgrading-to-pro" className="text-xl font-semibold mt-10 mb-4">Upgrading to Pro</h2>
      <p className="text-muted-foreground mb-4">
        Upgrading to Pro takes less than a minute and immediately unlocks unlimited resources.
      </p>
      <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-2 mb-6 ml-2">
        <li>Navigate to the <strong className="text-foreground">Billing</strong> page in the dashboard</li>
        <li>Click <strong className="text-foreground">"Upgrade to Pro"</strong></li>
        <li>Complete checkout via <strong className="text-foreground">Stripe</strong></li>
        <li>Your account is <strong className="text-foreground">immediately upgraded</strong> — no restart required</li>
      </ol>

      {/* Section 3: Managing Your Subscription */}
      <h2 id="managing-your-subscription" className="text-xl font-semibold mt-10 mb-4">Managing Your Subscription</h2>
      <p className="text-muted-foreground mb-4">
        All subscription management is handled through the Stripe customer portal.
      </p>
      <ul className="list-disc list-inside text-sm text-muted-foreground space-y-2 mb-6 ml-2">
        <li>Access the <strong className="text-foreground">Stripe customer portal</strong> from the Billing page in the dashboard</li>
        <li><strong className="text-foreground">Cancel anytime</strong> — access continues until end of billing period</li>
        <li>On cancellation, account <strong className="text-foreground">reverts to free tier</strong></li>
        <li>Existing data is <strong className="text-foreground">preserved</strong> but new resource creation may be blocked if over free limits</li>
      </ul>

      {/* Section 4: Tier Limits & Enforcement */}
      <h2 id="tier-limits" className="text-xl font-semibold mt-10 mb-4">Tier Limits & Enforcement</h2>
      <p className="text-muted-foreground mb-4">
        Limits are enforced atomically at time of resource creation. When you hit a limit,
        the API returns <code className="text-foreground bg-muted px-1 rounded">HTTP 402</code> with
        an error explaining which limit was reached.
      </p>

      <h3 className="text-lg font-medium mt-6 mb-3">Free Tier Limits</h3>
      <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-6 ml-2">
        <li><strong className="text-foreground">2 tables</strong> — custom user-created tables</li>
        <li><strong className="text-foreground">3 agents</strong> — registered API key agents</li>
        <li><strong className="text-foreground">100 graph entities</strong> — nodes in the knowledge graph</li>
        <li><strong className="text-foreground">30 days</strong> — audit log retention</li>
      </ul>

      <h3 className="text-lg font-medium mt-6 mb-3">Pro Tier Limits</h3>
      <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-6 ml-2">
        <li><strong className="text-foreground">Unlimited</strong> tables, agents, and graph entities</li>
        <li><strong className="text-foreground">365 days</strong> — audit log retention</li>
      </ul>

      {/* Section 5: Agent Pay-Per-Call (x402) */}
      <h2 id="agent-pay-per-call" className="text-xl font-semibold mt-10 mb-4">Agent Pay-Per-Call (x402)</h2>
      <p className="text-muted-foreground mb-4">
        The x402 protocol enables AI agents to pay for individual API calls using cryptocurrency.
        When an agent on the free tier calls an MCP tool, Epitome responds
        with <code className="text-foreground bg-muted px-1 rounded">HTTP 402 Payment Required</code>,
        including payment details in the response. The agent can then pay with USDC on Base and retry
        the request with proof of payment, receiving pro-tier access for that call.
      </p>

      <h3 className="text-lg font-medium mt-6 mb-3">Payment Flow</h3>
      <CodeBlock
        language="text"
        code={`Agent calls MCP tool
  → Epitome checks tier
  → If free tier: returns HTTP 402 with payment details
    → Payment details include: price, currency, network, pay-to address
  → Agent pays with USDC on Base
  → Agent retries request with payment proof (X-Payment header)
  → Epitome verifies payment on-chain
  → Request processed with pro-tier access`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">Supported Networks</h3>
      <p className="text-muted-foreground mb-4">
        <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 mr-2">Base Sepolia</Badge>
        Testnet for development and testing.
      </p>
      <p className="text-muted-foreground mb-4">
        <Badge className="bg-green-500/10 text-green-400 border-green-500/20 mr-2">Base</Badge>
        Mainnet for production use.
      </p>

      <h3 className="text-lg font-medium mt-6 mb-3">Pricing</h3>
      <p className="text-muted-foreground mb-4">
        <strong className="text-foreground">$0.01 per MCP tool call</strong> (USDC).
        No subscription needed — each call is independent.
      </p>

      <h3 className="text-lg font-medium mt-6 mb-3">Self-Hosting Configuration</h3>
      <p className="text-muted-foreground mb-4">
        To enable x402 agent pay-per-call on your self-hosted instance, set the following
        environment variables:
      </p>
      <CodeBlock
        language="bash"
        code={`X402_ENABLED=true
X402_PAY_TO_ADDRESS=0xYourAddress
X402_PRICE_PER_CALL=0.01
X402_NETWORK=eip155:84532            # Base Sepolia testnet (alias: "base-sepolia")
# X402_NETWORK=eip155:8453           # Base mainnet (alias: "base")
# X402_FACILITATOR_URL=              # Auto-selected: x402.org (testnet) or CDP (mainnet)
# CDP_API_KEY_ID=                    # Required for mainnet CDP facilitator
# CDP_API_KEY_SECRET=                # Required for mainnet CDP facilitator`}
      />

      {/* Section 6: Billing API Endpoints */}
      <h2 id="billing-api" className="text-xl font-semibold mt-10 mb-4">Billing API Endpoints</h2>
      <p className="text-muted-foreground mb-4">
        All billing endpoints require session authentication. Agent API keys cannot access billing endpoints.
      </p>

      <h3 className="text-lg font-medium mt-6 mb-3">GET /v1/billing/usage</h3>
      <p className="text-muted-foreground mb-4">
        Returns current tier, limits, and usage counts for your account.
      </p>
      <CodeBlock
        language="bash"
        code={`curl -s https://epitome.fyi/v1/billing/usage \\
  -H "Cookie: session=YOUR_SESSION_TOKEN"

# Response:
# {
#   "tier": "free",
#   "limits": { "max_tables": 2, "max_agents": 3, "max_graph_entities": 100 },
#   "usage": { "tables": 1, "agents": 2, "graph_entities": 47 }
# }`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">GET /v1/billing/subscription</h3>
      <p className="text-muted-foreground mb-4">
        Returns Stripe subscription details for Pro users, or <code className="text-foreground bg-muted px-1 rounded">null</code> for
        free tier accounts.
      </p>
      <CodeBlock
        language="bash"
        code={`curl -s https://epitome.fyi/v1/billing/subscription \\
  -H "Cookie: session=YOUR_SESSION_TOKEN"

# Response:
# {
#   "subscription": {
#     "status": "active",
#     "current_period_end": "2026-03-18T00:00:00Z",
#     "cancel_at_period_end": false
#   }
# }`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">POST /v1/billing/checkout</h3>
      <p className="text-muted-foreground mb-4">
        Creates a Stripe checkout session and returns a URL to redirect the user to.
      </p>
      <CodeBlock
        language="bash"
        code={`curl -s -X POST https://epitome.fyi/v1/billing/checkout \\
  -H "Cookie: session=YOUR_SESSION_TOKEN"

# Response:
# { "url": "https://checkout.stripe.com/c/pay/cs_live_..." }`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">POST /v1/billing/portal</h3>
      <p className="text-muted-foreground mb-4">
        Creates a Stripe customer portal session for managing subscription and payment methods.
      </p>
      <CodeBlock
        language="bash"
        code={`curl -s -X POST https://epitome.fyi/v1/billing/portal \\
  -H "Cookie: session=YOUR_SESSION_TOKEN"

# Response:
# { "url": "https://billing.stripe.com/p/session/..." }`}
      />

      <h3 className="text-lg font-medium mt-6 mb-3">GET /v1/billing/transactions</h3>
      <p className="text-muted-foreground mb-4">
        Returns x402 transaction history for your account, including payment amounts,
        transaction hashes, and which MCP tools were called.
      </p>
      <CodeBlock
        language="bash"
        code={`curl -s https://epitome.fyi/v1/billing/transactions \\
  -H "Cookie: session=YOUR_SESSION_TOKEN"

# Response:
# {
#   "transactions": [
#     {
#       "id": "txn_abc123",
#       "tool": "memorize",
#       "amount": "0.01",
#       "currency": "USDC",
#       "network": "base",
#       "tx_hash": "0x...",
#       "created_at": "2026-02-18T12:00:00Z"
#     }
#   ]
# }`}
      />

      {/* Section 7: FAQ */}
      <h2 id="faq" className="text-xl font-semibold mt-10 mb-4">FAQ</h2>

      <h3 className="text-lg font-medium mt-6 mb-3">What happens when I hit a free tier limit?</h3>
      <p className="text-muted-foreground mb-4">
        The API returns <code className="text-foreground bg-muted px-1 rounded">HTTP 402</code> with
        details on which limit was reached. Upgrade to Pro or use x402 pay-per-call to continue.
      </p>

      <h3 className="text-lg font-medium mt-6 mb-3">Can I downgrade from Pro?</h3>
      <p className="text-muted-foreground mb-4">
        Yes, cancel your subscription from the Stripe customer portal. Access continues until the end
        of your current billing period. After that, your account reverts to the free tier.
      </p>

      <h3 className="text-lg font-medium mt-6 mb-3">Are x402 payments refundable?</h3>
      <p className="text-muted-foreground mb-4">
        No, x402 payments are non-refundable blockchain micro-transactions. Each payment is settled
        on-chain and cannot be reversed.
      </p>

      <h3 className="text-lg font-medium mt-6 mb-3">What if I'm self-hosting?</h3>
      <p className="text-muted-foreground mb-4">
        Self-hosted instances have no billing by default. All limits are configurable via environment
        variables. See the <a href="/docs/self-hosting" className="text-blue-400 hover:underline">Self-Hosting Guide</a> for
        details on configuring tier limits and x402.
      </p>
    </DocPage>
  );
}
