/**
 * Module 5.8 — `BottomDock` (drag-resizable full-width dock).
 *
 * Replaces the Module 5.7 layout where `BottomRow` floated above the
 * dock and shifted by `40vh` whenever the dock expanded — a UX
 * regression the field user flagged ("timeline view is moving up very
 * high"). The fix lifts the timeline + layer cluster INTO the dock as
 * a fixed strip directly above the tab bar; the body now opens above
 * that strip, so the timeline stays visually pinned to the bottom of
 * the viewport regardless of dock state.
 *
 * The dock anatomy from top → bottom is:
 *
 *   1. **Drag handle** (`h-3`, always visible) — a thin pill grabber
 *      that the user can drag vertically to resize the body, click to
 *      toggle, double-click to reset to the default height, or use
 *      ArrowUp/ArrowDown for keyboard resize.
 *   2. **Body** (only when expanded) — height comes from the store
 *      (`bottomDockHeightVh`, clamped `[15vh, 70vh]`); cards in
 *      `grid-cols-1 md:2 lg:4`.
 *   3. **Timeline + layer cluster strip** (`h-12`, always visible) —
 *      the `<DateTimeline />` claims the centre slot and
 *      `<LayerControlCluster />` sits on the right.
 *   4. **Tabs bar** (`h-11`, always visible) — `Crop / Chart /
 *      Activities` triggers on the left, chevron toggle on the right.
 *      Clicking the bar background (not on a tab or chevron) toggles.
 *
 * Total collapsed height ≈ `7rem` (handle 0.75 + timeline 3 + tabs
 * 2.75 + borders ~0.5). The dock writes its current total height to
 * `--bottom-dock-h` on `:root` via `useEffect`, and floating chrome
 * (Zoom / Fullscreen / CloudHiddenToast / RightSidebar wrapper)
 * consumes that variable instead of hand-cascading `40vh + Nrem`
 * arithmetic. The CSS variable approach kills the "off-by-2rem
 * cascade" bug class that bit Module 5.7.
 *
 * State shape is unchanged for `bottomBarTab` (`null` = collapsed).
 * Module 5.8 adds `bottomDockHeightVh` for the resize.
 *
 * See `docs/implementation.md` Module 5.8 for the full rationale.
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
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { DateTimeline } from '@/components/map/overlays/DateTimeline';
import { LayerControlCluster } from '@/components/map/overlays/LayerControlCluster';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CHIP_FOCUS } from '@/lib/tokens';
import { cn } from '@/lib/utils';
import {
  BOTTOM_DOCK_DEFAULT_VH,
  BOTTOM_DOCK_MAX_VH,
  BOTTOM_DOCK_MIN_VH,
  type BottomBarTab,
  useUiStore,
} from '@/stores/useUiStore';

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

/**
 * Pixel threshold below which a pointer interaction on the grabber is
 * treated as a click (toggle) rather than a drag (resize). Calibrated
 * for both mouse precision and touch jitter — 8px is enough to
 * absorb finger-tremor on touchscreens without making mouse drags
 * feel laggy. (Adversarial review on Module 5.8 flagged the original
 * 4px value as too aggressive for coarse pointers.)
 */
const DRAG_CLICK_THRESHOLD_PX = 8;

/** Keyboard arrow step in vh for the grabber's resize affordance. */
const KEYBOARD_RESIZE_STEP_VH = 5;

/**
 * Total collapsed dock height in CSS units. Drag handle (h-6 =
 * 1.5rem) + timeline strip (h-12 = 3rem) + tabs bar (h-11 = 2.75rem)
 * + 3 borders (~3px ≈ 0.2rem) ≈ 7.5rem. Floating overlays use this
 * as the fallback when the dock hasn't yet written
 * `--bottom-dock-h`. Slight over-estimate to ensure no overlap.
 */
const COLLAPSED_DOCK_HEIGHT_CSS = '7.5rem';

export type BottomDockProps = {
  field: FieldDto;
};

export function BottomDock({ field }: BottomDockProps) {
  const bottomBarTab = useUiStore((s) => s.bottomBarTab);
  const setBottomBarTab = useUiStore((s) => s.setBottomBarTab);
  const heightVh = useUiStore((s) => s.bottomDockHeightVh);
  const setHeightVh = useUiStore((s) => s.setBottomDockHeightVh);

  const lastActiveTabRef = useRef<BottomBarTab>(bottomBarTab ?? DEFAULT_TAB);
  const toggleButtonRef = useRef<HTMLButtonElement | null>(null);
  const grabberRef = useRef<HTMLButtonElement | null>(null);
  const dockBodyId = useId();

  // Drag state — refs (not state) so pointermove handlers can read the
  // latest values without re-binding listeners. `dragMovedRef` lets us
  // distinguish a drag-release from a click on pointerup.
  const dragOriginYRef = useRef<number | null>(null);
  const dragStartHeightRef = useRef<number>(heightVh);
  const dragStartedCollapsedRef = useRef<boolean>(false);
  const dragMovedRef = useRef<boolean>(false);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (bottomBarTab !== null) lastActiveTabRef.current = bottomBarTab;
  }, [bottomBarTab]);

  const isExpanded = bottomBarTab !== null;

  // Publish the dock's total height to a CSS variable so floating
  // chrome (Zoom / Fullscreen / CloudHiddenToast / RightSidebar) can
  // self-position with a single `var(--bottom-dock-h)` reference. We
  // intentionally do NOT subtract the handle / strip / tabs heights
  // here — the variable IS the dock's outer height, and consumers add
  // their own breathing-gap rem.
  //
  // `useLayoutEffect` is intentional: during a drag the dock body
  // updates synchronously via React state, but consumers re-paint
  // their `bottom` from the CSS variable. If we publish in a
  // post-paint `useEffect` the floating chrome would lag one frame
  // behind the dock during continuous resize. The layout effect
  // commits the variable before the paint that shows the new dock
  // height, so the chrome moves in lockstep.
  useLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const value = isExpanded
      ? `calc(${heightVh}vh + ${COLLAPSED_DOCK_HEIGHT_CSS})`
      : COLLAPSED_DOCK_HEIGHT_CSS;
    root.style.setProperty('--bottom-dock-h', value);
    return () => {
      root.style.removeProperty('--bottom-dock-h');
    };
  }, [isExpanded, heightVh]);

  // Mirror the drag-active flag onto a `<html>` data attribute so the
  // global rule in `globals.css` can suppress the
  // `transition-[bottom]` animations on every dock-anchored element
  // for the duration of the drag. (Without this, the chevron-driven
  // collapse/expand animation is desirable, but during a continuous
  // drag the animation makes consumers chase the cursor.)
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (isDragging) {
      root.dataset.bottomDockDragging = 'true';
      return () => {
        delete root.dataset.bottomDockDragging;
      };
    }
    return undefined;
  }, [isDragging]);

  const handleTabChange = useCallback(
    (value: string) => {
      // Auto-expand to the chosen tab when the dock is collapsed.
      setBottomBarTab(value as BottomBarTab);
    },
    [setBottomBarTab],
  );

  const collapse = useCallback(() => {
    setBottomBarTab(null);
    requestAnimationFrame(() => {
      toggleButtonRef.current?.focus();
    });
  }, [setBottomBarTab]);

  const expand = useCallback(() => {
    setBottomBarTab(lastActiveTabRef.current);
  }, [setBottomBarTab]);

  const toggle = useCallback(() => {
    if (isExpanded) collapse();
    else expand();
  }, [isExpanded, collapse, expand]);

  const handleRootKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape' && isExpanded) {
        event.stopPropagation();
        collapse();
      }
    },
    [collapse, isExpanded],
  );

  // ───────────────────────── Drag-to-resize ─────────────────────────

  const handleGrabberPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      // Only react to the primary pointer (left mouse / first touch / pen).
      if (!event.isPrimary) return;
      // Right-clicks open the context menu — do not capture.
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragOriginYRef.current = event.clientY;
      dragStartHeightRef.current = heightVh;
      dragStartedCollapsedRef.current = !isExpanded;
      dragMovedRef.current = false;
      setIsDragging(true);
    },
    [heightVh, isExpanded],
  );

  const handleGrabberPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const origin = dragOriginYRef.current;
      if (origin === null) return;
      const deltaPx = origin - event.clientY; // drag UP → positive
      if (Math.abs(deltaPx) < DRAG_CLICK_THRESHOLD_PX) return;
      dragMovedRef.current = true;

      const viewportPx = typeof window === 'undefined' ? 800 : window.innerHeight;
      const startedCollapsed = dragStartedCollapsedRef.current;
      // When the user starts dragging from a collapsed dock we want
      // the body to APPEAR immediately (otherwise the user has to
      // drag ~120px before the body crosses the 15vh minimum and
      // becomes visible — feels broken). So on the first
      // past-threshold move we expand the dock and seed the height
      // at MIN_VH, then continue to grow proportionally to further
      // drag distance from the current cursor position.
      const baselineVh = startedCollapsed ? BOTTOM_DOCK_MIN_VH : dragStartHeightRef.current;
      const deltaVh = (deltaPx / viewportPx) * 100;
      const nextRaw = baselineVh + deltaVh;

      if (nextRaw < BOTTOM_DOCK_MIN_VH) {
        // Dragged below the minimum — collapse the dock entirely.
        if (isExpanded) {
          setBottomBarTab(null);
        }
        return;
      }

      const clamped = Math.min(BOTTOM_DOCK_MAX_VH, Math.max(BOTTOM_DOCK_MIN_VH, nextRaw));
      // If we're crossing back from collapsed → expanded mid-drag,
      // set the tab first so the body actually renders, and pin the
      // baseline ref to MIN_VH so subsequent moves resolve from a
      // stable origin (otherwise alternating
      // `dragStartedCollapsedRef === true` reads would compound the
      // offset).
      if (!isExpanded) {
        setBottomBarTab(lastActiveTabRef.current);
        dragStartedCollapsedRef.current = false;
        dragStartHeightRef.current = BOTTOM_DOCK_MIN_VH;
        // Re-anchor the pointer origin to "here" so the body grows
        // smoothly from MIN_VH instead of jumping by the threshold.
        dragOriginYRef.current = event.clientY;
      }
      setHeightVh(clamped);
    },
    [isExpanded, setBottomBarTab, setHeightVh],
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (dragOriginYRef.current === null) return;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // releasePointerCapture throws if the pointer was never
        // captured (rare, but happens when a sibling element steals
        // capture). Swallow — we still want to reset our internal
        // drag state below.
      }
      const wasDrag = dragMovedRef.current;
      dragOriginYRef.current = null;
      dragMovedRef.current = false;
      setIsDragging(false);

      // Clean tap with no movement → toggle collapsed/expanded.
      if (!wasDrag) {
        toggle();
      }
    },
    [toggle],
  );

  /**
   * Fallback when the browser steals pointer capture (e.g. an alert
   * fires, the route unmounts, the OS swaps focus). Without this the
   * drag refs stay populated and a subsequent click would be
   * mis-interpreted as a drag-release.
   */
  const handleLostPointerCapture = useCallback(() => {
    if (dragOriginYRef.current === null) return;
    dragOriginYRef.current = null;
    dragMovedRef.current = false;
    setIsDragging(false);
  }, []);

  const handleGrabberKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (!isExpanded) {
          setBottomBarTab(lastActiveTabRef.current);
          setHeightVh(BOTTOM_DOCK_DEFAULT_VH);
          return;
        }
        const next = Math.min(BOTTOM_DOCK_MAX_VH, heightVh + KEYBOARD_RESIZE_STEP_VH);
        setHeightVh(next);
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (!isExpanded) return;
        const next = heightVh - KEYBOARD_RESIZE_STEP_VH;
        if (next < BOTTOM_DOCK_MIN_VH) {
          collapse();
          return;
        }
        setHeightVh(next);
        return;
      }
    },
    [collapse, heightVh, isExpanded, setBottomBarTab, setHeightVh, toggle],
  );

  const handleGrabberDoubleClick = useCallback(() => {
    setHeightVh(BOTTOM_DOCK_DEFAULT_VH);
    if (!isExpanded) setBottomBarTab(lastActiveTabRef.current);
  }, [isExpanded, setBottomBarTab, setHeightVh]);

  // Tab-bar background click is intentionally NOT wired here — the
  // drag-handle pill at the dock's top edge already provides a wide,
  // visible click-to-toggle target plus drag-to-resize, and the
  // chevron at the right end of the tab bar offers a redundant icon
  // affordance. Adding a click handler on the tab-bar wrapper would
  // trip `lint/a11y/noStaticElementInteractions` and risk eating
  // clicks on tab triggers / chevron, with no incremental UX win.

  const grabberLabel = isExpanded
    ? 'Resize field details (drag to resize, click to collapse)'
    : 'Expand field details (drag up to expand, click to expand)';

  // Pixel cursor / colour treatment for the grabber depends on state.
  // The button itself is `h-6` (24px) to give a touch-friendly hit
  // target while the visible pill stays a slim 4px so it reads as a
  // grabber rather than a button. `touch-none` disables the browser's
  // native vertical-pan gesture so finger drags actually reach our
  // pointermove handler.
  const grabberClassName = cn(
    'group relative flex h-6 w-full touch-none items-center justify-center outline-none',
    isDragging ? 'cursor-grabbing' : 'cursor-ns-resize',
    'motion-safe:transition-colors hover:bg-white/5',
    CHIP_FOCUS,
  );

  return (
    <section
      aria-label="Field details"
      onKeyDown={handleRootKeyDown}
      className={cn(
        // Full-width dock — `rounded-t-2xl` only (top corners), so it
        // visually anchors to the bottom edge of the viewport.
        'pointer-events-auto fixed inset-x-0 bottom-0 z-20 touch-manipulation',
        'flex flex-col rounded-t-2xl border-white/10 border-t bg-black/80 text-white shadow-lg backdrop-blur-md saturate-150',
      )}
    >
      {/* 1. Drag handle — always visible, top-most so the user can
          grab from above the body when expanded. */}
      <button
        type="button"
        ref={grabberRef}
        aria-label={grabberLabel}
        aria-expanded={isExpanded}
        aria-controls={isExpanded ? dockBodyId : undefined}
        onPointerDown={handleGrabberPointerDown}
        onPointerMove={handleGrabberPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={handleLostPointerCapture}
        onKeyDown={handleGrabberKeyDown}
        onDoubleClick={handleGrabberDoubleClick}
        className={grabberClassName}
      >
        <span
          aria-hidden="true"
          className={cn(
            'h-1 w-12 rounded-full bg-white/35 motion-safe:transition-colors',
            'group-hover:bg-white/55 group-focus-visible:bg-white/55',
            isDragging && 'bg-white/70',
          )}
        />
      </button>

      <Tabs value={bottomBarTab ?? ''} onValueChange={handleTabChange} className="gap-0">
        {/* 2. Body — only when expanded. Inline `height` is the source
            of truth so the drag handler can shrink/grow live. */}
        {isExpanded ? (
          <div
            id={dockBodyId}
            style={{ height: `${heightVh}vh` } satisfies CSSProperties}
            className={cn(
              'overflow-y-auto overscroll-contain border-white/10 border-t px-4 py-3 md:px-6',
              // Skip the height transition while the user is actively
              // dragging — otherwise the body lags behind the cursor.
              !isDragging && 'motion-safe:transition-[height] motion-safe:duration-150',
            )}
          >
            <BottomDockBody field={field} />
          </div>
        ) : null}

        {/* 3. Timeline + layer cluster strip — always visible. Lives
            INSIDE the dock so it never shifts when the body opens. */}
        <div className={cn('flex h-12 items-center gap-3 border-white/10 border-t px-3 md:px-4')}>
          {/* Symmetric spacer keeps the timeline centred against the
              cluster on wide viewports; hidden on `<md`. */}
          <div aria-hidden="true" className="hidden w-10 md:block" />
          <div className="flex min-w-0 flex-1 justify-center">
            <DateTimeline fieldId={field.id} />
          </div>
          <div className="shrink-0">
            <LayerControlCluster />
          </div>
        </div>

        {/* 4. Tabs bar — always visible. Tabs trigger / chevron own
            their own click handlers; toggle affordance is the
            top-edge drag handle (click-to-toggle + drag-to-resize)
            plus the chevron at the right. */}
        <div
          className={cn(
            'flex h-11 items-center justify-between gap-2 border-white/10 border-t px-3 md:px-4',
          )}
        >
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
                onClick={toggle}
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
