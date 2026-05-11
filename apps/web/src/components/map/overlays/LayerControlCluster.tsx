/**
 * Module 5.6 — `LayerControlCluster`.
 *
 * Bottom-right frosted chip that consolidates the former AnalysisToolbar,
 * SourceSwitcher, and DownloadButton into a single edge-anchored cluster.
 * Replaces the centred-top toolbar and the floating bottom-right source
 * chip with one chrome unit, freeing the map's centre line for the
 * `DateTimeline` (see `docs/ui-ux-redesign.md` § R.B.3 + R.C.3).
 *
 * ## Segments (left → right)
 *
 *   1. `SourceChip`       — disabled "Sentinel-2 ▾" segment.
 *   2. hairline           — vertical separator.
 *   3. `IndexDropdown`    — NDVI / EVI / NDWI dropdown.
 *   4. `OpacityPopover`   — icon-button → opacity popover.
 *   5. palette stub       — disabled, "coming soon".
 *   6. `DownloadButton`   — existing icon button.
 *   7. collapse chevron   — hides the cluster to a single `LayersIcon` puck.
 *
 * ## Responsive
 *
 * - `md+`: default expanded; the user's local toggle wins after first
 *   interaction.
 * - `<md`: default collapsed to a single `LayersIcon` puck. Clicking
 *   opens a `Popover` containing the same controls stacked vertically.
 */

import {
  ChevronDownIcon,
  ChevronRightIcon,
  LayersIcon,
  PaletteIcon,
  SatelliteIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { CHIP_BASE, CHIP_FOCUS } from '@/lib/tokens';
import { cn } from '@/lib/utils';
import { DownloadButton } from './DownloadButton';
import { IndexDropdown } from './IndexDropdown';
import { OpacityPopover } from './OpacityPopover';

function SourceChip() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-disabled="true"
          onClick={(event) => event.preventDefault()}
          className={cn(
            'inline-flex h-9 cursor-not-allowed items-center gap-2 rounded-md px-2 text-sm text-white/85 opacity-80',
            CHIP_FOCUS,
          )}
        >
          <SatelliteIcon aria-hidden="true" className="size-3.5 text-white/75" />
          <span>Sentinel-2</span>
          <ChevronDownIcon aria-hidden="true" className="size-3.5 opacity-70" />
          <span className="sr-only"> (coming soon)</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">Source switching coming soon…</TooltipContent>
    </Tooltip>
  );
}

function PaletteStub() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Palette (coming soon)"
          aria-disabled="true"
          onClick={(event) => event.preventDefault()}
          className={cn(
            'inline-flex size-9 cursor-not-allowed items-center justify-center rounded-md text-white/70 opacity-60 transition-colors hover:bg-white/10 hover:text-white',
            CHIP_FOCUS,
          )}
        >
          <PaletteIcon aria-hidden="true" className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">Palette coming soon…</TooltipContent>
    </Tooltip>
  );
}

function ControlsRow() {
  return (
    <>
      <SourceChip />
      <span aria-hidden="true" className="h-6 w-px bg-white/15" />
      <IndexDropdown />
      <OpacityPopover />
      <PaletteStub />
      <DownloadButton />
    </>
  );
}

function ControlsStack() {
  return (
    <div className="flex flex-col gap-2">
      <SourceChip />
      <span aria-hidden="true" className="h-px w-full bg-white/15" />
      <div className="flex items-center justify-between gap-2">
        <IndexDropdown />
        <OpacityPopover />
      </div>
      <div className="flex items-center justify-between gap-2">
        <PaletteStub />
        <DownloadButton />
      </div>
    </div>
  );
}

export function LayerControlCluster() {
  const isMd = useMediaQuery('(min-width: 768px)');
  // Local component state — `docs/ui-ux-redesign.md` § R.B.3 / § 12 keeps
  // this out of `useUiStore` until a UX requirement asks for persistence.
  const [expanded, setExpanded] = useState<boolean>(true);

  // Track viewport so that the default flips with breakpoint when the
  // user hasn't pinned it explicitly. We use a single `expanded` flag
  // plus a "touched" ref so a user toggle wins after first interaction.
  const [hasUserToggled, setHasUserToggled] = useState(false);
  useEffect(() => {
    if (hasUserToggled) return;
    setExpanded(isMd);
  }, [isMd, hasUserToggled]);

  const handleToggle = () => {
    setHasUserToggled(true);
    setExpanded((v) => !v);
  };

  // Below `md` the expanded body lives inside a `Popover`; on `md+` it
  // sits inline next to the puck. Module 5.7: positioning is owned by
  // the parent `BottomRow` — this component returns the chip / puck
  // directly.
  if (!isMd) {
    return (
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Layer controls"
                className={cn(
                  CHIP_BASE,
                  CHIP_FOCUS,
                  'pointer-events-auto inline-flex size-10 items-center justify-center transition-colors hover:bg-black/80',
                )}
              >
                <LayersIcon aria-hidden="true" className="size-4" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">Layer controls</TooltipContent>
        </Tooltip>
        <PopoverContent side="top" align="end" className="w-[260px]">
          <ControlsStack />
        </PopoverContent>
      </Popover>
    );
  }

  if (expanded) {
    return (
      <div
        className={cn(
          CHIP_BASE,
          'pointer-events-auto inline-flex h-10 max-w-[360px] items-center gap-1 px-2',
        )}
      >
        <ControlsRow />
        <span aria-hidden="true" className="h-6 w-px bg-white/15" />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Collapse layer controls"
              aria-pressed={expanded}
              onClick={handleToggle}
              className={cn(
                'inline-flex size-9 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white',
                CHIP_FOCUS,
              )}
            >
              <ChevronRightIcon aria-hidden="true" className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Collapse</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Expand layer controls"
          aria-pressed={expanded}
          onClick={handleToggle}
          className={cn(
            CHIP_BASE,
            CHIP_FOCUS,
            'pointer-events-auto inline-flex size-10 items-center justify-center transition-colors hover:bg-black/80',
          )}
        >
          <LayersIcon aria-hidden="true" className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">Layer controls</TooltipContent>
    </Tooltip>
  );
}
