import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useOptionalSession } from '@/hooks/useOptionalSession';

export default function LandingNav() {
  const { isAuthenticated, isLoading } = useOptionalSession();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { label: 'Features', href: '#features' },
    { label: 'How It Works', href: '#how-it-works' },
    { label: 'Docs', href: '/docs' },
  ];

  return (
    <nav
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-500',
        scrolled
          ? 'bg-background/70 backdrop-blur-2xl border-b border-border/50 shadow-[0_1px_3px_rgba(0,0,0,0.3)]'
          : 'bg-transparent'
      )}
    >
      <div className="mx-auto max-w-6xl px-6 flex items-center justify-between h-16">
        {/* Wordmark */}
        <Link to="/" className="font-display text-xl tracking-tight text-foreground">
          Epitome
        </Link>

        {/* Center links — hidden on mobile */}
        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((link) =>
            link.href.startsWith('#') ? (
              <a
                key={link.label}
                href={link.href}
                className="text-[13px] text-muted-foreground hover:text-foreground transition-colors duration-200"
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.label}
                to={link.href}
                className="text-[13px] text-muted-foreground hover:text-foreground transition-colors duration-200"
              >
                {link.label}
              </Link>
            )
          )}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {!isLoading && (
            <Button asChild size="sm" variant={isAuthenticated ? 'default' : 'outline'}>
              <Link to={isAuthenticated ? '/profile' : '/onboarding'}>
                {isAuthenticated ? 'Dashboard' : 'Sign In'}
              </Link>
            </Button>
          )}

          {/* Mobile hamburger */}
          <button
            className="md:hidden p-2 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="md:hidden bg-background/95 backdrop-blur-2xl border-b border-border/50 px-6 pb-4 space-y-3">
          {navLinks.map((link) =>
            link.href.startsWith('#') ? (
              <a
                key={link.label}
                href={link.href}
                className="block text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.label}
                to={link.href}
                className="block text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            )
          )}
        </div>
      )}
    </nav>
  );
}
