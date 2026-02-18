import { useState } from 'react';
import { useSession, useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/hooks/useApi';
import { apiCall } from '@/lib/api-client';
import { PageHeader } from '@/components/PageHeader';
import { CodeBlock } from '@/components/CodeBlock';
import { EmptyState } from '@/components/EmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Key, Download, Trash2, Copy, Check } from 'lucide-react';

export default function Settings() {
  const { data: session } = useSession();
  const { data: apiKeys, isLoading: keysLoading } = useApiKeys();
  const createApiKey = useCreateApiKey();
  const revokeApiKey = useRevokeApiKey();

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [showNewKeyModal, setShowNewKeyModal] = useState(false);
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newKeyAgentId, setNewKeyAgentId] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState<'readwrite' | 'read'>('readwrite');
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExportData = async () => {
    try {
      const data = await apiCall('/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `epitome-export-${new Date().toISOString()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Failed to export data');
    }
  };

  const handleGenerateApiKey = async () => {
    setError(null);
    try {
      const scopes = newKeyScopes === 'readwrite' ? ['read', 'write'] : ['read'];
      const result = await createApiKey.mutateAsync({
        label: newKeyLabel || 'Untitled Key',
        agent_id: newKeyAgentId || undefined,
        scopes,
      });
      setGeneratedKey(result.data.key);
      setNewKeyLabel('');
      setNewKeyAgentId('');
    } catch (err) {
      console.error('Failed to generate API key:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate API key');
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    try {
      await revokeApiKey.mutateAsync(keyId);
    } catch (err) {
      console.error('Failed to revoke key:', err);
      alert('Failed to revoke API key');
    }
  };

  const handleDeleteVault = async () => {
    if (deleteConfirmText !== 'DELETE') {
      alert('Please type DELETE to confirm');
      return;
    }

    try {
      await apiCall('/vault', { method: 'DELETE' });
      window.location.href = '/';
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete vault');
    }
  };

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">
      <PageHeader title="Settings" description="Manage your account and vault settings" />

      <div className="space-y-6">
        {/* Account Info */}
        <Card>
          <CardHeader>
            <CardTitle>Account Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-0">
              <div className="flex justify-between items-center py-3 border-b border-border">
                <div>
                  <div className="text-sm font-medium text-foreground">User ID</div>
                  <div className="text-sm text-muted-foreground font-mono mt-1">
                    {session?.user_id || '...'}
                  </div>
                </div>
              </div>
              <div className="flex justify-between items-center py-3 border-b border-border">
                <div>
                  <div className="text-sm font-medium text-foreground">Email</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {session?.email || '...'}
                  </div>
                </div>
              </div>
              <div className="flex justify-between items-center py-3">
                <div>
                  <div className="text-sm font-medium text-foreground">Tier</div>
                  <div className="mt-1">
                    <Badge variant="secondary" className="capitalize">
                      {session?.tier || '...'}
                    </Badge>
                  </div>
                </div>
                <Button variant="link" className="text-sm" asChild>
                  <a href="/billing">
                    {session?.tier === 'pro' ? 'Manage subscription' : 'Upgrade to Pro'}
                  </a>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* API Keys */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>API Keys</CardTitle>
            <Button
              onClick={() => {
                setShowNewKeyModal(true);
                setGeneratedKey(null);
                setError(null);
                setNewKeyLabel('');
                setNewKeyAgentId('');
                setNewKeyScopes('readwrite');
              }}
              size="sm"
            >
              <Key className="size-4" />
              Generate New Key
            </Button>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              API keys allow programmatic access to your Epitome vault. For agent-specific keys with
              auto-granted permissions, use the <a href="/agents" className="text-primary hover:underline">Agents page</a>.
            </p>

            {keysLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading keys...</div>
            ) : apiKeys && apiKeys.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>Scopes</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apiKeys.map((key) => (
                    <TableRow key={key.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{key.label}</span>
                          {key.agentId && (
                            <Badge variant="outline" className="text-xs">
                              Agent: {key.agentId}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground font-mono">
                          {key.prefix}...
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {key.scopes.join(', ')}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs text-muted-foreground">
                          {new Date(key.createdAt).toLocaleDateString()}
                          {key.lastUsedAt && (
                            <div>Used {new Date(key.lastUsedAt).toLocaleDateString()}</div>
                          )}
                          {key.expiresAt && (
                            <div>Expires {new Date(key.expiresAt).toLocaleDateString()}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => handleRevokeKey(key.id)}
                          disabled={revokeApiKey.isPending}
                          className="text-destructive hover:text-destructive"
                        >
                          Revoke
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                icon={Key}
                title="No API keys generated yet"
                description="Generate a key to allow programmatic access to your vault."
              />
            )}
          </CardContent>
        </Card>

        {/* New Key Dialog */}
        <Dialog
          open={showNewKeyModal}
          onOpenChange={(open) => {
            if (!open) {
              setShowNewKeyModal(false);
              setGeneratedKey(null);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Generate New API Key</DialogTitle>
            </DialogHeader>

            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {!generatedKey ? (
              <>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="key-label">Key Label</Label>
                    <Input
                      id="key-label"
                      value={newKeyLabel}
                      onChange={(e) => setNewKeyLabel(e.target.value)}
                      placeholder="e.g., Production Server"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="key-agent-id">
                      Agent ID <span className="text-muted-foreground font-normal">(optional)</span>
                    </Label>
                    <Input
                      id="key-agent-id"
                      value={newKeyAgentId}
                      onChange={(e) => setNewKeyAgentId(e.target.value)}
                      placeholder="e.g., claude-desktop"
                    />
                    <p className="text-xs text-muted-foreground">
                      If set, consent permissions are auto-granted for this agent.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Permissions</Label>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="scopes"
                          checked={newKeyScopes === 'readwrite'}
                          onChange={() => setNewKeyScopes('readwrite')}
                          className="text-primary"
                        />
                        <span className="text-sm text-foreground">Read & Write</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="scopes"
                          checked={newKeyScopes === 'read'}
                          onChange={() => setNewKeyScopes('read')}
                          className="text-primary"
                        />
                        <span className="text-sm text-foreground">Read only</span>
                      </label>
                    </div>
                  </div>
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setShowNewKeyModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleGenerateApiKey}
                    disabled={createApiKey.isPending}
                  >
                    {createApiKey.isPending ? 'Generating...' : 'Generate'}
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <Alert className="border-yellow-500/20 bg-yellow-500/10">
                  <AlertTriangle className="size-4 text-yellow-500" />
                  <AlertDescription className="text-yellow-200">
                    <strong>Important:</strong> Copy this key now. It won't be shown again.
                  </AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <Label>Your API Key</Label>
                  <div className="flex gap-2">
                    <CodeBlock code={generatedKey} className="flex-1" />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(generatedKey);
                      setCopiedKey(true);
                      setTimeout(() => setCopiedKey(false), 2000);
                    }}
                    className="w-full"
                  >
                    {copiedKey ? (
                      <>
                        <Check className="size-4" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="size-4" />
                        Copy to Clipboard
                      </>
                    )}
                  </Button>
                </div>

                <DialogFooter>
                  <Button
                    onClick={() => {
                      setGeneratedKey(null);
                      setCopiedKey(false);
                      setError(null);
                      setShowNewKeyModal(false);
                    }}
                    className="w-full"
                  >
                    Done
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Data Export */}
        <Card>
          <CardHeader>
            <CardTitle>Export Data</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Download all your data in JSON format. This includes your profile, tables, vectors,
              and knowledge graph.
            </p>
            <Button variant="outline" onClick={handleExportData}>
              <Download className="size-4" />
              Export All Data
            </Button>
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">Danger Zone</CardTitle>
          </CardHeader>
          <CardContent>
            {!showDeleteConfirm ? (
              <>
                <p className="text-sm text-muted-foreground mb-4">
                  Permanently delete your vault and all associated data. This action cannot be
                  undone.
                </p>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="destructive"
                      onClick={() => setShowDeleteConfirm(true)}
                    >
                      <Trash2 className="size-4" />
                      Delete Vault
                    </Button>
                  </AlertDialogTrigger>
                </AlertDialog>
              </>
            ) : (
              <div className="space-y-4">
                <Alert variant="destructive">
                  <AlertTriangle className="size-4" />
                  <AlertDescription>
                    <strong>Warning:</strong> This will permanently delete:
                    <ul className="list-disc list-inside mt-2 space-y-1">
                      <li>Your profile and all versions</li>
                      <li>All custom tables and data</li>
                      <li>All vector embeddings and memories</li>
                      <li>Your entire knowledge graph</li>
                      <li>Activity logs and agent connections</li>
                    </ul>
                  </AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <Label htmlFor="delete-confirm">
                    Type <strong className="text-foreground">DELETE</strong> to confirm
                  </Label>
                  <Input
                    id="delete-confirm"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder="DELETE"
                  />
                </div>

                <div className="flex gap-3">
                  <Button
                    variant="destructive"
                    onClick={handleDeleteVault}
                    disabled={deleteConfirmText !== 'DELETE'}
                  >
                    Permanently Delete Vault
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowDeleteConfirm(false);
                      setDeleteConfirmText('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
