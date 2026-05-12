/**
 * Module 2.4 — MapLibre style helpers.
 *
 * Generic utilities for inspecting the active MapLibre style. Anything that
 * needs to know "where in the layer stack do labels live" must scan
 * `map.getStyle().layers` at runtime and never hard-code Esri/ArcGIS layer
 * IDs — those IDs are unstable across basemap versions and across providers
 * (we may switch from `arcgis/imagery` to a different hybrid style later,
 * or merge a separate label style on top).
 */

import type { Map as MaplibreMap } from 'maplibre-gl';

/**
 * Returns the id of the first `symbol` layer in the map's active style, or
 * `null` if the style contains no symbol layers.
 *
 * Symbol layers are MapLibre's mechanism for rendering text and icons —
 * place names, road shields, country labels, POI icons. A satellite-only
 * basemap will return `null`; a hybrid (imagery + labels) basemap will
 * return a real id that downstream layers can use as a `beforeId` insertion
 * point so they render under the labels rather than over them.
 *
 * Returns `null` if the style hasn't loaded yet — callers must already be
 * gating on `isStyleReady` before calling this.
 */
export function findFirstSymbolLayerId(map: MaplibreMap): string | null {
  const style = map.getStyle();
  if (!style?.layers) return null;
  for (const layer of style.layers) {
    if (layer.type === 'symbol') return layer.id;
  }
  return null;
}

/**
 * True iff `map` still has a live MapLibre style. After `map.remove()` the
 * internal `style` is disposed and any source/layer call throws
 * `Cannot read properties of undefined (reading 'getLayer'/'getSource')`.
 *
 * Cleanup effects on overlay components (FieldLayer, NdviLayer, …) that may
 * run *after* the parent `<MapView>` has already torn the map down — the
 * route-unmount race — gate on this so they no-op rather than throwing into
 * the route error boundary. The same defensive guard is mirrored inline in
 * `FieldLayer.tsx` (Module 3.3, predates this helper); newer overlays
 * should import from here.
 */
export function isMapAlive(map: MaplibreMap): boolean {
  return (map as unknown as { style?: unknown }).style != null;
}
