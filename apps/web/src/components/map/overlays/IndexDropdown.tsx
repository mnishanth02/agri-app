/**
 * Module 5.6 — `IndexDropdown`.
 *
 * Replaces the three-segment `IndexSwitcher`. A single dropdown trigger
 * that reads `[swatch] NDVI ▾`; opening reveals the three options with
 * an active checkmark. Width is < 100 px so the cluster stays compact
 * (see `docs/ui-ux-redesign.md` § R.B.1).
 *
 * Bound store unchanged: `useUiStore.selectedIndex` / `setSelectedIndex`.
 */

import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CHIP_FOCUS } from '@/lib/tokens';
import { cn } from '@/lib/utils';
import { useUiStore, type VegetationIndex } from '@/stores/useUiStore';

type IndexOption = {
  value: VegetationIndex;
  label: string;
  swatch: string;
};

const INDICES: ReadonlyArray<IndexOption> = [
  { value: 'NDVI', label: 'NDVI', swatch: 'bg-emerald-400' },
  { value: 'EVI', label: 'EVI', swatch: 'bg-emerald-300' },
  { value: 'NDWI', label: 'NDWI', swatch: 'bg-sky-400' },
];

function getSwatch(value: VegetationIndex): string {
  return INDICES.find((opt) => opt.value === value)?.swatch ?? 'bg-emerald-400';
}

export function IndexDropdown() {
  const selectedIndex = useUiStore((s) => s.selectedIndex);
  const setSelectedIndex = useUiStore((s) => s.setSelectedIndex);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Vegetation index: ${selectedIndex}`}
          className={cn(
            'inline-flex h-9 items-center gap-2 rounded-md px-2 font-medium text-sm text-white transition-colors',
            'hover:bg-white/10',
            CHIP_FOCUS,
          )}
        >
          <span aria-hidden="true" className={cn('size-2 rounded-sm', getSwatch(selectedIndex))} />
          <span>{selectedIndex}</span>
          <ChevronDownIcon aria-hidden="true" className="size-3.5 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="min-w-[10rem]">
        {INDICES.map((opt) => {
          const active = selectedIndex === opt.value;
          return (
            <DropdownMenuItem
              key={opt.value}
              aria-checked={active}
              onSelect={() => setSelectedIndex(opt.value)}
              className="flex items-center gap-2"
            >
              <span aria-hidden="true" className={cn('size-2 rounded-sm', opt.swatch)} />
              <span className="flex-1">{opt.label}</span>
              {active ? (
                <CheckIcon aria-hidden="true" className="size-3.5 text-emerald-400" />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
