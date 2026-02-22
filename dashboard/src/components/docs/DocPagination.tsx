import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

const DOC_PAGES = [
  { path: '/docs/quick-start', title: 'Quick Start' },
  { path: '/docs/mcp-tools', title: 'MCP Tools Reference' },
  { path: '/docs/api-reference', title: 'API Reference' },
  { path: '/docs/javascript-sdk', title: 'JavaScript SDK' },
  { path: '/docs/javascript-sdk-ai-tools', title: 'AI SDK Tools' },
  { path: '/docs/memory-router', title: 'Memory Router' },
  { path: '/docs/billing', title: 'Billing & Agents' },
  { path: '/docs/self-hosting', title: 'Self-Hosting Guide' },
  { path: '/docs/architecture', title: 'Architecture Overview' },
  { path: '/docs/data-model', title: 'Data Model Reference' },
  { path: '/docs/security', title: 'Security Model' },
  { path: '/docs/contributing', title: 'Contributing Guide' },
  { path: '/docs/troubleshooting', title: 'Troubleshooting / FAQ' },
];

export function DocPagination() {
  const { pathname } = useLocation();
  const currentIndex = DOC_PAGES.findIndex((page) => page.path === pathname);

  const prev = currentIndex > 0 ? DOC_PAGES[currentIndex - 1] : null;
  const next =
    currentIndex >= 0 && currentIndex < DOC_PAGES.length - 1
      ? DOC_PAGES[currentIndex + 1]
      : null;

  if (!prev && !next) return null;

  return (
    <div className="mt-12">
      <Separator className="bg-border mb-6" />
      <div className="flex items-center justify-between">
        {prev ? (
          <Link
            to={prev.path}
            className="group flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-0.5" />
            <span>{prev.title}</span>
          </Link>
        ) : (
          <div />
        )}
        {next ? (
          <Link
            to={next.path}
            className="group flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>{next.title}</span>
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
}
