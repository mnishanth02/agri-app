/**
 * Module 5.5 — `DateTimeline` (visual stub).
 *
 * Horizontal pill above the BottomBar that hints at the future date
 * picker. Renders six dots on a hairline; the right-most is the
 * "current" scene. **Phase 6** wires this to real Sentinel-2 scenes
 * from `useEosdaScenes(fieldId)` — until then this is decorative.
 *
 * ## Vertical positioning
 *
 * Sits just above the BottomBar:
 * - Collapsed bar (~48 px header) → `bottom-20` (≈ 80 px clears it).
 * - Expanded bar (~328 px = 48 px header + 280 px panel) → `bottom-[22rem]`.
 *
 * Reads `useUiStore.bottomBarTab` to decide which offset applies.
 *
 * ## Sidebar dodge
 *
 * Mirrors the BottomBar dodge: when the right sidebar pane is open on
 * `lg+`, shifts left by ~11 rem so the timeline stays clear of the
 * 364 px-wide pane.
 */

import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/useUiStore';

const DOT_COUNT = 6;
const DOT_INDICES = Array.from({ length: DOT_COUNT }, (_, i) => i);

export function DateTimeline() {
  const sidebarPaneOpen = useUiStore((s) => s.activeSidebarItem !== null);
  const bottomExpanded = useUiStore((s) => s.bottomBarTab !== null);

  return (
    <div
      className={cn(
        // Pointer-events stay off the wrapper since the chip itself is
        // non-interactive — we don't want to swallow map drags that
        // start over the timeline strip.
        'pointer-events-none absolute left-1/2 -translate-x-1/2',
        'motion-safe:transition-[transform,bottom] motion-safe:duration-200',
        bottomExpanded ? 'bottom-[22rem]' : 'bottom-20',
        sidebarPaneOpen && 'lg:[transform:translateX(calc(-50%_-_11rem))]',
      )}
    >
      <div
        aria-hidden="true"
        className="relative flex h-9 w-[360px] max-w-[calc(100vw-1.5rem)] items-center rounded-md border border-white/10 bg-black/70 px-4 text-white shadow-lg backdrop-blur-md saturate-150"
      >
        <div className="absolute inset-x-4 top-1/2 h-px -translate-y-1/2 bg-white/20" />
        <div className="relative flex w-full items-center justify-between">
          {DOT_INDICES.map((i) => {
            const isCurrent = i === DOT_COUNT - 1;
            return (
              <span
                key={i}
                className={cn(
                  'block rounded-full',
                  isCurrent ? 'size-2.5 bg-white' : 'size-2 bg-white/40',
                )}
              />
            );
          })}
        </div>
      </div>
      <span className="sr-only">Date timeline placeholder; Phase 6 will populate.</span>
    </div>
  );
}
