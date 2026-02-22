import { useState } from 'react';
import { useAgents, useUpdateConsent, useRevokeAgent, useDeleteAgent, useCreateApiKey } from '@/hooks/useApi';
import { useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from '@/lib/utils';
import type { AgentWithConsent } from '@/lib/types';
import { Shield, Check, Info, ChevronDown, AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { CodeBlock } from '@/components/CodeBlock';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const RESOURCES = [
  { key: 'profile', label: 'Profile', description: 'Name, preferences, personal info' },
  { key: 'tables/*', label: 'All Tables', description: 'Structured data (meals, workouts, etc.)' },
  { key: 'vectors/*', label: 'All Vectors', description: 'Semantic search embeddings' },
  { key: 'graph', label: 'Knowledge Graph', description: 'Entities and relationships' },
  { key: 'memory', label: 'Memory', description: 'Saved memories and context' },
];

const API_BASE_URL = import.meta.env.VITE_API_URL?.replace('/v1', '') || 'http://localhost:3000';

function ConnectAgentModal({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (key: string, agentName: string) => void;
}) {
  const [agentName, setAgentName] = useState('');
  const [selectedPermission, setSelectedPermission] = useState<'all' | 'write' | 'read'>('all');
  const [error, setError] = useState<string | null>(null);
  const createApiKey = useCreateApiKey();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentName.trim()) return;
    setError(null);

    try {
      const name = agentName.trim().toLowerCase().replace(/\s+/g, '-');
      const scopes: ('read' | 'write')[] =
        selectedPermission === 'read' ? ['read'] : ['read', 'write'];

      const result = await createApiKey.mutateAsync({
        label: agentName.trim(),
        agent_id: name,
        scopes,
      });

      onCreated(result.data.key, agentName.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API key');
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect an Agent</DialogTitle>
          <DialogDescription>
            Create an API key for your AI agent to access Epitome
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Agent Name</Label>
              <Input
                type="text"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="e.g. Claude Desktop, Cursor, My App"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Default Permission</Label>
              <div className="space-y-2">
                {([
                  { value: 'all' as const, label: 'Full Access (Read & Write)', desc: 'Agent can read and modify all data' },
                  { value: 'read' as const, label: 'Read Only', desc: 'Agent can view data but not modify it' },
                ]).map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedPermission === opt.value
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    <input
                      type="radio"
                      name="permission"
                      checked={selectedPermission === opt.value}
                      onChange={() => setSelectedPermission(opt.value)}
                      className="mt-0.5 accent-primary"
                    />
                    <div>
                      <div className="text-sm font-medium text-foreground">{opt.label}</div>
                      <div className="text-xs text-muted-foreground">{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="p-3 bg-muted rounded-lg">
              <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Resources granted</div>
              <div className="space-y-1">
                {RESOURCES.map((r) => (
                  <div key={r.key} className="flex items-center gap-2 text-sm text-foreground">
                    <Check className="size-4 text-green-400 flex-shrink-0" />
                    {r.label}
                  </div>
                ))}
              </div>
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!agentName.trim() || createApiKey.isPending}
            >
              {createApiKey.isPending ? 'Creating...' : 'Create API Key'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ApiKeyResult({ apiKey, agentName, onDone }: {
  apiKey: string;
  agentName: string;
  onDone: () => void;
}) {
  const mcpConfig = JSON.stringify({
    mcpServers: {
      epitome: {
        url: `${API_BASE_URL}/mcp`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
    },
  }, null, 2);

  const curlSnippet = `curl -X POST ${API_BASE_URL}/mcp \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Accept: application/json, text/event-stream" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"recall","arguments":{}}}'`;

  const restSnippet = `MCP endpoint: ${API_BASE_URL}/mcp
Auth Header: Authorization: Bearer ${apiKey}

JSON-RPC method: tools/list
JSON-RPC method: tools/call name=recall
JSON-RPC method: tools/call name=memorize
JSON-RPC method: tools/call name=review

Legacy REST endpoints /mcp/tools and /mcp/call/:toolName are disabled by default (410).`;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onDone(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-green-500/20 p-1">
              <Check className="size-4 text-green-400" />
            </div>
            <DialogTitle>Agent "{agentName}" Connected</DialogTitle>
          </div>
          <DialogDescription>Copy your API key now -- it won't be shown again.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* Warning */}
          <Alert>
            <AlertTriangle className="size-4" />
            <AlertDescription>
              This is the only time your API key will be displayed. Store it securely.
            </AlertDescription>
          </Alert>

          {/* API Key */}
          <div className="space-y-2">
            <Label>API Key</Label>
            <CodeBlock code={apiKey} />
          </div>

          {/* Config Snippets */}
          <div className="space-y-2">
            <Label>Configuration</Label>
            <Tabs defaultValue="mcp">
              <TabsList className="flex-wrap h-auto gap-1">
                <TabsTrigger value="mcp">MCP Config</TabsTrigger>
                <TabsTrigger value="claude-ai">Claude</TabsTrigger>
                <TabsTrigger value="openai">ChatGPT</TabsTrigger>
                <TabsTrigger value="curl">curl</TabsTrigger>
                <TabsTrigger value="rest">JSON-RPC</TabsTrigger>
              </TabsList>
              <TabsContent value="mcp" className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Add to your MCP client config (e.g. Claude Desktop <code className="bg-muted px-1 rounded text-foreground">claude_desktop_config.json</code>):
                </p>
                <CodeBlock code={mcpConfig} language="json" />
                <p className="text-xs text-muted-foreground">
                  Mac: <code className="bg-muted px-1 rounded text-foreground">~/Library/Application Support/Claude/claude_desktop_config.json</code>
                  <br />
                  Windows: <code className="bg-muted px-1 rounded text-foreground">%APPDATA%\Claude\claude_desktop_config.json</code>
                </p>
              </TabsContent>
              <TabsContent value="claude-ai" className="mt-3 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Claude connects via OAuth -- no API key needed.
                </p>
                <ol className="text-sm text-foreground space-y-2 list-decimal list-inside">
                  <li>Go to <strong>claude.ai</strong> &rarr; Settings &rarr; Connectors &rarr; <strong>"Add custom connector"</strong></li>
                  <li>Set <strong>Name</strong> to <code className="bg-muted px-1 rounded text-foreground">Epitome</code></li>
                  <li>Set <strong>Remote MCP server URL</strong> to:</li>
                </ol>
                <CodeBlock code={`${API_BASE_URL}/mcp`} />
                <ol start={4} className="text-sm text-foreground space-y-2 list-decimal list-inside">
                  <li>Leave <strong>OAuth Client ID</strong> and <strong>Client Secret</strong> blank</li>
                  <li>Click <strong>"Add"</strong> -- Claude handles OAuth authorization automatically</li>
                </ol>
              </TabsContent>
              <TabsContent value="openai" className="mt-3 space-y-3">
                <p className="text-xs text-muted-foreground">
                  ChatGPT connects via OAuth -- no API key needed.
                </p>
                <ol className="text-sm text-foreground space-y-2 list-decimal list-inside">
                  <li>In ChatGPT, open <strong>Settings</strong> &rarr; enable <strong>Developer mode</strong></li>
                  <li>Under <strong>"Apps"</strong> click <strong>"Create app"</strong></li>
                  <li>Set <strong>Name</strong> to <code className="bg-muted px-1 rounded text-foreground">Epitome</code></li>
                  <li>Set <strong>MCP Server URL</strong> to:</li>
                </ol>
                <CodeBlock code={`${API_BASE_URL}/mcp`} />
                <ol start={5} className="text-sm text-foreground space-y-2 list-decimal list-inside">
                  <li>Set <strong>Authentication</strong> to OAuth (leave Client ID and Client Secret blank)</li>
                  <li>Check the acknowledgment box, then click <strong>"Create"</strong></li>
                  <li>ChatGPT handles OAuth authorization automatically</li>
                </ol>
              </TabsContent>
              <TabsContent value="curl" className="mt-3">
                <CodeBlock code={curlSnippet} language="bash" />
              </TabsContent>
              <TabsContent value="rest" className="mt-3">
                <CodeBlock code={restSnippet} language="text" />
              </TabsContent>
            </Tabs>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onDone}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgentCard({ agent }: { agent: AgentWithConsent }) {
  const updateConsent = useUpdateConsent();
  const revokeAgent = useRevokeAgent();
  const deleteAgent = useDeleteAgent();
  const queryClient = useQueryClient();
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showMcpSetup, setShowMcpSetup] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRevoked = agent.status === 'revoked';

  const getPermissionForResource = (resource: string): 'read' | 'write' | 'none' => {
    const rule = agent.permissions.find((p) => p.resource === resource);
    return rule?.permission || 'none';
  };

  const handleSetPermission = async (resource: string, newPermission: 'read' | 'write' | 'none') => {
    setError(null);
    try {
      await updateConsent.mutateAsync({
        agentId: agent.agent_id,
        permissions: [{ resource, permission: newPermission }],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update permission');
    } finally {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    }
  };

  const handleSetAll = async (permission: 'read' | 'write' | 'none') => {
    setError(null);
    try {
      await updateConsent.mutateAsync({
        agentId: agent.agent_id,
        permissions: RESOURCES.map((r) => ({ resource: r.key, permission })),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update permissions');
    } finally {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    }
  };

  const handleRevoke = async () => {
    try {
      await revokeAgent.mutateAsync(agent.agent_id);
      setShowRevokeConfirm(false);
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke agent');
    }
  };

  const handleDelete = async () => {
    try {
      await deleteAgent.mutateAsync(agent.agent_id);
      setShowDeleteConfirm(false);
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete agent');
    }
  };

  const placeholder = '<YOUR_API_KEY>';
  const mcpConfig = JSON.stringify({
    mcpServers: {
      epitome: {
        url: `${API_BASE_URL}/mcp`,
        headers: {
          Authorization: `Bearer ${placeholder}`,
        },
      },
    },
  }, null, 2);
  const curlSnippet = `curl -X POST ${API_BASE_URL}/mcp \\
  -H "Authorization: Bearer ${placeholder}" \\
  -H "Accept: application/json, text/event-stream" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"recall","arguments":{}}}'`;
  const restSnippet = `MCP endpoint: ${API_BASE_URL}/mcp
Auth Header: Authorization: Bearer ${placeholder}

JSON-RPC method: tools/list
JSON-RPC method: tools/call name=recall
JSON-RPC method: tools/call name=memorize
JSON-RPC method: tools/call name=review

Legacy REST endpoints /mcp/tools and /mcp/call/:toolName are disabled by default (410).`;

  return (
    <Card>
      {/* Agent Header */}
      <CardHeader className="border-b border-border">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <CardTitle className="text-lg">
                {agent.agent_name || agent.agent_id}
              </CardTitle>
              {isRevoked ? (
                <Badge variant="secondary" className="bg-red-500/20 text-red-400 border-red-500/30">
                  <span className="size-1.5 rounded-full bg-red-400 mr-1" />
                  Revoked
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-green-500/20 text-green-400 border-green-500/30">
                  <span className="size-1.5 rounded-full bg-green-400 mr-1" />
                  Active
                </Badge>
              )}
            </div>
            <div className="font-mono text-xs text-muted-foreground mt-1">{agent.agent_id}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mt-4">
          <div className="bg-muted rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">Last Used</div>
            <div className="text-sm font-medium text-foreground">
              {agent.last_used ? formatDateTime(agent.last_used) : 'Never'}
            </div>
          </div>
          <div className="bg-muted rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">Connected Since</div>
            <div className="text-sm font-medium text-foreground">{formatDateTime(agent.created_at)}</div>
          </div>
        </div>
      </CardHeader>

      {/* Per-resource Permissions */}
      <CardContent>
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold text-foreground">Permissions</h4>
          <div className="flex gap-1 text-xs items-center">
            <span className="text-muted-foreground mr-1">Set all:</span>
            {(['write', 'read', 'none'] as const).map((level) => (
              <Button
                key={level}
                variant="outline"
                size="xs"
                onClick={() => handleSetAll(level)}
                disabled={isRevoked || updateConsent.isPending}
              >
                {level === 'none' ? 'None' : level === 'read' ? 'Read' : 'Read & Write'}
              </Button>
            ))}
          </div>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-3">
            <AlertTriangle className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          {RESOURCES.map((resource) => {
            const current = getPermissionForResource(resource.key);
            return (
              <div key={resource.key} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <div>
                  <div className="font-medium text-sm text-foreground">{resource.label}</div>
                  <div className="text-xs text-muted-foreground">{resource.description}</div>
                </div>
                <div className="flex gap-1">
                  {(['none', 'read', 'write'] as const).map((level) => (
                    <Button
                      key={level}
                      size="xs"
                      variant={current === level ? 'default' : 'outline'}
                      onClick={() => handleSetPermission(resource.key, level)}
                      disabled={isRevoked || updateConsent.isPending || current === level}
                      className={
                        current === level
                          ? level === 'none'
                            ? 'bg-muted text-muted-foreground hover:bg-muted border border-border'
                            : level === 'read'
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-green-600 text-white hover:bg-green-700'
                          : ''
                      }
                    >
                      {level === 'none' ? 'None' : level === 'read' ? 'Read' : 'Read & Write'}
                    </Button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>

      {/* MCP Setup — hidden when revoked */}
      {!isRevoked && <Collapsible open={showMcpSetup} onOpenChange={setShowMcpSetup}>
        <div className="border-t border-border">
          <CollapsibleTrigger asChild>
            <button
              className="w-full px-6 py-3 flex items-center justify-between text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <span>MCP Setup</span>
              <ChevronDown
                className={`size-4 transition-transform ${showMcpSetup ? 'rotate-180' : ''}`}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-6 pb-6 space-y-3">
              <p className="text-xs text-muted-foreground">
                Use the API key from when you first connected this agent.
              </p>
              <Tabs defaultValue="mcp">
                <TabsList className="flex-wrap h-auto gap-1">
                  <TabsTrigger value="mcp">MCP Config</TabsTrigger>
                  <TabsTrigger value="claude-ai">Claude</TabsTrigger>
                  <TabsTrigger value="openai">ChatGPT</TabsTrigger>
                  <TabsTrigger value="curl">curl</TabsTrigger>
                  <TabsTrigger value="rest">JSON-RPC</TabsTrigger>
                </TabsList>
                <TabsContent value="mcp" className="mt-3 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Add to your MCP client config (e.g. Claude Desktop <code className="bg-muted px-1 rounded text-foreground">claude_desktop_config.json</code>):
                  </p>
                  <CodeBlock code={mcpConfig} language="json" />
                  <p className="text-xs text-muted-foreground">
                    Mac: <code className="bg-muted px-1 rounded text-foreground">~/Library/Application Support/Claude/claude_desktop_config.json</code>
                    <br />
                    Windows: <code className="bg-muted px-1 rounded text-foreground">%APPDATA%\Claude\claude_desktop_config.json</code>
                  </p>
                </TabsContent>
                <TabsContent value="claude-ai" className="mt-3 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Claude connects via OAuth -- no API key needed.
                  </p>
                  <ol className="text-sm text-foreground space-y-2 list-decimal list-inside">
                    <li>Go to <strong>claude.ai</strong> &rarr; Settings &rarr; Connectors &rarr; <strong>"Add custom connector"</strong></li>
                    <li>Set <strong>Name</strong> to <code className="bg-muted px-1 rounded text-foreground">Epitome</code></li>
                    <li>Set <strong>Remote MCP server URL</strong> to:</li>
                  </ol>
                  <CodeBlock code={`${API_BASE_URL}/mcp`} />
                  <ol start={4} className="text-sm text-foreground space-y-2 list-decimal list-inside">
                    <li>Leave <strong>OAuth Client ID</strong> and <strong>Client Secret</strong> blank</li>
                    <li>Click <strong>"Add"</strong> -- Claude handles OAuth authorization automatically</li>
                  </ol>
                </TabsContent>
                <TabsContent value="openai" className="mt-3 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    ChatGPT connects via OAuth -- no API key needed.
                  </p>
                  <ol className="text-sm text-foreground space-y-2 list-decimal list-inside">
                    <li>In ChatGPT, open <strong>Settings</strong> &rarr; enable <strong>Developer mode</strong></li>
                    <li>Under <strong>"MCP Servers"</strong> click <strong>"+ Add"</strong></li>
                    <li>Set <strong>Name</strong> to <code className="bg-muted px-1 rounded text-foreground">Epitome</code></li>
                    <li>Set <strong>MCP Server URL</strong> to:</li>
                  </ol>
                  <CodeBlock code={`${API_BASE_URL}/mcp`} />
                  <ol start={5} className="text-sm text-foreground space-y-2 list-decimal list-inside">
                    <li>Set <strong>Authentication</strong> to OAuth (leave Client ID and Client Secret blank)</li>
                    <li>Check the acknowledgment box, then click <strong>"Create"</strong></li>
                    <li>ChatGPT handles OAuth authorization automatically</li>
                  </ol>
                </TabsContent>
                <TabsContent value="curl" className="mt-3">
                  <CodeBlock code={curlSnippet} language="bash" />
                </TabsContent>
                <TabsContent value="rest" className="mt-3">
                  <CodeBlock code={restSnippet} language="text" />
                </TabsContent>
              </Tabs>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>}

      {/* Revoke / Delete Section */}
      <div className="border-t border-border px-6 py-4 flex justify-end">
        {isRevoked ? (
          <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
            <Button
              variant="outline"
              size="sm"
              className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="size-4 mr-1.5" />
              Delete Agent
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <Trash2 className="size-5 text-red-400" />
                  Permanently delete {agent.agent_name || agent.agent_id}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently remove all data for this agent including API keys, consent rules, and registry entry. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleteAgent.isPending}
                >
                  {deleteAgent.isPending ? 'Deleting...' : 'Yes, Delete Permanently'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <AlertDialog open={showRevokeConfirm} onOpenChange={setShowRevokeConfirm}>
            <Button
              variant="outline"
              size="sm"
              className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              onClick={() => setShowRevokeConfirm(true)}
            >
              Revoke Access
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="size-5 text-red-400" />
                  Revoke all access for {agent.agent_name || agent.agent_id}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This agent will immediately lose all access to your data. You can delete the agent afterwards.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={handleRevoke}
                  disabled={revokeAgent.isPending}
                >
                  {revokeAgent.isPending ? 'Revoking...' : 'Yes, Revoke Access'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </Card>
  );
}

export default function Agents() {
  const { data: agents, isLoading, error: loadError } = useAgents();
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [createdKey, setCreatedKey] = useState<{ key: string; name: string } | null>(null);
  const queryClient = useQueryClient();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="size-8 text-primary animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading agents...</p>
        </div>
      </div>
    );
  }

  const agentsList = agents || [];

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      <PageHeader title="Connected Agents" description="Manage AI agents with access to your data">
        <Button onClick={() => setShowConnectModal(true)}>
          + Connect Agent
        </Button>
      </PageHeader>

      {loadError && (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle className="size-4" />
          <AlertDescription>
            Failed to load agents: {loadError instanceof Error ? loadError.message : 'Unknown error'}
          </AlertDescription>
        </Alert>
      )}

      {agentsList.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Shield}
              title="No agents connected yet"
              description="Create an API key for your AI agent to start using Epitome as persistent memory"
              actionLabel="Connect Your First Agent"
              onAction={() => setShowConnectModal(true)}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {agentsList.map((agent) => (
            <AgentCard key={agent.agent_id} agent={agent} />
          ))}
        </div>
      )}

      {/* Info Panel */}
      <Card className="mt-8 bg-primary/5 border-primary/20">
        <CardContent>
          <div className="flex gap-3">
            <Info className="size-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-medium text-foreground mb-1">About Agent Permissions</div>
              <ul className="space-y-1 text-muted-foreground">
                <li><strong className="text-foreground">Write</strong> -- Agent can read and modify data (includes read access)</li>
                <li><strong className="text-foreground">Read</strong> -- Agent can view data but not modify it</li>
                <li><strong className="text-foreground">None</strong> -- Agent has no access to this resource</li>
                <li>Use "Set all" to quickly change all permissions at once</li>
                <li>Changes take effect immediately on every API call</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Modals */}
      {showConnectModal && (
        <ConnectAgentModal
          onClose={() => setShowConnectModal(false)}
          onCreated={(key, name) => {
            setShowConnectModal(false);
            setCreatedKey({ key, name });
            // Refresh agents list after creating
            queryClient.invalidateQueries({ queryKey: ['agents'] });
          }}
        />
      )}

      {createdKey && (
        <ApiKeyResult
          apiKey={createdKey.key}
          agentName={createdKey.name}
          onDone={() => setCreatedKey(null)}
        />
      )}
    </div>
  );
}
