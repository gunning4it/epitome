import { useScrollSpy } from '@/hooks/useScrollSpy';
import { cn } from '@/lib/utils';

interface Heading {
  id: string;
  text: string;
  level: number;
}

interface TableOfContentsProps {
  headings: Heading[];
}

export function TableOfContents({ headings }: TableOfContentsProps) {
  const headingIds = headings.map((h) => h.id);
  const activeId = useScrollSpy(headingIds);

  const handleClick = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <nav className="sticky top-20 py-8">
      <p className="text-sm font-medium text-foreground mb-3">On this page</p>
      <ul className="space-y-1.5">
        {headings.map((heading) => (
          <li key={heading.id}>
            <button
              onClick={() => handleClick(heading.id)}
              className={cn(
                'block text-[13px] leading-snug transition-colors text-left',
                heading.level === 3 && 'pl-3',
                activeId === heading.id
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {heading.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
