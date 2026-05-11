/**
 * Module 5.7 — `AnalysisLayout`.
 *
 * Full-bleed analysis shell for `/fields/$id`: a single MapLibre canvas
 * fills the entire viewport (the `_auth` header is gated off on this
 * route), the basemap and persisted field polygon paint on top, and
 * edge-anchored chrome floats over the map. Implements the layout
 * described in `docs/ui-ux-redesign-v2.md` § 4.
 *
 * ## Edge-anchored chrome
 *
 * Top-left: `TopBar` chip · Top-right: `GetOverviewButton` +
 * `FieldSwitcherChip` · Left edge: `ZoomControls` + `FullscreenButton`
 * + `CloudHiddenToast` (stacked, `bottom` driven by the
 * `--bottom-dock-h` CSS variable) · Right edge: `RightSidebar` (single
 * growing chip, rail + optional inline pane on md+) · Bottom:
 * `BottomDock` (full-width drag-resizable dock, hosts the date
 * timeline + layer cluster directly above its tab bar so they stay
 * pinned to the dock edge regardless of expand state — Module 5.8).
 *
 * Nothing dodges the right pane; the dock + left chrome + sidebar
 * wrapper all read the same CSS variable so they reposition smoothly
 * (and live, while the user drags) without per-component selector
 * subscriptions.
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
import { BottomDock } from '@/components/shell/BottomDock';
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
      className="relative h-dvh w-full overflow-hidden bg-black"
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

          {/* left middle: scale bar, coords, zoom column, cloud toast */}
          <MapOverlays />

          {/* right edge — single growing chip (rail + optional inline pane on md+).
              `bottom` reads the `--bottom-dock-h` CSS variable that
              `BottomDock` publishes, so the rail tracks the dock's
              current height (collapsed, expanded, or mid-drag) without
              its own subscription. The fallback (`7.5rem`) covers the
              first paint before `BottomDock` has mounted its effect. */}
          <div
            className="dock-bottom-anchored pointer-events-auto absolute top-3 right-3 motion-safe:transition-[bottom] motion-safe:duration-200"
            style={{ bottom: 'calc(var(--bottom-dock-h, 7.5rem) + 0.75rem)' }}
          >
            <RightSidebar field={field} />
          </div>

          {/* bottom — full-width drag-resizable dock. Hosts the date
              timeline + layer cluster strip directly above its tab
              bar (Module 5.8) so they remain pinned to the dock
              regardless of expand state. */}
          <BottomDock field={field} />
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
    // - top 24 = no header, only the `top-3` chip envelope.
    // - right 96 = 64 px rail + 12 + 12 + 8 px breathing.
    // - bottom 152 = collapsed dock total (~120 px = 24 px handle +
    //   48 px timeline strip + 44 px tab bar + ~4 px borders) + 32 px
    //   safety. Sized for the collapsed dock; expansion is short and
    //   the user already knows their polygon.
    // - left 96 = symmetric with right; clears the 40 px zoom column.
    map.fitBounds(bounds, {
      padding: { top: 24, right: 96, bottom: 152, left: 96 },
      animate: false,
      maxZoom: 17,
    });
    lastFittedRef.current = bounds;
  }, [map, isReady, bounds]);

  return null;
}
