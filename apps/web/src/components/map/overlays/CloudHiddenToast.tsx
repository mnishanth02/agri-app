/**
 * Module 5.7 — `CloudHiddenToast`.
 *
 * Bottom-left static info chip explaining that very cloudy scenes are
 * filtered out by default. Stacks above the `FullscreenButton` on the
 * left edge with `bottom` driven by `useUiStore.bottomBarTab` so the
 * dock can never cover it.
 *
 * Auto-dismisses after 8 seconds; manual dismiss is still keyboard
 * reachable via the close button.
 *
 * Pixel offsets clear FullscreenButton (~268 px top edge collapsed) plus
 * a small gap; deviates from the literal v2 spec values for the same
 * reason as `FullscreenButton.tsx` — see that file's JSDoc.
 */

import { CloudIcon, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CHIP_BASE, CHIP_FOCUS } from '@/lib/tokens';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/useUiStore';

const AUTO_DISMISS_MS = 8_000;

export function CloudHiddenToast() {
  const bottomExpanded = useUiStore((s) => s.bottomBarTab !== null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (dismissed) return;
    const timer = setTimeout(() => setDismissed(true), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [dismissed]);

  if (dismissed) return null;

  return (
    <output
      aria-live="polite"
      className={cn(
        CHIP_BASE,
        'pointer-events-auto absolute left-3 z-10 inline-flex h-9 max-w-[calc(100vw-1.5rem)] items-center gap-2 pr-1 pl-3 text-xs',
        'motion-safe:transition-[bottom] motion-safe:duration-200',
        // 18 rem clears FullscreenButton (top edge ~272 px collapsed).
        // Expanded: collapsed + 40vh — same vertical relation.
        bottomExpanded ? 'bottom-[calc(40vh+18rem)]' : 'bottom-[18rem]',
      )}
    >
      <CloudIcon aria-hidden="true" className="size-3.5 text-white/70" />
      <span>Showing the latest cloud-free scene.</span>
      <button
        type="button"
        aria-label="Dismiss notice"
        onClick={() => setDismissed(true)}
        className={cn(
          'inline-flex size-7 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white',
          CHIP_FOCUS,
        )}
      >
        <XIcon aria-hidden="true" className="size-3.5" />
      </button>
    </output>
  );
}
