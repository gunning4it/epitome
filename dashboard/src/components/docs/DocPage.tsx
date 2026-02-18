import { useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Copy, Check } from 'lucide-react';
import { TableOfContents } from '@/components/docs/TableOfContents';
import { DocPagination } from '@/components/docs/DocPagination';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import SEO from '@/components/SEO';
import { domToMarkdown } from '@/lib/dom-to-markdown';

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
  const contentRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const location = useLocation();

  const seoTitle = title.includes('Epitome') ? title : `${title} — Epitome Docs`;

  const handleCopyMarkdown = async () => {
    if (!contentRef.current) return;
    const markdown = domToMarkdown(contentRef.current, {
      title,
      description,
      sourceUrl: `https://epitome.fyi${location.pathname}`,
    });
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex gap-8">
      <SEO
        title={seoTitle}
        description={description}
        path={location.pathname}
        image="/og-docs.png"
      />
      <article className="flex-1 min-w-0 max-w-3xl py-8 px-6">
        <div className="flex items-start justify-between gap-4 mb-2">
          <h1 className="text-3xl font-bold">{title}</h1>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 mt-1 text-muted-foreground hover:text-foreground"
                  onClick={handleCopyMarkdown}
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy page as markdown</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <p className="text-muted-foreground text-lg mb-8">{description}</p>
        <div ref={contentRef} className="docs-prose">{children}</div>
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
