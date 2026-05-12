/**
 * Module 6.5 — `DateTimeline` (data-bound).
 *
 * Horizontal strip of date chips driven by `useEosdaScenes(fieldId)`
 * (Module 6.2). Each chip represents the BEST scene for one acquisition
 * date — selection logic lives in `@/lib/scene-helpers.bestPerDate` so
 * the timeline, the auto-select hook, and `CloudHiddenToast` all agree
 * on what "best" means and which date wins. Clicking a chip writes
 * `selectedViewId` to `useUiStore`; `<NdviLayer>` (Module 6.4) reacts
 * by swapping its raster source.
 *
 * ## Cloudy filter behaviour
 *
 * `useUiStore.showCloudyScenes` (default `false`) hides best-per-date
 * scenes whose `cloudPercent > 50`. The currently selected chip is
 * ALWAYS rendered even if it is cloudy and the toggle is off
 * (rubber-duck #8 in the Module 6.5 plan — never hide the active
 * selection or the user can't tell what they're looking at). Because
 * the auto-select hook now also picks from `bestPerDate(scenes)` the
 * default selection is guaranteed to have a chip; the
 * force-render-active path remains for the case where the user
 * manually clicks a cloudy chip while `showCloudyScenes=true` and then
 * toggles the filter off.
 *
 * The `CloudHiddenToast` sibling surfaces the hidden count and the
 * "Show all" affordance; this component also exposes a small "Show /
 * Hide cloudy" toggle on the right end of the strip. The toggle remains
 * icon-visible below `sm` so mobile users still have an affordance after
 * dismissing the toast.
 *
 * ## Accessibility
 *
 * The chip strip is `role="toolbar"` (the existing visual stub already
 * used this and it matches Biome's lint expectations for non-input
 * radio replacements); each chip is a `<button>` with `aria-pressed`
 * reflecting the `selectedViewId === bestForDate.viewId` predicate.
 * Cloudy state is communicated through (a) the `Cloud` icon, (b) the
 * `aria-label` (`"Imagery from YYYY-MM-DD, X% cloud cover"`), and
 * (c) the tooltip (`"YYYY-MM-DD · cloud X% · coverage Y%"`) — never
 * via colour alone.
 *
 * Roving-tabindex toolbar pattern (per WAI-ARIA APG): exactly one chip
 * is focusable at a time (`tabIndex=0`) — the active selection if it
 * is in the visible set, else the newest chip. `ArrowLeft` /
 * `ArrowRight` move focus between chips, `Home` / `End` jump to the
 * ends. Focus moves do NOT auto-select; selection still requires
 * `Space` / `Enter` (the chip's native button activation). The chevron
 * scroll buttons and the cloudy toggle live OUTSIDE the toolbar's
 * focus loop so they keep their independent tab stops.
 *
 * Position is owned by the parent strip inside `BottomDock` (Module
 * 5.8); this component renders a width-flexible chip and contributes
 * no positioning of its own.
 */

import type { SceneDto } from '@viz-crop/shared';
import { ChevronLeftIcon, ChevronRightIcon, CloudIcon } from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useEosdaScenes } from '@/hooks/useEosdaScenes';
import { bestPerDate, filterVisibleBestScenes, isCloudyScene } from '@/lib/scene-helpers';
import { CHIP_BASE, CHIP_FOCUS } from '@/lib/tokens';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/useUiStore';

const SKELETON_CHIP_COUNT = 5;

const DAY_FORMATTER = new Intl.DateTimeFormat('en', {
  day: '2-digit',
  month: 'short',
  timeZone: 'UTC',
});

type BestForDate = {
  /** ISO `YYYY-MM-DD` (UTC) — the grouping key. */
  sceneDate: string;
  viewId: string;
  cloudPercent: number | null;
  dataCoveragePercent: number | null;
  isCloudy: boolean;
};

function toBestForDate(scene: SceneDto): BestForDate {
  return {
    sceneDate: scene.sceneDate,
    viewId: scene.viewId,
    cloudPercent: scene.cloudPercent,
    dataCoveragePercent: scene.dataCoveragePercent,
    isCloudy: isCloudyScene(scene),
  };
}

function formatChipDate(sceneDate: string): { day: string; year: string } {
  const [yStr, mStr, dStr] = sceneDate.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return { day: sceneDate, year: '' };
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  return {
    day: DAY_FORMATTER.format(date),
    year: `'${String(y).slice(-2)}`,
  };
}

function formatPercent(value: number | null): string {
  if (value === null) return '—';
  return `${Math.round(value)}%`;
}

export type DateTimelineProps = {
  fieldId: string;
};

export function DateTimeline({ fieldId }: DateTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const query = useEosdaScenes(fieldId);
  const selectedViewId = useUiStore((s) => s.selectedViewId);
  const setSelectedViewId = useUiStore((s) => s.setSelectedViewId);
  const showCloudyScenes = useUiStore((s) => s.showCloudyScenes);
  const setShowCloudyScenes = useUiStore((s) => s.setShowCloudyScenes);

  const scenes = query.data;

  const bestScenes = useMemo<ReadonlyArray<SceneDto>>(
    () => (scenes ? bestPerDate(scenes) : []),
    [scenes],
  );

  // Visible chips = (toggle ? all : non-cloudy) ∪ {selected if it has
  // a chip}. The auto-select hook (Module 6.2) now also picks from
  // best-per-date so the *default* selection always lives in `baseline`,
  // but the union still matters if a user manually clicks a cloudy chip
  // while `showCloudyScenes=true` and then toggles the filter off.
  const visibleChips = useMemo<ReadonlyArray<BestForDate>>(() => {
    return filterVisibleBestScenes(bestScenes, { showCloudyScenes, selectedViewId }).map(
      toBestForDate,
    );
  }, [bestScenes, showCloudyScenes, selectedViewId]);

  // --- Roving-tabindex toolbar ---------------------------------------
  // Exactly ONE chip is in the tab order at a time. Default focus
  // target is the active selection; if there isn't one, the newest
  // chip (last in our oldest→newest array). Arrow keys move focus
  // (do NOT auto-select); selection still requires Space/Enter on the
  // chip's native button activation.
  const chipRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const [focusViewId, setFocusViewId] = useState<string | null>(null);

  // Keep `focusViewId` in sync with the visible set: if the focused
  // chip falls out of the visible list (e.g., the user toggled the
  // cloudy filter), or a new selection arrives, snap to the active
  // chip if visible, else the last visible chip.
  useEffect(() => {
    if (visibleChips.length === 0) {
      if (focusViewId !== null) setFocusViewId(null);
      return;
    }
    const isFocusVisible =
      focusViewId !== null && visibleChips.some((c) => c.viewId === focusViewId);
    if (isFocusVisible) return;
    const activeVisible =
      selectedViewId !== null && visibleChips.some((c) => c.viewId === selectedViewId)
        ? selectedViewId
        : null;
    const fallback = visibleChips[visibleChips.length - 1]?.viewId ?? null;
    setFocusViewId(activeVisible ?? fallback);
  }, [visibleChips, selectedViewId, focusViewId]);

  const moveFocus = useCallback(
    (nextIndex: number) => {
      const chip = visibleChips[nextIndex];
      if (!chip) return;
      setFocusViewId(chip.viewId);
      const node = chipRefs.current.get(chip.viewId);
      if (node) {
        node.focus();
        // Keep the focused chip in view when it sits off-screen in the
        // horizontally-scrolling strip.
        node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    },
    [visibleChips],
  );

  const handleToolbarKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (visibleChips.length === 0) return;
      const currentIndex = focusViewId
        ? visibleChips.findIndex((c) => c.viewId === focusViewId)
        : -1;
      const lastIndex = visibleChips.length - 1;
      switch (event.key) {
        case 'ArrowRight': {
          event.preventDefault();
          const next = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, lastIndex);
          moveFocus(next);
          break;
        }
        case 'ArrowLeft': {
          event.preventDefault();
          const next = currentIndex < 0 ? lastIndex : Math.max(currentIndex - 1, 0);
          moveFocus(next);
          break;
        }
        case 'Home': {
          event.preventDefault();
          moveFocus(0);
          break;
        }
        case 'End': {
          event.preventDefault();
          moveFocus(lastIndex);
          break;
        }
        default:
          // Space/Enter fall through to the native <button> click handler.
          break;
      }
    },
    [focusViewId, moveFocus, visibleChips],
  );

  const registerChipRef = useCallback((viewId: string, node: HTMLButtonElement | null) => {
    if (node) {
      chipRefs.current.set(viewId, node);
    } else {
      chipRefs.current.delete(viewId);
    }
  }, []);

  const scrollBy = (direction: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * 160, behavior: 'smooth' });
  };

  return (
    <div
      className={cn(
        CHIP_BASE,
        'pointer-events-auto flex h-10 w-full items-center gap-1 px-1.5',
        'max-w-[min(900px,calc(100vw-12rem))]',
      )}
    >
      <button
        type="button"
        aria-label="Earlier scenes"
        onClick={() => scrollBy(-1)}
        className={cn(
          'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white',
          CHIP_FOCUS,
        )}
      >
        <ChevronLeftIcon aria-hidden="true" className="size-4" />
      </button>

      <div
        ref={scrollRef}
        role="toolbar"
        aria-label="Imagery dates"
        aria-orientation="horizontal"
        aria-busy={query.isPending || undefined}
        onKeyDown={handleToolbarKeyDown}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {query.isPending ? (
          <SkeletonChips />
        ) : query.isError ? (
          <ErrorPill onRetry={() => void query.refetch()} />
        ) : visibleChips.length === 0 ? (
          <EmptyChip />
        ) : (
          visibleChips.map((chip) => (
            <DateChip
              key={chip.viewId}
              chip={chip}
              isActive={chip.viewId === selectedViewId}
              isFocusable={chip.viewId === focusViewId}
              registerRef={registerChipRef}
              onSelect={() => {
                setSelectedViewId(chip.viewId);
                setFocusViewId(chip.viewId);
              }}
            />
          ))
        )}
      </div>

      <button
        type="button"
        aria-label="Later scenes"
        onClick={() => scrollBy(1)}
        className={cn(
          'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white',
          CHIP_FOCUS,
        )}
      >
        <ChevronRightIcon aria-hidden="true" className="size-4" />
      </button>

      <button
        type="button"
        aria-pressed={showCloudyScenes}
        aria-label={showCloudyScenes ? 'Hide cloudy scenes' : 'Show cloudy scenes'}
        onClick={() => setShowCloudyScenes((prev) => !prev)}
        className={cn(
          'ml-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5 text-[10px] text-white/70 transition-colors hover:bg-white/10 hover:text-white sm:h-7 sm:w-auto sm:gap-1 sm:px-2',
          showCloudyScenes && 'border-white/30 bg-white/15 text-white',
          CHIP_FOCUS,
        )}
      >
        <CloudIcon aria-hidden="true" className="size-3" />
        <span className="hidden sm:inline">{showCloudyScenes ? 'Hide cloudy' : 'Show cloudy'}</span>
      </button>
    </div>
  );
}

type DateChipProps = {
  chip: BestForDate;
  isActive: boolean;
  isFocusable: boolean;
  onSelect: () => void;
  registerRef: (viewId: string, node: HTMLButtonElement | null) => void;
};

function DateChip({ chip, isActive, isFocusable, onSelect, registerRef }: DateChipProps) {
  const { day, year } = formatChipDate(chip.sceneDate);
  const cloudLabel = formatPercent(chip.cloudPercent);
  const coverageLabel = formatPercent(chip.dataCoveragePercent);
  const ariaLabel = `Imagery from ${chip.sceneDate}, ${cloudLabel} cloud cover`;
  const tooltipText = `${chip.sceneDate} · cloud ${cloudLabel} · coverage ${coverageLabel}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={(node) => registerRef(chip.viewId, node)}
          type="button"
          aria-pressed={isActive}
          aria-label={ariaLabel}
          tabIndex={isFocusable ? 0 : -1}
          onClick={onSelect}
          className={cn(
            'relative inline-flex h-9 min-w-12 max-w-20 flex-1 shrink-0 flex-col items-center justify-center rounded-md font-medium text-[10px] text-white/75 leading-tight transition-colors',
            'hover:bg-white/10 hover:text-white',
            CHIP_FOCUS,
            isActive && 'bg-emerald-400/20 text-white ring-1 ring-emerald-300 ring-inset',
          )}
        >
          <span className="truncate">{day}</span>
          <span className="text-white/50">{year}</span>
          {chip.isCloudy ? (
            <CloudIcon
              aria-hidden="true"
              className="absolute top-0.5 right-0.5 size-3 text-white/60"
            />
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltipText}</TooltipContent>
    </Tooltip>
  );
}

function SkeletonChips() {
  return (
    <>
      {Array.from({ length: SKELETON_CHIP_COUNT }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton list is static, index is the natural key
          key={i}
          aria-hidden="true"
          className="inline-flex h-9 min-w-12 max-w-20 flex-1 shrink-0 animate-pulse rounded-md bg-white/10"
        />
      ))}
      <span className="sr-only">Loading imagery dates…</span>
    </>
  );
}

function ErrorPill({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="inline-flex h-9 items-center gap-2 rounded-md bg-red-500/15 px-2 text-[11px] text-red-200">
      <span>Couldn't load scenes.</span>
      <button
        type="button"
        onClick={onRetry}
        className={cn(
          'inline-flex h-6 items-center rounded px-2 font-medium text-[11px] text-white transition-colors hover:bg-white/15',
          CHIP_FOCUS,
        )}
      >
        Retry
      </button>
    </div>
  );
}

function EmptyChip() {
  return (
    <output className="inline-flex h-9 items-center rounded-md px-3 text-[11px] text-white/60">
      No scenes available
    </output>
  );
}
