/**
 * Module 2.4 — ArcGIS basemap plugin wrapper.
 *
 * Bridges the `@esri/maplibre-arcgis` plugin's event-driven, fire-and-forget
 * `BasemapStyle.applyStyle` into a Promise that resolves only after MapLibre
 * has actually finished swapping in the new style (`style.load`), so the
 * `useMapInstance` style-change token can be marked ready against a stable
 * style.
 *
 * ## Style choice — "imagery with labels" (hybrid)
 *
 * Phase 2's goal is satellite imagery **plus** road and place labels. The
 * Esri Basemap Styles service docs designate `arcgis/imagery` as a
 * `complete` style: a base satellite imagery layer with an overlay of
 * place name labels and streets. (See the `complete` field on
 * `StylesItemSelf` at developers.arcgis.com/rest/basemap-styles/types/ —
 * the canonical example called out there is `arcgis/imagery`.)
 *
 * Do NOT use `arcgis/imagery/standard` — that path returns the imagery
 * base/detail layer *without* the labels overlay, so MapLibre receives a
 * label-free style and `findFirstSymbolLayerId` returns null. Likewise
 * `arcgis/imagery/labels` is labels-only and would need to be merged on
 * top of imagery manually.
 *
 * After the style applies, we sanity-check that the resolved style
 * actually contains at least one `symbol` layer (labels). If it does not
 * we `console.error` so a future Esri-side change to the style payload
 * surfaces loudly instead of silently shipping an unlabelled basemap.
 *
 * ## Esri attribution
 *
 * The plugin's `BasemapStyle` automatically installs its own
 * `AttributionControl` on `applyTo(map)` (see `BasemapStyle._setEsriAttribution`)
 * — we do not need to add one manually. Removing the map (Module 2.2 cleanup)
 * tears it down with everything else.
 *
 * ## Overlapping-operation safety (StrictMode + future basemap toggling)
 *
 * Two failure modes need to be defused when more than one basemap operation
 * targets the same map within a short window (React 19 StrictMode dev
 * double-mount, future rapid basemap toggles):
 *
 * 1. **Stale `applyTo` after cleanup.** If the caller aborted (effect
 *    cleanup) while we were still in the async `loadStyle()` phase, we must
 *    NOT call `basemap.applyTo(map)` afterwards — that would `setStyle` an
 *    abandoned style on top of whatever the next operation has applied.
 *    `AbortSignal` plus the `settled` guard handle this.
 *
 * 2. **Wrong-style `style.load` resolution.** A `style.load` event from a
 *    superseded operation's `setStyle` can fire while a newer operation's
 *    listener is already attached. The newer listener would resolve against
 *    the wrong style and bump `styleEpoch` for content the user is about
 *    to lose when the newer `setStyle` finally runs. Two guards prevent
 *    this:
 *      - A per-map `latestBasemapOp` symbol identifies the newest in-flight
 *        operation; listeners from older ops detach silently when their
 *        symbol no longer matches.
 *      - A per-op `myStyleApplied` flag is only flipped when *our*
 *        `applyTo` runs; until then, any `style.load` we receive must
 *        belong to a different op and we ignore it.
 */

import { BasemapStyle } from '@esri/maplibre-arcgis';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { findFirstSymbolLayerId } from './map-style';

const ARCGIS_HYBRID_STYLE = 'arcgis/imagery';

const latestBasemapOp = new WeakMap<MaplibreMap, symbol>();

/**
 * Applies the ArcGIS imagery-with-labels (hybrid) basemap to `map` and
 * resolves once the new style has finished loading on the map.
 *
 * Pass `signal` (typically from an `AbortController` owned by the calling
 * effect) to cancel an in-flight operation on cleanup; the returned promise
 * rejects with an `AbortError` and no further `setStyle` is invoked.
 *
 * The caller is responsible for the `useMapInstance` style-change token
 * dance (`beginStyleChange` before this call, `markStyleReady` after the
 * returned promise resolves).
 */
export function applyArcgisImageryWithLabels(
  map: MaplibreMap,
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
  }

  const myOp = Symbol('arcgis-basemap-op');
  latestBasemapOp.set(map, myOp);

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let myStyleApplied = false;

    const onAbort = () => {
      fail(signal?.reason ?? new DOMException('aborted', 'AbortError'));
    };

    const detach = () => {
      map.off('style.load', onStyleLoad);
      signal?.removeEventListener('abort', onAbort);
    };

    function onStyleLoad() {
      // Stale: a newer applyArcgisImageryWithLabels call superseded us.
      // Detach silently — the newer op owns this map's basemap lifecycle now.
      if (latestBasemapOp.get(map) !== myOp) {
        map.off('style.load', onStyleLoad);
        return;
      }
      // Our `applyTo` hasn't fired yet — this `style.load` belongs to a
      // prior (now-superseded) op whose `setStyle` got there first. Ignore
      // it and keep waiting for our own `style.load`.
      if (!myStyleApplied) return;
      if (settled) return;
      settled = true;
      detach();

      if (findFirstSymbolLayerId(map) === null) {
        console.error(
          `[arcgis] Applied basemap style "${ARCGIS_HYBRID_STYLE}" has no symbol layers — ` +
            'place/road labels will be missing. Verify VITE_ESRI_API_KEY has the basemaps ' +
            'privilege, or merge "arcgis/imagery/labels" over "arcgis/imagery" as a fallback.',
        );
      }
      resolve();
    }

    function fail(err: unknown) {
      if (settled) return;
      settled = true;
      detach();
      reject(err instanceof Error ? err : new Error(String(err)));
    }

    signal?.addEventListener('abort', onAbort);
    map.on('style.load', onStyleLoad);

    const basemap = new BasemapStyle({
      style: ARCGIS_HYBRID_STYLE,
      token,
    });

    basemap.on('BasemapStyleError', fail);

    basemap
      .loadStyle()
      .then(() => {
        if (settled) return;
        // Aborted or superseded mid-load — let the newer op apply its own
        // style and don't trample it with our now-stale one.
        if (latestBasemapOp.get(map) !== myOp) {
          fail(new DOMException('superseded', 'AbortError'));
          return;
        }
        myStyleApplied = true;
        basemap.applyTo(map);
      })
      .catch(fail);
  });
}
