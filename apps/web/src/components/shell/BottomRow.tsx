/**
 * Module 5.7 — `BottomRow` (floating row above the dock).
 *
 * Single fixed full-width row hosting `<DateTimeline />` (centred,
 * `flex-1`) and `<LayerControlCluster />` (right). The row's `bottom`
 * is driven by `useUiStore.bottomBarTab`: when the dock is collapsed
 * the row sits at `bottom-14` (clears the 2.75 rem dock header + 0.75
 * rem gap); when the dock expands to its `40vh` cap the row shifts up
 * to `bottom-[calc(40vh+3.5rem)]` — that's the dock body cap (`40vh`)
 * plus the dock header (`h-11` ≈ 2.75 rem) plus a 0.75 rem breathing
 * gap. The literal spec value `bottom-[calc(40vh+0.75rem)]` placed the
 * row 32 px INSIDE the expanded dock body since the dock total height
 * is `40vh + h-11`, not `40vh`. Both row and dock animate `bottom`
 * together via `motion-safe:transition-[bottom] duration-200`.
 *
 * The row itself is `pointer-events-none`; each child re-enables
 * pointer events on its own chip surface (the timeline and layer
 * cluster are both `CHIP_BASE` chips already).
 *
 * See `docs/ui-ux-redesign-v2.md` § 7.C.2.
 */

import { DateTimeline } from '@/components/map/overlays/DateTimeline';
import { LayerControlCluster } from '@/components/map/overlays/LayerControlCluster';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/useUiStore';

export function BottomRow() {
  const expanded = useUiStore((s) => s.bottomBarTab !== null);

  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 z-10 flex items-center gap-3 px-3',
        'motion-safe:transition-[bottom] motion-safe:duration-200',
        expanded ? 'bottom-[calc(40vh+3.5rem)]' : 'bottom-14',
      )}
    >
      {/* Symmetric spacer so the timeline stays visually centred when
          the layer cluster on the right grows. Hidden on `<md`. */}
      <div aria-hidden="true" className="hidden w-10 md:block" />

      <div className="flex min-w-0 flex-1 justify-center">
        <DateTimeline />
      </div>

      <div className="shrink-0">
        <LayerControlCluster />
      </div>
    </div>
  );
}
