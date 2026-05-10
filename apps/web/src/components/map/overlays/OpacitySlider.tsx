/**
 * Module 5.5 — `OpacitySlider`.
 *
 * Compact slider bound to `useUiStore.ndviOpacity` (0–1). Visual only
 * until **Phase 6** wires it to the NDVI raster's `raster-opacity`
 * paint property. Slot-class overrides re-skin the shadcn `Slider`
 * primitive for the dark frosted chrome.
 */

import { Slider } from '@/components/ui/slider';
import { useUiStore } from '@/stores/useUiStore';

export function OpacitySlider() {
  const ndviOpacity = useUiStore((s) => s.ndviOpacity);
  const setNdviOpacity = useUiStore((s) => s.setNdviOpacity);

  const percent = Math.round(ndviOpacity * 100);

  return (
    <div className="inline-flex items-center gap-2">
      <span aria-hidden="true" className="select-none text-white/70 text-xs">
        Opacity
      </span>
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
        className="w-32 [&_[data-slot=slider-range]]:bg-white [&_[data-slot=slider-thumb]]:!border-white/80 [&_[data-slot=slider-thumb]]:!bg-white [&_[data-slot=slider-track]]:bg-white/20"
      />
      <span className="w-10 select-none text-right text-white/85 text-xs tabular-nums">
        {percent}%
      </span>
    </div>
  );
}
