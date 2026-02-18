import { useState, useEffect } from 'react';

/**
 * Tracks which heading ID is currently visible in the viewport.
 * Used by docs TableOfContents for active section highlighting.
 */
export function useScrollSpy(ids: string[]) {
  const [activeId, setActiveId] = useState<string>('');

  useEffect(() => {
    if (!ids.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    );

    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [ids]);

  return activeId;
}
