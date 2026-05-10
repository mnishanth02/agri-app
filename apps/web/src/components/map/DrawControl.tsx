/**
 * Module 3.2 — `DrawControl`.
 *
 * Toolbar overlay child of `<MapView>` that drives the `useFieldDrawing`
 * hook. Renders two buttons in the top-right corner of the map:
 *
 *   - **Draw** — toggles polygon-mode on/off via `start()` / `stop()`.
 *     `aria-pressed` mirrors `isDrawing` and the button uses the filled
 *     `default` variant when active so the active state is visible
 *     against the satellite basemap. Disabled until the adapter is ready.
 *
 *   - **Clear** — calls `clear()` to discard the in-progress polygon and
 *     reset `useFieldStore`'s draft slice. Disabled when there's nothing
 *     to clear (no draft polygon AND not currently drawing).
 *
 * ## Why subscribe to `draftPolygon` here
 *
 * The Clear button's enabled state is derived from "is there a draft to
 * clear?" — that's the polygon slice in `useFieldStore`. Subscribing with
 * a single-field selector keeps re-renders limited to actual draft
 * transitions (null ↔ Polygon), not every area tick from the live
 * `change` handler.
 *
 * ## Pointer events
 *
 * Per the `<MapView>` overlay convention (MapView.tsx:34-39), interactive
 * controls inside an overlay must opt back in with `pointer-events-auto`
 * so clicks reach the buttons even if a parent overlay sets
 * `pointer-events: none`. This toolbar is small enough that the rest of
 * the map remains pannable around it.
 */

import { Button } from '@/components/ui/button';
import { useFieldDrawing } from '@/hooks/useFieldDrawing';
import { useFieldStore } from '@/stores/useFieldStore';

export function DrawControl() {
  const { isReady, isDrawing, start, stop, clear } = useFieldDrawing();
  const hasDraft = useFieldStore((s) => s.draftPolygon !== null);

  const handleToggleDraw = () => {
    if (isDrawing) stop();
    else start();
  };

  const clearDisabled = !isReady || (!hasDraft && !isDrawing);

  return (
    <div className="pointer-events-auto absolute top-3 right-3 z-10 flex gap-2">
      <Button
        type="button"
        size="sm"
        variant={isDrawing ? 'default' : 'outline'}
        aria-pressed={isDrawing}
        disabled={!isReady}
        onClick={handleToggleDraw}
      >
        {isDrawing ? 'Drawing…' : 'Draw'}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={clearDisabled} onClick={clear}>
        Clear
      </Button>
    </div>
  );
}
