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
 * edge with `bottom` driven by `useUiStore.bottomBarTab` so the dock
 * can never cover it. Pixel offsets clear ZoomControls (~88 px stacked
 * height) plus a small gap; deviates from the literal v2 spec values
 * because `bottom-[calc(7rem+52px)]` would visually overlap the zoom
 * buttons (the spec authored before noticing the stack height).
 */

import { FullscreenControl } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { useMapContext } from '@/components/map/MapContext';
import { CHIP_BASE } from '@/lib/tokens';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/useUiStore';

export function FullscreenButton() {
  const { map, isReady } = useMapContext();
  const slotRef = useRef<HTMLDivElement>(null);
  const expanded = useUiStore((s) => s.bottomBarTab !== null);

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
      className={cn(
        CHIP_BASE,
        'pointer-events-auto absolute left-3 z-10 p-1',
        'motion-safe:transition-[bottom] motion-safe:duration-200',
        // Stacks above ZoomControls (bottom-28 = 112 px, ~88 px tall).
        // 14 rem (224 px) sits ~24 px above the zoom column's top edge.
        // Expanded: collapsed + 40vh — same vertical relation since
        // zoom also shifts by 40vh.
        expanded ? 'bottom-[calc(40vh+14rem)]' : 'bottom-[14rem]',
        '[&_.maplibregl-ctrl-group]:!border-0 [&_.maplibregl-ctrl-group]:!bg-transparent [&_.maplibregl-ctrl-group]:!shadow-none',
        '[&_.maplibregl-ctrl-group_button]:!h-9 [&_.maplibregl-ctrl-group_button]:!w-9',
        '[&_.maplibregl-ctrl-group_button]:!bg-transparent',
        '[&_.maplibregl-ctrl-group_button]:hover:!bg-white/10',
        '[&_.maplibregl-ctrl-icon]:!brightness-0 [&_.maplibregl-ctrl-icon]:!invert',
      )}
    />
  );
}
