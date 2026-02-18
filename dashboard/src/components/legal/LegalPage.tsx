import { useLocation } from 'react-router-dom';
import { TableOfContents } from '@/components/docs/TableOfContents';
import SEO from '@/components/SEO';

interface Heading {
  id: string;
  text: string;
  level: number;
}

interface LegalPageProps {
  title: string;
  description: string;
  effectiveDate: string;
  headings: Heading[];
  children: React.ReactNode;
}

export default function LegalPage({
  title,
  description,
  effectiveDate,
  headings,
  children,
}: LegalPageProps) {
  const location = useLocation();
  const seoTitle = `${title} — Epitome`;

  return (
    <div className="flex gap-8">
      <SEO
        title={seoTitle}
        description={description}
        path={location.pathname}
      />
      <article className="flex-1 min-w-0 max-w-3xl">
        <h1 className="text-3xl font-bold mb-2">{title}</h1>
        <p className="text-sm text-muted-foreground mb-4">
          Effective: {effectiveDate}
        </p>
        <p className="text-muted-foreground text-lg mb-8">{description}</p>
        <div className="docs-prose">{children}</div>
      </article>
      {headings.length > 0 && (
        <div className="hidden xl:block w-[220px] shrink-0">
          <TableOfContents headings={headings} />
        </div>
      )}
    </div>
  );
}
