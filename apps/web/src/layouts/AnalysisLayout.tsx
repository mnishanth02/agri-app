/**
 * Module 5.6 — `AnalysisLayout`.
 *
 * Full-bleed analysis shell for `/fields/$id`: a single MapLibre canvas
 * fills the viewport (minus the auth header), the basemap and persisted
 * field polygon paint on top, and edge-anchored chrome floats over the
 * map. Implements the layout described in `docs/ui-ux-redesign.md` § 3.
 *
 * ## Edge-anchored chrome
 *
 * Top-left: `TopBar` chip · Top-right: `GetOverviewButton` +
 * `FieldSwitcherChip` · Left middle: `ZoomControls` + `FullscreenButton`
 * (via `MapOverlays`) · Right edge: `RightSidebar` rail (+ optional
 * inline pane on md+) · Bottom-centre: `DateTimeline` · Bottom-left:
 * `BottomBar` tray · Bottom-right: `LayerControlCluster`.
 *
 * Nothing dodges: opening the right pane never repositions any other
 * shell. The pane overlays the map; other shells stay put.
 *
 * ## Responsive default (D3)
 *
 * On first mount we collapse `useUiStore.activeSidebarItem` to `null`
 * when the viewport is `<lg`, so the map is the hero on narrow screens.
 * The effect is one-shot via `hasInitialisedRef` so it never overrides
 * a user-driven toggle.
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
import { FieldSwitcherChip } from '@/components/shell/FieldSwitcherChip';
import { GetOverviewButton } from '@/components/shell/GetOverviewButton';
import { RightSidebar } from '@/components/shell/RightSidebar';
import { TopBar } from '@/components/shell/TopBar';
import { useUiStore } from '@/stores/useUiStore';

const INITIAL_ZOOM = 14;

export type AnalysisLayoutProps = {
  field: FieldDto;
};

export function AnalysisLayout({ field }: AnalysisLayoutProps) {
  const setActiveSidebarItem = useUiStore((s) => s.setActiveSidebarItem);
  const hasInitialisedRef = useRef(false);

  // D3 — one-shot initial paint: collapse the sidebar on narrow viewports
  // so the map is the hero. After this fires the user owns the state.
  useEffect(() => {
    if (hasInitialisedRef.current) return;
    hasInitialisedRef.current = true;
    if (typeof window === 'undefined') return;
    const isNarrow = window.matchMedia('(max-width: 1023px)').matches;
    if (isNarrow) setActiveSidebarItem(null);
  }, [setActiveSidebarItem]);

  const fieldTitleId = useId();

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

        <div className="pointer-events-none absolute inset-0">
          {/* top-left */}
          <div className="pointer-events-auto absolute top-3 left-3">
            <TopBar field={field} titleId={fieldTitleId} />
          </div>

          {/* top-right — clears the 64 px right rail at right-3 */}
          <div className="pointer-events-auto absolute top-3 right-20 flex items-center gap-2">
            <GetOverviewButton />
            <FieldSwitcherChip />
          </div>

          {/* left middle, scale bar, coords, date timeline, cloud toast, layer cluster */}
          <MapOverlays />

          {/* right edge — rail + optional inline pane on md+ */}
          <div className="pointer-events-auto absolute top-3 right-3 bottom-3">
            <RightSidebar field={field} />
          </div>

          {/* bottom-left tray */}
          <div className="pointer-events-auto absolute bottom-3 left-3">
            <BottomBar field={field} />
          </div>
        </div>
      </MapView>
    </section>
  );
}

function FitToFieldBounds({ bounds }: { bounds: [number, number, number, number] }) {
  const { map, isReady } = useMapContext();
  const lastFittedRef = useRef<[number, number, number, number] | null>(null);

  useEffect(() => {
    if (!map || !isReady) return;
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
    // Padding clears the new edge-anchored chrome envelope:
    // - top 64 = 40 px TopBar + 12 px margin + 12 px breathing room
    // - right 88 = 64 px rail + 12 px margin + 12 px breathing room
    //   (the optional pane *overlays* and is not factored in)
    // - bottom 96 = 36 px DateTimeline + 36 px collapsed tray + 24 px
    // - left 88 = symmetric with right; clears the 40 px zoom column
    map.fitBounds(bounds, {
      padding: { top: 64, right: 88, bottom: 96, left: 88 },
      animate: false,
      maxZoom: 17,
    });
    lastFittedRef.current = bounds;
  }, [map, isReady, bounds]);

  return null;
}
