/**
 * Module 5.6 — `OpacityPopover`.
 *
 * Replaces the always-visible `OpacitySlider` row inside the
 * `LayerControlCluster`. A single 36 × 36 icon button opens a popover
 * with the horizontal slider, end-cap labels, and a centred percent
 * readout (see `docs/ui-ux-redesign.md` § R.B.2).
 *
 * Bound store unchanged: `useUiStore.ndviOpacity` / `setNdviOpacity`.
 */

import { SlidersHorizontalIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CHIP_FOCUS } from '@/lib/tokens';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/useUiStore';

export function OpacityPopover() {
  const ndviOpacity = useUiStore((s) => s.ndviOpacity);
  const setNdviOpacity = useUiStore((s) => s.setNdviOpacity);

  const percent = Math.round(ndviOpacity * 100);

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Opacity (${percent}%)`}
              className={cn(
                'inline-flex size-9 items-center justify-center rounded-md text-white/85 transition-colors hover:bg-white/10 hover:text-white',
                CHIP_FOCUS,
              )}
            >
              <SlidersHorizontalIcon aria-hidden="true" className="size-4" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Opacity</TooltipContent>
      </Tooltip>
      <PopoverContent side="top" align="end" className="w-[240px] space-y-2">
        <div className="flex items-center justify-between text-white/70 text-xs">
          <span>Opacity</span>
          <span className="font-medium text-white tabular-nums">{percent}%</span>
        </div>
        <Slider
          aria-label="Opacity"
          min={0}
          max={1}
          step={0.05}
          value={[ndviOpacity]}
          onValueChange={(values) => {
            const next = values[0];
            if (typeof next === 'number') setNdviOpacity(next);
          }}
          className="w-full [&_[data-slot=slider-range]]:bg-white [&_[data-slot=slider-thumb]]:!border-white/80 [&_[data-slot=slider-thumb]]:!bg-white [&_[data-slot=slider-track]]:bg-white/20"
        />
        <div className="flex justify-between text-[10px] text-white/55">
          <span>0%</span>
          <span>100%</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
