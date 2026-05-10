/**
 * Module 3.2 — `useFieldDrawing` (Terra Draw + MapLibre adapter integration).
 *
 * Wraps a single `TerraDraw` instance backed by `TerraDrawMapLibreGLAdapter`
 * so the create-field flow can let the user draw exactly one polygon per
 * field and write the result into `useFieldStore` together with derived
 * validation state.
 *
 * ## Why gate on `isStyleReady` and re-key on `styleEpoch`
 *
 * The MapLibre adapter calls `map.addSource` / `map.addLayer` from
 * `register()` to host its own provisional rendering. If we constructed the
 * adapter against the placeholder style installed by `useMapInstance` (i.e.,
 * on `isReady` alone), every adapter source/layer would be wiped the moment
 * `BasemapLayer` swaps in the real ArcGIS style. Worse, the rebound `map`
 * would still hold a reference to the dead adapter from the previous style
 * generation, making interactions fail silently.
 *
 * The fix is the canonical readiness pattern documented at the top of
 * `useMapInstance.ts`: build the adapter inside an effect gated on
 * `[map, isStyleReady, styleEpoch]`, and tear the whole instance down in
 * cleanup. `BasemapLayer` calls `beginStyleChange(map)` *before* it applies
 * the new style, which flips `isStyleReady` back to `false` and triggers
 * this effect's cleanup. In practice — because `applyArcgisImageryWithLabels`
 * awaits an async `loadStyle()` before `basemap.applyTo(map)` — that
 * cleanup completes before the underlying `setStyle` call fires, so the
 * adapter is unregistered before its sources/layers can be replaced. The
 * defensive `try/catch` around `draw.stop()` catches any leftover failure
 * if a future synchronous style path inverts that ordering. After the new
 * style is ready, `styleEpoch` increments and the effect re-runs against a
 * fresh `TerraDraw` instance — cheap, deterministic, and immune to stale
 * source/layer references.
 *
 * ## Structural vs. business validation split
 *
 * The Module 3.2 spec is explicit (docs/implementation.md:490): structural /
 * self-intersection failures get a toast and are discarded so the user
 * redraws; area and India-bbox failures are kept on the map but flagged
 * inline so the user can resize / drag instead of starting over. This hook
 * implements that split as follows on every Terra Draw `finish` event:
 *
 *   1. `ValidateNotSelfIntersecting(feature)` — Terra Draw's built-in
 *      segment-intersection guard. On failure → toast + `draw.clear()` +
 *      `clearDraft()`. The polygon never enters the store. (See
 *      "Why we run validation manually" below for why this isn't passed to
 *      the polygon mode's `validation` config.)
 *   2. `polygonGeoJsonSchema.safeParse(feature.geometry)` — the strict
 *      shared zod schema that already enforces single-ring, ring-closure,
 *      India-bbox, and area-in-range.
 *      - Structural issue (ring-not-closed, multi-ring) → defensive
 *        toast + clear. In practice Terra Draw can't produce these for a
 *        polygon mode feature, but we keep the branch as a backstop.
 *      - Area / bbox issue → write the polygon to the store with
 *        `valid: false` and human-readable error messages so
 *        `<FieldLayer />` (Module 3.3) keeps painting the shape and the
 *        form (Module 3.5) shows the error inline.
 *      - Success → write the polygon with `valid: true` and `errors: []`.
 *
 * ## Why `setDraftGeometry` (one set), not the two-step pattern
 *
 * `useFieldStore.setDraftGeometry` is a single `set()` that writes
 * polygon + area + valid + errors atomically. Splitting into
 * `setDraftPolygon(...)` + `setDraftValidation(...)` would cause one
 * intermediate render where consumers selecting `{ draftPolygon,
 * draftValid }` see a fresh polygon paired with stale validation. The
 * Module 3.1 review carved this action out specifically so 3.2 wouldn't
 * cause two re-renders per draw tick — see `useFieldStore.ts` JSDoc.
 *
 * ## Why we run `ValidateNotSelfIntersecting` manually instead of via the
 * mode's `validation` config
 *
 * Terra Draw's polygon-mode `validation` callback runs inside the store
 * `update`/`finish` path. Returning `{ valid: false }` causes the store
 * write to be rejected, which means **the `finish` listener does not fire
 * for an invalid feature** (no feature got finished). The user would just
 * see the polygon disappear with no toast and no signal that they need to
 * redraw. By skipping mode-level validation and re-running
 * `ValidateNotSelfIntersecting` ourselves on `finish`, we always get the
 * event, can produce the toast, and clear the now-rejected feature. See
 * the DEVIATION blockquote under Module 3.2 in docs/implementation.md.
 *
 * ## Live area + validation on `change` (Module 3.4)
 *
 * Each provisional / commit `change` recomputes area from the in-progress
 * polygon (which Terra Draw stores with the closing point already wired,
 * so `@turf/area` returns a sane value) and **also** runs the same
 * `polygonGeoJsonSchema.safeParse` the `finish` handler runs, so the form
 * (Module 3.5) can render the canonical India-bbox / size hints live as
 * the user drags vertices around — not just after they double-click to
 * finish. Three branches:
 *
 *   - Parse succeeds → `valid: true`, `errors: []`, area chip lights up.
 *   - Parse fails with a **structural** issue (`hasStructuralFailure`) →
 *     `valid: false`, `errors: []`. We deliberately do **not** surface
 *     structural messages live: an in-progress Terra Draw polygon can
 *     transiently look "structural" (e.g., one ring vertex still being
 *     dragged into place) and a flickering "ring not closed" message would
 *     be noisy. The `finish` handler is the one that toasts + clears for
 *     structural failures.
 *   - Parse fails with a **business** issue (bbox / area) →
 *     `valid: false`, `errors: <human-readable messages>`. These are
 *     stable across drag ticks and are exactly what the form should show
 *     inline so the user can fix as they drag.
 *
 * In every branch the area is written so the live chip keeps working.
 *
 * The polygon itself is **not** written until `finish` — `<FieldLayer />`
 * reads `draftPolygon` from the store and would otherwise paint a
 * half-formed shape on top of Terra Draw's own provisional render. The
 * `finish` handler immediately overwrites these `draftValid`/`draftErrors`
 * values atomically with `setDraftGeometry` (polygon + validation in one
 * `set()`) so the brief moment of "validation set, polygon not yet" only
 * matters to consumers that read validation without polygon — which is
 * exactly what the form wants for the live readout.
 *
 * ## StrictMode safety
 *
 * The cleanup function unsubscribes every listener it registered, calls
 * `draw.stop()` (which unregisters the adapter and clears its sources /
 * layers), and is guarded against double-stop with a closure-local
 * `stopped` flag. Re-entry from React's setup → cleanup → setup dev cycle
 * is therefore safe — each pass owns its own `TerraDraw` instance.
 */

import { polygonGeoJsonSchema } from '@viz-crop/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  type GeoJSONStoreFeatures,
  TerraDraw,
  TerraDrawPolygonMode,
  ValidateNotSelfIntersecting,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import { useMapContext } from '@/components/map/MapContext';
import { polygonAreaHectares } from '@/lib/geometry';
import { useFieldStore } from '@/stores/useFieldStore';

/** Mode names — `setMode('polygon')` enters drawing, `setMode('static')` parks the instance. */
const POLYGON_MODE = 'polygon';
const STATIC_MODE = 'static';

/**
 * Imperative API the toolbar (`<DrawControl />`) drives. `isReady` is
 * `false` until the adapter has been built against a real style; both
 * commands and toolbar buttons should be disabled while it's `false`.
 * `isDrawing` mirrors the polygon-mode active state for the toggle button's
 * pressed/active styling.
 */
export type UseFieldDrawingResult = {
  isReady: boolean;
  isDrawing: boolean;
  start: () => void;
  stop: () => void;
  clear: () => void;
};

const NOOP = () => {};

const NOT_READY: UseFieldDrawingResult = {
  isReady: false,
  isDrawing: false,
  start: NOOP,
  stop: NOOP,
  clear: NOOP,
};

/** Pick the polygon feature out of a Terra Draw snapshot. We register only
 *  the polygon mode, so in practice this filter just narrows the union
 *  type from `Polygon | LineString | Point` to `Polygon`. */
function pickLatestPolygon(
  features: GeoJSONStoreFeatures[],
): GeoJSON.Feature<GeoJSON.Polygon> | null {
  for (let i = features.length - 1; i >= 0; i -= 1) {
    const feature = features[i];
    if (feature && feature.geometry.type === 'Polygon') {
      return feature as GeoJSON.Feature<GeoJSON.Polygon>;
    }
  }
  return null;
}

/** Map zod issues to human-readable messages for the inline error list.
 *  `polygonGeoJsonSchema` already authored these as user-facing copy
 *  (e.g., "Polygon area 0.03 ha is below the minimum 0.05 ha"); we just
 *  pass them through. The structural-vs-business classification is done
 *  separately so we don't have to parse messages. */
function issueMessages(issues: readonly { message: string }[]): string[] {
  return issues.map((issue) => issue.message);
}

/**
 * Decide whether a schema failure is "structural" (polygon shape itself is
 * unusable; user must redraw) or "business" (polygon is geometrically fine
 * but doesn't fit the field constraints; user can drag/resize to fix).
 *
 * Classification is by zod issue `code` + `path` shape — both stable
 * invariants of `polygonGeoJsonSchema`. We deliberately do NOT match on
 * `message` because the schema's user-facing copy may be edited without
 * touching this hook, and a silent classification flip (area → toast +
 * discard, or bbox → toast + discard) would be a worse UX bug than a
 * compile error here.
 *
 * Structural cases (every one is a defensive backstop — Terra Draw's
 * polygon mode does not produce these in normal use):
 *   - `code: 'too_small' | 'too_big'` at `path: ['coordinates']` —
 *     `z.array(ringSchema).length(1)` failure (multi-ring polygon).
 *   - `code: 'too_small'` at `path: ['coordinates', ringIdx]` — ring with
 *     fewer than 4 positions (degenerate ring).
 *   - `code: 'custom'` at `path: ['coordinates', ringIdx]` — ring not
 *     closed (the schema's superRefine raises this exact path/code).
 *
 * Everything else (per-vertex bbox issues at path length 3, area issues
 * with `code: 'custom'` at path length 1) is business: keep the polygon
 * visible, mark it invalid, surface inline errors.
 */
function hasStructuralFailure(issues: readonly { code: string; path: PropertyKey[] }[]): boolean {
  return issues.some((issue) => {
    const { code, path } = issue;
    if (path.length === 1 && path[0] === 'coordinates') {
      return code === 'too_small' || code === 'too_big';
    }
    if (path.length === 2 && path[0] === 'coordinates') {
      return code === 'too_small' || code === 'custom';
    }
    return false;
  });
}

export function useFieldDrawing(): UseFieldDrawingResult {
  const { map, isStyleReady, styleEpoch } = useMapContext();
  const drawRef = useRef<TerraDraw | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `styleEpoch` is the re-key signal — when the basemap swaps a new style, the epoch bumps and this effect must rebuild the adapter against the new sources/layers (see `useMapInstance.ts` `## Style readiness contract`).
  useEffect(() => {
    if (!map || !isStyleReady) return;

    const adapter = new TerraDrawMapLibreGLAdapter({ map });
    const draw = new TerraDraw({
      adapter,
      modes: [new TerraDrawPolygonMode()],
    });

    let stopped = false;

    const setDraftGeometry = useFieldStore.getState().setDraftGeometry;
    const setDraftValidation = useFieldStore.getState().setDraftValidation;
    const clearDraft = useFieldStore.getState().clearDraft;

    /** Read the most recent polygon out of Terra Draw's store. Snapshot is
     *  a deep copy so it's safe to hand straight to zod / the app store. */
    const readLatestPolygon = (): GeoJSON.Feature<GeoJSON.Polygon> | null =>
      pickLatestPolygon(draw.getSnapshot());

    const handleChange = (_ids: ReadonlyArray<string | number>, type: string) => {
      // `styling` updates are pure rendering churn — they fire on hover and
      // do not mean the geometry changed. Skip to avoid pointless re-renders.
      if (type === 'styling') return;

      const polygon = readLatestPolygon();
      if (!polygon) {
        clearDraft();
        return;
      }

      // Live area + validation readout for the in-progress polygon. We
      // don't write the polygon itself yet — see the "Live area +
      // validation on `change`" header note.
      const ha = polygonAreaHectares(polygon.geometry);
      const result = polygonGeoJsonSchema.safeParse(polygon.geometry);

      if (result.success) {
        setDraftValidation({ areaHectares: ha, valid: true, errors: [] });
        return;
      }

      // Suppress structural messages live (they're transient mid-drag);
      // the `finish` handler owns the toast-and-clear UX for those.
      if (hasStructuralFailure(result.error.issues)) {
        setDraftValidation({ areaHectares: ha, valid: false, errors: [] });
        return;
      }

      setDraftValidation({
        areaHectares: ha,
        valid: false,
        errors: issueMessages(result.error.issues),
      });
    };

    const handleFinish = (id: string | number) => {
      const finishedFeature = draw.getSnapshotFeature(id);
      const polygonFeature =
        finishedFeature && finishedFeature.geometry.type === 'Polygon'
          ? (finishedFeature as GeoJSON.Feature<GeoJSON.Polygon>)
          : readLatestPolygon();

      if (!polygonFeature) return;

      // Structural defense — Terra Draw's polygon mode does not block
      // self-intersections by default, so a bowtie can reach this handler.
      const selfCheck = ValidateNotSelfIntersecting(polygonFeature as GeoJSONStoreFeatures);
      if (!selfCheck.valid) {
        toast.error('Polygon edges cannot cross — please redraw', {
          description: selfCheck.reason,
        });
        draw.clear();
        clearDraft();
        return;
      }

      // One-draft-per-field: if the user finished a polygon, kept polygon
      // mode active, and started another one without pressing Clear, the
      // snapshot now has multiple polygons. Drop every polygon that isn't
      // the just-finished one so the map and the store stay in sync.
      const staleIds = draw
        .getSnapshot()
        .filter(
          (f): f is GeoJSONStoreFeatures =>
            f.geometry.type === 'Polygon' && f.id !== undefined && f.id !== id,
        )
        .map((f) => f.id as string | number);
      if (staleIds.length > 0) {
        draw.removeFeatures(staleIds);
      }

      const result = polygonGeoJsonSchema.safeParse(polygonFeature.geometry);
      const ha = polygonAreaHectares(polygonFeature.geometry);

      if (!result.success) {
        if (hasStructuralFailure(result.error.issues)) {
          toast.error('Invalid polygon shape — please redraw', {
            description: result.error.issues[0]?.message,
          });
          draw.clear();
          clearDraft();
          return;
        }

        // Business-invalid: keep the shape on the map, mark invalid, show
        // human-readable hints inline. The form's submit will stay
        // disabled until the user fixes it (drag a vertex to bring the
        // polygon inside India / shrink it under MAX_AREA_KM2 km² / grow
        // it past MIN_AREA_HECTARES ha).
        setDraftGeometry({
          polygon: polygonFeature.geometry,
          areaHectares: ha,
          valid: false,
          errors: issueMessages(result.error.issues),
        });
        return;
      }

      setDraftGeometry({
        polygon: polygonFeature.geometry,
        areaHectares: ha,
        valid: true,
        errors: [],
      });
    };

    draw.on('change', handleChange);
    draw.on('finish', handleFinish);

    draw.start();
    drawRef.current = draw;
    setIsReady(true);
    setIsDrawing(false);

    return () => {
      if (stopped) return;
      stopped = true;

      draw.off('change', handleChange);
      draw.off('finish', handleFinish);

      // `stop()` unregisters the adapter (removing its sources/layers from
      // the map) and clears the store. Catch and swallow — if the map has
      // already been removed by an outer unmount, the adapter's
      // unregister can throw on a missing canvas/style; that's not
      // actionable here.
      try {
        draw.stop();
      } catch (err) {
        console.warn('[useFieldDrawing] draw.stop() failed during cleanup', err);
      }

      if (useFieldStore.getState().draftPolygon === null) {
        clearDraft();
      }

      drawRef.current = null;
      setIsReady(false);
      setIsDrawing(false);
    };
  }, [map, isStyleReady, styleEpoch]);

  const start = useCallback(() => {
    const draw = drawRef.current;
    if (!draw) return;
    // One-draft-per-field: purge any prior Terra Draw feature *and* the
    // store slice before entering polygon mode, so the next `finish`
    // event is unambiguously the new polygon.
    draw.clear();
    useFieldStore.getState().clearDraft();
    draw.setMode(POLYGON_MODE);
    setIsDrawing(true);
  }, []);

  const stop = useCallback(() => {
    const draw = drawRef.current;
    if (!draw) return;
    draw.setMode(STATIC_MODE);
    setIsDrawing(false);
    // If the user stopped mid-draw (no `finish` ever fired), Terra Draw
    // discards the in-progress feature but `handleChange` already wrote a
    // live `draftAreaHectares` into the store. With `draftPolygon` still
    // null, that area readout would otherwise stick around and the toolbar
    // would show Clear as disabled (no draft to clear) while the form
    // showed a stale area chip. Wipe the validation slice so the UI
    // matches reality. Skip the wipe when there IS a finished polygon
    // (`stop` after `finish`) so the committed draft survives.
    if (useFieldStore.getState().draftPolygon === null) {
      useFieldStore.getState().clearDraft();
    }
  }, []);

  const clear = useCallback(() => {
    const draw = drawRef.current;
    if (!draw) return;
    draw.clear();
    useFieldStore.getState().clearDraft();
    // `clear()` doesn't change the active mode — the user stays in draw
    // mode if they were drawing. The toolbar should only re-render
    // through `isDrawing` if the consumer also called `stop()`.
  }, []);

  if (!isReady) return NOT_READY;
  return { isReady, isDrawing, start, stop, clear };
}
