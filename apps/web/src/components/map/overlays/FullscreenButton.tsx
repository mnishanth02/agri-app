/**
 * Module 5.5 — `FullscreenButton`.
 *
 * Wraps MapLibre's native `FullscreenControl` and hands it the **wrapper
 * around the map container** as the fullscreen target. The default
 * behavior (no `container` option) would fullscreen only the map's inner
 * `<canvas>` host — losing every chrome overlay (TopBar, RightSidebar,
 * BottomDock, etc.). Promoting one level up keeps all of them visible
 * while fullscreen.
 *
 * Falls back to the map container itself if `parentElement` is missing
 * (defensive — should never happen with the current `<MapView>` shape).
 *
 * Module 5.7 stacks this button above `ZoomControls` on the bottom-left
 * edge. Module 5.8 swaps the `bottomBarTab` selector for a single
 * `var(--bottom-dock-h)` reference plus a `4.75rem` offset above the
 * zoom column (~88 px stacked + 16 px gap), so this button tracks the
 * dock's actual current height (including mid-drag resize). The
 * CSS-var fallback (`7rem`) covers the first paint before `BottomDock`
 * mounts its publishing effect.
 */

import { FullscreenControl } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { useMapContext } from '@/components/map/MapContext';
import { CHIP_BASE } from '@/lib/tokens';
import { cn } from '@/lib/utils';

export function FullscreenButton() {
  const { map, isReady } = useMapContext();
  const slotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!map || !isReady) return;
    const slot = slotRef.current;
    if (!slot) return;

    const mapContainer = map.getContainer();
    const fullscreenTarget = mapContainer.parentElement ?? mapContainer;
    const ctrl = new FullscreenControl({ container: fullscreenTarget });
    const el = ctrl.onAdd(map);
    slot.appendChild(el);

    return () => {
      ctrl.onRemove();
      if (el.parentNode === slot) slot.removeChild(el);
    };
  }, [map, isReady]);

  return (
    <div
      ref={slotRef}
      // Stacks above ZoomControls with a clear visual gap. Zoom column
      // ≈ 81 px (two 36 px buttons + 1 px divider + 8 px padding) sits
      // at `dock + 1rem`, so its top edge is at `dock + 6.0625rem`.
      // Anchor fullscreen at `dock + 7rem` for ~15 px breathing.
      style={{ bottom: 'calc(var(--bottom-dock-h, 7.5rem) + 7rem)' }}
      className={cn(
        CHIP_BASE,
        'pointer-events-auto absolute left-3 z-10 p-1',
        'dock-bottom-anchored motion-safe:transition-[bottom] motion-safe:duration-200',
        '[&_.maplibregl-ctrl-group]:!border-0 [&_.maplibregl-ctrl-group]:!bg-transparent [&_.maplibregl-ctrl-group]:!shadow-none',
        '[&_.maplibregl-ctrl-group_button]:!h-9 [&_.maplibregl-ctrl-group_button]:!w-9',
        '[&_.maplibregl-ctrl-group_button]:!bg-transparent',
        '[&_.maplibregl-ctrl-group_button]:hover:!bg-white/10',
        '[&_.maplibregl-ctrl-icon]:!brightness-0 [&_.maplibregl-ctrl-icon]:!invert',
      )}
    />
  );
}
