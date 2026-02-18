import { useState } from 'react';
import { Brain } from 'lucide-react';
import { useVectorSearch, useRecentVectors, useVectorCollections } from '@/hooks/useApi';
import { formatDateTime } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import { ConfidenceBadge } from '@/components/ConfidenceBadge';
import { EmptyState } from '@/components/EmptyState';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

const EXAMPLE_SEARCHES = [
  { label: 'meals', query: 'meals I had recently' },
  { label: 'preferences', query: 'my preferences' },
  { label: 'family', query: 'family members' },
  { label: 'work', query: 'work projects' },
  { label: 'hobbies', query: 'hobbies and interests' },
  { label: 'travel', query: 'places I visited' },
];

export default function Memories() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCollection, setSelectedCollection] = useState('');
  const [minSimilarity, setMinSimilarity] = useState(0.7);
  const [searchParams, setSearchParams] = useState<{ query: string; limit?: number; minSimilarity?: number } | null>(null);
  const [browseOffset, setBrowseOffset] = useState(0);
  const browseLimit = 20;

  // Browse mode: recent vectors
  const { data: recentData, isLoading: isLoadingRecent } = useRecentVectors({
    collection: selectedCollection || undefined,
    limit: browseLimit,
    offset: browseOffset,
  });

  // Collections for filter pills
  const { data: collections } = useVectorCollections();

  // Search mode: vector search (only when user has searched)
  const searchCollection = selectedCollection || '_all';
  const { data: searchResults, isLoading: isSearching } = useVectorSearch(
    searchCollection,
    searchParams || { query: '' }
  );

  const isSearchMode = searchParams !== null;

  const handleSearch = () => {
    if (searchQuery.trim()) {
      setSearchParams({
        query: searchQuery,
        minSimilarity,
        limit: 20,
      });
    }
  };

  const handleClearSearch = () => {
    setSearchParams(null);
    setSearchQuery('');
    setBrowseOffset(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleCollectionClick = (collection: string) => {
    setSelectedCollection(collection);
    setBrowseOffset(0);
    // If in search mode, re-trigger search with new collection
    if (isSearchMode && searchQuery.trim()) {
      setSearchParams({
        query: searchQuery,
        minSimilarity,
        limit: 20,
      });
    }
  };

  // Total count for "All" pill
  const totalEntries = collections?.reduce((sum, c) => sum + c.entry_count, 0) ?? 0;

  const recentVectors = recentData?.data ?? [];
  const recentTotal = recentData?.meta?.total ?? 0;

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      <PageHeader
        title="Memories"
        description="Browse and search across all memories stored by your AI agents"
      />

      {/* Collection Pills */}
      {collections && collections.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => handleCollectionClick('')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
              selectedCollection === ''
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            All ({totalEntries})
          </button>
          {collections.map((col) => (
            <button
              key={col.collection}
              onClick={() => handleCollectionClick(col.collection)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
                selectedCollection === col.collection
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {col.collection} ({col.entry_count})
            </button>
          ))}
        </div>
      )}

      {/* Search Controls */}
      <Card className="mb-6">
        <CardContent>
          <div className="space-y-4">
            <div className="flex gap-3">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search your memories..."
                className="flex-1"
              />
              <Button
                onClick={handleSearch}
                disabled={!searchQuery.trim()}
              >
                Search
              </Button>
              {isSearchMode && (
                <Button variant="outline" onClick={handleClearSearch}>
                  Clear
                </Button>
              )}
            </div>

            {isSearchMode && (
              <div className="flex gap-4 items-center">
                <div className="flex-1 space-y-2">
                  <Label>
                    Min Similarity: {Math.round(minSimilarity * 100)}%
                  </Label>
                  <Slider
                    value={[minSimilarity * 100]}
                    onValueChange={(v) => setMinSimilarity(v[0] / 100)}
                    max={100}
                    step={5}
                  />
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Content */}
      {isSearchMode ? (
        // Search Mode
        isSearching ? (
          <div className="text-center py-12">
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-muted-foreground">Searching...</p>
          </div>
        ) : searchResults && searchResults.length > 0 ? (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground mb-4">
              Found {searchResults.length} results
            </div>
            {searchResults.map((result, idx) => (
              <MemoryCard
                key={result.id || idx}
                collection={result.collection}
                text={result.text}
                metadata={result.metadata}
                confidence={result.confidence || 0.5}
                similarity={result.similarity}
                createdAt={result.created_at}
              />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent>
              <EmptyState
                icon={Brain}
                title="No results found"
                description="Try adjusting your search query or lowering the similarity threshold"
              />
            </CardContent>
          </Card>
        )
      ) : (
        // Browse Mode
        isLoadingRecent ? (
          <div className="text-center py-12">
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading memories...</p>
          </div>
        ) : recentVectors.length > 0 ? (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground mb-4">
              Showing {browseOffset + 1}–{Math.min(browseOffset + browseLimit, recentTotal)} of {recentTotal} memories
            </div>

            {recentVectors.map((entry) => (
              <MemoryCard
                key={entry.id}
                collection={entry.collection}
                text={entry.text}
                metadata={entry.metadata}
                confidence={entry.confidence}
                status={entry.status}
                createdAt={entry.created_at}
              />
            ))}

            {/* Pagination */}
            {recentTotal > browseLimit && (
              <div className="flex justify-between items-center pt-4">
                <Button
                  variant="outline"
                  onClick={() => setBrowseOffset(Math.max(0, browseOffset - browseLimit))}
                  disabled={browseOffset === 0}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {Math.floor(browseOffset / browseLimit) + 1} of {Math.ceil(recentTotal / browseLimit)}
                </span>
                <Button
                  variant="outline"
                  onClick={() => setBrowseOffset(browseOffset + browseLimit)}
                  disabled={browseOffset + browseLimit >= recentTotal}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        ) : (
          // Empty state
          <Card>
            <CardContent>
              <EmptyState
                icon={Brain}
                title="No memories yet"
                description="Memories are created automatically when AI agents update your profile or add records. Connect an AI agent via MCP to get started."
              />

              <div className="mt-6 text-center">
                <p className="text-sm text-muted-foreground mb-3">Or try searching for:</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {EXAMPLE_SEARCHES.map((example) => (
                    <button
                      key={example.label}
                      onClick={() => {
                        setSearchQuery(example.query);
                        setSearchParams({
                          query: example.query,
                          minSimilarity,
                          limit: 20,
                        });
                      }}
                      className="px-4 py-2 bg-muted hover:bg-primary/20 hover:text-primary text-muted-foreground rounded-full text-sm transition"
                    >
                      {example.label}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
}

/** Shared card component for both browse and search results */
function MemoryCard({
  collection,
  text,
  metadata,
  confidence,
  similarity,
  createdAt,
}: {
  collection: string;
  text: string;
  metadata: Record<string, unknown>;
  confidence: number;
  similarity?: number;
  status?: string;
  createdAt: string;
}) {
  return (
    <Card className="hover:border-primary/30 transition-colors">
      <CardContent>
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-3">
            <Badge variant="secondary">
              {collection}
            </Badge>
            <ConfidenceBadge confidence={confidence} />
            {similarity !== undefined && (
              <span className="text-sm text-muted-foreground">
                {(similarity * 100).toFixed(0)}% match
              </span>
            )}
          </div>
          <span className="text-sm text-muted-foreground">
            {formatDateTime(createdAt)}
          </span>
        </div>

        <p className="text-foreground mb-3">{text}</p>

        {metadata && Object.keys(metadata).length > 0 && (
          <div className="bg-muted/50 rounded-lg p-3 font-mono text-xs text-muted-foreground">
            <div className="space-y-1">
              {Object.entries(metadata).map(([key, value]) => (
                <div key={key}>
                  <span className="font-medium">{key}:</span>{' '}
                  {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
