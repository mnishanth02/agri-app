/**
 * Module 6.4 — `NdviLayer` (Layer 4 of the canonical map stack).
 *
 * Effect-only child of `<MapView>` that paints an EOSDA-served NDVI / EVI /
 * NDWI raster overlay for the currently selected Sentinel-2 view. Renders
 * no DOM. Sibling of `<FieldLayer>` — mounted *before* it in JSX so the
 * field outline (added by `FieldLayer.moveLayer`) lands on top.
 *
 * ## Tile URL
 *
 * Tiles are fetched from the authenticated API proxy added in Module 6.3:
 *   `${VITE_API_BASE_URL}/api/eosda/render/{z}/{x}/{y}` +
 *     `?fieldId=${fieldId}&viewId=${encodeURIComponent(viewId)}&band=${band}`
 *
 * MapLibre substitutes `{z}/{x}/{y}` per tile request. The `Authorization:
 * Bearer <jwt>` header is attached by the `transformRequest` hook wired in
 * `AnalysisLayout` — this component does not (and must not) read the
 * Clerk token directly.
 *
 * ## Token-ready gate (rubber-duck #4)
 *
 * MapLibre starts requesting tiles the instant the source is added. If the
 * source mounts before `useClerkTokenRef` has resolved its first token,
 * every initial tile fires without an `Authorization` header → the API
 * 401s, MapLibre marks the tile failed and may not retry. The lifecycle
 * effect therefore gates on `isAuthReady === true` AND `selectedViewId !=
 * null` before adding source/layer; otherwise it mounts nothing (the
 * cleanup is a no-op because nothing was added).
 *
 * ## viewId-belongs-to-field gate (Phase 6 review BLOCKER)
 *
 * Field navigation A → B fires `<NdviLayer>`'s lifecycle effect with the
 * NEW `fieldId` and the OLD `selectedViewId` BEFORE
 * `useAutoSelectDefaultScene` swaps the selection to a viewId valid for
 * field B. Without an additional gate, MapLibre would issue tile requests
 * shaped like `/api/eosda/render/.../?fieldId=B&viewId=<A's viewId>` and
 * the API would 404 every one (the cache existence check in
 * `eosda.render.ts` rejects unknown `(fieldId, viewId)` pairs to prevent
 * enumeration). Those 404s never become user-visible imagery but they
 * pollute the network panel and waste a render-pass per tile until
 * auto-select catches up.
 *
 * The `isViewIdValidForField` gate subscribes to `useEosdaScenes(fieldId)`
 * (TanStack Query dedupes — no extra request) and only allows the source
 * to mount when `selectedViewId` actually exists in the current field's
 * scene list. The auto-select hook's next pass writes a valid viewId and
 * the effect re-runs cleanly.
 *
 * No `'RGB'`/no-NDVI gate is needed: `useUiStore.selectedIndex` is typed
 * as `'NDVI' | 'EVI' | 'NDWI'` (see `useUiStore.ts` JSDoc) — every value
 * is a valid EOSDA Render alias.
 *
 * ## Layer ordering — `beforeId = findFirstSymbolLayerId(map)`
 *
 * The canonical stack (`docs/plan.md` § 2) is
 *   `satellite → NDVI → labels → field fill → field outline`.
 * We insert with `beforeId` set to the first symbol layer id in the active
 * style so the raster paints UNDER basemap labels (legibility) but OVER
 * the satellite fill. `FieldLayer` then runs `moveLayer(...)` (no
 * `beforeId`) on its own layers to push them to the top — so the user's
 * polygon stays on top of NDVI regardless of mount order.
 *
 * Because `beforeId` placement handles label stacking deterministically,
 * the styledata-listener fallback that an earlier draft of `FieldLayer`
 * planned (re-running `moveLayer` whenever NDVI mutates the layer list)
 * is unnecessary — see the discussion in `useMapInstance.ts`.
 *
 * ## Two effects: lifecycle vs opacity
 *
 * Same pattern as `FieldLayer` (see its JSDoc for the full rationale):
 *
 *   1. **Lifecycle effect** — deps include the tile-URL inputs
 *      (`fieldId`, `selectedViewId`, `selectedIndex`) plus the readiness
 *      gates and `styleEpoch`. Adds the source + layer; cleanup removes
 *      both (layers before source — MapLibre throws on `removeSource`
 *      while a layer references it).
 *   2. **Opacity-only effect** — deps `[map, isStyleReady, ndviOpacity]`.
 *      Calls `setPaintProperty('ndvi-tile', 'raster-opacity', value)` —
 *      cheap, no source rebuild. Folding this into the lifecycle effect
 *      would tear down and re-fetch every tile on each slider tick.
 *
 * ## Style-swap safety
 *
 * The lifecycle effect re-keys on `styleEpoch`, so when `BasemapLayer`
 * swaps in the ArcGIS hybrid style (which wipes every source/layer), the
 * effect re-runs against the fresh style. The defensive `isMapAlive`
 * guard in cleanup protects against the route-unmount race where
 * `<MapView>` tears the map down before sibling cleanups fire.
 */

import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useMapContext } from '@/components/map/MapContext';
import { env } from '@/env';
import { useEosdaScenes } from '@/hooks/useEosdaScenes';
import { findFirstSymbolLayerId, isMapAlive } from '@/lib/map-style';
import { useUiStore } from '@/stores/useUiStore';

export const NDVI_SOURCE_ID = 'ndvi-tile-source';
export const NDVI_LAYER_ID = 'ndvi-tile';

/**
 * EOSDA caps S2 derived-index render tiles at z=16 (verified against
 * `/api/render/.../{z}/{x}/{y}` — z>=17 returns 422 `"Max zoom exceed"`,
 * and bursts of those 422s trip the per-key 429 quota). Setting the
 * source `maxzoom` here makes MapLibre stop fetching new tiles past
 * z=16 and overzoom (stretch) z=16 tiles for closer views — the
 * standard pattern for raster sources backed by a hard server cap.
 */
const EOSDA_RENDER_MAX_ZOOM = 16;

export type NdviLayerProps = {
  fieldId: string;
  /**
   * `true` once `useClerkTokenRef` has resolved its first JWT. While
   * `false`, the lifecycle effect mounts nothing — see the JSDoc header
   * (`## Token-ready gate`) for why.
   */
  isAuthReady: boolean;
  /**
   * Field-polygon bbox `[west, south, east, north]`. Forwarded to the
   * raster source as MapLibre's `bounds` property so MapLibre never
   * issues tile requests for tiles that don't intersect the field. At
   * low zoom levels (or when the user pans far away) this is the
   * difference between 1–2 backend round-trips per zoom level vs
   * dozens — EOSDA's per-key 429 quota will start tripping inside a
   * few seconds without it. See MapLibre `raster.bounds` spec.
   */
  bounds: [number, number, number, number];
  /**
   * Current value of `fields.eosda_cropper_ref` for this field, or
   * `null` while warm-up is still resolving it. Folded into the tile
   * URL as a `&v=<hash|pending>` cache-buster so the moment the column
   * flips from NULL → hash, every subsequent tile request lands at a
   * new URL — evicting any un-clipped fallback tiles from MapLibre's
   * in-memory cache and the browser HTTP cache without requiring a
   * hard refresh. The proxy strips this param via zod (it never
   * reaches EOSDA upstream).
   */
  cropperRef: string | null;
};

export function NdviLayer({ fieldId, isAuthReady, bounds, cropperRef }: NdviLayerProps) {
  const { map, isStyleReady, styleEpoch } = useMapContext();

  // Multi-slice read wrapped in `useShallow` so unrelated `useUiStore`
  // updates (e.g., sidebar toggles) don't re-render this component.
  const { selectedViewId, selectedIndex, ndviOpacity } = useUiStore(
    useShallow((s) => ({
      selectedViewId: s.selectedViewId,
      selectedIndex: s.selectedIndex,
      ndviOpacity: s.ndviOpacity,
    })),
  );

  // Subscribe to the same scenes query DateTimeline + the auto-select
  // hook use. TanStack Query dedupes by key — no extra request. We only
  // care whether `selectedViewId` is in the list; the gate below closes
  // the field-A → field-B race documented in the JSDoc header.
  const { data: scenes } = useEosdaScenes(fieldId);
  const isViewIdValidForField = useMemo(
    () => Boolean(selectedViewId && scenes?.some((s) => s.viewId === selectedViewId)),
    [scenes, selectedViewId],
  );

  // 1. Lifecycle effect — add source + layer when (and only when) all the
  //    gates clear; cleanup removes them. `ndviOpacity` is intentionally
  //    excluded from the dep list — opacity changes are owned by effect (2)
  //    via `setPaintProperty`, not by source rebuilds.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `styleEpoch` is the re-key signal — when the basemap swaps a new style, the epoch bumps and this effect must rebuild against the new style. `ndviOpacity` is intentionally excluded; the opacity-only effect below owns it.
  useEffect(() => {
    if (!map || !isStyleReady || !isAuthReady || !selectedViewId || !isViewIdValidForField) {
      return;
    }

    const apiBase = env.VITE_API_BASE_URL.replace(/\/+$/, '');
    // `v` is a stable cache key derived from the cropper hash: as soon
    // as warm-up finishes and the hash appears in the field DTO, the
    // tile URL changes and MapLibre treats every tile as new — no more
    // stale un-clipped tiles served from cache. While the hash is still
    // pending we use a fixed sentinel so MapLibre still dedupes within
    // that window.
    const cropperVersion = cropperRef ?? 'pending';
    const tileUrl =
      `${apiBase}/api/eosda/render/{z}/{x}/{y}` +
      `?fieldId=${fieldId}` +
      `&viewId=${encodeURIComponent(selectedViewId)}` +
      `&band=${selectedIndex}` +
      `&v=${cropperVersion}`;

    const beforeId = findFirstSymbolLayerId(map);

    // Defensive: a StrictMode double-effect or a partially-completed prior
    // cleanup may have left these in place. Tear down before adding so the
    // second setup pass observes a clean slate. Order matters: layers
    // reference the source.
    if (isMapAlive(map)) {
      if (map.getLayer(NDVI_LAYER_ID)) map.removeLayer(NDVI_LAYER_ID);
      if (map.getSource(NDVI_SOURCE_ID)) map.removeSource(NDVI_SOURCE_ID);
    }

    map.addSource(NDVI_SOURCE_ID, {
      type: 'raster',
      tiles: [tileUrl],
      tileSize: 256,
      // Hard ceiling: EOSDA caps S2 derived-index tiles at z=16 (z≥17
      // returns 422 "Max zoom exceed"). MapLibre overzooms z=16 tiles
      // for closer views — the standard pattern for raster sources
      // backed by a hard server cap.
      maxzoom: EOSDA_RENDER_MAX_ZOOM,
      // Critical quota guard: without `bounds`, MapLibre requests every
      // tile in the visible viewport — dozens at low zoom levels, each
      // a backend round-trip to EOSDA. With `bounds` set to the field
      // bbox, MapLibre only requests tiles that intersect the polygon
      // (1–4 tiles for a small field at any zoom level), keeping us
      // well under the per-key rate limit during pan/zoom.
      bounds,
      attribution: 'Imagery © EOSDA / Sentinel-2',
    });

    // `addLayer(layer, beforeId?)` — split the call so we never pass
    // `undefined` (the active style may not have any symbol layers, e.g.
    // the placeholder before `BasemapLayer` swaps in the hybrid style;
    // in that case painting on top is acceptable).
    if (beforeId) {
      map.addLayer(
        {
          id: NDVI_LAYER_ID,
          type: 'raster',
          source: NDVI_SOURCE_ID,
          paint: { 'raster-opacity': ndviOpacity },
        },
        beforeId,
      );
    } else {
      map.addLayer({
        id: NDVI_LAYER_ID,
        type: 'raster',
        source: NDVI_SOURCE_ID,
        paint: { 'raster-opacity': ndviOpacity },
      });
    }

    return () => {
      // Route-unmount race: `<MapView>`'s `useMapInstance` cleanup may
      // have already torn the map down (nulling `map.style`). Guard so
      // we no-op rather than throwing into the route error boundary.
      if (!isMapAlive(map)) return;
      if (map.getLayer(NDVI_LAYER_ID)) map.removeLayer(NDVI_LAYER_ID);
      if (map.getSource(NDVI_SOURCE_ID)) map.removeSource(NDVI_SOURCE_ID);
    };
  }, [
    map,
    isStyleReady,
    styleEpoch,
    fieldId,
    selectedViewId,
    selectedIndex,
    isAuthReady,
    isViewIdValidForField,
    bounds,
    cropperRef,
  ]);

  // 2. Opacity-only effect — push the new value with `setPaintProperty`,
  //    no source/layer churn. Skip if the layer hasn't been added yet
  //    (gates above haven't cleared, or the lifecycle effect hasn't run
  //    on this style epoch yet); the next lifecycle pass will seed
  //    `raster-opacity` from the current `ndviOpacity` at add-time, so
  //    nothing is lost.
  useEffect(() => {
    if (!map || !isStyleReady) return;
    if (!isMapAlive(map)) return;
    if (!map.getLayer(NDVI_LAYER_ID)) return;
    map.setPaintProperty(NDVI_LAYER_ID, 'raster-opacity', ndviOpacity);
  }, [map, isStyleReady, ndviOpacity]);

  return null;
}
