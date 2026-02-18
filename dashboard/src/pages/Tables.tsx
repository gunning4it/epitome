import { useState, useEffect } from 'react';
import { Table2 } from 'lucide-react';
import { useTables, useTableData, useInsertRecord, useUpdateRecord, useDeleteRecord } from '@/hooks/useApi';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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

// Internal columns to hide from default display
const HIDDEN_COLUMNS = new Set(['_deleted_at', 'updated_at']);

// Columns to skip in record form (auto-generated)
const SKIP_COLUMNS = new Set(['id', 'created_at', 'updated_at', '_deleted_at', '_meta_id']);

interface Column {
  name: string;
  type: string;
  nullable: boolean;
}

function inputTypeForColumn(colType: string): string {
  if (/int|serial/i.test(colType)) return 'number';
  if (/numeric|decimal|float|double|real/i.test(colType)) return 'number';
  if (/bool/i.test(colType)) return 'checkbox';
  if (/timestamp/i.test(colType)) return 'datetime-local';
  if (/date/i.test(colType)) return 'date';
  if (/time/i.test(colType)) return 'time';
  return 'text';
}

function formatForInput(value: unknown, inputType: string): string {
  if (value === null || value === undefined) return '';
  if (inputType === 'datetime-local' && typeof value === 'string') {
    try {
      return new Date(value).toISOString().slice(0, 16);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '\u2014';
  if (value instanceof Date || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value))) {
    try {
      return new Date(value as string).toLocaleString();
    } catch { return String(value); }
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function Tables() {
  const { data: tables, isLoading } = useTables();
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const { data: tableData, isLoading: isLoadingData } = useTableData(
    selectedTable || '',
    selectedTable ? {} : undefined
  );

  // CRUD modal state
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<Record<string, unknown> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; summary: string } | null>(null);

  // Form state for add/edit dialogs
  const [formData, setFormData] = useState<Record<string, unknown>>({});

  // Mutation hooks
  const insertMutation = useInsertRecord(selectedTable || '');
  const updateMutation = useUpdateRecord(selectedTable || '');
  const deleteMutation = useDeleteRecord(selectedTable || '');

  // API returns { data: Record[], meta: { total, executionTime } }
  const queryResult = tableData as { data?: Array<Record<string, unknown>>; meta?: { total: number } } | undefined;
  const records = queryResult?.data ?? [];

  // Get column metadata from the tables list (already fetched)
  const selectedTableMeta = tables?.find((t) => t.table_name === selectedTable);
  const columns = (selectedTableMeta?.columns ?? []).filter((col: Column) => !HIDDEN_COLUMNS.has(col.name));
  const editableColumns = columns.filter((col: Column) => !SKIP_COLUMNS.has(col.name));

  // Initialize form data when add/edit dialog opens
  useEffect(() => {
    if (addModalOpen) {
      const initial: Record<string, unknown> = {};
      for (const col of editableColumns) {
        initial[col.name] = inputTypeForColumn(col.type) === 'checkbox' ? false : '';
      }
      const handle = window.setTimeout(() => {
        setFormData(initial);
      }, 0);
      return () => window.clearTimeout(handle);
    }
  }, [addModalOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (editRecord) {
      const initial: Record<string, unknown> = {};
      for (const col of editableColumns) {
        initial[col.name] = editRecord[col.name] ?? (inputTypeForColumn(col.type) === 'checkbox' ? false : '');
      }
      const handle = window.setTimeout(() => {
        setFormData(initial);
      }, 0);
      return () => window.clearTimeout(handle);
    }
  }, [editRecord]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleFormChange(colName: string, value: unknown) {
    setFormData((prev) => ({ ...prev, [colName]: value }));
  }

  function cleanFormData(): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {};
    for (const col of editableColumns) {
      let val = formData[col.name];
      if (val === '' && col.nullable) {
        val = null;
      } else if (val !== '' && val !== null && /int|serial|numeric|decimal|float|double|real/i.test(col.type)) {
        val = Number(val);
      }
      cleaned[col.name] = val;
    }
    return cleaned;
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const data = cleanFormData();
    insertMutation.mutate(data, {
      onSuccess: () => setAddModalOpen(false),
    });
  }

  function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    const data = cleanFormData();
    updateMutation.mutate(
      { id: String(editRecord!.id), data },
      { onSuccess: () => setEditRecord(null) },
    );
  }

  function handleDelete() {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
    });
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-muted-foreground">Loading tables...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-8 max-w-7xl mx-auto">
      <PageHeader
        title="Tables Browser"
        description="Explore and manage your custom data tables"
      />

      <div className="grid grid-cols-12 gap-6">
        {/* Table List */}
        <div className="col-span-4">
          <Card className="overflow-hidden">
            <CardHeader className="border-b">
              <CardTitle>Tables</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {tables && tables.length > 0 ? (
                  tables.map((table) => (
                    <button
                      key={table.table_name}
                      onClick={() => setSelectedTable(table.table_name)}
                      className={`w-full text-left p-4 transition ${
                        selectedTable === table.table_name
                          ? 'bg-accent border-l-2 border-primary'
                          : 'hover:bg-muted'
                      }`}
                    >
                      <div className="font-medium text-foreground">{table.table_name}</div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {table.description || 'No description'}
                      </div>
                      <div className="text-xs text-muted-foreground mt-2">
                        {table.record_count || 0} records &bull; {table.columns?.length || 0} columns
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="p-8">
                    <EmptyState
                      icon={Table2}
                      title="No tables found"
                      description="Create your first table to get started"
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Table Content */}
        <div className="col-span-8">
          {selectedTable ? (
            <Card>
              <CardHeader className="border-b flex-row items-center justify-between">
                <CardTitle>{selectedTable}</CardTitle>
                <Button onClick={() => setAddModalOpen(true)} size="sm">
                  Add Record
                </Button>
              </CardHeader>

              {isLoadingData ? (
                <CardContent>
                  <div className="py-8 text-center">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-muted-foreground">Loading data...</p>
                  </div>
                </CardContent>
              ) : records.length > 0 ? (
                <Table>
                  <TableHeader className="bg-muted">
                    <TableRow>
                      {columns.map((col: Column) => (
                        <TableHead key={col.name} className="px-4 py-3">
                          {col.name}
                          <span className="font-mono text-xs text-muted-foreground ml-1">
                            ({col.type})
                          </span>
                        </TableHead>
                      ))}
                      <TableHead className="px-4 py-3 text-right">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map((row, idx) => (
                      <TableRow key={idx}>
                        {columns.map((col: Column) => (
                          <TableCell key={col.name} className="px-4 py-3 max-w-xs truncate">
                            {formatCellValue(row[col.name])}
                          </TableCell>
                        ))}
                        <TableCell className="px-4 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-primary"
                            onClick={() => setEditRecord(row)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget({
                              id: String(row.id),
                              summary: columns.slice(0, 2).map((c: Column) => formatCellValue(row[c.name])).join(' / '),
                            })}
                          >
                            Delete
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <CardContent>
                  <EmptyState
                    icon={Table2}
                    title="No records in this table"
                    actionLabel="Add First Record"
                    onAction={() => setAddModalOpen(true)}
                  />
                </CardContent>
              )}
            </Card>
          ) : (
            <Card>
              <CardContent>
                <EmptyState
                  icon={Table2}
                  title="Select a table to view its contents"
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Add Record Dialog */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Record to {selectedTable}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            {editableColumns.map((col: Column) => {
              const inputType = inputTypeForColumn(col.type);
              const isCheckbox = inputType === 'checkbox';

              return (
                <div key={col.name} className="space-y-1.5">
                  <Label>
                    {col.name}
                    <span className="font-mono text-xs text-muted-foreground ml-1">({col.type})</span>
                    {col.nullable && <span className="text-xs text-muted-foreground ml-1">optional</span>}
                  </Label>
                  {isCheckbox ? (
                    <input
                      type="checkbox"
                      checked={!!formData[col.name]}
                      onChange={(e) => handleFormChange(col.name, e.target.checked)}
                      className="h-4 w-4 rounded border-border"
                    />
                  ) : (
                    <Input
                      type={inputType}
                      value={formatForInput(formData[col.name], inputType)}
                      onChange={(e) => handleFormChange(col.name, e.target.value)}
                      required={!col.nullable}
                    />
                  )}
                </div>
              );
            })}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={insertMutation.isPending}>
                {insertMutation.isPending ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    Saving...
                  </span>
                ) : 'Add Record'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Record Dialog */}
      <Dialog open={!!editRecord} onOpenChange={(open) => { if (!open) setEditRecord(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Record in {selectedTable}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            {editableColumns.map((col: Column) => {
              const inputType = inputTypeForColumn(col.type);
              const isCheckbox = inputType === 'checkbox';

              return (
                <div key={col.name} className="space-y-1.5">
                  <Label>
                    {col.name}
                    <span className="font-mono text-xs text-muted-foreground ml-1">({col.type})</span>
                    {col.nullable && <span className="text-xs text-muted-foreground ml-1">optional</span>}
                  </Label>
                  {isCheckbox ? (
                    <input
                      type="checkbox"
                      checked={!!formData[col.name]}
                      onChange={(e) => handleFormChange(col.name, e.target.checked)}
                      className="h-4 w-4 rounded border-border"
                    />
                  ) : (
                    <Input
                      type={inputType}
                      value={formatForInput(formData[col.name], inputType)}
                      onChange={(e) => handleFormChange(col.name, e.target.value)}
                      required={!col.nullable}
                    />
                  )}
                </div>
              );
            })}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditRecord(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    Saving...
                  </span>
                ) : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation AlertDialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Record</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this record?
              {deleteTarget?.summary && (
                <span className="block font-mono text-xs mt-1 truncate">
                  {deleteTarget.summary}
                </span>
              )}
              <span className="block text-destructive mt-2">This cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
