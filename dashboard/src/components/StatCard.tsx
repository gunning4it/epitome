import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import type { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  color?: string;
  className?: string;
}

export function StatCard({ label, value, icon: Icon, color, className }: StatCardProps) {
  return (
    <Card className={cn("py-4", className)}>
      <CardContent className="flex items-center gap-4">
        {Icon && (
          <div className={cn("rounded-lg p-2.5", color || "bg-primary/10")}>
            <Icon className={cn("size-5", color ? "text-current" : "text-primary")} />
          </div>
        )}
        <div>
          <p className="text-2xl font-semibold font-mono tracking-tight text-foreground">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
