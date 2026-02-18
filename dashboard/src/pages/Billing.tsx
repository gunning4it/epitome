import { useMemo, useRef, useEffect } from 'react';
import * as d3 from 'd3';
import {
  useSession,
  useBillingUsage,
  useBillingSubscription,
  useCreateCheckout,
  useCreatePortal,
  useBillingTransactions,
} from '@/hooks/useApi';
import type { BillingTransaction } from '@/lib/api-client';
import { formatDate } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  CreditCard,
  ArrowUpRight,
  Receipt,
  Database,
  Bot,
  Network,
} from 'lucide-react';

// ─── Usage Progress Bar ───────────────────────────────────────────

function UsageBar({
  label,
  current,
  limit,
  icon: Icon,
}: {
  label: string;
  current: number;
  limit: number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const unlimited = limit === -1;
  const pct = unlimited ? 0 : Math.min((current / limit) * 100, 100);
  const color =
    unlimited || pct < 70
      ? 'bg-emerald-500'
      : pct < 90
        ? 'bg-yellow-500'
        : 'bg-red-500';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Icon className="size-4 text-muted-foreground" />
          {label}
        </div>
        <span className="text-sm text-muted-foreground font-mono">
          {unlimited ? `${current} / Unlimited` : `${current} / ${limit}`}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        {!unlimited && (
          <div
            className={`h-full rounded-full transition-all ${color}`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  );
}

// ─── 30-Day Usage Chart (D3) ──────────────────────────────────────

function UsageChart({
  history,
}: {
  history: Array<{ resource: string; date: string; count: number; agentId: string | null }>;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  const { apiData, mcpData, dates } = useMemo(() => {
    const byDate = new Map<string, { api: number; mcp: number }>();

    // Fill 30 days
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      byDate.set(key, { api: 0, mcp: 0 });
    }

    for (const h of history) {
      if (!h.agentId) {
        const entry = byDate.get(h.date);
        if (entry) {
          if (h.resource === 'api_calls') entry.api += h.count;
          if (h.resource === 'mcp_calls') entry.mcp += h.count;
        }
      }
    }

    const sortedDates = [...byDate.keys()].sort();
    return {
      apiData: sortedDates.map((d) => ({ date: d, value: byDate.get(d)!.api })),
      mcpData: sortedDates.map((d) => ({ date: d, value: byDate.get(d)!.mcp })),
      dates: sortedDates,
    };
  }, [history]);

  useEffect(() => {
    if (!svgRef.current || dates.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current.clientWidth;
    const height = 200;
    const margin = { top: 16, right: 16, bottom: 28, left: 40 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const x = d3
      .scaleTime()
      .domain([new Date(dates[0]), new Date(dates[dates.length - 1])])
      .range([0, innerW]);

    const maxVal = Math.max(
      d3.max(apiData, (d) => d.value) || 0,
      d3.max(mcpData, (d) => d.value) || 0,
      1
    );

    const y = d3.scaleLinear().domain([0, maxVal]).nice().range([innerH, 0]);

    const g = svg
      .attr('viewBox', `0 0 ${width} ${height}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Grid lines
    g.append('g')
      .attr('class', 'grid')
      .call(
        d3.axisLeft(y).ticks(4).tickSize(-innerW).tickFormat(() => '')
      )
      .call((g) => g.select('.domain').remove())
      .call((g) => g.selectAll('.tick line').attr('stroke', 'currentColor').attr('stroke-opacity', 0.08));

    // X axis
    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat((d) => d3.timeFormat('%b %d')(d as Date)))
      .call((g) => g.select('.domain').attr('stroke', 'currentColor').attr('stroke-opacity', 0.15))
      .call((g) => g.selectAll('.tick text').attr('fill', 'currentColor').attr('opacity', 0.5).attr('font-size', '10px'))
      .call((g) => g.selectAll('.tick line').remove());

    // Y axis
    g.append('g')
      .call(d3.axisLeft(y).ticks(4))
      .call((g) => g.select('.domain').remove())
      .call((g) => g.selectAll('.tick text').attr('fill', 'currentColor').attr('opacity', 0.5).attr('font-size', '10px'))
      .call((g) => g.selectAll('.tick line').remove());

    const area = d3
      .area<{ date: string; value: number }>()
      .x((d) => x(new Date(d.date)))
      .y0(innerH)
      .y1((d) => y(d.value))
      .curve(d3.curveMonotoneX);

    const line = d3
      .line<{ date: string; value: number }>()
      .x((d) => x(new Date(d.date)))
      .y((d) => y(d.value))
      .curve(d3.curveMonotoneX);

    // API calls area + line
    g.append('path')
      .datum(apiData)
      .attr('fill', 'hsl(217, 91%, 60%)')
      .attr('fill-opacity', 0.15)
      .attr('d', area);
    g.append('path')
      .datum(apiData)
      .attr('fill', 'none')
      .attr('stroke', 'hsl(217, 91%, 60%)')
      .attr('stroke-width', 1.5)
      .attr('d', line);

    // MCP calls area + line
    g.append('path')
      .datum(mcpData)
      .attr('fill', 'hsl(142, 71%, 45%)')
      .attr('fill-opacity', 0.15)
      .attr('d', area);
    g.append('path')
      .datum(mcpData)
      .attr('fill', 'none')
      .attr('stroke', 'hsl(142, 71%, 45%)')
      .attr('stroke-width', 1.5)
      .attr('d', line);
  }, [apiData, mcpData, dates]);

  return (
    <div>
      <svg ref={svgRef} className="w-full text-foreground" style={{ height: 200 }} />
      <div className="flex items-center gap-4 mt-2 justify-center text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-blue-500" />
          API Calls
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-emerald-500" />
          MCP Calls
        </span>
      </div>
    </div>
  );
}

// ─── Transaction Row ──────────────────────────────────────────────

function formatAmount(micros: number): string {
  const dollars = micros / 1_000_000;
  // Show cents for sub-dollar amounts, 2 decimals otherwise
  if (dollars < 1) return `$${dollars.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.00')}`;
  return `$${dollars.toFixed(2)}`;
}

function TransactionRow({ tx }: { tx: BillingTransaction }) {
  return (
    <TableRow>
      <TableCell className="text-foreground whitespace-nowrap">
        {formatDate(tx.createdAt)}
      </TableCell>
      <TableCell>
        <Badge
          variant="secondary"
          className={
            tx.paymentType === 'stripe'
              ? 'bg-purple-500/20 text-purple-400 border-transparent'
              : 'bg-blue-500/20 text-blue-400 border-transparent'
          }
        >
          {tx.paymentType === 'stripe' ? 'Stripe' : 'x402'}
        </Badge>
      </TableCell>
      <TableCell className="text-foreground">
        {tx.description || (tx.paymentType === 'stripe' ? 'Pro subscription' : 'MCP tool call')}
      </TableCell>
      <TableCell className="font-mono text-foreground">
        {formatAmount(tx.amountMicros)}
      </TableCell>
      <TableCell>
        <Badge
          variant="secondary"
          className={
            tx.status === 'succeeded'
              ? 'bg-emerald-500/20 text-emerald-400 border-transparent'
              : tx.status === 'failed'
                ? 'bg-red-500/20 text-red-400 border-transparent'
                : 'bg-yellow-500/20 text-yellow-400 border-transparent'
          }
        >
          {tx.status}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        {tx.stripeInvoiceId && (
          <span className="text-xs text-muted-foreground font-mono">
            {tx.stripeInvoiceId.slice(0, 16)}...
          </span>
        )}
        {tx.x402TxHash && (
          <a
            href={`https://basescan.org/tx/${tx.x402TxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline font-mono inline-flex items-center gap-1"
          >
            {tx.x402TxHash.slice(0, 10)}...
            <ArrowUpRight className="size-3" />
          </a>
        )}
      </TableCell>
    </TableRow>
  );
}

// ─── Main Billing Page ────────────────────────────────────────────

export default function Billing() {
  const { data: session } = useSession();
  const { data: usage, isLoading: usageLoading } = useBillingUsage();
  const { data: subscription } = useBillingSubscription();
  const { data: txData, isLoading: txLoading } = useBillingTransactions({ limit: 20 });
  const checkout = useCreateCheckout();
  const portal = useCreatePortal();

  const tier = session?.tier || 'free';
  const isPro = tier === 'pro' || tier === 'enterprise';

  const handleUpgrade = async () => {
    try {
      const result = await checkout.mutateAsync();
      window.location.href = result.url;
    } catch (err) {
      console.error('Checkout failed:', err);
    }
  };

  const handleManage = async () => {
    try {
      const result = await portal.mutateAsync();
      window.location.href = result.url;
    } catch (err) {
      console.error('Portal failed:', err);
    }
  };

  // Per-agent breakdown from usage history
  const agentBreakdown = useMemo(() => {
    if (!usage?.history) return [];
    const agents = new Map<string, { api: number; mcp: number }>();
    for (const h of usage.history) {
      if (h.agentId) {
        const entry = agents.get(h.agentId) || { api: 0, mcp: 0 };
        if (h.resource === 'api_calls') entry.api += h.count;
        if (h.resource === 'mcp_calls') entry.mcp += h.count;
        agents.set(h.agentId, entry);
      }
    }
    return [...agents.entries()]
      .map(([id, counts]) => ({ agentId: id, ...counts, total: counts.api + counts.mcp }))
      .sort((a, b) => b.total - a.total);
  }, [usage?.history]);

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <PageHeader title="Billing" description="Manage your subscription and monitor usage" />

      <div className="space-y-6">
        {/* A. Current Plan */}
        <Card>
          <CardHeader>
            <CardTitle>Current Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Badge
                  variant="secondary"
                  className={
                    isPro
                      ? 'bg-primary/20 text-primary border-transparent text-base px-3 py-1'
                      : 'text-base px-3 py-1'
                  }
                >
                  {tier.charAt(0).toUpperCase() + tier.slice(1)}
                </Badge>
                {isPro && subscription?.currentPeriodEnd && (
                  <span className="text-sm text-muted-foreground">
                    {subscription.cancelAtPeriodEnd ? 'Cancels' : 'Renews'}{' '}
                    {formatDate(subscription.currentPeriodEnd)}
                  </span>
                )}
              </div>
              <div>
                {isPro ? (
                  <Button
                    variant="outline"
                    onClick={handleManage}
                    disabled={portal.isPending}
                  >
                    <CreditCard className="size-4" />
                    {portal.isPending ? 'Loading...' : 'Manage Subscription'}
                  </Button>
                ) : (
                  <Button onClick={handleUpgrade} disabled={checkout.isPending}>
                    <ArrowUpRight className="size-4" />
                    {checkout.isPending ? 'Loading...' : 'Upgrade to Pro \u2014 $5/mo'}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* B. Usage Overview */}
        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
          </CardHeader>
          <CardContent>
            {usageLoading ? (
              <div className="py-8 text-center text-muted-foreground">Loading usage...</div>
            ) : usage ? (
              <div className="space-y-5">
                <UsageBar
                  label="Tables"
                  current={usage.current.tables}
                  limit={usage.limits.maxTables}
                  icon={Database}
                />
                <UsageBar
                  label="Agents"
                  current={usage.current.agents}
                  limit={usage.limits.maxAgents}
                  icon={Bot}
                />
                <UsageBar
                  label="Graph Entities"
                  current={usage.current.graphEntities}
                  limit={usage.limits.maxGraphEntities}
                  icon={Network}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* C. 30-Day Usage Chart */}
        {usage?.history && usage.history.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>30-Day Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <UsageChart history={usage.history} />
            </CardContent>
          </Card>
        )}

        {/* D. Per-Agent Breakdown */}
        {agentBreakdown.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Per-Agent Breakdown (30 days)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead className="text-right">API Calls</TableHead>
                    <TableHead className="text-right">MCP Calls</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agentBreakdown.map((agent) => (
                    <TableRow key={agent.agentId}>
                      <TableCell className="font-medium text-foreground">
                        {agent.agentId}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {agent.api.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {agent.mcp.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono text-foreground font-semibold">
                        {agent.total.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* E. Billing History */}
        <Card>
          <CardHeader>
            <CardTitle>Billing History</CardTitle>
          </CardHeader>
          <CardContent>
            {txLoading ? (
              <div className="py-8 text-center text-muted-foreground">Loading transactions...</div>
            ) : txData?.data && txData.data.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Reference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {txData.data.map((tx) => (
                    <TransactionRow key={tx.id} tx={tx} />
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                icon={Receipt}
                title="No billing history"
                description="Transactions will appear here after your first payment"
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
