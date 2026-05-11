/**
 * Module 5.6 — `RightSidebar`.
 *
 * Persistent right-edge chrome on the analysis screen (`/fields/$id`).
 * Always renders the 64 px collapsed icon rail; the expanded pane sits
 * inline to the left of the rail on `md+` and escalates to a shadcn
 * bottom-right `Sheet` on `<md` so the persistent overlay stops fighting
 * for space on phones (see `docs/ui-ux-redesign.md` § R.C.1).
 *
 * State model unchanged: `useUiStore.activeSidebarItem` — `null` =
 * collapsed; any `SidebarItem` = expanded with that item's pane.
 */

import type { FieldDto } from '@viz-crop/shared';
import { XIcon } from 'lucide-react';
import {
  forwardRef,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { CHIP_BASE, CHIP_FOCUS } from '@/lib/tokens';
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
  const isMd = useMediaQuery('(min-width: 768px)');

  const activeConfig = activeSidebarItem ? getSidebarItem(activeSidebarItem) : null;

  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);
  const railContainerRef = useRef<HTMLDivElement>(null);

  const handleSelect = useCallback(
    (id: SidebarItem, fromButton: HTMLButtonElement | null) => {
      if (id === activeSidebarItem) {
        setActiveSidebarItem(null);
        return;
      }
      lastTriggerRef.current = fromButton;
      setActiveSidebarItem(id);
    },
    [activeSidebarItem, setActiveSidebarItem],
  );

  const handleClose = useCallback(() => {
    setActiveSidebarItem(null);
    requestAnimationFrame(() => {
      lastTriggerRef.current?.focus();
    });
  }, [setActiveSidebarItem]);

  // md+ inline behaviour: rail + pane share one container that grows
  // from 64 px to 364 px. Module 5.7: outer container owns `CHIP_BASE`
  // so opening a pane reads as the same chip expanding (one shadow,
  // one border) — see `docs/ui-ux-redesign-v2.md` § 6.
  if (isMd) {
    return (
      <div
        className={cn(
          CHIP_BASE,
          'flex h-full overflow-hidden',
          'motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-out',
          activeConfig ? 'w-[364px]' : 'w-16',
        )}
      >
        {activeConfig ? (
          <PaneBody field={field} config={activeConfig} onClose={handleClose} />
        ) : null}

        <Rail ref={railContainerRef} activeId={activeSidebarItem} onSelect={handleSelect} />
      </div>
    );
  }

  // <md: only the rail stays inline; pane escalates to a Sheet. The
  // rail still needs chip chrome here since it stands alone (no outer
  // expanding container like the md+ branch).
  return (
    <>
      <div className={cn(CHIP_BASE, 'flex h-full w-16 overflow-hidden')}>
        <Rail ref={railContainerRef} activeId={activeSidebarItem} onSelect={handleSelect} />
      </div>

      <Sheet
        open={activeConfig !== null}
        onOpenChange={(open) => {
          if (!open) handleClose();
        }}
      >
        <SheetContent
          side="right"
          className="w-[300px] gap-0 border-white/10 bg-black/90 p-0 text-white backdrop-blur-md sm:max-w-[320px]"
        >
          {activeConfig ? (
            <PaneBody field={field} config={activeConfig} onClose={handleClose} inSheet />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

type RailProps = {
  activeId: SidebarItem | null;
  onSelect: (id: SidebarItem, fromButton: HTMLButtonElement | null) => void;
};

const Rail = forwardRef<HTMLDivElement, RailProps>(function Rail({ activeId, onSelect }, ref) {
  const buttonRefs = useRef<Map<SidebarItem, HTMLButtonElement | null>>(new Map());

  const [focusedId, setFocusedId] = useState<SidebarItem>(
    () => activeId ?? (SIDEBAR_ITEMS[0]?.id as SidebarItem),
  );

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
      className={cn('flex h-full w-16 shrink-0 flex-col items-center gap-1 overflow-y-auto py-3')}
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
});

type RailButtonProps = {
  item: SidebarItemConfig;
  isActive: boolean;
  isFocused: boolean;
  onSelect: (id: SidebarItem, fromButton: HTMLButtonElement | null) => void;
  buttonRef: (node: HTMLButtonElement | null) => void;
};

function RailButton({ item, isActive, isFocused, onSelect, buttonRef }: RailButtonProps) {
  const Icon = item.icon;

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
            'relative inline-flex size-11 items-center justify-center rounded-md border-l-[3px] border-transparent text-white/85 transition-colors',
            'hover:bg-white/10 hover:text-white',
            CHIP_FOCUS,
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

type PaneBodyProps = {
  field: FieldDto;
  config: SidebarItemConfig;
  onClose: () => void;
  /** When true, the body is hosted inside a `Sheet` so the outer chip
   *  styles (border/shadow/animation) are suppressed. */
  inSheet?: boolean;
};

function PaneBody({ field, config, onClose, inSheet = false }: PaneBodyProps) {
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
        'flex h-full flex-col overflow-hidden text-white',
        inSheet
          ? 'w-full'
          : cn(
              // Module 5.7: pane no longer carries its own chip chrome.
              // Outer RightSidebar container owns CHIP_BASE; pane just
              // contributes a hairline divider against the rail and a
              // cross-fade body so opening reads as expansion.
              'w-[300px] shrink-0 border-white/10 border-r',
              'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150',
            ),
      )}
    >
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-white/10 border-b px-3">
        <div className="flex min-w-0 items-center gap-2">
          <config.icon aria-hidden="true" className="size-4 shrink-0 text-white/70" />
          <h2 id={headingId} className="min-w-0 truncate font-semibold text-sm tracking-tight">
            {config.label}
          </h2>
        </div>
        {!inSheet ? (
          <button
            type="button"
            aria-label="Close pane"
            onClick={onClose}
            className={cn(
              'inline-flex size-7 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white',
              CHIP_FOCUS,
            )}
          >
            <XIcon aria-hidden="true" className="size-4" />
          </button>
        ) : null}
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
