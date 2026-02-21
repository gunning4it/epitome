import { useState, useMemo } from 'react';
import { useActivityLog } from '@/hooks/useApi';
import type { ActivityLogEntry } from '@/lib/types';
import { formatDateTime } from '@/lib/utils';
import { Activity as ActivityIcon, Eye, Search, PenLine, Download, ClipboardList } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { EmptyState } from '@/components/EmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

const ACTION_CONFIG: Record<string, { label: string; color: string }> = {
  read: { label: 'Read', color: 'bg-blue-500/20 text-blue-400' },
  write: { label: 'Write', color: 'bg-green-500/20 text-green-400' },
  update: { label: 'Update', color: 'bg-yellow-500/20 text-yellow-400' },
  delete: { label: 'Delete', color: 'bg-red-500/20 text-red-400' },
  query: { label: 'Query', color: 'bg-purple-500/20 text-purple-400' },
  consent_check: { label: 'Consent Check', color: 'bg-zinc-500/20 text-zinc-400' },
  consent_granted: { label: 'Consent Granted', color: 'bg-emerald-500/20 text-emerald-400' },
  consent_denied: { label: 'Consent Denied', color: 'bg-orange-500/20 text-orange-400' },
  mcp_recall: { label: 'Recall', color: 'bg-indigo-500/20 text-indigo-400' },
  mcp_memorize: { label: 'Memorize', color: 'bg-teal-500/20 text-teal-400' },
  mcp_review: { label: 'Review', color: 'bg-violet-500/20 text-violet-400' },
  write_pipeline: { label: 'Write Pipeline', color: 'bg-amber-500/20 text-amber-400' },
  login: { label: 'Login', color: 'bg-sky-500/20 text-sky-400' },
  logout: { label: 'Logout', color: 'bg-slate-500/20 text-slate-400' },
};

function getActionConfig(action: string): { label: string; color: string } {
  if (ACTION_CONFIG[action]) return ACTION_CONFIG[action];
  // Fallback: format unknown actions nicely
  const label = action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { label, color: 'bg-zinc-500/20 text-zinc-400' };
}

function formatDetails(action: string, details?: Record<string, unknown>): string {
  if (!details || Object.keys(details).length === 0) return '-';

  if (action === 'write_pipeline') {
    const summary = details.pipelineSummary as
      | {
          writeId?: string;
          stages?: Array<{ stage?: string; writeStatus?: string | null; error?: string | null }>;
        }
      | undefined;
    if (summary?.stages && summary.stages.length > 0) {
      const latest = summary.stages[summary.stages.length - 1];
      const stages = summary.stages.map((s) => s.stage).filter(Boolean).join(' -> ');
      const status = latest.writeStatus ? ` | ${latest.writeStatus}` : '';
      const error = latest.error ? ` | error: ${latest.error}` : '';
      return `${stages}${status}${error}`;
    }

    const pipeline = details.pipeline as
      | {
          stage?: string | null;
          writeStatus?: string | null;
          error?: string | null;
        }
      | undefined;
    if (pipeline?.stage) {
      const status = pipeline.writeStatus ? ` | ${pipeline.writeStatus}` : '';
      const error = pipeline.error ? ` | error: ${pipeline.error}` : '';
      return `${pipeline.stage}${status}${error}`;
    }
  }

  // Action-specific formatting
  if (action === 'consent_check' || action === 'consent_granted') {
    const granted = details.granted ? 'Granted' : 'Denied';
    const perm = details.permission || details.resource || '';
    return `${perm} access ${granted.toLowerCase()}`;
  }

  if (action === 'consent_denied') {
    return `${details.permission || details.resource || 'Access'} denied`;
  }

  if (action.startsWith('mcp_') || action === 'write') {
    const parts: string[] = [];
    if (details.fields && Array.isArray(details.fields)) {
      parts.push(`Fields: ${(details.fields as string[]).join(', ')}`);
    }
    if (details.tableName) parts.push(`Table: ${details.tableName}`);
    if (details.collection) parts.push(`Collection: ${details.collection}`);
    if (parts.length > 0) return parts.join(' | ');
  }

  if (action === 'query') {
    if (details.resultCount !== undefined) return `${details.resultCount} results`;
    if (details.rowCount !== undefined) return `${details.rowCount} rows`;
    if (details.mode) return `Mode: ${details.mode}`;
  }

  if (action === 'read') {
    if (details.count !== undefined) return `${details.count} item${Number(details.count) !== 1 ? 's' : ''}`;
  }

  // Generic: show key summary values
  const summaryKeys = ['resultCount', 'count', 'rowCount', 'query', 'type', 'entityName', 'entityType', 'mode'];
  const parts: string[] = [];
  for (const key of summaryKeys) {
    if (details[key] !== undefined) {
      parts.push(`${key.replace(/([A-Z])/g, ' $1').toLowerCase().trim()}: ${details[key]}`);
    }
  }
  if (parts.length > 0) return parts.join(' | ');

  // Last resort: compact JSON
  const json = JSON.stringify(details);
  return json.length > 80 ? json.slice(0, 77) + '...' : json;
}

export default function Activity() {
  const [filters, setFilters] = useState({
    agent_id: '',
    action: '',
    resource_type: '',
    date_from: '',
    date_to: '',
  });

  const [appliedFilters, setAppliedFilters] = useState<Record<string, string | number | boolean> | null>(null);
  const { data: activities, isLoading } = useActivityLog(appliedFilters ?? undefined);

  const displayActivities = useMemo(() => {
    if (!activities) return [];

    const pipelineGroups = new Map<string, ActivityLogEntry[]>();
    const nonPipeline: ActivityLogEntry[] = [];

    for (const activity of activities) {
      const pipeline = activity.details?.pipeline;
      const writeId = pipeline?.writeId;
      if (activity.action === 'write_pipeline' && writeId) {
        const existing = pipelineGroups.get(writeId) || [];
        existing.push(activity);
        pipelineGroups.set(writeId, existing);
      } else {
        nonPipeline.push(activity);
      }
    }

    const summarizedPipelines = Array.from(pipelineGroups.entries()).map(([writeId, entries]) => {
      const sorted = [...entries].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      const latest = sorted[sorted.length - 1];
      const stages = sorted.map((entry) => ({
        stage: entry.details?.pipeline?.stage || '',
        writeStatus: entry.details?.pipeline?.writeStatus || null,
        error: entry.details?.pipeline?.error || null,
      }));

      return {
        ...latest,
        id: `pipeline-${writeId}`,
        details: {
          ...(latest.details || {}),
          pipelineSummary: {
            writeId,
            stages,
          },
        },
      };
    });

    return [...nonPipeline, ...summarizedPipelines].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [activities]);

  // Derive unique action and resource types from data
  const { uniqueActions, uniqueResourceTypes } = useMemo(() => {
    if (displayActivities.length === 0) {
      return { uniqueActions: [] as string[], uniqueResourceTypes: [] as string[] };
    }
    const actions = [...new Set(displayActivities.map((a) => a.action))].sort();
    const resources = [...new Set(displayActivities.map((a) => a.resource_type))].sort();
    return { uniqueActions: actions, uniqueResourceTypes: resources };
  }, [displayActivities]);

  const handleApplyFilters = () => {
    const params: Record<string, string> = {};
    if (filters.agent_id) params.agent_id = filters.agent_id;
    if (filters.action) params.action = filters.action;
    if (filters.resource_type) params.resource_type = filters.resource_type;
    if (filters.date_from) params.date_from = filters.date_from;
    if (filters.date_to) params.date_to = filters.date_to;
    setAppliedFilters(Object.keys(params).length > 0 ? params : null);
  };

  const handleClearFilters = () => {
    setFilters({
      agent_id: '',
      action: '',
      resource_type: '',
      date_from: '',
      date_to: '',
    });
    setAppliedFilters(null);
  };

  const handleExport = () => {
    if (!displayActivities || displayActivities.length === 0) return;

    const csv = [
      ['Timestamp', 'Agent', 'Action', 'Resource Type', 'Resource ID', 'Details'].join(','),
      ...displayActivities.map((activity) => [
        activity.timestamp,
        activity.agent_name || activity.agent_id,
        activity.action,
        activity.resource_type,
        activity.resource_id,
        JSON.stringify(activity.details || ''),
      ].join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `activity-log-${new Date().toISOString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Calculate per-agent breakdown
  const agentBreakdown = displayActivities?.reduce((acc, activity) => {
    const agentName = activity.agent_name || activity.agent_id || 'unknown';
    if (!acc[agentName]) {
      acc[agentName] = { reads: 0, writes: 0, queries: 0, total: 0 };
    }
    acc[agentName].total++;
    if (activity.action === 'read') acc[agentName].reads++;
    else if (activity.action === 'query') acc[agentName].queries++;
    else acc[agentName].writes++;
    return acc;
  }, {} as Record<string, { reads: number; writes: number; queries: number; total: number }>);

  const totalActivities = displayActivities?.length || 0;
  const readCount = displayActivities?.filter((a) => a.action === 'read').length || 0;
  const queryCount = displayActivities?.filter((a) => a.action === 'query').length || 0;
  const writeCount = totalActivities - readCount - queryCount;

  return (
    <div className="px-6 py-8 max-w-7xl mx-auto">
      <PageHeader
        title="Activity Log"
        description="Track all agent interactions with your vault"
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Total Activities"
          value={totalActivities}
          icon={ActivityIcon}
        />
        <StatCard
          label="Reads"
          value={readCount}
          icon={Eye}
          color="bg-blue-500/15 text-blue-400"
        />
        <StatCard
          label="Queries"
          value={queryCount}
          icon={Search}
          color="bg-purple-500/15 text-purple-400"
        />
        <StatCard
          label="Writes"
          value={writeCount}
          icon={PenLine}
          color="bg-green-500/15 text-green-400"
        />
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
            <div className="space-y-1.5">
              <Label>Agent</Label>
              <Input
                value={filters.agent_id}
                onChange={(e) => setFilters({ ...filters, agent_id: e.target.value })}
                placeholder="Filter by agent..."
              />
            </div>

            <div className="space-y-1.5">
              <Label>Action</Label>
              <select
                value={filters.action}
                onChange={(e) => setFilters({ ...filters, action: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] dark:bg-input/30 dark:border-input"
              >
                <option value="">All</option>
                {uniqueActions.map((action) => (
                  <option key={action} value={action}>
                    {getActionConfig(action).label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label>Resource Type</Label>
              <select
                value={filters.resource_type}
                onChange={(e) => setFilters({ ...filters, resource_type: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] dark:bg-input/30 dark:border-input"
              >
                <option value="">All</option>
                {uniqueResourceTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label>Date From</Label>
              <Input
                type="date"
                value={filters.date_from}
                onChange={(e) => setFilters({ ...filters, date_from: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Date To</Label>
              <Input
                type="date"
                value={filters.date_to}
                onChange={(e) => setFilters({ ...filters, date_to: e.target.value })}
              />
            </div>
          </div>

          <div className="flex gap-3">
            <Button onClick={handleApplyFilters}>
              Apply Filters
            </Button>
            <Button variant="outline" onClick={handleClearFilters}>
              Clear
            </Button>
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={!displayActivities || displayActivities.length === 0}
              className="ml-auto"
            >
              <Download />
              Export CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Per-Agent Breakdown */}
      {agentBreakdown && Object.keys(agentBreakdown).length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Per-Agent Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(agentBreakdown).map(([agent, stats]: [string, { reads: number; writes: number; queries: number; total: number }]) => (
                <div key={agent} className="flex items-center justify-between bg-muted rounded-lg p-3">
                  <div>
                    <div className="font-medium text-foreground">{agent}</div>
                    <div className="text-sm text-muted-foreground">
                      {stats.reads} reads &middot; {stats.queries} queries &middot; {stats.writes} writes
                    </div>
                  </div>
                  <div className="text-2xl font-bold font-mono text-foreground">{stats.total}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Activity Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-12 text-center">
              <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">Loading activities...</p>
            </div>
          ) : displayActivities && displayActivities.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayActivities.map((activity, idx: number) => {
                  const actionCfg = getActionConfig(activity.action);
                  return (
                    <TableRow key={activity.id || idx}>
                      <TableCell className="text-foreground whitespace-nowrap">
                        {formatDateTime(activity.timestamp)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="bg-blue-500/20 text-blue-400 border-transparent">
                          {activity.agent_name || activity.agent_id}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={`border-transparent ${actionCfg.color}`}>
                          {actionCfg.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-foreground">
                        {activity.resource_type}
                        {activity.resource_id && (
                          <span className="text-muted-foreground ml-1 font-mono text-xs">
                            {activity.resource_id.length > 12
                              ? activity.resource_id.slice(0, 12) + '...'
                              : activity.resource_id}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-xs truncate">
                        {formatDetails(activity.action, activity.details)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              icon={ClipboardList}
              title="No activity logs found"
              description="Activity will appear here as agents interact with your vault"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
