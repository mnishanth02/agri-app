/**
 * Module 5.6 — `ScaleBar`.
 *
 * Wraps MapLibre's native `ScaleControl` and mounts its DOM into our own
 * frosted chrome. Pinned to `top-14 right-20` so it sits below the
 * `GetOverviewButton` / `FieldSwitcherChip` row and to the left of the
 * `RightSidebar` rail (which lives at `right-3`); hidden below `lg` —
 * the scale read-out is useful on desktop but not critical at phone
 * widths (see `docs/ui-ux-redesign.md` § R.C.4).
 */

import { ScaleControl } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { useMapContext } from '@/components/map/MapContext';
import { CHIP_BASE } from '@/lib/tokens';
import { cn } from '@/lib/utils';

export function ScaleBar() {
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
        CHIP_BASE,
        'pointer-events-none absolute top-14 right-20 hidden h-9 items-center px-2 pb-1.5 lg:inline-flex',
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
