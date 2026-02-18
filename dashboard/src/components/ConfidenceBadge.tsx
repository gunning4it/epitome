import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface ConfidenceBadgeProps {
  confidence: number;
  className?: string;
}

function getConfidenceInfo(confidence: number) {
  if (confidence >= 0.8) return { label: 'Trusted', dotColor: 'bg-green-400', variant: 'secondary' as const };
  if (confidence >= 0.6) return { label: 'Unvetted', dotColor: 'bg-yellow-400', variant: 'secondary' as const };
  return { label: 'Uncertain', dotColor: 'bg-orange-400', variant: 'secondary' as const };
}

export function ConfidenceBadge({ confidence, className }: ConfidenceBadgeProps) {
  const { label, dotColor, variant } = getConfidenceInfo(confidence);

  return (
    <Badge variant={variant} className={cn("gap-1.5 font-normal", className)}>
      <span className={cn("size-1.5 rounded-full", dotColor)} />
      {Math.round(confidence * 100)}% {label}
    </Badge>
  );
}
