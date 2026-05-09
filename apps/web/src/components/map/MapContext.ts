/**
 * Module 2.3 — MapView context.
 *
 * Carries the live `useMapInstance` result down the React tree so overlay
 * children (`BasemapLayer`, draw adapters, NDVI, Field overlays, etc.) can
 * subscribe to map identity + readiness without prop drilling.
 *
 * Consumers must remember the readiness contract from `useMapInstance`:
 *   - Gate "the map is alive" effects on `isReady`.
 *   - Gate **anything that touches sources/layers** on `isStyleReady`
 *     AND re-key on `styleEpoch` so layers re-mount after a basemap swap.
 */

import type { Map as MaplibreMap } from 'maplibre-gl';
import { createContext, useContext } from 'react';

export type MapContextValue = {
  map: MaplibreMap | null;
  isReady: boolean;
  isStyleReady: boolean;
  styleEpoch: number;
};

export const MapContext = createContext<MapContextValue | null>(null);

export function useMapContext(): MapContextValue {
  const ctx = useContext(MapContext);
  if (ctx === null) {
    throw new Error('useMapContext must be used inside <MapView>.');
  }
  return ctx;
}
