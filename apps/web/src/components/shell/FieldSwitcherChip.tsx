/**
 * Module 5.6 / 8.2 — `FieldSwitcherChip`.
 *
 * Hoisted out of `TopBar` so the chip can live in the top-right slot
 * alongside `GetOverviewButton`. Module 8.2 wires the chip to the
 * current field's rename + delete actions; cross-field switching is
 * still deferred (the closing disabled item keeps the affordance
 * honest).
 *
 * The Rename `Dialog` and Delete `AlertDialog` are rendered as
 * **siblings** of the dropdown (see `FieldSwitcherDialogs`) so the
 * dropdown's unmount when the menu closes does not also unmount the
 * dialog mid-mutation — same Radix-inside-Radix gotcha that
 * `FieldCard` solves the same way.
 */

import type { FieldDto } from '@viz-crop/shared';
import { ChevronDownIcon, LayersIcon, PencilIcon, TrashIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CHIP_BASE, CHIP_FOCUS } from '@/lib/tokens';
import { cn } from '@/lib/utils';
import { FieldDeleteAlert, FieldRenameDialog } from './FieldSwitcherDialogs';

const NAME_TRUNCATE = 24;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function FieldSwitcherChip({ field }: { field: FieldDto }) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              CHIP_BASE,
              CHIP_FOCUS,
              'h-10 gap-2 border-0 px-3 font-medium text-sm text-white hover:bg-black/80 hover:text-white dark:border-0 dark:bg-black/70 dark:hover:bg-black/80',
            )}
            aria-label={`Field actions for ${field.name}`}
          >
            <LayersIcon aria-hidden="true" className="size-4 text-white/70" />
            <span>All fields</span>
            <ChevronDownIcon aria-hidden="true" className="size-3.5 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8} className="w-56">
          <DropdownMenuLabel className="text-muted-foreground text-xs">
            This field
          </DropdownMenuLabel>
          <DropdownMenuLabel className="truncate font-medium text-sm">
            {truncate(field.name, NAME_TRUNCATE)}
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
            <PencilIcon className="size-4" aria-hidden="true" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
            <TrashIcon className="size-4" aria-hidden="true" />
            Delete
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled>Other fields coming soon…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <FieldRenameDialog field={field} open={renameOpen} onOpenChange={setRenameOpen} />
      <FieldDeleteAlert field={field} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </>
  );
}
