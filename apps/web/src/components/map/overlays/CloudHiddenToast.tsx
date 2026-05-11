/**
 * Module 5.6 — `CloudHiddenToast`.
 *
 * Bottom-left static info chip explaining that very cloudy scenes are
 * filtered out by default. Anchored just above the BottomBar tray; when
 * the tray expands inline (md+), shifts further up to clear it.
 *
 * Auto-dismisses after 8 seconds; manual dismiss is still keyboard
 * reachable via the close button.
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
        'pointer-events-auto absolute left-3 inline-flex h-9 max-w-[calc(100vw-1.5rem)] items-center gap-2 pr-1 pl-3 text-xs',
        'motion-safe:transition-[bottom] motion-safe:duration-200',
        bottomExpanded ? 'bottom-[22rem]' : 'bottom-16',
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
