/**
 * Module 5.5 — `MapOverlays`.
 *
 * Wrapper that mounts every map overlay control inside the
 * `<AnalysisLayout>` chrome container (`pointer-events-none absolute
 * inset-0`). Each child is itself absolutely positioned and opts into
 * pointer events on its interactive surface — the wrapper deliberately
 * renders no DOM of its own so positioning is fully owned by the
 * overlays.
 *
 * Children must be rendered inside a `<MapView>` so the ones that read
 * the live MapLibre instance (`CoordsBadge`, `ScaleBar`, `ZoomControls`,
 * `FullscreenButton`) can call `useMapContext()`.
 */

import { TooltipProvider } from '@/components/ui/tooltip';
import { AnalysisToolbar } from './AnalysisToolbar';
import { CloudHiddenToast } from './CloudHiddenToast';
import { CoordsBadge } from './CoordsBadge';
import { DateTimeline } from './DateTimeline';
import { FullscreenButton } from './FullscreenButton';
import { ScaleBar } from './ScaleBar';
import { SourceSwitcher } from './SourceSwitcher';
import { ZoomControls } from './ZoomControls';

export function MapOverlays() {
  // Local TooltipProvider so disabled stubs (`SourceSwitcher`,
  // `DownloadButton`) and other tooltip consumers inside the overlay
  // tree have a Radix provider in scope. The other shells own their
  // own providers, so adding one at the app root would be redundant.
  return (
    <TooltipProvider delayDuration={300}>
      <CoordsBadge />
      <ScaleBar />
      <ZoomControls />
      <FullscreenButton />
      <AnalysisToolbar />
      <DateTimeline />
      <CloudHiddenToast />
      <SourceSwitcher />
    </TooltipProvider>
  );
}
