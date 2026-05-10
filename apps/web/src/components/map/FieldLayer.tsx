/**
 * Module 3.3 — `FieldLayer` (Layer 3 in the canonical map stack).
 *
 * Effect-only child of `<MapView>` that paints the current field polygon —
 * either the draft the user is composing (`useFieldStore.draftPolygon`) or a
 * persisted field's geometry on the analysis screen — as a translucent white
 * fill plus a white outline. Renders no DOM.
 *
 * ## Why gate on `isStyleReady` AND re-key on `styleEpoch`
 *
 * MapLibre's `'load'` (the signal `isReady` rides) only proves the canvas is
 * mounted; it says nothing about whether a *useful* style with sources/layers
 * has been applied. `BasemapLayer` swaps in the ArcGIS hybrid style
 * asynchronously via `applyArcgisImageryWithLabels`, and that swap replaces
 * **every** source and layer on the map. Anything we add against the
 * placeholder style installed by `useMapInstance` would silently disappear
 * the moment the basemap lands. The canonical fix — documented at the top
 * of `useMapInstance.ts` — is to gate this effect on
 * `[map, isStyleReady, styleEpoch]`. `BasemapLayer` calls
 * `beginStyleChange(map)` *before* applying the new style, which flips
 * `isStyleReady` to `false` and triggers our cleanup. In practice, because
 * `applyArcgisImageryWithLabels` awaits `loadStyle()` before
 * `basemap.applyTo(map)`, that cleanup completes before the underlying
 * `setStyle` call fires — so we tear our source/layers down against the
 * still-live old style, not the half-installed new one. After the swap,
 * `markStyleReady` increments `styleEpoch` and the effect re-runs against a
 * fresh style. (See the same reasoning in `useFieldDrawing.ts` JSDoc; the
 * cleanup-ordering caveat depends on `applyArcgisImageryWithLabels`'s async
 * `loadStyle()`. The defensive `getLayer`/`getSource` guards below catch any
 * leftover races if a future synchronous style path inverts that ordering.)
 *
 * ## Why two effects (lifecycle vs data)
 *
 * The spec is explicit: add the source **once**, then update with
 * `GeoJSONSource#setData(...)` when the polygon changes. That maps cleanly
 * to two effects with different dep sets:
 *
 *   1. **Lifecycle effect** — deps `[map, isStyleReady, styleEpoch]`.
 *      Adds the `field` source plus the `field-fill` and `field-outline`
 *      layers, then calls `moveLayer` to push them above any basemap label
 *      symbols. Cleanup removes layers before the source. Re-runs only when
 *      the style is replaced.
 *   2. **Data effect** — deps `[map, isStyleReady, effectivePolygon]`.
 *      Looks up the (already-added) source and calls `setData(...)` with a
 *      fresh FeatureCollection. Re-runs on every polygon change.
 *
 * Folding both into one effect would either re-create the source on every
 * polygon edit (defeating the spec) or defer initial `setData` to a
 * polygon-change tick (leaving the layers empty for the first render).
 *
 * ## Why empty FeatureCollection for null polygon
 *
 * When `polygon` is `null` (no draft, draft cleared), we set the source
 * data to an empty FeatureCollection rather than removing the layers and
 * re-adding them on the next polygon. MapLibre's `GeoJSONSource#setData`
 * is cheap; `addSource`/`addLayer` churn would either flash the layer
 * order (re-running `moveLayer` to keep `field-outline` on top) or risk a
 * race where a fast Clear → Draw cycle leaves the source missing when the
 * lifecycle effect tries to read it. Keeping the layers registered with
 * empty data renders nothing visually and keeps the stack stable.
 *
 * ## Why `moveLayer` without `beforeId`
 *
 * Per Module 3.3 (`docs/implementation.md`) and the canonical layer stack
 * in `docs/plan.md` §2 (Field Analysis Screen Anatomy), the required order
 * is `satellite → NDVI → labels → field fill → field outline`. The field
 * outline sits on top of basemap label symbols (the user must always see
 * the polygon edge), not below them. `map.moveLayer(id)` without a
 * `beforeId` argument moves the layer to the very top of the layer stack,
 * which is exactly what we want for both `field-fill` and `field-outline`.
 * We call them in that order so the *outline* ends up topmost (the second
 * `moveLayer` call wins for the topmost slot). Phase 6's NDVI insertion
 * uses `findFirstSymbolLayerId(map)` to slip below labels — the inverse
 * problem — which is why we deliberately do not hard-code Esri layer IDs
 * here.
 *
 * ## Why optional `polygon` prop (draft-vs-persisted dual use)
 *
 * The Module 3.3 spec covers two consumers with the same visual contract:
 *
 *   - `/fields/new` (Module 3.6): renders the in-flight draft from
 *     `useFieldStore.draftPolygon`.
 *   - `/fields/$id` (later phase): renders the persisted polygon from
 *     `useField(id).data.geometry`.
 *
 * Two near-identical sibling components (`<DraftFieldLayer />` +
 * `<PersistedFieldLayer />`) would duplicate the entire MapLibre lifecycle
 * — the same source, the same two layers, the same `moveLayer` ordering,
 * the same style-epoch dance — for no payoff. Instead this component takes
 * an **optional** `polygon` prop:
 *
 *   - Prop omitted (`<FieldLayer />`)  → subscribe to the store. Used on
 *     the create screen so the layer auto-updates as Terra Draw writes
 *     `draftPolygon`.
 *   - Prop provided (`<FieldLayer polygon={field.geometry} />`) → use the
 *     prop value verbatim. Used on the analysis screen so the layer
 *     follows React Query's data, independent of any draft state.
 *
 * `polygon === undefined` distinguishes "not passed" from "passed but
 * null" (caller wants to explicitly clear). Passing `polygon={null}`
 * paints nothing even if the store has a draft — important for the
 * analysis screen, which must never read draft state.
 *
 * ## Cleanup ordering (layers before source)
 *
 * MapLibre throws if you `removeSource` while layers still reference it.
 * Both the lifecycle effect's cleanup and the StrictMode setup-side
 * defensive removal therefore tear down in this order:
 *   `removeLayer('field-outline')` → `removeLayer('field-fill')` →
 *   `removeSource('field')`.
 * Each step is guarded with `getLayer`/`getSource` so a partial teardown
 * (e.g., the style was replaced and already wiped some IDs) doesn't throw.
 */

import type { GeoJSONSource } from 'maplibre-gl';
import { useEffect } from 'react';
import { useMapContext } from '@/components/map/MapContext';
import { useFieldStore } from '@/stores/useFieldStore';

/**
 * IDs are exported as module-level constants so future modules (3.6 wire-up,
 * Phase 6 NDVI ordering) can reference them without re-typing string
 * literals. Keep these in sync with the canonical stack documented in
 * `docs/plan.md` §2.
 */
export const FIELD_SOURCE_ID = 'field';
export const FIELD_FILL_LAYER_ID = 'field-fill';
export const FIELD_OUTLINE_LAYER_ID = 'field-outline';

const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection<GeoJSON.Polygon> = {
  type: 'FeatureCollection',
  features: [],
};

/** Wrap a `GeoJSON.Polygon` (or `null`) in the FeatureCollection shape MapLibre's
 *  `geojson` source consumes. Pure function — no map references — so it's safe
 *  to call from either effect. */
function featureCollectionFor(
  polygon: GeoJSON.Polygon | null,
): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  if (polygon === null) return EMPTY_FEATURE_COLLECTION;
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: polygon, properties: {} }],
  };
}

export type FieldLayerProps = {
  /**
   * Polygon to render. **Optional**:
   *  - `undefined` (prop omitted) → component subscribes to
   *    `useFieldStore.draftPolygon` (create-field flow).
   *  - `GeoJSON.Polygon` → render this polygon (analysis screen passing
   *    `useField(id).data.geometry`).
   *  - `null` → render nothing, even if the store has a draft.
   *
   * See the JSDoc header (`## Why optional polygon prop`) for the
   * draft-vs-persisted rationale.
   */
  polygon?: GeoJSON.Polygon | null;
};

export function FieldLayer({ polygon }: FieldLayerProps) {
  const { map, isStyleReady, styleEpoch } = useMapContext();
  // `polygon === undefined` (prop omitted) → fall back to the store. Any
  // explicit value, including `null`, wins over the draft so the analysis
  // screen can pass `field.geometry` without leaking draft state or
  // re-rendering on draft updates.
  const effectivePolygon = useFieldStore((s) => (polygon !== undefined ? polygon : s.draftPolygon));

  // Lifecycle effect: add the source + layers once per style generation,
  // remove them on cleanup. Re-runs when the style is swapped (styleEpoch).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `styleEpoch` is the re-key signal — when the basemap swaps a new style, the epoch bumps and this effect must rebuild against the new style (see `useMapInstance.ts` `## Style readiness contract`).
  useEffect(() => {
    if (!map || !isStyleReady) return;

    // Defensive: a StrictMode double-effect or a partially-completed prior
    // cleanup may have left these in place. Tearing down before adding
    // means the second setup pass observes a clean slate. Order matters:
    // layers reference the source.
    if (map.getLayer(FIELD_OUTLINE_LAYER_ID)) map.removeLayer(FIELD_OUTLINE_LAYER_ID);
    if (map.getLayer(FIELD_FILL_LAYER_ID)) map.removeLayer(FIELD_FILL_LAYER_ID);
    if (map.getSource(FIELD_SOURCE_ID)) map.removeSource(FIELD_SOURCE_ID);

    map.addSource(FIELD_SOURCE_ID, {
      type: 'geojson',
      data: featureCollectionFor(effectivePolygon),
    });

    map.addLayer({
      id: FIELD_FILL_LAYER_ID,
      type: 'fill',
      source: FIELD_SOURCE_ID,
      paint: {
        'fill-color': '#ffffff',
        'fill-opacity': 0.15,
      },
    });

    map.addLayer({
      id: FIELD_OUTLINE_LAYER_ID,
      type: 'line',
      source: FIELD_SOURCE_ID,
      paint: {
        'line-color': '#ffffff',
        'line-width': 2,
      },
    });

    // Push both above any basemap label symbols. Order matters: the second
    // `moveLayer` call wins for the topmost slot, so move fill first, then
    // outline → outline ends up topmost (per the canonical stack:
    // satellite → NDVI → labels → field fill → field outline).
    map.moveLayer(FIELD_FILL_LAYER_ID);
    map.moveLayer(FIELD_OUTLINE_LAYER_ID);

    return () => {
      // Cleanup ordering: layers before source (MapLibre throws on
      // `removeSource` while layers still reference it). Each step is
      // guarded so a partial teardown — e.g., the style was already
      // replaced and wiped some IDs — doesn't throw.
      if (map.getLayer(FIELD_OUTLINE_LAYER_ID)) map.removeLayer(FIELD_OUTLINE_LAYER_ID);
      if (map.getLayer(FIELD_FILL_LAYER_ID)) map.removeLayer(FIELD_FILL_LAYER_ID);
      if (map.getSource(FIELD_SOURCE_ID)) map.removeSource(FIELD_SOURCE_ID);
    };
    // `effectivePolygon` is intentionally not a dep here — the lifecycle
    // effect seeds the source with the current polygon at add-time, then
    // the data effect below owns subsequent polygon changes via
    // `setData(...)`. Including it would cause the source/layers to be
    // re-created on every polygon edit, defeating the spec's "add once,
    // setData on change" requirement.
  }, [map, isStyleReady, styleEpoch]);

  // Data effect: when the polygon changes, push fresh data through
  // `setData(...)`. Cheap — no source/layer churn. We do **not** depend on
  // `styleEpoch` here: the lifecycle effect re-seeds the new source with
  // the current `effectivePolygon` at add-time on every style swap, so a
  // duplicate `setData` from this effect would be redundant.
  useEffect(() => {
    if (!map || !isStyleReady) return;
    const source = map.getSource(FIELD_SOURCE_ID) as GeoJSONSource | undefined;
    // Source may legitimately be missing on the first render of this
    // effect if React schedules the data effect before the lifecycle
    // effect on the same tick. The next polygon-change re-run will catch
    // up; meanwhile the lifecycle effect already seeded the source with
    // `effectivePolygon` at add-time so nothing is lost.
    if (!source) return;
    source.setData(featureCollectionFor(effectivePolygon));
  }, [map, isStyleReady, effectivePolygon]);

  return null;
}
