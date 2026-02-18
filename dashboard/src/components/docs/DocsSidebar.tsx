import { NavLink, Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

interface NavGroup {
  label: string;
  items: { path: string; title: string }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Getting Started',
    items: [{ path: '/docs/quick-start', title: 'Quick Start' }],
  },
  {
    label: 'Using Epitome',
    items: [
      { path: '/docs/mcp-tools', title: 'MCP Tools Reference' },
      { path: '/docs/api-reference', title: 'API Reference' },
    ],
  },
  {
    label: 'Self-Hosting',
    items: [
      { path: '/docs/self-hosting', title: 'Self-Hosting Guide' },
      { path: '/docs/architecture', title: 'Architecture Overview' },
      { path: '/docs/data-model', title: 'Data Model Reference' },
      { path: '/docs/security', title: 'Security Model' },
    ],
  },
  {
    label: 'Contributing',
    items: [
      { path: '/docs/contributing', title: 'Contributing Guide' },
      { path: '/docs/troubleshooting', title: 'Troubleshooting / FAQ' },
    ],
  },
];

interface DocsSidebarProps {
  onNavigate?: () => void;
}

export function DocsSidebar({ onNavigate }: DocsSidebarProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-5">
        <Link
          to="/"
          onClick={onNavigate}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          <Home className="size-3" />
          Home
        </Link>
        <span className="text-lg font-semibold text-foreground tracking-tight">
          Epitome Docs
        </span>
      </div>
      <Separator className="bg-sidebar-border" />

      {/* Navigation */}
      <ScrollArea className="flex-1">
        <nav className="px-3 py-4 space-y-1">
          {NAV_GROUPS.map((group) => (
            <Collapsible key={group.label} defaultOpen>
              <CollapsibleTrigger className="flex items-center gap-1.5 w-full px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors group">
                <ChevronRight className="size-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90" />
                {group.label}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="ml-2 space-y-0.5">
                  {group.items.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          'block px-3 py-1.5 rounded-md text-sm transition-colors',
                          isActive
                            ? 'text-primary bg-sidebar-accent font-medium'
                            : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50'
                        )
                      }
                    >
                      {item.title}
                    </NavLink>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </nav>
      </ScrollArea>
    </div>
  );
}
