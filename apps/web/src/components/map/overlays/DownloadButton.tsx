/**
 * Module 5.5 — `DownloadButton` (disabled stub).
 *
 * Icon-only ghost button that signals a future "Download current scene"
 * affordance. Same disabled-but-keyboard-reachable + tooltip pattern as
 * `<SourceSwitcher>`.
 */

import { DownloadIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function DownloadButton() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Download (coming soon)"
          aria-disabled="true"
          onClick={(event) => event.preventDefault()}
          className="inline-flex size-9 cursor-not-allowed items-center justify-center rounded-md text-white/70 opacity-60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/70"
        >
          <DownloadIcon aria-hidden="true" className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">Download coming soon…</TooltipContent>
    </Tooltip>
  );
}
