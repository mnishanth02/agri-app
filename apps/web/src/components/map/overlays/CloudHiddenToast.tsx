/**
 * Module 5.7 — `CloudHiddenToast`.
 *
 * Bottom-left static info chip explaining that very cloudy scenes are
 * filtered out by default. Stacks above the `FullscreenButton` on the
 * left edge.
 *
 * Module 5.8 replaces the `bottomBarTab` selector with a single
 * `var(--bottom-dock-h)` reference plus an `8.75rem` offset (clears
 * zoom + fullscreen + breathing) so the toast tracks the dock's
 * actual current height. The CSS-var fallback (`7rem`) covers the
 * first paint before `BottomDock` mounts its publishing effect.
 *
 * Auto-dismisses after 8 seconds; manual dismiss is still keyboard
 * reachable via the close button.
 */

import { CloudIcon, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CHIP_BASE, CHIP_FOCUS } from '@/lib/tokens';
import { cn } from '@/lib/utils';

const AUTO_DISMISS_MS = 8_000;

export function CloudHiddenToast() {
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
      // Stacks above FullscreenButton: dock + 1rem zoom gap + ~88px
      // zoom + 16 px gap + ~36px fullscreen + 16 px breathing ≈
      // 8.75 rem above dock-h.
      style={{ bottom: 'calc(var(--bottom-dock-h, 7.5rem) + 8.75rem + 1rem)' }}
      className={cn(
        CHIP_BASE,
        'pointer-events-auto absolute left-3 z-10 inline-flex h-9 max-w-[calc(100vw-1.5rem)] items-center gap-2 pr-1 pl-3 text-xs',
        'dock-bottom-anchored motion-safe:transition-[bottom] motion-safe:duration-200',
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
