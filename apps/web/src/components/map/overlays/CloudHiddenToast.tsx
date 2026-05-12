/**
 * Module 6.5 — `CloudHiddenToast` (data-bound).
 *
 * Bottom-left frosted toast that surfaces the count of best-per-date
 * scenes hidden by the default cloud filter and offers a "Show all"
 * affordance. Subscribes to the SAME `useEosdaScenes(fieldId)` query
 * key as `DateTimeline` (TanStack Query dedupes — no extra request)
 * and to `useUiStore.showCloudyScenes` so it disappears the moment
 * the user opts into cloudy scenes.
 *
 * The "best per date" computation is centralised in
 * `@/lib/scene-helpers.bestPerDate`; the timeline, the auto-select
 * hook, and this toast all consume the same helper so the count and
 * the visible-chip set never drift apart.
 *
 * ## Field-change reset
 *
 * When `fieldId` changes (the user navigates between fields), the
 * dismissed state is reset so a previously-dismissed toast for field
 * A doesn't suppress the toast for field B's hidden cloudy scenes.
 * This handles both possibilities — the component being remounted
 * (then the initial state already wins) and the component persisting
 * across navigation (where the effect is the only thing that resets
 * `dismissed`).
 *
 * ## Positioning
 *
 * Module 5.8 anchors this toast above the `FullscreenButton` via
 * `var(--bottom-dock-h)` + `11rem`. The `dock-bottom-anchored` class
 * is preserved so the global `[data-bottom-dock-dragging]` rule can
 * suppress the `transition-[bottom]` animation while the user drags
 * the dock grabber.
 *
 * ## Semantics (resolves Pending Item 5.5 N4)
 *
 * The chip now reports a live, computed-from-server-data result
 * (`hiddenCloudyCount`) so `<output>` is the correct element — it is
 * literally the output of a calculation that updates as scenes load
 * or as the user toggles `showCloudyScenes`. `aria-live="polite"`
 * still announces changes to screen-reader users.
 *
 * ## Why no auto-dismiss
 *
 * The Module 5.7 stub auto-dismissed after 8 s. Now that the toast
 * carries an actionable affordance ("Show all"), auto-dismissing
 * would silently strip a control the user might still need —
 * dismissal is manual via the close button instead.
 */

import { CloudIcon, XIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useEosdaScenes } from '@/hooks/useEosdaScenes';
import { bestPerDate, countHiddenCloudyBestScenes } from '@/lib/scene-helpers';
import { CHIP_BASE, CHIP_FOCUS } from '@/lib/tokens';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/useUiStore';

export type CloudHiddenToastProps = {
  fieldId: string;
};

export function CloudHiddenToast({ fieldId }: CloudHiddenToastProps) {
  const [dismissed, setDismissed] = useState(false);

  // Reset the dismissed state when the user navigates to a different
  // field. Handles both the "component remounted" and "component
  // persisted" cases — the initial state covers the first; this effect
  // covers the second. `fieldId` is a sentinel: the effect body doesn't
  // read it; its identity change is what triggers the reset.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fieldId is the sentinel that triggers the reset; removing it would only run on mount and the dismissed state would persist across field navigation.
  useEffect(() => {
    setDismissed(false);
  }, [fieldId]);

  const query = useEosdaScenes(fieldId);
  const selectedViewId = useUiStore((s) => s.selectedViewId);
  const showCloudyScenes = useUiStore((s) => s.showCloudyScenes);
  const setShowCloudyScenes = useUiStore((s) => s.setShowCloudyScenes);

  const hiddenCloudyCount = useMemo(
    () => (query.data ? countHiddenCloudyBestScenes(bestPerDate(query.data), selectedViewId) : 0),
    [query.data, selectedViewId],
  );

  if (dismissed) return null;
  if (showCloudyScenes) return null;
  if (hiddenCloudyCount === 0) return null;

  const label = `${hiddenCloudyCount} ${hiddenCloudyCount === 1 ? 'scene' : 'scenes'} hidden by cloud cover`;

  return (
    <output
      aria-live="polite"
      // Stacks above FullscreenButton with a matching ~16 px gap.
      // Fullscreen chip (~44 px tall) anchors at `dock + 7rem`, so its
      // top edge is at `dock + 9.75rem`; anchor toast at `dock + 11rem`.
      style={{ bottom: 'calc(var(--bottom-dock-h, 7.5rem) + 11rem)' }}
      className={cn(
        CHIP_BASE,
        'pointer-events-auto absolute left-3 z-10 inline-flex h-9 max-w-[calc(100vw-1.5rem)] items-center gap-2 pr-1 pl-3 text-xs',
        'dock-bottom-anchored motion-safe:transition-[bottom] motion-safe:duration-200',
      )}
    >
      <CloudIcon aria-hidden="true" className="size-3.5 text-white/70" />
      <span>{label}</span>
      <button
        type="button"
        onClick={() => setShowCloudyScenes(true)}
        className={cn(
          'inline-flex h-7 items-center rounded-md px-2 font-medium text-white text-xs transition-colors hover:bg-white/15',
          CHIP_FOCUS,
        )}
      >
        Show all
      </button>
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
