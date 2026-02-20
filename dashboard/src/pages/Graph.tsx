import { useState } from 'react';
import { Network, X } from 'lucide-react';
import {
  useGraphEntities,
  useEntityNeighbors,
  useUpdateEntity,
  useMergeEntities,
  useDeleteEntity,
} from '@/hooks/useApi';
import GraphExplorer from '@/components/GraphExplorer';
import { EmptyState } from '@/components/EmptyState';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ENTITY_DISPLAY, type EntityType } from '@/lib/ontology';
import type { Entity, Edge } from '@/lib/types';

const ENTITY_LEGEND = (Object.entries(ENTITY_DISPLAY) as [EntityType, { label: string; color: string }][]).map(
  ([type, config]) => ({ type, label: config.label, color: config.color })
);

export default function Graph() {
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [stableMode, setStableMode] = useState(false);
  const { data: graphData, isLoading } = useGraphEntities({
    includeSynthetic: false,
    stableMode,
    stableConfidenceMin: 0.75,
    edgeLimit: 600,
    edgeOffset: 0,
  });
  const updateEntity = useUpdateEntity();
  const mergeEntities = useMergeEntities();
  const deleteEntity = useDeleteEntity();

  const { data: neighborsData } = useEntityNeighbors(selectedEntity?.id || '');

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="size-16 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-muted-foreground">Loading knowledge graph...</p>
        </div>
      </div>
    );
  }

  const graphResponse = graphData as { entities?: Entity[]; edges?: Edge[] } | undefined;
  const nodes: Entity[] = graphResponse?.entities || [];
  const edges: Edge[] = graphResponse?.edges || [];

  const handleNodeClick = (node: Entity) => {
    setSelectedEntity(node);
  };

  const handleCloseDetail = () => {
    setSelectedEntity(null);
  };

  const handleRenameEntity = async () => {
    if (!selectedEntity) return;
    const nextName = window.prompt('Rename entity', selectedEntity.name);
    if (!nextName || nextName.trim() === '' || nextName.trim() === selectedEntity.name) return;

    try {
      await updateEntity.mutateAsync({
        id: selectedEntity.id,
        data: { name: nextName.trim() },
      });

      setSelectedEntity((prev) => (prev ? { ...prev, name: nextName.trim() } : prev));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to update entity');
    }
  };

  const handleMergeEntity = async () => {
    if (!selectedEntity) return;
    const targetId = window.prompt('Target entity ID to merge into');
    if (!targetId || targetId.trim() === '') return;
    if (targetId.trim() === String(selectedEntity.id)) {
      window.alert('Target ID must be different from source.');
      return;
    }

    try {
      await mergeEntities.mutateAsync({
        sourceId: selectedEntity.id,
        targetId: targetId.trim(),
      });

      setSelectedEntity(null);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to merge entities');
    }
  };

  const handleDeleteEntity = async () => {
    if (!selectedEntity) return;
    const confirmed = window.confirm(
      `Delete entity "${selectedEntity.name}"? This action cannot be undone.`
    );
    if (!confirmed) return;

    try {
      await deleteEntity.mutateAsync(selectedEntity.id);
      setSelectedEntity(null);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to delete entity');
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-card border-b border-border px-8 py-4">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Knowledge Graph</h1>
            <p className="text-muted-foreground text-sm">
              {nodes.length} entities &middot; {edges.length} connections
              {stableMode && edges.length === 0 && nodes.length > 0 && (
                <span className="text-yellow-400 ml-2">
                  — try turning stable mode off to see inferred relationships
                </span>
              )}
            </p>
          </div>

          {/* Search */}
          <div className="flex gap-3">
            <Button
              type="button"
              variant={stableMode ? 'default' : 'outline'}
              onClick={() => setStableMode((prev) => !prev)}
            >
              Stable mode {stableMode ? 'on' : 'off'}
            </Button>
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search entities..."
              className="w-64"
            />
          </div>
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
          {ENTITY_LEGEND.map((entry) => (
            <div key={entry.type} className="flex items-center gap-2">
              <div
                className="size-3 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-muted-foreground text-xs">{entry.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Graph Container */}
      <div className="flex-1 flex">
        {/* Graph Visualization */}
        <div className="flex-1 p-4 bg-background">
          {nodes.length > 0 ? (
            <GraphExplorer
              nodes={nodes}
              edges={edges}
              onNodeClick={handleNodeClick}
              searchQuery={searchQuery}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <EmptyState
                icon={Network}
                title="No entities in knowledge graph yet"
                description="Start adding memories to build your knowledge graph"
              />
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selectedEntity && (
          <div className="w-96 bg-card border-l border-border">
            <ScrollArea className="h-full">
              <div className="p-6">
                <div className="flex justify-between items-start mb-6">
                  <h2 className="text-xl font-semibold text-foreground">{selectedEntity.name}</h2>
                  <button
                    onClick={handleCloseDetail}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="size-5" />
                  </button>
                </div>

                <div className="space-y-6">
                  {/* Type */}
                  <div>
                    <div className="text-sm text-muted-foreground mb-2">Type</div>
                    <Badge variant="secondary">{selectedEntity.type}</Badge>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-4 bg-muted rounded-lg p-3">
                    <div>
                      <div className="text-sm text-muted-foreground mb-1">Mentions</div>
                      <div className="text-2xl font-bold text-foreground">
                        {selectedEntity.mention_count}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground mb-1">Confidence</div>
                      <div className="text-2xl font-bold text-foreground">
                        {(selectedEntity.confidence * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>

                  {/* Evidence */}
                  <div>
                    <div className="text-sm font-medium text-foreground mb-2">Evidence</div>
                    <div className="space-y-1 text-sm">
                      {Boolean(selectedEntity.properties?.origin) && (
                        <div>
                          <span className="text-muted-foreground">Source:</span>{' '}
                          <span className="text-foreground">{String(selectedEntity.properties.origin)}</span>
                        </div>
                      )}
                      <div>
                        <span className="text-muted-foreground">First seen:</span>{' '}
                        <span className="text-foreground">{new Date(selectedEntity.first_seen).toLocaleDateString()}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Last seen:</span>{' '}
                        <span className="text-foreground">{new Date(selectedEntity.last_seen).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>

                  {/* Properties */}
                  {selectedEntity.properties &&
                    Object.keys(selectedEntity.properties).filter(k => k !== 'origin').length > 0 && (
                      <div>
                        <div className="text-sm font-medium text-foreground mb-2">Properties</div>
                        <div className="space-y-2">
                          {Object.entries(selectedEntity.properties)
                            .filter(([key]) => key !== 'origin')
                            .map(([key, value]) => (
                            <div key={key} className="text-sm">
                              <span className="text-muted-foreground">{key}:</span>{' '}
                              <span className="text-foreground">
                                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* Neighbors */}
                  {neighborsData && neighborsData.length > 0 && (
                    <div>
                      <div className="text-sm font-medium text-foreground mb-3">
                        Connected Entities ({neighborsData.length})
                      </div>
                      <div className="space-y-2">
                        {neighborsData.map((neighbor: Entity & { edge?: { relation: string; weight: number; confidence: number } }) => (
                          <div
                            key={neighbor.id}
                            className="p-3 bg-muted rounded-lg hover:bg-accent cursor-pointer transition-colors"
                            onClick={() => setSelectedEntity(neighbor)}
                          >
                            <div className="font-medium text-sm text-foreground">
                              {neighbor.name}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {neighbor.type} {neighbor.edge?.relation && <Badge variant="outline" className="ml-1 text-[10px]">{neighbor.edge.relation}</Badge>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <Separator />

                  {/* Actions */}
                  <div className="space-y-2">
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={handleRenameEntity}
                      disabled={updateEntity.isPending}
                    >
                      Edit Properties
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={handleMergeEntity}
                      disabled={mergeEntities.isPending}
                    >
                      Merge with Another Entity
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={handleDeleteEntity}
                      disabled={deleteEntity.isPending}
                    >
                      Delete Entity
                    </Button>
                  </div>
                </div>
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
}
