/**
 * Module 5.5 — `SourceSwitcher` (disabled stub).
 *
 * Bottom-right "Sentinel-2 ▾" chip that LOOKS like a dropdown trigger
 * but is `aria-disabled` — same disabled-but-keyboard-reachable pattern
 * as `<TopBar>`'s "Get overview" CTA. Future imagery sources (Landsat,
 * PlanetScope, etc.) would expand this into a real dropdown.
 */

import { ChevronDownIcon, SatelliteIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/useUiStore';

export function SourceSwitcher() {
  const sidebarPaneOpen = useUiStore((s) => s.activeSidebarItem !== null);
  const bottomExpanded = useUiStore((s) => s.bottomBarTab !== null);

  return (
    <div
      className={cn(
        // Base `right-20` clears the collapsed RightSidebar rail (which
        // sits at `right-3` with `w-16`); `lg:right-[25rem]` slides
        // further left when the pane is open so the chip never paints
        // over the pane content. Bottom offset mirrors DateTimeline so
        // it stays clear of the BottomBar in both collapsed and
        // expanded states.
        'pointer-events-auto absolute right-20',
        'motion-safe:transition-[bottom,right] motion-safe:duration-200',
        bottomExpanded ? 'bottom-[22rem]' : 'bottom-20',
        sidebarPaneOpen && 'lg:right-[25rem]',
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-disabled="true"
            onClick={(event) => event.preventDefault()}
            className="inline-flex h-9 cursor-not-allowed items-center gap-2 rounded-md border border-white/10 bg-black/70 px-3 text-sm text-white opacity-60 shadow-lg backdrop-blur-md saturate-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/70"
          >
            <SatelliteIcon aria-hidden="true" className="size-3.5 text-white/75" />
            <span>Sentinel-2</span>
            <ChevronDownIcon aria-hidden="true" className="size-3.5 opacity-70" />
            <span className="sr-only"> (coming soon)</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Source switching coming soon…</TooltipContent>
      </Tooltip>
    </div>
  );
}
