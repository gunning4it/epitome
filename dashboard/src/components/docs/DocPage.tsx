import { TableOfContents } from '@/components/docs/TableOfContents';
import { DocPagination } from '@/components/docs/DocPagination';

interface Heading {
  id: string;
  text: string;
  level: number;
}

interface DocPageProps {
  title: string;
  description: string;
  headings?: Heading[];
  children: React.ReactNode;
}

export default function DocPage({
  title,
  description,
  headings,
  children,
}: DocPageProps) {
  return (
    <div className="flex gap-8">
      <article className="flex-1 min-w-0 max-w-3xl py-8 px-6">
        <h1 className="text-3xl font-bold mb-2">{title}</h1>
        <p className="text-muted-foreground text-lg mb-8">{description}</p>
        <div className="docs-prose">{children}</div>
        <DocPagination />
      </article>
      {headings && headings.length > 0 && (
        <div className="hidden xl:block w-[220px] shrink-0">
          <TableOfContents headings={headings} />
        </div>
      )}
    </div>
  );
}
