/**
 * Module 5.7 — `BottomDock` (full-width bottom dock).
 *
 * Replaces the bottom-left `BottomBar` tray with an edge-to-edge dock
 * anchored to the bottom of the viewport. Header (`h-11`) is always
 * visible: 3 tab triggers (Crop / Chart / Activities) on the left, a
 * chevron toggle on the right. Body renders only when expanded
 * (`useUiStore.bottomBarTab !== null`), capped at `40vh` and laid out
 * as a `grid-cols-1 md:2 lg:4` of cards.
 *
 * No `<md` Sheet escalation — the dock is already a full-width drawer
 * at every viewport, so phones get the same dock UX as desktops.
 *
 * State unchanged from Module 5.6's `BottomBar`: same
 * `useUiStore.bottomBarTab` selector + setter, same `lastActiveTabRef`
 * pattern so re-expanding restores the previous tab. ESC collapses and
 * refocuses the chevron.
 *
 * See `docs/ui-ux-redesign-v2.md` § 7.C.1 for the design rationale.
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
import { CHIP_FOCUS } from '@/lib/tokens';
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
  { value: 'cropInfo', label: 'Crop' },
  { value: 'chart', label: 'Chart' },
  { value: 'activities', label: 'Activities' },
];

const DEFAULT_TAB: BottomBarTab = 'cropInfo';

const CARD_CLASS = 'rounded-md border border-white/10 bg-white/5 p-3 text-sm';

export type BottomDockProps = {
  field: FieldDto;
};

export function BottomDock({ field }: BottomDockProps) {
  const bottomBarTab = useUiStore((s) => s.bottomBarTab);
  const setBottomBarTab = useUiStore((s) => s.setBottomBarTab);

  const lastActiveTabRef = useRef<BottomBarTab>(bottomBarTab ?? DEFAULT_TAB);
  const toggleButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (bottomBarTab !== null) lastActiveTabRef.current = bottomBarTab;
  }, [bottomBarTab]);

  const isExpanded = bottomBarTab !== null;

  const handleTabChange = useCallback(
    (value: string) => {
      // Auto-expand to the chosen tab when the dock is collapsed.
      setBottomBarTab(value as BottomBarTab);
    },
    [setBottomBarTab],
  );

  const handleCollapse = useCallback(() => {
    setBottomBarTab(null);
    requestAnimationFrame(() => {
      toggleButtonRef.current?.focus();
    });
  }, [setBottomBarTab]);

  const handleExpand = useCallback(() => {
    setBottomBarTab(lastActiveTabRef.current);
  }, [setBottomBarTab]);

  const handleTogglePress = isExpanded ? handleCollapse : handleExpand;

  const handleRootKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape' && isExpanded) {
        event.stopPropagation();
        handleCollapse();
      }
    },
    [handleCollapse, isExpanded],
  );

  return (
    <section
      aria-label="Field details"
      onKeyDown={handleRootKeyDown}
      className={cn(
        // Full-width dock — `rounded-t-2xl` only (top corners), so it
        // visually anchors to the bottom edge of the viewport.
        'pointer-events-auto fixed inset-x-0 bottom-0 z-20 touch-manipulation',
        'rounded-t-2xl border-white/10 border-t bg-black/80 text-white shadow-lg backdrop-blur-md saturate-150',
      )}
    >
      <Tabs value={bottomBarTab ?? ''} onValueChange={handleTabChange} className="gap-0">
        <div className="flex h-11 items-center justify-between gap-2 px-3 md:px-4">
          <TabsList variant="line" className="h-8 gap-0.5 bg-transparent p-0">
            {TABS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className={cn(
                  'h-8 flex-none rounded-md px-3 font-medium text-sm text-white/70 transition-colors',
                  'hover:bg-white/5 hover:text-white',
                  'data-[state=active]:bg-white/15 data-[state=active]:text-white data-[state=active]:shadow-none',
                  'dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-white/15 dark:data-[state=active]:text-white',
                  CHIP_FOCUS,
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
                aria-label={isExpanded ? 'Collapse field details' : 'Expand field details'}
                aria-expanded={isExpanded}
                onClick={handleTogglePress}
                className={cn(
                  'inline-flex size-8 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white',
                  CHIP_FOCUS,
                )}
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
              'max-h-[40vh] overflow-y-auto overscroll-contain border-white/10 border-t px-4 py-3 md:px-6',
              'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200',
            )}
          >
            <BottomDockBody field={field} />
          </div>
        ) : null}
      </Tabs>
    </section>
  );
}

function BottomDockBody({ field }: { field: FieldDto }) {
  return (
    <>
      <TabsContent value="cropInfo" className="mt-0 outline-none">
        <CropInfoTab field={field} />
      </TabsContent>
      <TabsContent value="chart" className="mt-0 outline-none">
        <ChartTab />
      </TabsContent>
      <TabsContent value="activities" className="mt-0 outline-none">
        <ActivitiesTab />
      </TabsContent>
    </>
  );
}

function CropInfoTab({ field }: { field: FieldDto }) {
  const rotationHeadingId = useId();
  const sowingDateLabel = field.sowingDate
    ? SOWING_DATE_FORMATTER.format(new Date(field.sowingDate))
    : '—';
  const areaLabel =
    field.areaHectares !== null ? `${HECTARES_FORMATTER.format(field.areaHectares)} ha` : '—';
  const cropLabel = field.cropType?.trim() || '—';
  const seasonLabel = field.season?.trim() || '—';

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
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
  return (
    <article className={cn(CARD_CLASS, 'border-dashed bg-white/[0.03]')}>
      <h3 className="font-semibold text-white text-xs uppercase tracking-wide">{title}</h3>
      <p className="mt-2 text-white/65 text-xs leading-relaxed">{children}</p>
    </article>
  );
}

function ChartTab() {
  return (
    <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center">
      <LineChartIcon aria-hidden="true" className="size-7 text-white/40" />
      <p className="text-sm text-white/85">NDVI trend chart — coming soon.</p>
      <p className="text-white/55 text-xs">Mean index across all cached scenes will plot here.</p>
    </div>
  );
}

function ActivitiesTab() {
  return (
    <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 text-center">
      <ClipboardListIcon aria-hidden="true" className="size-7 text-white/40" />
      <p className="text-sm text-white/85">No activities yet.</p>
      <p className="text-white/55 text-xs">Field operations you log will appear here.</p>
      <Tooltip>
        <TooltipTrigger asChild>
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
