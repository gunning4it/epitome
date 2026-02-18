import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
// Gradient separator used instead of Separator component

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'Features', href: '#features', external: false },
      { label: 'How It Works', href: '#how-it-works', external: false },
      { label: 'Sign In', href: '/onboarding', external: false },
    ],
  },
  {
    title: 'Documentation',
    links: [
      { label: 'Quick Start', href: '/docs/quick-start', external: false },
      { label: 'API Reference', href: '/docs/api-reference', external: false },
      { label: 'Self-Hosting', href: '/docs/self-hosting', external: false },
    ],
  },
  {
    title: 'Community',
    links: [
      {
        label: 'GitHub',
        href: 'https://github.com/gunning4it/epitome',
        external: true,
      },
      { label: 'Contributing', href: '/docs/contributing', external: false },
    ],
  },
];

const TECH_BADGES = ['React', 'PostgreSQL', 'Hono', 'D3.js'];

export default function Footer() {
  return (
    <footer className="pb-8">
      {/* Gradient separator line */}
      <div className="mb-12 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

      <div className="mx-auto max-w-6xl px-6">
        {/* Link columns */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-10 mb-12">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h4 className="text-sm font-semibold text-foreground mb-4">
                {col.title}
              </h4>
              <ul className="space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {link.label}
                      </a>
                    ) : link.href.startsWith('#') ? (
                      <a
                        href={link.href}
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        to={link.href}
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Built with */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
          <span className="text-xs text-muted-foreground mr-1">Built with</span>
          {TECH_BADGES.map((tech) => (
            <Badge key={tech} variant="outline" className="text-xs">
              {tech}
            </Badge>
          ))}
        </div>

        {/* Copyright */}
        <p className="text-center text-xs text-muted-foreground">
          &copy; 2026 Epitome. MIT License.
        </p>
      </div>
    </footer>
  );
}
