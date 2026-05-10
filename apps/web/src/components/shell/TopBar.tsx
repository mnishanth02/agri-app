/**
 * Module 5.2 — `TopBar`.
 *
 * Floating chip-style top bar that sits centred above the analysis map.
 * Implements the anatomy listed in `docs/plan.md` § 2 ("Top bar"):
 * back arrow → `/`, field icon, field name, area in ha, crop type,
 * "Get overview" CTA, "All fields ▾" placeholder dropdown.
 *
 * ## Visual language
 *
 * The bar floats over the satellite basemap, so it uses a dark frosted
 * surface (`bg-black/70` + `backdrop-blur-md saturate-150` + a faint
 * white hairline) with light-on-dark text. Width is intrinsic — the
 * parent layout applies `left-1/2 -translate-x-1/2` to keep the chip
 * centred and shifts it left in lockstep with the BottomBar /
 * AnalysisToolbar / DateTimeline when the right sidebar pane opens.
 *
 * ## Stub controls
 *
 * Per the v2 spec, "Get overview" and "All fields" are explicit
 * placeholders:
 *
 * - **Get overview**: rendered as a normal-looking primary button so
 *   it reads as the screen's main CTA, but with `aria-disabled="true"`
 *   wrapped in a Radix Tooltip ("Get overview coming soon…") and no
 *   real `onClick` — clicking is a no-op rather than throwing or
 *   navigating.
 * - **All fields**: a real `DropdownMenu` that opens, but contains a
 *   single disabled item ("Switching coming soon"). This signals the
 *   affordance without breaking when users discover it.
 *
 * Wiring lives outside this file — TopBar is purely presentational and
 * receives the resolved `field: FieldDto` from `AnalysisLayout`.
 */

import { Link } from '@tanstack/react-router';
import type { FieldDto } from '@viz-crop/shared';
import { ArrowLeftIcon, ChevronDownIcon, MapPinIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export type TopBarProps = {
  field: FieldDto;
  /**
   * DOM id applied to the field-name `<h1>`. The parent layout's
   * `<section aria-labelledby={...}>` references it so the analysis
   * region announces the field name.
   */
  titleId: string;
};

const HECTARES_FORMATTER = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function TopBar({ field, titleId }: TopBarProps) {
  const hasArea = field.areaHectares !== null;
  const areaLabel = hasArea
    ? `${HECTARES_FORMATTER.format(field.areaHectares as number)}\u00A0ha`
    : '—';

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-12 w-auto max-w-[calc(100vw-1.5rem)] items-center gap-3 rounded-full border border-white/10 bg-black/70 pr-1.5 pl-2 text-white shadow-lg backdrop-blur-md saturate-150">
        <Link
          to="/"
          aria-label="Back to your fields"
          className="inline-flex size-9 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/70"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
        </Link>

        <div className="flex min-w-0 items-center gap-2">
          <MapPinIcon aria-hidden="true" className="size-4 shrink-0 text-white/60" />
          {/*
           * Page-level h1: the field name is the screen's primary
           * subject, so it owns the document outline. Default browser h1
           * margins are reset via `m-0` so the heading sits inline within
           * the chip.
           */}
          <h1
            id={titleId}
            className="m-0 min-w-0 max-w-[clamp(8rem,40vw,18rem)] truncate font-semibold text-base text-white tracking-tight"
            title={field.name}
          >
            {field.name}
          </h1>
          <span aria-hidden="true" className="text-white/30">
            ·
          </span>
          {hasArea ? (
            <span className="whitespace-nowrap text-white/85 text-xs tabular-nums">
              {areaLabel}
            </span>
          ) : (
            <>
              <span className="sr-only">Area unavailable</span>
              <span aria-hidden="true" className="text-white/60 text-xs">
                —
              </span>
            </>
          )}
        </div>

        <span className="hidden whitespace-nowrap rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-white text-xs sm:inline-flex">
          {field.cropType}
        </span>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="default"
              aria-disabled="true"
              onClick={(event) => event.preventDefault()}
              className="h-9 cursor-not-allowed rounded-full opacity-60 hover:bg-primary focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/70"
            >
              Get overview
              <span className="sr-only"> (coming soon)</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Get overview coming soon…</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="h-9 rounded-full border-white/20 bg-white/10 text-white hover:bg-white/15 hover:text-white focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/70 dark:border-white/20 dark:bg-white/10 dark:hover:bg-white/15"
            >
              All fields
              <ChevronDownIcon aria-hidden="true" className="size-3.5 opacity-80" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8}>
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Your fields
            </DropdownMenuLabel>
            <DropdownMenuItem disabled>Field switching is coming soon…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </TooltipProvider>
  );
}
