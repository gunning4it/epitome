import type { LucideIcon } from 'lucide-react';

interface ComparisonCategoryHeaderProps {
  name: string;
  icon: LucideIcon;
}

export default function ComparisonCategoryHeader({ name, icon: Icon, compact }: ComparisonCategoryHeaderProps & { compact?: boolean }) {
  return (
    <div className={compact ? 'flex items-center gap-2.5 pb-3' : 'flex items-center gap-2.5 pt-8 pb-3'}>
      <Icon className="size-4 text-primary/70" />
      <span className="text-xs font-mono tracking-[0.15em] uppercase text-muted-foreground">
        {name}
      </span>
      <div className="flex-1 h-px bg-border/50" />
    </div>
  );
}
