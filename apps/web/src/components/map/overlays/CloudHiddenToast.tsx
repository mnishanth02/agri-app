/**
 * Module 5.5 — `CloudHiddenToast`.
 *
 * Bottom-left static info chip explaining that very cloudy scenes are
 * filtered out by default. **Phase 6/7** will wire conditional logic
 * (only render when EOSDA returned scenes that exceed the cloud
 * threshold). For now it is always visible so the chrome reads
 * complete in screenshots.
 *
 * ## Vertical positioning
 *
 * Reads `useUiStore.bottomBarTab` and shifts above the BottomBar when
 * the panel is expanded — otherwise the toast paints over and
 * intercepts part of the BottomBar's left edge after the sidebar dodge
 * pulls the bar leftward.
 *
 * Local dismiss state is intentionally session-scoped (not in the
 * Zustand UI store) — once Phase 6 introduces real "show cloudy"
 * filtering this chip becomes ephemeral feedback rather than a
 * persisted preference.
 */

import { CloudIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/useUiStore';

export function CloudHiddenToast() {
  const bottomExpanded = useUiStore((s) => s.bottomBarTab !== null);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <output
      aria-live="polite"
      className={cn(
        'pointer-events-auto absolute left-3 inline-flex h-9 max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-md border border-white/10 bg-black/70 pr-1 pl-3 text-white text-xs shadow-lg backdrop-blur-md saturate-150',
        'motion-safe:transition-[bottom] motion-safe:duration-200',
        bottomExpanded ? 'bottom-[22rem]' : 'bottom-20',
      )}
    >
      <CloudIcon aria-hidden="true" className="size-3.5 text-white/70" />
      <span>Showing the latest cloud-free scene.</span>
      <button
        type="button"
        aria-label="Dismiss notice"
        onClick={() => setDismissed(true)}
        className="inline-flex size-9 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/70"
      >
        <XIcon aria-hidden="true" className="size-3.5" />
      </button>
    </output>
  );
}
