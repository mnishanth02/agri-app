/**
 * Module 5.5 — `ZoomControls`.
 *
 * Wraps MapLibre's native `NavigationControl` (zoom only — compass and
 * pitch visualization are off). Same manual `onAdd` / `onRemove` mount
 * pattern as `ScaleBar`: keeps the buttons inside our own positioning
 * slot rather than MapLibre's corner stack.
 */

import { NavigationControl } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { useMapContext } from '@/components/map/MapContext';
import { CHIP_BASE } from '@/lib/tokens';
import { cn } from '@/lib/utils';

export function ZoomControls() {
  const { map, isReady } = useMapContext();
  const slotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!map || !isReady) return;
    const slot = slotRef.current;
    if (!slot) return;

    const ctrl = new NavigationControl({
      showCompass: false,
      showZoom: true,
      visualizePitch: false,
    });
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
        'pointer-events-auto absolute top-1/2 left-3 -translate-y-1/2 p-1',
        // Re-skin the native MapLibre zoom buttons to match our dark chrome.
        '[&_.maplibregl-ctrl-group]:!border-0 [&_.maplibregl-ctrl-group]:!bg-transparent [&_.maplibregl-ctrl-group]:!shadow-none',
        '[&_.maplibregl-ctrl-group_button]:!h-9 [&_.maplibregl-ctrl-group_button]:!w-9',
        '[&_.maplibregl-ctrl-group_button]:!bg-transparent',
        '[&_.maplibregl-ctrl-group_button]:hover:!bg-white/10',
        '[&_.maplibregl-ctrl-group_button+button]:!border-t [&_.maplibregl-ctrl-group_button+button]:!border-white/20',
        '[&_.maplibregl-ctrl-icon]:!brightness-0 [&_.maplibregl-ctrl-icon]:!invert',
      )}
    />
  );
}
