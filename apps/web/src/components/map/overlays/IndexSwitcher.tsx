/**
 * Module 5.5 — `IndexSwitcher`.
 *
 * Three-segment toggle (NDVI / EVI / NDWI) bound to
 * `useUiStore.selectedIndex`. The visual change is decorative until
 * **Phase 6** swaps the actual NDVI raster source on selection.
 *
 * ## a11y
 *
 * Implemented as a `role="group"` with each option as a toggle button
 * carrying `aria-pressed`. (We deliberately avoid `role="radiogroup"` /
 * `role="radio"` on `<button>` elements — Biome's
 * `useSemanticElements` rule routes ARIA radio semantics to native
 * `<input type="radio">`. The pressed-button pattern is the standard
 * fallback for visually segmented controls and is what shadcn's
 * ToggleGroup primitive uses internally.)
 */

import { cn } from '@/lib/utils';
import { useUiStore, type VegetationIndex } from '@/stores/useUiStore';

const INDICES: ReadonlyArray<{ value: VegetationIndex; label: string }> = [
  { value: 'NDVI', label: 'NDVI' },
  { value: 'EVI', label: 'EVI' },
  { value: 'NDWI', label: 'NDWI' },
];

export function IndexSwitcher() {
  const selectedIndex = useUiStore((s) => s.selectedIndex);
  const setSelectedIndex = useUiStore((s) => s.setSelectedIndex);

  return (
    <fieldset className="m-0 inline-flex min-w-0 items-center gap-1 border-0 p-0">
      <legend className="sr-only">Vegetation index</legend>
      {INDICES.map((opt) => {
        const active = selectedIndex === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => setSelectedIndex(opt.value)}
            className={cn(
              'inline-flex h-9 items-center rounded-md px-3 font-medium text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/70',
              active
                ? 'bg-emerald-400/20 text-emerald-50 ring-1 ring-inset ring-emerald-300/40'
                : 'text-white/70 hover:bg-white/5 hover:text-white',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </fieldset>
  );
}
