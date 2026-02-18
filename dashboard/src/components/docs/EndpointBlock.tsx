import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-green-500/10 text-green-400 border-green-500/20',
  POST: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  PATCH: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  DELETE: 'bg-red-500/10 text-red-400 border-red-500/20',
};

interface EndpointBlockProps {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  description: string;
  auth?: string;
  children?: React.ReactNode;
}

export function EndpointBlock({
  method,
  path,
  description,
  auth,
  children,
}: EndpointBlockProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 my-4">
      <div className="flex items-center gap-3 mb-3">
        <Badge
          className={cn(
            'rounded-md px-2 py-0.5 text-xs font-mono font-semibold border',
            METHOD_COLORS[method]
          )}
        >
          {method}
        </Badge>
        <code className="text-sm font-mono text-foreground">{path}</code>
        {auth && (
          <span className="ml-auto text-xs text-muted-foreground">{auth}</span>
        )}
      </div>
      <p className="text-sm text-muted-foreground mb-0">{description}</p>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
