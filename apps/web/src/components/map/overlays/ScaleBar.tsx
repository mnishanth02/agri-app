/**
 * Module 5.5 — `ScaleBar`.
 *
 * Wraps MapLibre's native `ScaleControl` and mounts its DOM into our own
 * frosted chrome at the top-right of the map. We do not call
 * `map.addControl(...)` — that places the control in MapLibre's own corner
 * stack which conflicts with the absolute positioning of the rest of the
 * analysis chrome. Instead we instantiate the control, call `onAdd(map)`
 * to obtain the live element (which is already wired to `'move'`/`'zoom'`
 * events internally) and append it to a positioning div.
 *
 * Cleanup tears down the listeners via `onRemove()`.
 */

import { ScaleControl } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { useMapContext } from '@/components/map/MapContext';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/useUiStore';

export function ScaleBar() {
  const sidebarPaneOpen = useUiStore((s) => s.activeSidebarItem !== null);
  const { map, isReady } = useMapContext();
  const slotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!map || !isReady) return;
    const slot = slotRef.current;
    if (!slot) return;

    const ctrl = new ScaleControl({ maxWidth: 100, unit: 'metric' });
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
        // Base position pins the bar against the right edge of the rail
        // when the sidebar is collapsed; when the pane is open we slide
        // it further left so it doesn't paint over the pane content.
        'pointer-events-none absolute top-3 right-20 inline-flex h-9 items-center rounded-md',
        'border border-white/10 bg-black/70 px-2 pb-1.5 text-white shadow-lg backdrop-blur-md saturate-150',
        'motion-safe:transition-[right] motion-safe:duration-200',
        sidebarPaneOpen && 'lg:right-[25rem]',
        '[&_.maplibregl-ctrl-scale]:!border-white/60',
        '[&_.maplibregl-ctrl-scale]:!border-t-0',
        '[&_.maplibregl-ctrl-scale]:!bg-transparent',
        '[&_.maplibregl-ctrl-scale]:!text-white',
        '[&_.maplibregl-ctrl-scale]:!text-xs',
        '[&_.maplibregl-ctrl-scale]:!shadow-none',
      )}
    />
  );
}
