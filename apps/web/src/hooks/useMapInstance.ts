/**
 * Module 2.2 — `useMapInstance` (StrictMode-safe MapLibre lifecycle hook).
 *
 * Constructs exactly one live `maplibregl.Map` for the lifetime of a host
 * component and tears it down deterministically on unmount.
 *
 * ## StrictMode contract
 *
 * React's `<StrictMode>` intentionally runs an extra setup → cleanup → setup
 * cycle in development to flush effects with non-idempotent side effects. The
 * Module 2.2 requirement is **one live map after the final mount**, not
 * "exactly one constructor call" in dev. Each effect run owns its own map
 * instance (captured in the cleanup closure) and `map.remove()` always runs in
 * cleanup; the `mapRef` guard is defensive — it prevents a second constructor
 * call inside a single mount cycle, which React's contract already forbids.
 *
 * ## Style readiness contract — read this before adding dynamic layers
 *
 * MapLibre's `'load'` event only proves the WebGL canvas is mounted; it says
 * nothing about whether a *useful* style (sources + layers) has been applied.
 * The ArcGIS basemap (Module 2.4) and any future basemap toggles install their
 * style asynchronously via `BasemapStyle.applyStyle(...)`, which replaces every
 * source and layer on the map. Anything attached to `'load'` alone will
 * silently disappear when that swap happens.
 *
 * **All dynamic layers and drawing adapters — Field overlays, Terra Draw,
 * NDVI tiles, anything that calls `map.addSource` / `map.addLayer` — must
 * subscribe to `isStyleReady` and `styleEpoch`, never `isReady` alone.**
 * The canonical effect shape is:
 *
 * ```ts
 * useEffect(() => {
 *   if (!map || !isStyleReady) return;
 *   addLayers(map);
 *   return () => removeLayers(map);
 * }, [map, isStyleReady, styleEpoch]);
 * ```
 *
 * `styleEpoch` increments on every `markStyleReady(map)` call so subscribers
 * can distinguish "same style" from "style was swapped and re-applied."
 *
 * The `beginStyleChange` / `markStyleReady` helpers are exported as free
 * functions (not props on the return value) so basemap effects living next to
 * `<MapView>` can flip readiness without prop-drilling. They look the map
 * instance up in a module-level `WeakMap` registry; calls against an unknown
 * or removed map silently no-op.
 *
 * `beginStyleChange` returns an opaque `StyleChangeToken` that callers must
 * pass back to `markStyleReady`. The token guards against two failure modes:
 *
 * 1. **Double-bump within one generation.** Resolving on both `style.load`
 *    and the next `idle` would otherwise increment `styleEpoch` twice for a
 *    single style swap.
 * 2. **Stale completion across generations.** When two style changes overlap
 *    (rapid basemap toggle, or async retry), the first style's completion
 *    must not prematurely mark the second style ready before its sources and
 *    layers have actually loaded.
 */

import maplibregl, { type Map as MaplibreMap, type RequestTransformFunction } from 'maplibre-gl';
import { type RefObject, useEffect, useRef, useState } from 'react';

export type UseMapInstanceOptions = {
  center: [number, number];
  zoom: number;
  /**
   * Optional MapLibre `transformRequest` configured at construction time.
   * Phase 2 uses the default passthrough (`{ url }` for every URL). Module
   * 6.4 will pass a closure that reads a synchronous Clerk token ref and
   * appends `Authorization: Bearer ...` only to URLs starting with the
   * EOSDA render proxy — never call `getToken()` per tile request.
   */
  transformRequest?: RequestTransformFunction;
};

export type UseMapInstanceResult = {
  map: MaplibreMap | null;
  isReady: boolean;
  isStyleReady: boolean;
  styleEpoch: number;
};

type StyleControl = {
  setStyleReady: (ready: boolean) => void;
  bumpEpoch: () => void;
  // Generation counters shared between the WeakMap entry and the helpers.
  // `pending` is incremented on every `beginStyleChange` (the value returned
  // to the caller as a `StyleChangeToken`). `markStyleReady` only fires when
  // the caller's token equals the latest `pending` AND the same generation
  // has not already been marked ready — guarding against stale completions
  // from superseded style swaps and against double-bumps from callers that
  // resolve on both `style.load` and the next `idle`.
  pending: number;
  ready: number;
};

const styleControls = new WeakMap<MaplibreMap, StyleControl>();

const passthroughTransformRequest: RequestTransformFunction = (url) => ({ url });

/**
 * Opaque handle returned by `beginStyleChange` and required by
 * `markStyleReady`. Treat as an unforgeable token; do not depend on its
 * concrete shape.
 */
export type StyleChangeToken = number & { readonly __brand: unique symbol };

/**
 * Signal that an asynchronous style change is starting. Sets `isStyleReady`
 * back to `false` so dynamic layer effects unmount before the basemap module
 * tears down sources/layers, and returns a token that the caller must pass
 * to `markStyleReady` once the new style has finished loading.
 *
 * Returns `null` if the map is no longer registered (e.g., already torn
 * down). Callers should treat `null` as "abort, don't mark ready."
 */
export function beginStyleChange(map: MaplibreMap): StyleChangeToken | null {
  const ctrl = styleControls.get(map);
  if (!ctrl) return null;
  ctrl.pending += 1;
  ctrl.setStyleReady(false);
  return ctrl.pending as StyleChangeToken;
}

/**
 * Signal that the style change identified by `token` has finished loading.
 * No-ops if the map is unregistered, the token is stale (a newer
 * `beginStyleChange` superseded it), or the same token has already been
 * marked ready. Only the first valid call for a given token flips
 * `isStyleReady` and bumps `styleEpoch`.
 */
export function markStyleReady(map: MaplibreMap, token: StyleChangeToken): void {
  const ctrl = styleControls.get(map);
  if (!ctrl) return;
  if (token !== (ctrl.pending as StyleChangeToken)) return;
  if (ctrl.ready === ctrl.pending) return;
  ctrl.ready = ctrl.pending;
  ctrl.setStyleReady(true);
  ctrl.bumpEpoch();
}

export function useMapInstance(
  containerRef: RefObject<HTMLDivElement | null>,
  options: UseMapInstanceOptions,
): UseMapInstanceResult {
  const mapRef = useRef<MaplibreMap | null>(null);
  const [map, setMap] = useState<MaplibreMap | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isStyleReady, setIsStyleReady] = useState(false);
  const [styleEpoch, setStyleEpoch] = useState(0);

  // Snapshot construction-time options so prop changes after mount don't
  // tear down and recreate the map. Runtime updates must use map APIs
  // (`map.setCenter`, `map.flyTo`, etc.) on the returned instance.
  const initialOptionsRef = useRef(options);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (mapRef.current) return;

    const instance = new maplibregl.Map({
      container,
      center: initialOptionsRef.current.center,
      zoom: initialOptionsRef.current.zoom,
      // Empty but valid style: the basemap module installs the real style
      // after mount via `BasemapStyle.applyStyle`. Keeping `isStyleReady`
      // false until that swap completes prevents dynamic layers from
      // mounting against a placeholder style that's about to be replaced.
      style: { version: 8, sources: {}, layers: [] },
      transformRequest: initialOptionsRef.current.transformRequest ?? passthroughTransformRequest,
    });

    mapRef.current = instance;
    setMap(instance);

    styleControls.set(instance, {
      setStyleReady: setIsStyleReady,
      bumpEpoch: () => setStyleEpoch((n) => n + 1),
      pending: 0,
      ready: 0,
    });

    const handleLoad = () => setIsReady(true);
    instance.once('load', handleLoad);

    return () => {
      styleControls.delete(instance);
      instance.off('load', handleLoad);
      instance.remove();
      mapRef.current = null;
      setMap(null);
      setIsReady(false);
      setIsStyleReady(false);
      // styleEpoch is intentionally left monotonic across remounts: any
      // gating on `[map, isStyleReady, styleEpoch]` already keys on `map`
      // identity, so a stale epoch from a removed map cannot apply layers
      // to the new instance.
    };
  }, [containerRef]);

  return { map, isReady, isStyleReady, styleEpoch };
}
