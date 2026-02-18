import { useMemoryReview, useResolveReview } from '@/hooks/useApi';
import { formatDateTime } from '@/lib/utils';
import type { MemoryReviewItem, Contradiction } from '@/lib/types';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { ConfidenceBadge } from '@/components/ConfidenceBadge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle, Info } from 'lucide-react';

export default function Review() {
  const { data: reviewItems, isLoading } = useMemoryReview();
  const resolveReview = useResolveReview();

  const handleResolve = async (id: number, action: 'confirm' | 'reject' | 'keep_both') => {
    await resolveReview.mutateAsync({ id: String(id), action });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-muted-foreground">Loading contradictions...</p>
        </div>
      </div>
    );
  }

  const items: MemoryReviewItem[] = reviewItems || [];

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">
      <PageHeader
        title="Memory Review"
        description="Review and resolve contradictions in your memory vault"
      />

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={CheckCircle}
              title="No contradictions to review"
              description="Your memory is clean and consistent. Great job!"
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="text-sm text-muted-foreground">
            {items.length} {items.length === 1 ? 'memory' : 'memories'} to review
          </div>

          {items.map((item) => (
            <Card key={item.id} className="overflow-hidden">
              {/* Warning Header */}
              <div className="bg-yellow-500/10 border-b border-yellow-500/20 px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="size-5 text-yellow-500" />
                    <div>
                      <div className="font-medium text-foreground">
                        {item.sourceType}: {item.sourceRef}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Created {formatDateTime(item.createdAt)}
                      </div>
                    </div>
                  </div>
                  <ConfidenceBadge confidence={item.confidence} />
                </div>
              </div>

              {/* Contradictions */}
              <CardContent className="pt-6">
                {item.contradictions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No contradiction details available.</p>
                ) : (
                  <div className="space-y-4">
                    <div className="text-sm font-medium text-muted-foreground">
                      {item.contradictions.length} {item.contradictions.length === 1 ? 'contradiction' : 'contradictions'}
                    </div>
                    {item.contradictions.map((c: Contradiction, idx: number) => (
                      <div key={idx} className="border border-border rounded-lg overflow-hidden">
                        <div className="bg-muted px-4 py-2 border-b border-border">
                          <span className="text-sm font-medium text-foreground">Field: {c.field}</span>
                          {c.agent && (
                            <span className="text-xs text-muted-foreground ml-3">
                              by {c.agent} on {formatDateTime(c.detectedAt)}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 divide-x divide-border">
                          <div className="p-4">
                            <div className="text-xs font-medium text-muted-foreground mb-2 uppercase">Current Value</div>
                            <div className="bg-muted p-3 rounded text-sm text-foreground break-words">
                              {typeof c.oldValue === 'object'
                                ? JSON.stringify(c.oldValue, null, 2)
                                : String(c.oldValue ?? '(empty)')}
                            </div>
                          </div>
                          <div className="p-4">
                            <div className="text-xs font-medium text-muted-foreground mb-2 uppercase">New Value</div>
                            <div className="bg-primary/10 p-3 rounded text-sm text-foreground break-words">
                              {typeof c.newValue === 'object'
                                ? JSON.stringify(c.newValue, null, 2)
                                : String(c.newValue ?? '(empty)')}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>

              {/* Actions Footer */}
              <div className="bg-muted/50 px-6 py-4 border-t border-border">
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => handleResolve(item.id, 'reject')}
                    disabled={resolveReview.isPending}
                  >
                    Reject Changes
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={() => handleResolve(item.id, 'confirm')}
                    disabled={resolveReview.isPending}
                  >
                    Accept New
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => handleResolve(item.id, 'keep_both')}
                    disabled={resolveReview.isPending}
                  >
                    Keep Both
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Info Panel */}
      <div className="mt-8 p-6 bg-primary/5 rounded-lg border border-primary/20">
        <div className="flex gap-3">
          <Info className="size-6 text-primary flex-shrink-0 mt-0.5" />
          <div className="text-sm text-foreground">
            <div className="font-medium mb-1">How Memory Review Works</div>
            <ul className="space-y-1 text-muted-foreground">
              <li>Epitome detects when AI agents write conflicting information</li>
              <li>Review up to 5 contradictions at a time to keep this manageable</li>
              <li>
                Higher confidence values indicate the AI was more certain about that
                information
              </li>
              <li>Choose "Keep Both" if both values are correct in different contexts</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
