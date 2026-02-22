import type { LucideIcon } from 'lucide-react';

interface ComparisonCategoryHeaderProps {
  name: string;
  icon: LucideIcon;
}

export default function ComparisonCategoryHeader({ name, icon: Icon }: ComparisonCategoryHeaderProps) {
  return (
    <div className="flex items-center gap-2.5 pt-8 pb-3 first:pt-0">
      <Icon className="size-4 text-primary/70" />
      <span className="text-xs font-mono tracking-[0.15em] uppercase text-muted-foreground">
        {name}
      </span>
      <div className="flex-1 h-px bg-border/50" />
    </div>
  );
}
