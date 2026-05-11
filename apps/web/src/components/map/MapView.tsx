/**
 * Module 2.3 — `MapView` component.
 *
 * Owns the host DOM for a MapLibre instance and exposes the live
 * `useMapInstance` result via `MapContext` so overlay children can attach
 * sources, layers, and controls without prop drilling.
 *
 * ## DOM shape — wrapper around container
 *
 * MapLibre takes ownership of the container element it is given: it appends
 * its `<canvas>`, attribution, and control DOM as direct children and may
 * mutate that subtree at any time. React must not also reconcile children
 * into the same node, or the two reconcilers will fight (children disappear,
 * canvas gets unmounted, etc.). MapView therefore renders:
 *
 *   <div [user style/className] style="position: relative">      ← positioning context
 *     <div ref={containerRef} class="h-full w-full" />            ← MapLibre owns this
 *     {children}                                                  ← React owns these
 *   </div>
 *
 * The container is sized intrinsically (`h-full w-full`) rather than via
 * `absolute inset-0`, because MapLibre's `Map` constructor unconditionally
 * sets `style.position = "relative"` on the container element — and inline
 * styles win over Tailwind utilities. With `position: relative` overriding
 * `absolute`, the `inset-0` anchors no longer apply and the container
 * collapses to 0 height, leaving the canvas hidden and the map appearing
 * as a black void even though tiles are loading correctly. Sizing
 * intrinsically sidesteps that hijack entirely.
 *
 * Overlay children (BasemapLayer, future draw/NDVI overlays) are siblings of
 * the MapLibre container and absolutely positioned within the wrapper —
 * matching the overlay placement contract in plan.md §2.
 *
 * **Overlay convention (pointer-events).** Any visual overlay that visually
 * covers the map (full-bleed wrappers, decorative gradients, etc.) must set
 * `pointer-events: none` on its container and let interactive controls inside
 * opt back in with `pointer-events: auto` — otherwise the overlay will shadow
 * MapLibre's pan/zoom/click handlers across whatever area it covers. Effect-
 * only overlays like `BasemapLayer` that render no DOM are unaffected.
 *
 * ## Sizing contract
 *
 * `style` is a CSS-only sizing prop (height/width/etc.) — **not** a MapLibre
 * style spec. The parent must give MapView a concrete height; MapLibre needs
 * a non-zero `clientWidth` / `clientHeight` on the container element at
 * construction time to render anything.
 *
 * ## Snapshot semantics for `center` / `zoom`
 *
 * `useMapInstance` snapshots construction-time options on the first effect
 * run. Changing the `center` / `zoom` props after mount has no effect —
 * runtime camera updates must use `map.flyTo`, `map.setCenter`, etc. via the
 * context-provided `map` instance. This prevents form state changes in
 * sibling components from accidentally tearing down and recreating the map.
 */

import type { RequestTransformFunction } from 'maplibre-gl';
import { type CSSProperties, type ReactNode, useMemo, useRef } from 'react';
import { useMapInstance } from '@/hooks/useMapInstance';
import { MapContext, type MapContextValue } from './MapContext';

export type MapViewProps = {
  center: [number, number];
  zoom: number;
  children?: ReactNode;
  /** CSS sizing for the wrapper (height/width/etc.). NOT a MapLibre style. */
  style?: CSSProperties;
  className?: string;
  /**
   * MapLibre `transformRequest` configured at construction time. Module 6.4
   * passes a memoised closure that captures a Clerk-token ref so EOSDA
   * render-tile URLs gain `Authorization: Bearer ...` without re-creating
   * the map. Like `center` / `zoom`, this is snapshotted by `useMapInstance`
   * — pass a stable reference (e.g. via `useMemo`) and capture mutable
   * state through refs.
   */
  transformRequest?: RequestTransformFunction;
};

function omitPositionStyles(style: CSSProperties | undefined): CSSProperties {
  const safeStyle = { ...style };
  delete safeStyle.position;
  delete safeStyle.top;
  delete safeStyle.right;
  delete safeStyle.bottom;
  delete safeStyle.left;
  delete safeStyle.inset;
  return safeStyle;
}

export function MapView({
  center,
  zoom,
  children,
  style,
  className,
  transformRequest,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { map, isReady, isStyleReady, styleEpoch } = useMapInstance(containerRef, {
    center,
    zoom,
    // Conditional spread so `transformRequest: undefined` is never set
    // explicitly — `useMapInstance`'s options type uses
    // `exactOptionalPropertyTypes`, which rejects an explicit `undefined`
    // for an optional property. The hook supplies its own passthrough
    // default when the key is absent.
    ...(transformRequest ? { transformRequest } : {}),
  });
  const safeStyle = omitPositionStyles(style);

  const contextValue = useMemo<MapContextValue>(
    () => ({ map, isReady, isStyleReady, styleEpoch }),
    [map, isReady, isStyleReady, styleEpoch],
  );

  return (
    <MapContext.Provider value={contextValue}>
      <div className={className} style={{ ...safeStyle, position: 'relative' }}>
        <div ref={containerRef} className="h-full w-full" />
        {children}
      </div>
    </MapContext.Provider>
  );
}
