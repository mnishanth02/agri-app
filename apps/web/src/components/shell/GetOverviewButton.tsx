/**
 * Module 5.6 — `GetOverviewButton`.
 *
 * Sparkle icon button that signals the future "Get overview" affordance.
 * Demoted from a primary CTA in the TopBar to a 40 × 40 icon button in
 * the top-right slot (see `docs/ui-ux-redesign.md` § D1). Same
 * disabled-but-keyboard-reachable + tooltip pattern as the rest of the
 * placeholder controls on this screen.
 */

import { SparklesIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CHIP_BASE, CHIP_FOCUS } from '@/lib/tokens';
import { cn } from '@/lib/utils';

export function GetOverviewButton() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Get overview (coming soon)"
          aria-disabled="true"
          onClick={(event) => event.preventDefault()}
          className={cn(
            CHIP_BASE,
            CHIP_FOCUS,
            'inline-flex h-10 w-10 cursor-not-allowed items-center justify-center opacity-80 transition-colors hover:bg-black/80',
          )}
        >
          <SparklesIcon aria-hidden="true" className="size-4 text-emerald-200" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Get overview coming soon…</TooltipContent>
    </Tooltip>
  );
}
