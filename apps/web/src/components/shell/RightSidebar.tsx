/**
 * Module 5.3 — `RightSidebar`.
 *
 * Persistent right-edge chrome on the analysis screen (`/fields/$id`).
 * Implements the anatomy listed in `docs/plan.md` § 2 ("Right sidebar"):
 * a ~64 px collapsed icon rail and a ~300 px expanded pane.
 *
 * ## Layout
 *
 * The component is a single anchored container that renders **two
 * adjacent surfaces** — the rail (always visible, on the right edge)
 * and the pane (slides out to the **left** of the rail when an item is
 * active). Both surfaces share the dark frosted aesthetic established
 * by `<TopBar>` (`bg-black/70` + `backdrop-blur` + a faint white
 * hairline). Together they read as one piece of chrome whose width
 * grows from 64 px to ~364 px when expanded.
 *
 * ## State model
 *
 * Active item lives in `useUiStore.activeSidebarItem`:
 *
 * - `null` → collapsed, only the rail is visible.
 * - any `SidebarItem` → expanded with that item's pane.
 *
 * Clicking an icon toggles: if it's already active we collapse, otherwise
 * we switch to it. The store defaults to `'sample'`, so the very first
 * paint already shows the Sample pane open.
 *
 * ## Pane content
 *
 * Only the **Sample** pane renders a real container — Phase 7 fills it
 * with NDVI stats. To make Phase 7 a drop-in fill, the `<section>`
 * wrapper is rendered here with a stable `aria-labelledby` and a
 * comment marker; the placeholder copy lives inside it. Every other
 * item renders a generic "Coming soon" placeholder with the item's
 * own icon, label, and a one-line description so each stub is
 * distinguishable rather than 11 copies of the same screen.
 *
 * ## Accessibility
 *
 * - The rail is a `role="toolbar"` with vertical orientation and a
 *   single Tab stop (roving tabindex). Arrow keys traverse buttons,
 *   Home/End jump to the first/last button, wrapping across the visual
 *   group separator.
 * - Each rail button is a `<button type="button">` with both
 *   `aria-pressed` (toggle semantic — is this item active?) **and**
 *   `aria-expanded` (since the toggle also expands a region pointed at
 *   by `aria-controls`).
 * - Tooltips are suppressed on the active button — its label already
 *   appears in the pane header, and the doubled announcement is noise.
 * - The pane is an `<aside>` with `aria-labelledby` pointing at the
 *   header `<h2>` so the label and the heading don't drift.
 * - Pressing Escape inside the pane closes it; focus is restored to
 *   the originating rail button so keyboard users don't lose their
 *   place.
 * - Tab order in DOM is rail → pane (close button then body), matching
 *   the documented expectation. The pane is rendered *after* the rail
 *   in JSX so source order matches.
 *
 * ## Why not `<Sheet>`
 *
 * shadcn `Sheet` is a modal/drawer pattern (overlay + focus trap), but
 * the right sidebar is **persistent chrome** — it never traps focus and
 * never dims the underlying map. Plain divs + `Tooltip` are the right
 * primitives here.
 */

import type { FieldDto } from '@viz-crop/shared';
import { XIcon } from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { type SidebarItem, useUiStore } from '@/stores/useUiStore';
import { getSidebarItem, SIDEBAR_ITEMS, type SidebarItemConfig } from './sidebar-items';

const PANE_ID = 'sidebar-pane';

export type RightSidebarProps = {
  field: FieldDto;
};

export function RightSidebar({ field }: RightSidebarProps) {
  const activeSidebarItem = useUiStore((s) => s.activeSidebarItem);
  const setActiveSidebarItem = useUiStore((s) => s.setActiveSidebarItem);

  const activeConfig = activeSidebarItem ? getSidebarItem(activeSidebarItem) : null;

  // Remember which rail button opened the pane so we can return focus
  // to it on close — keyboard users would otherwise lose their place
  // when the close button (and its DOM node) unmount.
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);
  const railContainerRef = useRef<HTMLDivElement>(null);

  const handleSelect = useCallback(
    (id: SidebarItem, fromButton: HTMLButtonElement | null) => {
      if (id === activeSidebarItem) {
        setActiveSidebarItem(null);
        // No focus restore needed — focus is already on the button
        // that the user just clicked to collapse.
        return;
      }
      lastTriggerRef.current = fromButton;
      setActiveSidebarItem(id);
    },
    [activeSidebarItem, setActiveSidebarItem],
  );

  const handleClose = useCallback(() => {
    setActiveSidebarItem(null);
    // Defer to next frame so the pane has unmounted and the rail
    // button is the natural focus target.
    requestAnimationFrame(() => {
      lastTriggerRef.current?.focus();
    });
  }, [setActiveSidebarItem]);

  return (
    <div
      className={cn(
        'flex h-full',
        // `transition-[width]` (NOT `transition-all`) keeps the slide
        // cheap. `motion-safe:` honors `prefers-reduced-motion`.
        'motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-out',
        activeConfig ? 'w-[364px]' : 'w-16',
      )}
    >
      {activeConfig ? <Pane field={field} config={activeConfig} onClose={handleClose} /> : null}

      <Rail ref={railContainerRef} activeId={activeSidebarItem} onSelect={handleSelect} />
    </div>
  );
}

type RailProps = {
  activeId: SidebarItem | null;
  onSelect: (id: SidebarItem, fromButton: HTMLButtonElement | null) => void;
  ref: React.Ref<HTMLDivElement>;
};

/**
 * Vertical icon column. Renders the two visual groups (`primary` and
 * `secondary`) separated by a hairline. Always 64 px wide.
 *
 * Roving tabindex: only one button is in the Tab order at a time. Arrow
 * keys move focus among the rail buttons; Home/End jump to the ends.
 * Activation (Enter/Space) is the browser default for `<button>`.
 */
function Rail({ activeId, onSelect, ref }: RailProps) {
  const buttonRefs = useRef<Map<SidebarItem, HTMLButtonElement | null>>(new Map());

  // Currently-focused rail button (for roving tabindex). Defaults to the
  // active item if any, else the first item.
  const [focusedId, setFocusedId] = useState<SidebarItem>(
    () => activeId ?? (SIDEBAR_ITEMS[0]?.id as SidebarItem),
  );

  // Keep `focusedId` in sync if the active item changes externally
  // (e.g., URL load) so Tab still lands on a sensible button.
  useEffect(() => {
    if (activeId) setFocusedId(activeId);
  }, [activeId]);

  const focusItem = useCallback((id: SidebarItem) => {
    setFocusedId(id);
    buttonRefs.current.get(id)?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const currentIndex = SIDEBAR_ITEMS.findIndex((item) => item.id === focusedId);
      if (currentIndex === -1) return;

      let nextIndex: number | null = null;
      switch (event.key) {
        case 'ArrowDown':
          nextIndex = (currentIndex + 1) % SIDEBAR_ITEMS.length;
          break;
        case 'ArrowUp':
          nextIndex = (currentIndex - 1 + SIDEBAR_ITEMS.length) % SIDEBAR_ITEMS.length;
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = SIDEBAR_ITEMS.length - 1;
          break;
        default:
          return;
      }

      event.preventDefault();
      const next = SIDEBAR_ITEMS[nextIndex];
      if (next) focusItem(next.id);
    },
    [focusedId, focusItem],
  );

  const primary = SIDEBAR_ITEMS.filter((item) => item.group === 'primary');
  const secondary = SIDEBAR_ITEMS.filter((item) => item.group === 'secondary');

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Field analysis sidebar"
      onKeyDown={handleKeyDown}
      className="flex h-full w-16 shrink-0 flex-col items-center gap-1 rounded-md border border-white/10 bg-black/70 py-3 text-white shadow-lg backdrop-blur-md saturate-150"
    >
      {primary.map((item) => (
        <RailButton
          key={item.id}
          item={item}
          isActive={activeId === item.id}
          isFocused={focusedId === item.id}
          onSelect={onSelect}
          buttonRef={(node) => {
            if (node) buttonRefs.current.set(item.id, node);
            else buttonRefs.current.delete(item.id);
          }}
        />
      ))}

      <div aria-hidden="true" className="my-2 h-px w-10 bg-white/20" />

      {secondary.map((item) => (
        <RailButton
          key={item.id}
          item={item}
          isActive={activeId === item.id}
          isFocused={focusedId === item.id}
          onSelect={onSelect}
          buttonRef={(node) => {
            if (node) buttonRefs.current.set(item.id, node);
            else buttonRefs.current.delete(item.id);
          }}
        />
      ))}
    </div>
  );
}

type RailButtonProps = {
  item: SidebarItemConfig;
  isActive: boolean;
  isFocused: boolean;
  onSelect: (id: SidebarItem, fromButton: HTMLButtonElement | null) => void;
  buttonRef: (node: HTMLButtonElement | null) => void;
};

function RailButton({ item, isActive, isFocused, onSelect, buttonRef }: RailButtonProps) {
  const Icon = item.icon;

  // Suppress tooltip on the active item — its label already appears
  // in the pane header, so doubling it is noise. We omit the `open`
  // prop entirely for inactive buttons to keep the default
  // open-on-hover behaviour (passing `undefined` is rejected by
  // `exactOptionalPropertyTypes`).
  const tooltipProps = isActive ? { open: false as const } : {};

  return (
    <Tooltip {...tooltipProps}>
      <TooltipTrigger asChild>
        <button
          ref={buttonRef}
          type="button"
          aria-label={item.label}
          aria-pressed={isActive}
          aria-expanded={isActive}
          aria-controls={PANE_ID}
          tabIndex={isFocused ? 0 : -1}
          onClick={(event) => onSelect(item.id, event.currentTarget)}
          className={cn(
            // Reserve the 2 px stripe slot via `border-l-[3px]
            // border-transparent` so the icon stays centred at the
            // same px in active vs inactive states.
            'relative inline-flex size-11 items-center justify-center rounded-md border-l-[3px] border-transparent text-white/85 transition-colors',
            'hover:bg-white/10 hover:text-white',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/70',
            isActive && 'border-emerald-300 bg-white/15 text-white',
          )}
        >
          <Icon aria-hidden="true" className="size-5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" sideOffset={6}>
        {item.label}
      </TooltipContent>
    </Tooltip>
  );
}

type PaneProps = {
  field: FieldDto;
  config: SidebarItemConfig;
  onClose: () => void;
};

/**
 * Expanded pane shown to the LEFT of the rail. Header + body. Body
 * branches on the active item id — only `'sample'` renders the
 * Phase 7-ready `<section>` container; everything else renders a
 * "Coming soon" placeholder with the item's own description.
 */
function Pane({ field, config, onClose }: PaneProps) {
  const headingId = useId();

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  return (
    <aside
      id={PANE_ID}
      aria-labelledby={headingId}
      onKeyDown={handleKeyDown}
      className={cn(
        'mr-2 flex h-full w-[300px] shrink-0 flex-col overflow-hidden rounded-md border border-white/10 bg-black/70 text-white shadow-lg backdrop-blur-md saturate-150',
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-2 motion-safe:duration-200',
      )}
    >
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-white/10 border-b px-3">
        <div className="flex min-w-0 items-center gap-2">
          <config.icon aria-hidden="true" className="size-4 shrink-0 text-white/70" />
          <h2 id={headingId} className="min-w-0 truncate font-semibold text-sm tracking-tight">
            {config.label}
          </h2>
        </div>
        <button
          type="button"
          aria-label="Close pane"
          onClick={onClose}
          className="inline-flex size-7 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/70"
        >
          <XIcon aria-hidden="true" className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {config.id === 'sample' ? (
          <SamplePanePlaceholder field={field} />
        ) : (
          <ComingSoonPlaceholder config={config} />
        )}
      </div>
    </aside>
  );
}

/**
 * Sample pane shell. Phase 7 will replace the inner copy with the real
 * NDVI stats (mean / p10 / p90 / median + cloud-confidence line +
 * mini-histogram) per `docs/plan.md` § 2 → "Sample sidebar pane". Keep
 * the outer `<section>` and its `data-pane="sample"` marker so the fill
 * is a true drop-in.
 */
function SamplePanePlaceholder({ field }: { field: FieldDto }) {
  return (
    <section data-pane="sample" aria-label="NDVI sample stats" className="flex flex-col gap-3">
      <p className="text-white/60 text-xs uppercase tracking-wide">Field</p>
      <p className="truncate font-medium text-sm text-white" title={field.name}>
        {field.name}
      </p>

      <div className="rounded-md border border-white/10 border-dashed bg-white/[0.03] px-3 py-6 text-center">
        <p className="text-sm text-white/80">NDVI sample stats arrive in Phase 7.</p>
        <p className="mt-1 text-white/60 text-xs">
          Mean, p10/p90, median, cloud confidence, and a mini-histogram for the selected scene.
        </p>
      </div>
    </section>
  );
}

function ComingSoonPlaceholder({ config }: { config: SidebarItemConfig }) {
  const Icon = config.icon;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <Icon aria-hidden="true" className="size-7 text-white/40" />
      <p className="font-medium text-sm text-white/85">{config.label}</p>
      <p className="text-balance text-white/60 text-xs">{config.description}</p>
      <p className="mt-2 text-white/60 text-xs">Coming soon…</p>
    </div>
  );
}
