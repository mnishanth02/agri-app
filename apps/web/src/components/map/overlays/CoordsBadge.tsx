/**
 * Module 5.5 — `CoordsBadge`.
 *
 * Top-left frosted chip that mirrors the cursor's geographic position
 * (lat/lng, four decimals) over the satellite basemap. The chip
 * unmounts when the cursor leaves the map so it never displays stale
 * coordinates; it reappears as soon as the cursor re-enters.
 *
 * ## Why no `aria-live`
 *
 * Mousemove fires many times per second; an `aria-live` region here
 * would saturate screen readers with a continuous coordinate stream.
 * The chip stays as a static label (with an `sr-only` "Cursor
 * coordinates:" prefix) so AT users can read it on demand.
 *
 * ## Why a separate `coords` state instead of a ref + DOM mutation
 *
 * The badge is small and only rerenders when the cursor moves *over*
 * the map; the surrounding chrome (TopBar, RightSidebar, BottomBar)
 * never reads from `coords`, so React reconciliation cost is negligible
 * compared to MapLibre's own per-frame work.
 */

import type { MapMouseEvent } from 'maplibre-gl';
import { useEffect, useState } from 'react';
import { useMapContext } from '@/components/map/MapContext';

// `en-US` is intentional — coordinate decimals should always use a `.`
// separator regardless of browser locale (scientific convention).
const COORD_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

type Coords = { lng: number; lat: number };

export function CoordsBadge() {
  const { map, isReady } = useMapContext();
  const [coords, setCoords] = useState<Coords | null>(null);

  useEffect(() => {
    if (!map || !isReady) return;

    const handleMove = (event: MapMouseEvent) => {
      setCoords({ lng: event.lngLat.lng, lat: event.lngLat.lat });
    };
    const handleOut = () => setCoords(null);

    map.on('mousemove', handleMove);
    map.on('mouseout', handleOut);

    return () => {
      map.off('mousemove', handleMove);
      map.off('mouseout', handleOut);
    };
  }, [map, isReady]);

  // Hide the chip while idle so it doesn't display a meaningless
  // placeholder; it reappears the moment the cursor enters the map.
  // Hidden below `lg` to free the top row for the centered TopBar on
  // narrower viewports.
  if (!coords) return null;

  const label = `${COORD_FORMATTER.format(coords.lat)}°, ${COORD_FORMATTER.format(coords.lng)}°`;

  return (
    <div className="pointer-events-none absolute top-3 left-3 hidden h-9 min-w-[16rem] items-center rounded-md border border-white/10 bg-black/70 px-3 text-white text-xs tabular-nums shadow-lg backdrop-blur-md saturate-150 lg:inline-flex">
      <span className="sr-only">Cursor coordinates: </span>
      <span>{label}</span>
    </div>
  );
}
