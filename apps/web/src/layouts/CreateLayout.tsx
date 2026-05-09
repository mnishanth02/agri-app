/**
 * Module 2.5 — `CreateLayout`.
 *
 * 2-column responsive shell for `/fields/new`: map on the left (~70%),
 * field-details form column on the right (~30%). Phase 3 wires the form
 * into the right column; Phase 2 leaves it as a placeholder.
 *
 * ## Sizing contract
 *
 * The authenticated layout (`routes/_auth/route.tsx`) renders a sticky
 * `h-14` (3.5rem) header above `<Outlet />`. MapLibre needs a non-zero
 * `clientHeight` on the container at construction time, so this layout
 * pins itself to `calc(100dvh - 3.5rem)` so the map column has a
 * deterministic viewport height regardless of how much content the form
 * column renders. `dvh` accounts for mobile browser chrome collapsing
 * the visual viewport; we fall back via `min-h-[...]` semantics by also
 * setting `h-[calc(100dvh-3.5rem)]` so the map cannot grow to push the
 * page into a scroll state.
 *
 * Below the `md` breakpoint the columns stack (map on top, form below);
 * we keep the map at a fixed `60dvh` slice on mobile so the form column
 * stays reachable without an awkward scroll-then-scroll-again gesture.
 *
 * ## Subtree isolation
 *
 * The map subtree is rendered through `mapSlot`, the form via
 * `formSlot`. Future form state lives inside `formSlot` and must not be
 * threaded into `mapSlot` as props — the map subtree should re-render
 * only on map identity / readiness changes, never on field-name typing.
 */

import type { ReactNode } from 'react';

export type CreateLayoutProps = {
  mapSlot: ReactNode;
  formSlot: ReactNode;
};

export function CreateLayout({ mapSlot, formSlot }: CreateLayoutProps) {
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-[calc(100dvh-3.5rem)] w-full flex-col md:flex-row">
      <section
        aria-label="Field map"
        className="relative h-[60dvh] w-full shrink-0 md:h-full md:w-[70%]"
      >
        {mapSlot}
      </section>

      <aside
        aria-label="Field details form"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto border-border border-t bg-background md:border-t-0 md:border-l"
      >
        {formSlot}
      </aside>
    </div>
  );
}
