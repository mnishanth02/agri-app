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
 *
 * Module 6.5 — accepts a `fieldId` prop and forwards it to
 * `<CloudHiddenToast>` so the toast can subscribe to the per-field
 * `useEosdaScenes` query and show the live "X scenes hidden by cloud
 * cover" count. The prop chain is kept shallow and explicit rather
 * than introducing a Context (only one consumer needs the field).
 */

import { CloudHiddenToast } from './CloudHiddenToast';
import { CoordsBadge } from './CoordsBadge';
import { FullscreenButton } from './FullscreenButton';
import { ScaleBar } from './ScaleBar';
import { ZoomControls } from './ZoomControls';

export type MapOverlaysProps = {
  fieldId: string;
};

export function MapOverlays({ fieldId }: MapOverlaysProps) {
  return (
    <>
      <CoordsBadge />
      <ScaleBar />
      <ZoomControls />
      <FullscreenButton />
      <CloudHiddenToast fieldId={fieldId} />
    </>
  );
}
