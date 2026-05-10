/**
 * Module 5.5 — `AnalysisToolbar`.
 *
 * Top-center frosted bar that groups the index/opacity/download
 * controls into one piece of chrome between the `<TopBar>` and the map.
 * Mirrors the `<BottomBar>` sidebar dodge so the bar slides left on
 * `lg+` when the right sidebar pane is open.
 */

import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/useUiStore';
import { DownloadButton } from './DownloadButton';
import { IndexSwitcher } from './IndexSwitcher';
import { OpacitySlider } from './OpacitySlider';

export function AnalysisToolbar() {
  const sidebarPaneOpen = useUiStore((s) => s.activeSidebarItem !== null);

  return (
    <div
      className={cn(
        'pointer-events-auto absolute top-20 left-1/2 -translate-x-1/2',
        'motion-safe:transition-transform motion-safe:duration-200',
        sidebarPaneOpen && 'lg:[transform:translateX(calc(-50%_-_11rem))]',
      )}
    >
      <div className="inline-flex h-12 max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-md border border-white/10 bg-black/70 px-2 text-white shadow-lg backdrop-blur-md saturate-150">
        <IndexSwitcher />
        <span aria-hidden="true" className="h-6 w-px bg-white/15" />
        <OpacitySlider />
        <span aria-hidden="true" className="h-6 w-px bg-white/15" />
        <DownloadButton />
      </div>
    </div>
  );
}
