/**
 * Module 2.4 — `BasemapLayer`.
 *
 * Effect-only child of `<MapView>` that swaps the empty placeholder style
 * installed by `useMapInstance` with the ArcGIS imagery-with-labels hybrid
 * basemap. Renders no DOM.
 *
 * ## Lifecycle contract
 *
 * 1. Wait for `isReady` (the MapLibre `'load'` event has fired and the
 *    placeholder style is mounted). Until then the map cannot accept a
 *    `setStyle` call.
 * 2. Call `beginStyleChange(map)` to flip `isStyleReady` back to `false` so
 *    any dynamic layers that depend on the style unmount cleanly **before**
 *    the basemap module replaces every source/layer on the map. This step
 *    also returns an opaque `StyleChangeToken` that survives across
 *    overlapping style swaps (rapid basemap toggle, async retry).
 * 3. Apply the ArcGIS basemap; on success, call `markStyleReady(map, token)`
 *    which flips `isStyleReady` back to `true` and bumps `styleEpoch`.
 *    Subscribers re-key on `styleEpoch` so they re-add their sources/layers
 *    against the new style.
 *
 * ## StrictMode safety
 *
 * Effect cleanup aborts the in-flight `applyArcgisImageryWithLabels` via
 * `AbortController`. The helper short-circuits before `basemap.applyTo(map)`
 * if it observes the abort during its async `loadStyle()` phase, so a
 * superseded effect cannot `setStyle` an abandoned style on top of the
 * newer effect's basemap. Together with the helper's per-map operation
 * symbol + `myStyleApplied` guard, a superseded `style.load` cannot mark
 * the wrong style ready — see `apps/web/src/lib/arcgis.ts` header for the
 * full hazard analysis.
 *
 * The `AbortError` rejection from a cancelled run is intentionally
 * swallowed below so dev-mode StrictMode double-mounts do not produce
 * spurious console errors.
 */

import { useEffect } from 'react';
import { env } from '@/env';
import { beginStyleChange, markStyleReady } from '@/hooks/useMapInstance';
import { applyArcgisImageryWithLabels } from '@/lib/arcgis';
import { useMapContext } from './MapContext';

export function BasemapLayer() {
  const { map, isReady } = useMapContext();

  useEffect(() => {
    if (!map || !isReady) return;
    const token = beginStyleChange(map);
    if (token === null) return;

    const ac = new AbortController();
    applyArcgisImageryWithLabels(map, env.VITE_ESRI_API_KEY, ac.signal)
      .then(() => {
        markStyleReady(map, token);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('[BasemapLayer] failed to apply ArcGIS basemap', err);
        markStyleReady(map, token);
      });

    return () => {
      ac.abort();
    };
  }, [map, isReady]);

  return null;
}
