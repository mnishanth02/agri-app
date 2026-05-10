/**
 * Module 5.5 — `FullscreenButton`.
 *
 * Wraps MapLibre's native `FullscreenControl` and hands it the **wrapper
 * around the map container** as the fullscreen target. The default
 * behavior (no `container` option) would fullscreen only the map's inner
 * `<canvas>` host — losing every chrome overlay (TopBar, RightSidebar,
 * BottomBar, AnalysisToolbar, etc.). Promoting one level up keeps all of
 * them visible while fullscreen.
 *
 * Falls back to the map container itself if `parentElement` is missing
 * (defensive — should never happen with the current `<MapView>` shape).
 */

import { FullscreenControl } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { useMapContext } from '@/components/map/MapContext';

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
      className={[
        // Tightened to ~16 px below the zoom group so the two MapLibre
        // chrome chips read as a single left-edge rail rather than two
        // disconnected pills.
        'pointer-events-auto absolute left-3 top-[calc(50%+52px)] rounded-md',
        'border border-white/10 bg-black/70 p-1 text-white shadow-lg backdrop-blur-md saturate-150',
        '[&_.maplibregl-ctrl-group]:!border-0 [&_.maplibregl-ctrl-group]:!bg-transparent [&_.maplibregl-ctrl-group]:!shadow-none',
        '[&_.maplibregl-ctrl-group_button]:!h-9 [&_.maplibregl-ctrl-group_button]:!w-9',
        '[&_.maplibregl-ctrl-group_button]:!bg-transparent',
        '[&_.maplibregl-ctrl-group_button]:hover:!bg-white/10',
        '[&_.maplibregl-ctrl-icon]:!brightness-0 [&_.maplibregl-ctrl-icon]:!invert',
      ].join(' ')}
    />
  );
}
