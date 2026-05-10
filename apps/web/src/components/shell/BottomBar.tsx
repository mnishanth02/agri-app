/**
 * Module 5.4 — `BottomBar`.
 *
 * Floating bottom-centered chrome for the analysis screen (`/fields/$id`).
 * Implements the anatomy listed in `docs/plan.md` § 2 ("Bottom bar"):
 * three tab shells — Crop info, Chart, Activities — that share a single
 * collapsible ~280 px panel.
 *
 * ## Visual language
 *
 * Same dark frosted aesthetic as `<TopBar>` and `<RightSidebar>`:
 * `bg-black/70` + `backdrop-blur-md saturate-150` + a faint white
 * hairline border. Fixed `640 px` width that shrinks on narrow viewports
 * via `max-w-[calc(100vw-1.5rem)]` so the bar never collides with the
 * chrome margin enforced by `AnalysisLayout`.
 *
 * ## State model
 *
 * Active tab lives in `useUiStore.bottomBarTab`:
 *
 * - `null` → collapsed, only the tab-strip header is visible.
 * - any `BottomBarTab` → expanded with that tab's content panel below.
 *
 * The header always renders the three Radix tab triggers plus a chevron
 * collapse/expand toggle. Clicking a tab trigger sets that tab and, if
 * collapsed, expands the panel. Clicking the chevron toggles between
 * collapsed and the **last-active** tab (defaulting to `'cropInfo'`),
 * so users don't lose their place when they re-open the bar.
 *
 * ## Accessibility
 *
 * - Tab semantics come from Radix `<Tabs>` / `<TabsTrigger>` /
 *   `<TabsContent>` (`role="tablist"`, `aria-selected`, arrow-key
 *   navigation, `aria-controls` linking).
 * - The chevron button announces its action with a state-aware
 *   `aria-label` ("Collapse bottom bar" / "Expand bottom bar") and
 *   mirrors the panel's open state via `aria-expanded`.
 * - Pressing Escape inside the expanded panel collapses it; focus is
 *   then restored to the chevron toggle so keyboard users don't lose
 *   their place when the panel unmounts.
 * - The chart-tab and activities-tab icons are decorative
 *   (`aria-hidden="true"`); the surrounding text carries the meaning.
 *
 * ## Stub controls
 *
 * Two of the three tabs are explicit placeholders per the v2 spec:
 *
 * - **Chart**: copy + `<LineChartIcon>` until Phase 7 wires the recharts
 *   line over cached scenes.
 * - **Activities**: empty-state copy + a disabled "Add activity" button
 *   so the affordance is visible without doing anything yet.
 *
 * Wiring lives outside this file — `BottomBar` is purely presentational
 * and receives the resolved `field: FieldDto` from `AnalysisLayout`.
 */

import type { FieldDto } from '@viz-crop/shared';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ClipboardListIcon,
  LineChartIcon,
  PlusIcon,
} from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
} from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { type BottomBarTab, useUiStore } from '@/stores/useUiStore';

const HECTARES_FORMATTER = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const SOWING_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const TABS: ReadonlyArray<{ value: BottomBarTab; label: string }> = [
  { value: 'cropInfo', label: 'Crop info' },
  { value: 'chart', label: 'Chart' },
  { value: 'activities', label: 'Activities' },
];

/**
 * Tab to expand to when the chevron is clicked from the collapsed state
 * for the very first time (before the user has touched any tab).
 */
const DEFAULT_TAB: BottomBarTab = 'cropInfo';

/** Shared card styling used by every Crop info subpanel. */
const CARD_CLASS = 'rounded-md border border-white/10 bg-white/5 p-3 text-sm';

export type BottomBarProps = {
  field: FieldDto;
};

export function BottomBar({ field }: BottomBarProps) {
  const bottomBarTab = useUiStore((s) => s.bottomBarTab);
  const setBottomBarTab = useUiStore((s) => s.setBottomBarTab);

  // Remember the most recent non-null tab so the chevron can restore it
  // after a collapse → expand cycle. Seeded from the store's initial
  // value so the very first chevron click after `bottomBarTab` was
  // hand-cleared still lands on a sensible tab.
  const lastActiveTabRef = useRef<BottomBarTab>(bottomBarTab ?? DEFAULT_TAB);
  const toggleButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (bottomBarTab !== null) lastActiveTabRef.current = bottomBarTab;
  }, [bottomBarTab]);

  const isExpanded = bottomBarTab !== null;

  const handleTabChange = useCallback(
    (value: string) => {
      // Radix narrows `value` to `string`; the underlying triggers are
      // restricted to the `BottomBarTab` union by the static `TABS`
      // array, so the cast is safe.
      setBottomBarTab(value as BottomBarTab);
    },
    [setBottomBarTab],
  );

  const handleCollapse = useCallback(() => {
    setBottomBarTab(null);
    // Wait a frame so the panel has unmounted before stealing focus —
    // otherwise focus-within styles flash on the disappearing panel.
    requestAnimationFrame(() => {
      toggleButtonRef.current?.focus();
    });
  }, [setBottomBarTab]);

  const handleExpand = useCallback(() => {
    setBottomBarTab(lastActiveTabRef.current);
  }, [setBottomBarTab]);

  const handleTogglePress = isExpanded ? handleCollapse : handleExpand;

  const handleRootKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      // Escape collapses from anywhere inside the bar (header tab
      // triggers, panel content, chevron), not just the panel — so
      // keyboard users can exit without first having to Tab into the
      // panel body.
      if (event.key === 'Escape' && isExpanded) {
        event.stopPropagation();
        handleCollapse();
      }
    },
    [handleCollapse, isExpanded],
  );

  return (
    <section
      aria-label="Bottom bar"
      onKeyDown={handleRootKeyDown}
      className="z-10 w-[640px] max-w-[calc(100vw-1.5rem)] touch-manipulation overflow-hidden rounded-md border border-white/10 bg-black/70 text-white shadow-lg backdrop-blur-md saturate-150"
    >
      <Tabs
        // Radix Tabs accepts an empty string when no trigger should look
        // active — this is exactly the collapsed state.
        value={bottomBarTab ?? ''}
        onValueChange={handleTabChange}
        className="gap-0"
      >
        <div className="flex h-12 items-center justify-between gap-2 px-2">
          <TabsList variant="line" className="h-9 gap-1 bg-transparent p-0">
            {TABS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className={cn(
                  // Override the default `flex-1` so triggers stay
                  // compact instead of stretching across the header.
                  'h-9 flex-none rounded-md px-3 text-sm font-medium text-white/70 transition-colors',
                  'hover:bg-white/5 hover:text-white',
                  'data-[state=active]:bg-white/15 data-[state=active]:text-white data-[state=active]:shadow-none',
                  'dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-white/15 dark:data-[state=active]:text-white',
                  // Match the focus-ring treatment used by TopBar / RightSidebar
                  // for cohesion across the analysis chrome.
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/70',
                  // Suppress the underline indicator baked into the
                  // `line` variant — we use background fill instead.
                  'after:hidden',
                )}
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                ref={toggleButtonRef}
                aria-label={isExpanded ? 'Collapse bottom bar' : 'Expand bottom bar'}
                aria-expanded={isExpanded}
                onClick={handleTogglePress}
                className="inline-flex size-9 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/70"
              >
                {isExpanded ? (
                  <ChevronDownIcon aria-hidden="true" className="size-4" />
                ) : (
                  <ChevronUpIcon aria-hidden="true" className="size-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{isExpanded ? 'Collapse' : 'Expand'}</TooltipContent>
          </Tooltip>
        </div>

        {isExpanded ? (
          <div
            className={cn(
              'h-[280px] overflow-y-auto overscroll-contain border-white/10 border-t p-3',
              'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200',
            )}
          >
            <TabsContent value="cropInfo" className="mt-0 outline-none">
              <CropInfoTab field={field} />
            </TabsContent>
            <TabsContent value="chart" className="mt-0 outline-none">
              <ChartTab />
            </TabsContent>
            <TabsContent value="activities" className="mt-0 outline-none">
              <ActivitiesTab />
            </TabsContent>
          </div>
        ) : null}
      </Tabs>
    </section>
  );
}

/**
 * Crop info tab body. Lays out four cards in a horizontal row on `md+`:
 * a real "Crop rotation" panel (current season + crop + sowing date +
 * area pulled from the field metadata) followed by three Phase-7
 * placeholders (growth stages, current risks, sown-area detection).
 */
function CropInfoTab({ field }: { field: FieldDto }) {
  const rotationHeadingId = useId();
  const sowingDateLabel = field.sowingDate
    ? SOWING_DATE_FORMATTER.format(new Date(field.sowingDate))
    : '—';
  const areaLabel =
    field.areaHectares !== null ? `${HECTARES_FORMATTER.format(field.areaHectares)} ha` : '—';
  // Trim + fall back to em-dash so blank or whitespace-only values from
  // the API don't render as empty cells.
  const cropLabel = field.cropType?.trim() || '—';
  const seasonLabel = field.season?.trim() || '—';

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      <article className={CARD_CLASS} aria-labelledby={rotationHeadingId}>
        <h3
          id={rotationHeadingId}
          className="font-semibold text-white text-xs uppercase tracking-wide"
        >
          Crop rotation
        </h3>
        <dl className="mt-2 flex flex-col gap-2">
          <Row label="Season">
            <span className="inline-flex max-w-full items-center truncate rounded-full border border-white/20 bg-white/10 px-2 py-0.5 font-medium text-[11px] text-white">
              {seasonLabel}
            </span>
          </Row>
          <Row label="Crop">
            <span
              className="min-w-0 max-w-[14ch] truncate font-medium text-sm text-white"
              title={cropLabel}
            >
              {cropLabel}
            </span>
          </Row>
          <Row label="Sowing">
            <span className="text-white/85 text-xs tabular-nums">{sowingDateLabel}</span>
          </Row>
          <Row label="Area">
            <span className="text-white/85 text-xs tabular-nums">{areaLabel}</span>
          </Row>
        </dl>
      </article>

      <PlaceholderCard title="Growth stages">
        Growth stages will appear here once monitoring is wired.
      </PlaceholderCard>
      <PlaceholderCard title="Current risks">No risk signals yet.</PlaceholderCard>
      <PlaceholderCard title="Sown area detected">Awaiting NDVI analysis.</PlaceholderCard>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <dt className="text-[11px] text-white/55 uppercase tracking-wide">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

function PlaceholderCard({ title, children }: { title: string; children: ReactNode }) {
  // Dashed border + dimmer surface marks placeholder cards as visually
  // distinct from the real "Crop rotation" data card next to them.
  return (
    <article className={cn(CARD_CLASS, 'border-dashed bg-white/[0.03]')}>
      <h3 className="font-semibold text-white text-xs uppercase tracking-wide">{title}</h3>
      <p className="mt-2 text-white/65 text-xs leading-relaxed">{children}</p>
    </article>
  );
}

function ChartTab() {
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 text-center">
      <LineChartIcon aria-hidden="true" className="size-7 text-white/40" />
      <p className="text-sm text-white/85">NDVI trend chart — coming soon.</p>
      <p className="text-white/55 text-xs">Mean index across all cached scenes will plot here.</p>
    </div>
  );
}

function ActivitiesTab() {
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 text-center">
      <ClipboardListIcon aria-hidden="true" className="size-7 text-white/40" />
      <p className="text-sm text-white/85">No activities yet.</p>
      <p className="text-white/55 text-xs">Field operations you log will appear here.</p>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* `aria-disabled` (instead of native `disabled`) keeps the
            button reachable by Tab + screen readers; the click handler
            no-ops via `preventDefault`. Same pattern as TopBar's
            "Get overview" CTA. */}
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-disabled="true"
            onClick={(event) => event.preventDefault()}
            className="cursor-not-allowed border-white/20 bg-white/5 text-white/70 opacity-70 hover:bg-white/5 hover:text-white/70 focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/70 dark:border-white/20 dark:bg-white/5 dark:hover:bg-white/5"
          >
            <PlusIcon aria-hidden="true" className="size-3.5" />
            Add activity
            <span className="sr-only"> (coming soon)</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Coming soon</TooltipContent>
      </Tooltip>
    </div>
  );
}
