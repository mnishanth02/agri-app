/**
 * Module 5.6 — `MapOverlays`.
 *
 * Wrapper that mounts every map overlay control inside the
 * `<AnalysisLayout>` chrome container. Each child is itself absolutely
 * positioned and opts into pointer events on its interactive surface —
 * the wrapper deliberately renders no DOM of its own.
 *
 * Children must be rendered inside a `<MapView>` so the ones that read
 * the live MapLibre instance (`CoordsBadge`, `ScaleBar`, `ZoomControls`,
 * `FullscreenButton`) can call `useMapContext()`. Tooltips/Popovers
 * rely on the app-wide `<TooltipProvider>` mounted in `routes/__root.tsx`.
 */

import { CloudHiddenToast } from './CloudHiddenToast';
import { CoordsBadge } from './CoordsBadge';
import { DateTimeline } from './DateTimeline';
import { FullscreenButton } from './FullscreenButton';
import { LayerControlCluster } from './LayerControlCluster';
import { ScaleBar } from './ScaleBar';
import { ZoomControls } from './ZoomControls';

export function MapOverlays() {
  return (
    <>
      <CoordsBadge />
      <ScaleBar />
      <ZoomControls />
      <FullscreenButton />
      <DateTimeline />
      <CloudHiddenToast />
      <LayerControlCluster />
    </>
  );
}
