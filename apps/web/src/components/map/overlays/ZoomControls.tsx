/**
 * Module 5.5 — `ZoomControls`.
 *
 * Wraps MapLibre's native `NavigationControl` (zoom only — compass and
 * pitch visualization are off). Same manual `onAdd` / `onRemove` mount
 * pattern as `ScaleBar`: keeps the buttons inside our own positioning
 * slot rather than MapLibre's corner stack.
 *
 * Module 5.7 re-anchors this column to the bottom-left edge with `bottom`
 * driven by `useUiStore.bottomBarTab` so the dock can never cover it.
 * Animates in lockstep with the dock + row + fullscreen + cloud toast.
 */

import { NavigationControl } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { useMapContext } from '@/components/map/MapContext';
import { CHIP_BASE } from '@/lib/tokens';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/useUiStore';

export function ZoomControls() {
  const { map, isReady } = useMapContext();
  const slotRef = useRef<HTMLDivElement>(null);
  const expanded = useUiStore((s) => s.bottomBarTab !== null);

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
        'pointer-events-auto absolute left-3 z-10 p-1',
        'motion-safe:transition-[bottom] motion-safe:duration-200',
        // Collapsed: 7 rem clears the dock header (h-11 = 2.75 rem) +
        // the row above it (h-10 = 2.5 rem) + breathing.
        // Expanded: collapsed + 40vh keeps the same gap above the row,
        // since the row also shifts by 40vh on expansion. (Spec § 7.C.6
        // proposed `40vh+5rem` but that overlaps the now-corrected row;
        // adversarial review caught the cascade off-by-2rem.)
        expanded ? 'bottom-[calc(40vh+7rem)]' : 'bottom-28',
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
