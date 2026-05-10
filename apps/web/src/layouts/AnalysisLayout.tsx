/**
 * Module 5.1 — `AnalysisLayout`.
 *
 * Full-bleed analysis shell for `/fields/$id`: a single MapLibre canvas
 * fills the viewport (minus the auth header), the basemap and persisted
 * field polygon paint on top, and three layout shells — `<TopBar />`,
 * `<RightSidebar />`, `<BottomBar />` — float over the map as absolutely
 * positioned siblings. Matches the screen anatomy described in
 * `docs/plan.md` § 2.
 *
 * ## Presentational only
 *
 * The route owns data fetching (`useField(id)`); this layout owns layout.
 * It receives the resolved `field: FieldDto` as a prop and does not call
 * any data hooks. That separation lets the route handle loading /
 * 404-redirect / error states without the layout having to model them.
 *
 * ## Sizing
 *
 * The auth layout (`routes/_auth/route.tsx`) renders a sticky `h-14`
 * (3.5rem) header above `<Outlet />`, so this layout pins itself to
 * `calc(100dvh - 3.5rem)` — same pattern as `CreateLayout` — so MapLibre
 * gets a deterministic non-zero `clientHeight` at construction time.
 *
 * ## Initial camera
 *
 * Construction-time `center` / `zoom` props on `<MapView>` are snapshotted
 * by `useMapInstance` on first effect run; later prop changes do not
 * re-center the map. We compute the polygon's bbox center as the initial
 * `center` and pick a generous zoom (14) that frames any plot from a
 * fraction of a hectare to a few hundred. Once the map mounts and the
 * polygon paints, `<FitToFieldBounds />` runs `map.fitBounds(...)` once
 * with padding so the polygon sits inside the visible map area, accounting
 * for the chrome overlays. We do this from a child of `<MapView>` so it
 * has access to the `MapContext` — see the JSDoc on `FitToFieldBounds`.
 *
 * ## Chrome positioning
 *
 * The three shell stubs live inside a single `pointer-events-none
 * absolute inset-0` overlay container (per the MapView overlay convention
 * documented in `MapView.tsx` — full-bleed chrome must not shadow
 * MapLibre's pan/zoom handlers). Each shell wraps its visible content in
 * a `pointer-events-auto` container so it remains interactive.
 */

import bbox from '@turf/bbox';
import type { FieldDto } from '@viz-crop/shared';
import { useEffect, useId, useMemo, useRef } from 'react';
import { BasemapLayer } from '@/components/map/BasemapLayer';
import { FieldLayer } from '@/components/map/FieldLayer';
import { useMapContext } from '@/components/map/MapContext';
import { MapView } from '@/components/map/MapView';
import { MapOverlays } from '@/components/map/overlays/MapOverlays';
import { BottomBar } from '@/components/shell/BottomBar';
import { RightSidebar } from '@/components/shell/RightSidebar';
import { TopBar } from '@/components/shell/TopBar';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/useUiStore';

/**
 * Initial zoom used as the construction-time prop for `<MapView>`. The
 * bbox-based `fitBounds` effect below will refine this on mount, so this
 * is purely a sensible fallback for the first few frames before MapLibre
 * is ready.
 */
const INITIAL_ZOOM = 14;

export type AnalysisLayoutProps = {
  field: FieldDto;
};

export function AnalysisLayout({ field }: AnalysisLayoutProps) {
  // Subscribe to the sidebar pane state so the bottom bar can dodge
  // left when the right sidebar is expanded — otherwise the centered
  // bar overlaps the pane on common laptop widths (< ~1392 px).
  const activeSidebarItem = useUiStore((s) => s.activeSidebarItem);
  const sidebarPaneOpen = activeSidebarItem !== null;

  // Generate a stable id for the field title heading so the surrounding
  // section can `aria-labelledby` it. We use `useId()` rather than a
  // hardcoded string both to satisfy Biome's `useUniqueElementIds`
  // rule and so the id remains unique if the layout is ever rendered
  // more than once on the same page.
  const fieldTitleId = useId();

  // Compute bbox + center once per polygon. `@turf/bbox` returns
  // `[minX, minY, maxX, maxY]` (lon/lat order, matching MapLibre).
  const { center, bounds } = useMemo(() => {
    const [minX, minY, maxX, maxY] = bbox(field.geometry);
    return {
      center: [(minX + maxX) / 2, (minY + maxY) / 2] as [number, number],
      bounds: [minX, minY, maxX, maxY] as [number, number, number, number],
    };
  }, [field.geometry]);

  return (
    <section
      aria-labelledby={fieldTitleId}
      className="relative h-[calc(100dvh-3.5rem)] w-full overflow-hidden bg-black"
    >
      <MapView center={center} zoom={INITIAL_ZOOM} className="h-full w-full">
        <BasemapLayer />
        <FieldLayer polygon={field.geometry} />
        <FitToFieldBounds bounds={bounds} />

        {/*
         * Chrome overlay container. `pointer-events-none` so the empty
         * gaps between shells let the user pan/zoom the map underneath;
         * each shell flips back to `pointer-events-auto` for its own
         * interactive surface.
         *
         * DOM order is deliberately: TopBar → MapOverlays → RightSidebar
         * → BottomBar. Tab traversal then visits TopBar (back arrow,
         * field title, CTAs) → AnalysisToolbar (the screen's primary
         * NDVI/EVI/NDWI control) → RightSidebar pane → BottomBar →
         * remaining bottom-corner overlays. AnalysisToolbar comes second
         * because it is the live overlay control and reaching it before
         * RightSidebar's coming-soon stubs matches its product priority.
         */}
        <div className="pointer-events-none absolute inset-0">
          {/*
           * TopBar mirrors the BottomBar dodge so the page's central
           * spine stays aligned (TopBar — AnalysisToolbar — DateTimeline —
           * BottomBar all shift together when the sidebar pane opens).
           */}
          <div
            className={cn(
              'pointer-events-auto absolute top-3 left-1/2 -translate-x-1/2',
              'motion-safe:transition-transform motion-safe:duration-200',
              sidebarPaneOpen && 'lg:[transform:translateX(calc(-50%_-_11rem))]',
            )}
          >
            <TopBar field={field} titleId={fieldTitleId} />
          </div>

          {/*
           * Module 5.5 — map overlay controls. Each overlay self-positions
           * absolutely inside this container and opts back into pointer
           * events on its interactive surface. See `MapOverlays.tsx`.
           * Rendered before RightSidebar so AnalysisToolbar lands in tab
           * order immediately after TopBar.
           */}
          <MapOverlays />

          {/*
           * RightSidebar anchors the full vertical space on the right
           * edge (with a small margin from the chrome) so its rail can
           * always be reached and its expanded pane has room to breathe.
           * The component owns its own width animation between the
           * 64 px collapsed rail and the ~364 px expanded rail+pane.
           */}
          <div className="pointer-events-auto absolute top-3 right-3 bottom-3">
            <RightSidebar field={field} />
          </div>

          {/*
           * BottomBar is centered horizontally over the map. When the
           * RightSidebar pane is expanded (~364 px wide on the right),
           * shift the bar left by ~192 px on `lg+` so its right edge
           * stops clear of the pane even on the narrowest 1024 px lg
           * viewport (the 11 rem dodge used elsewhere is too small at
           * the breakpoint where the dodge first engages). The transition
           * keeps the shift smooth as the user toggles the sidebar.
           */}
          <div
            className={cn(
              'pointer-events-auto absolute bottom-3 left-1/2 -translate-x-1/2',
              'motion-safe:transition-transform motion-safe:duration-200',
              sidebarPaneOpen && 'lg:[transform:translateX(calc(-50%_-_12rem))]',
            )}
          >
            <BottomBar field={field} />
          </div>
        </div>
      </MapView>
    </section>
  );
}

/**
 * Effect-only child of `<MapView>` that fits the camera to the field's
 * bounding box exactly once per `bounds` identity. Lives inside `<MapView>`
 * so it can read the live map instance from `MapContext`.
 *
 * Why a separate component (instead of an effect at the layout level):
 * the `MapContext` provider is rendered by `<MapView>`, so any consumer
 * must be its descendant.
 *
 * Why gate on `isReady` (and not `isStyleReady`): `fitBounds` only needs
 * a live MapLibre instance — it does not touch sources or layers, so it
 * doesn't have to wait for the ArcGIS basemap swap to land. Running as
 * soon as `'load'` fires keeps the camera correct from the first paint
 * and avoids a visible "snap" after the basemap arrives.
 */
function FitToFieldBounds({ bounds }: { bounds: [number, number, number, number] }) {
  const { map, isReady } = useMapContext();
  const lastFittedRef = useRef<[number, number, number, number] | null>(null);

  useEffect(() => {
    if (!map || !isReady) return;
    // Skip if we've already fitted to these exact bounds (StrictMode
    // double-effect, or an unrelated re-render that produced the same
    // bbox tuple).
    const last = lastFittedRef.current;
    if (
      last &&
      last[0] === bounds[0] &&
      last[1] === bounds[1] &&
      last[2] === bounds[2] &&
      last[3] === bounds[3]
    ) {
      return;
    }
    // Pad for the chrome overlays so the polygon doesn't sit underneath
    // them on first fit. Defaults of `useUiStore` open both shells:
    //   - TopBar (~56 px) → top
    //   - RightSidebar pane (~364 px) → right
    //   - BottomBar (~320 px expanded) → bottom
    // Module 5.5 may revisit if new overlays push content further.
    map.fitBounds(bounds, {
      padding: { top: 72, right: 380, bottom: 336, left: 80 },
      animate: false,
      maxZoom: 17,
    });
    lastFittedRef.current = bounds;
  }, [map, isReady, bounds]);

  return null;
}
