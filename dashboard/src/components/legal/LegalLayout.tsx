import { Link, Outlet, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { label: 'Privacy', to: '/legal/privacy' },
  { label: 'Terms', to: '/legal/terms' },
  { label: 'Security', to: '/legal/security' },
  { label: 'Cookies', to: '/legal/cookies' },
  { label: 'CCPA', to: '/legal/ccpa' },
];

export default function LegalLayout() {
  const { pathname } = useLocation();

  return (
    <div className="min-h-screen bg-background">
      {/* Sticky header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-6">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-4" />
            <span className="font-semibold text-foreground">Epitome</span>
          </Link>

          {/* Inline nav — hidden on mobile */}
          <nav className="hidden md:flex items-center gap-1 ml-auto">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={cn(
                  'px-3 py-1.5 rounded-md text-sm transition-colors',
                  pathname === link.to
                    ? 'text-foreground bg-muted font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
