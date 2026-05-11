/**
 * SSR-safe `window.matchMedia` wrapper. Returns a boolean that tracks the
 * media-query and stays subscribed for changes.
 *
 * Used by the analysis chrome to escalate persistent overlays to shadcn
 * `Sheet`s below `md` (see `docs/ui-ux-redesign.md` § 7 — Module R.C).
 */

import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
