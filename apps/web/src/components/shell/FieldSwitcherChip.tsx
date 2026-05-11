/**
 * Module 5.6 — `FieldSwitcherChip`.
 *
 * Hoisted out of `TopBar` so the chip can live in the top-right slot
 * alongside `GetOverviewButton`. Same disabled placeholder semantics as
 * before — a real `DropdownMenu` that opens to a single disabled item,
 * signalling the affordance without claiming a feature that doesn't
 * exist yet.
 */

import { ChevronDownIcon, LayersIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CHIP_BASE, CHIP_FOCUS } from '@/lib/tokens';
import { cn } from '@/lib/utils';

export function FieldSwitcherChip() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            CHIP_BASE,
            CHIP_FOCUS,
            'h-10 gap-2 border-0 px-3 font-medium text-sm text-white hover:bg-black/80 hover:text-white dark:border-0 dark:bg-black/70 dark:hover:bg-black/80',
          )}
        >
          <LayersIcon aria-hidden="true" className="size-4 text-white/70" />
          <span>All fields</span>
          <ChevronDownIcon aria-hidden="true" className="size-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8}>
        <DropdownMenuLabel className="text-muted-foreground text-xs">Your fields</DropdownMenuLabel>
        <DropdownMenuItem disabled>Field switching is coming soon…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
