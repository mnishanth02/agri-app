# UI/UX redesign v2 — Module 5.7 (Edge-anchored chrome v2)

> **Status:** Planned · Owner: web team · Driver: user feedback after Module 5.6 ship.
> **Tracking entry:** Add `### Module 5.7 — Edge-anchored chrome v2 ✅ (completed YYYY-MM-DD)` under Phase 5 in [`implementation.md`](./implementation.md) when shipped.
> **Companion:** [`ui-ux-redesign.md`](./ui-ux-redesign.md) (Module 5.6) is the precursor; this doc supersedes its bottom-bar / right-sidebar / header sections only.

---

## 1. Problem statement

The Module 5.6 layout shipped edge-anchored chrome successfully, but field testing on `/fields/$id` surfaced four follow-on issues:

1. **Bottom-left tray clips left chrome.** When `BottomBar` expands (320 × 360), it overlaps `ZoomControls` + `FullscreenButton` (both anchored at `left-3, top-1/2 ± 52`). The reference screenshot the user attached shows the tray covering the zoom/fullscreen column.
2. **Date timeline has trailing dead space.** `DateTimeline` chips are fixed `w-12`; with the current 9 placeholder scenes inside a `w-[min(720px,…)]` chip there is visible empty space after the last chip on wide viewports. The strip needs to fill the available width and reflow with the data instead of always rendering as a fixed-width bar.
3. **Right sidebar feels like two separate components.** The rail (chip A) and the pane (chip B) currently render as two `CHIP_BASE` containers with `mr-2` between them and a `slide-in-from-right-2` animation on the pane. Visually this reads as "a new component appeared" instead of "the rail expanded".
4. **Global header is dead weight on this screen.** The `_auth` route header (3.5 rem brand + `UserButton`) only repeats data already on the dashboard. On `/fields/$id` the user wants every pixel for the map.

There is also an open question about where the `BottomBar` "wastes vertical space" below the timeline — the actual cause is the bottom-left tray sitting *next to* the bottom-centre `DateTimeline` instead of stacking vertically; the redesign collapses both into a single bottom region (dock + floating row).

---

## 2. Goals

1. The map gains the full viewport height on `/fields/$id` (no `_auth` header).
2. A **full-width bottom dock** holds Crop / Chart / Activities, expanding upward; collapses to a flat bar.
3. Above the dock, a **single floating row** carries the date timeline (centred) and the layer-control cluster (right). Both shift up together as the dock expands.
4. **Date timeline chips fill the available row width** equally; if more chips than fit, the row scrolls horizontally as today.
5. **Right sidebar reads as a single growing chip** (rail + pane + cross-fade body inside one rounded container with a hairline divider) rather than two separate chips with a slide-in animation.
6. **Zoom + fullscreen** controls move with the dock so they are never covered.
7. No regressions to keyboard navigation, focus restore, `useUiStore` shape, or Phase 6 / 7 data wiring contracts.

---

## 3. Decisions (confirmed with user before plan finalisation)

| # | Question | Choice |
|---|---|---|
| Q1 | Where does the user menu (sign-out) live after the header is removed on this screen? | **Drop it from this screen** — the user signs out from the dashboard. No avatar mounted on `/fields/$id`. |
| Q2 | Bottom dock shape | **Edge-to-edge full-width**, only the top corners rounded (`rounded-t-2xl rounded-b-none`). Row above is also full-width with timeline centred and layer cluster on the right. |
| Q3 | Date chip sizing | **Flex to fill the row evenly** — `flex-1` per chip with a `min-w-12 max-w-20` clamp; horizontal scroll fallback when chips exceed the cap. |
| Q4 | Right sidebar unification | **Single rounded container that grows in width** — rail glued to the right edge, pane content slides in to its left, separated only by a `border-r border-white/10` hairline; cross-fade pane body (no slide). |

---

## 4. Anatomy after redesign

```
┌────────────────────────────────────────────────────────────────────────────┐
│ TopBar (top-3 left-3)                       GetOverview · FieldSwitcher    │
│                                                          (top-3 right-20)  │
│                                                                            │
│ ZoomControls ─┐                                          ┌─ RightSidebar   │
│ Fullscreen   ─┘ (left-3, bottom-{driven by dock state})  │ (top-3 right-3) │
│                                                          │   one chip:     │
│ CloudHiddenToast (left-3, bottom-{driven by dock})       │   rail | pane   │
│                                                          │   width animates│
│                                                          │   16 → 364 px   │
│                                                                            │
│ ╭────────── BottomRow (inset-x-0, bottom-{driven by dock}) ──────────────╮ │
│ │             DateTimeline (centre, flex-1)            LayerCluster     │ │
│ ╰───────────────────────────────────────────────────────────────────────╯ │
│ ┌───────────── BottomDock (inset-x-0 bottom-0) ────────────────────────┐  │
│ │ [Crop] [Chart] [Activities]                                  [▾/▴]   │  │
│ │ ── expanded body, max-h-[40vh], grid-cols-1 md:2 lg:4 cards ──        │  │
│ └─────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

Key invariant: `BottomDock`, `BottomRow`, `ZoomControls`, `FullscreenButton`, and `CloudHiddenToast` all read **`useUiStore.bottomBarTab !== null`** and animate their `bottom` together via `motion-safe:transition-[bottom] duration-200`. Nothing else moves when the dock toggles.

---

## 5. Phase A — Drop the global header on `/fields/$id`

Depends on: nothing. Parallelisable with Phase B.

### A.1 Gate the auth header by route match

**File:** [`apps/web/src/routes/_auth/route.tsx`](../apps/web/src/routes/_auth/route.tsx)

- Import `useMatches` from `@tanstack/react-router`.
- Inside `AuthLayout`, compute `const isAnalysisRoute = useMatches().some((m) => m.routeId === '/_auth/fields/$id');`.
- When `isAnalysisRoute` is true, render only `<Outlet />` (no `<header>` chrome). Otherwise, render the existing brand + `UserButton` header unchanged.
- Keep the `beforeLoad` redirect intact — auth gating must not change.

**Done when:** Navigating to `/fields/$id` shows zero header; `/` and `/fields/new` still render the brand + sign-out menu.

### A.2 Reclaim the 3.5 rem on the analysis canvas

**File:** [`apps/web/src/layouts/AnalysisLayout.tsx`](../apps/web/src/layouts/AnalysisLayout.tsx)

- Change the root `<section>` height from `h-[calc(100dvh-3.5rem)]` to `h-dvh w-full overflow-hidden bg-black`.
- Update `FitToFieldBounds` padding from `{ top: 64, right: 88, bottom: 96, left: 88 }` → `{ top: 24, right: 96, bottom: 132, left: 96 }`.
  - `top: 24` — no header, only the `top-3` chip envelope.
  - `bottom: 132` — clears the collapsed `BottomDock` (44 px header) + `BottomRow` chip (40 px) + 12 px breathing × 2 + 24 px safety. We deliberately size for the collapsed state; expansion is short and the user already knows their polygon.
  - `right: 96` / `left: 96` — symmetric clearance for the right rail (64 px) plus 12 + 12 px and the left zoom column (40 + 12 + 12 + safety).

### A.3 Match the loading skeleton sizing

**File:** [`apps/web/src/routes/_auth/fields.$id.tsx`](../apps/web/src/routes/_auth/fields.$id.tsx)

- Update the `FieldDetailSkeleton` wrapper class from `h-[calc(100dvh-3.5rem)]` to `h-dvh` so the placeholder fills the same viewport as the real `<AnalysisLayout>` (no layout shift on hydration).

### A.4 Verify nothing else assumes a 3.5 rem header

- Grep `apps/web/src` for `100dvh-3.5rem` and `3.5rem`. Allowed remaining usage: `CreateLayout.tsx` (still under the header).
- Confirm `EmptyState.tsx`, `FieldList.tsx`, dashboard route, and `/fields/new` all still render under the `_auth` header (they should — they're not the gated route).

---

## 6. Phase B — Right sidebar feels like one expanding panel

Depends on: nothing. Parallelisable with Phase A.

### B.1 Move chip chrome to the outer container (md+ only)

**File:** [`apps/web/src/components/shell/RightSidebar.tsx`](../apps/web/src/components/shell/RightSidebar.tsx)

In the `if (isMd) return …` branch, restructure the existing flex container so it owns the chip chrome:

- Apply `CHIP_BASE` to the outer `<div>` (the one that already animates width `w-16 → w-[364px]`).
- Keep the existing `motion-safe:transition-[width] duration-200 ease-out` on it.
- Inside, render `<PaneBody>` first (when active) then `<Rail>` last (it stays glued to the right edge). The flex order is unchanged; we are just moving where `CHIP_BASE` lives.

### B.2 Strip duplicate chip chrome from `Rail`

- Remove `CHIP_BASE` from the inner `Rail` `<div>` className.
- Keep the layout classes (`flex h-full w-16 shrink-0 flex-col items-center gap-1 overflow-y-auto py-3`) and `role="toolbar"` / `aria-orientation="vertical"` / key-nav exactly as they are.

### B.3 Strip duplicate chip chrome from `PaneBody` and add the divider

In `PaneBody`:

- When `inSheet === false`, replace the current className composition `cn(CHIP_BASE, 'mr-2 w-[300px] shrink-0', 'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-2 motion-safe:duration-200')` with: `'flex h-full w-[300px] shrink-0 flex-col overflow-hidden border-r border-white/10 text-white motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150'`.
  - No `CHIP_BASE`, no `mr-2` (no gap → seamless).
  - Hairline `border-r` separates pane content from rail.
  - Cross-fade only (no slide), 150 ms — width animation already conveys the "growing" motion.
- When `inSheet === true` (`<md` Sheet branch), keep the current `w-full` rendering and **do not** add the right border (sheets don't have a rail next to them).

### B.4 Verify `<md` Sheet branch unchanged

- The `<md` branch still renders the rail with `CHIP_BASE` (it stands alone) and escalates the pane to a `<Sheet side="right">`. No edits needed there.

### B.5 Smoke

- Click each rail item: pane appears with cross-fade only; outer chip widens; no second shadow / second border visible at the seam.
- Toggle the same item again: pane fades out, chip narrows back to 64 px.
- Tab through the rail: focus ring only on the active button, divider stays static.

---

## 7. Phase C — Bottom dock + floating row

Depends on: Phase A (so the dock + row sit at the actual bottom of the viewport, not above a header).

### C.1 Create `BottomDock`

**New file:** [`apps/web/src/components/shell/BottomDock.tsx`](../apps/web/src/components/shell/BottomDock.tsx)

Replace the bottom-left corner tray with a full-width dock that anchors to the bottom edge.

**Container**

- Outer element: `<section aria-label="Field details">` with class `pointer-events-auto fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-black/80 text-white shadow-lg backdrop-blur-md saturate-150 rounded-t-2xl`.
  - We deliberately don't use `CHIP_BASE` because it includes `rounded-lg` for all four corners and our dock needs `rounded-t-2xl` only.
  - Use the same dark-glass colour stack so it visually matches the chips.

**Header row (always visible)**

- Height `h-11`; horizontal padding `px-3 md:px-4`.
- Left: `<Tabs value={bottomBarTab ?? ''} onValueChange={…}>` with the same three triggers as the old `BottomBar`. Keep `CHIP_FOCUS` on triggers.
- Right: chevron toggle button (`ChevronUpIcon` collapsed → `ChevronDownIcon` expanded). Same `lastActiveTabRef` logic from `BottomBar` so re-expanding restores the previous tab.
- Tooltip wrapper unchanged.

**Body (only when expanded)**

- Conditional render when `bottomBarTab !== null`.
- Class: `max-h-[40vh] min-h-[260px] overflow-y-auto overscroll-contain border-white/10 border-t px-4 md:px-6 py-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200`.
- Inner: `<TabsContent>` for `cropInfo` / `chart` / `activities` rendering a `<div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">` of cards. Lift the existing `CropInfoTab`, `ChartTab`, `ActivitiesTab`, and `BottomBarBody` from the old `BottomBar.tsx` into this file unchanged.
- No `<md` Sheet escalation — the dock IS already a full-width sheet at every viewport.

**State + behaviour**

- Same `useUiStore.bottomBarTab` selector + `setBottomBarTab`. No new store keys.
- ESC handler on the section root collapses the dock and refocuses the chevron (mirror the pattern in current `BottomBar`).
- Tab change selects a tab and (if collapsed) auto-expands to the chosen tab.

### C.2 Create `BottomRow`

**New file:** [`apps/web/src/components/shell/BottomRow.tsx`](../apps/web/src/components/shell/BottomRow.tsx)

Hosts the timeline and layer cluster on a single row that floats just above the dock and shifts up when the dock expands.

**Container**

- `<div className={cn('pointer-events-none fixed inset-x-0 z-10 flex items-center gap-3 px-3 motion-safe:transition-[bottom] motion-safe:duration-200', expanded ? 'bottom-[calc(40vh+0.75rem)]' : 'bottom-14')}>`.
  - `bottom-14` (≈ 3.5 rem) clears the collapsed dock header (`h-11` ≈ 2.75 rem) + 0.75 rem gap.
  - `bottom-[calc(40vh+0.75rem)]` clears the expanded dock body cap.
  - `pointer-events-none` on the wrapper, `pointer-events-auto` re-enabled on each child via the existing chip styles.

**Slots (left → centre → right)**

- Left: empty `<div className="hidden md:block w-10" aria-hidden="true" />` spacer to keep the centre visually balanced when the layer cluster is wide.
- Centre: `<div className="flex flex-1 min-w-0 justify-center"><DateTimeline /></div>`.
- Right: `<div className="shrink-0"><LayerControlCluster /></div>`.

**State**

- Single Zustand selector: `const expanded = useUiStore((s) => s.bottomBarTab !== null)`. No new store keys.

### C.3 Rewrite `DateTimeline`

**File:** [`apps/web/src/components/map/overlays/DateTimeline.tsx`](../apps/web/src/components/map/overlays/DateTimeline.tsx)

Current: self-positioned at `pointer-events-none absolute bottom-20 left-1/2 -translate-x-1/2` with fixed `w-12` chips inside a fixed `w-[min(720px,calc(100vw-1.5rem))]` chip — produces dead space on wide viewports.

New behaviour:

- **Drop self-positioning** — `BottomRow` owns position. Outer chip becomes `cn(CHIP_BASE, 'pointer-events-auto flex h-10 w-full max-w-[min(900px,calc(100vw-12rem))] items-center gap-1 px-1.5')`.
  - `w-full` so it claims the centre slot's flexed width.
  - `max-w-[min(900px,calc(100vw-12rem))]` — caps wide viewports so the row doesn't crowd the layer cluster on the right; `12rem` accounts for the cluster + gaps.
- **Chips become flexible**: each scene button gets `flex-1 min-w-12 max-w-20` (was `w-12`). Inner content stays `flex-col items-center justify-center` with `truncate` on the day label. Icon (cloud) absolute-positioned as today.
- **Scroll fallback** kicks in only when `flex-1` cannot honour `min-w-12` for all chips; the scroll container keeps `overflow-x-auto scroll-smooth [scrollbar-width:none]`.
- Keep arrow buttons (`ChevronLeft/Right`), keep "Next: …" hint, keep `role="toolbar"` + `aria-orientation="horizontal"` + `aria-label="Recent scenes"` and per-chip `aria-pressed` / `aria-label` (`${day} ${year}${cloudy ? ' (cloudy)' : ''}`).
- Keep the placeholder `SCENES` array but extract it to a single top-level const so Phase 6 swap (`useEosdaScenes(fieldId)`) is a one-line drop-in.

### C.4 Detach `LayerControlCluster` from absolute positioning

**File:** [`apps/web/src/components/map/overlays/LayerControlCluster.tsx`](../apps/web/src/components/map/overlays/LayerControlCluster.tsx)

- In the `md+` branch, drop the wrapper `<div className="pointer-events-auto absolute right-20 bottom-3">` — return the chip / puck directly. Same for the `<md` popover branch (drop `absolute right-3 bottom-3`).
- All other behaviour unchanged: local `expanded` state, breakpoint-driven default, `<md` collapses to a `LayersIcon` puck opening a vertical popover.

### C.5 Stop mounting timeline + layer cluster from `MapOverlays`

**File:** [`apps/web/src/components/map/overlays/MapOverlays.tsx`](../apps/web/src/components/map/overlays/MapOverlays.tsx)

- Remove imports + JSX for `DateTimeline` and `LayerControlCluster`. Both now mount inside `BottomRow`.
- Keep `CoordsBadge`, `ScaleBar`, `ZoomControls`, `FullscreenButton`, `CloudHiddenToast`.

### C.6 Re-anchor left chrome so the dock can never cover it

The user's specific concern: when the bottom-left tray expanded, it covered `ZoomControls` + `FullscreenButton`. The fix is to move both onto the left edge with the same dual-state `bottom` the dock + row use.

**File:** [`apps/web/src/components/map/overlays/ZoomControls.tsx`](../apps/web/src/components/map/overlays/ZoomControls.tsx)

- Add `const expanded = useUiStore((s) => s.bottomBarTab !== null);`.
- Change the wrapper className:
  - From: `'pointer-events-auto absolute top-1/2 left-3 -translate-y-1/2 p-1'`
  - To:   `cn('pointer-events-auto absolute left-3 p-1 motion-safe:transition-[bottom] motion-safe:duration-200', expanded ? 'bottom-[calc(40vh+5rem)]' : 'bottom-28')`.
  - `bottom-28` (≈ 7 rem) clears the collapsed dock (`h-11`) + row (`h-10`) + breathing room.
  - `bottom-[calc(40vh+5rem)]` clears the expanded dock + row.
- Keep MapLibre re-skin selectors + `CHIP_BASE` chip styling unchanged.

**File:** [`apps/web/src/components/map/overlays/FullscreenButton.tsx`](../apps/web/src/components/map/overlays/FullscreenButton.tsx)

- Same Zustand selector.
- Replace `'pointer-events-auto absolute left-3 top-[calc(50%+52px)] p-1'` with `cn('pointer-events-auto absolute left-3 p-1 motion-safe:transition-[bottom] motion-safe:duration-200', expanded ? 'bottom-[calc(40vh+8rem)]' : 'bottom-[calc(7rem+52px)]')` — i.e. stack 52 px above `ZoomControls` in both states.

### C.7 Reposition `CloudHiddenToast`

**File:** [`apps/web/src/components/map/overlays/CloudHiddenToast.tsx`](../apps/web/src/components/map/overlays/CloudHiddenToast.tsx)

- Visibility behaviour unchanged (auto-dismiss after 8 s, manual `XIcon` close).
- `bottom` state now keys off the same `bottomBarTab` selector but with values that clear the dock + row:
  - Collapsed: `bottom-[7rem]` (≈ 112 px — sits above the row + zoom).
  - Expanded: `bottom-[calc(40vh+6.5rem)]`.
- Keep `motion-safe:transition-[bottom] duration-200`.

### C.8 Wire it all in `AnalysisLayout`

**File:** [`apps/web/src/layouts/AnalysisLayout.tsx`](../apps/web/src/layouts/AnalysisLayout.tsx)

- Import `BottomDock` (replaces `BottomBar`) and `BottomRow`.
- Inside the `pointer-events-none absolute inset-0` chrome layer:
  - Remove the `<div className="pointer-events-auto absolute bottom-3 left-3"><BottomBar … /></div>` wrapper.
  - Mount `<BottomDock field={field} />` and `<BottomRow />` directly (both self-position via fixed/absolute classes).
- Top-left, top-right, and right-rail slots stay as they are.
- Padding update for `FitToFieldBounds` already covered in A.2.

### C.9 Delete the old `BottomBar`

**File:** [`apps/web/src/components/shell/BottomBar.tsx`](../apps/web/src/components/shell/BottomBar.tsx) — **delete** after `BottomDock` is wired and the type checker is clean. Also remove any test imports / Playwright selectors that reference `BottomBar`-specific testids.

---

## 8. Phase D — Cleanup, docs, verification

### D.1 Static checks

- `pnpm biome check apps/web/src` → clean.
- `pnpm --filter @viz-crop/web typecheck` → clean.

### D.2 Tests

- `pnpm --filter @viz-crop/web test` for unit tests; ensure no tests imported `BottomBar` directly.
- `pnpm --filter @viz-crop/web exec playwright test` — re-baseline analysis-screen snapshots in [`apps/web/e2e/dashboard.spec.ts`](../apps/web/e2e/dashboard.spec.ts) if they are affected. Use `--update-snapshots` only after a manual visual review, then commit the new pixels separately.

### D.3 Documentation

- **`docs/implementation.md`**: append under Phase 5:

  ```markdown
  ### Module 5.7 — Edge-anchored chrome v2 ✅ (completed YYYY-MM-DD)

  Depends on: 5.6.

  Field-test feedback after 5.6 led to four shifts: (1) `_auth` header is gated off on `/fields/$id` so the map owns the full viewport; (2) the bottom-left tray became a full-width `BottomDock` that opens upward with `Crop / Chart / Activities`; (3) `DateTimeline` and `LayerControlCluster` moved into a new `BottomRow` that floats above the dock and shifts up with it; (4) `RightSidebar` rail + pane unified into a single growing chip with a hairline divider and cross-fade body so opening a pane reads as expansion, not a new component. `ZoomControls`, `FullscreenButton`, and `CloudHiddenToast` re-anchored to the left edge with `bottom` driven by `bottomBarTab` so the dock can no longer cover them. See [`docs/ui-ux-redesign-v2.md`](./ui-ux-redesign-v2.md) for the full plan.

  **Done when:** `/fields/$id` renders without the `_auth` header; dock + row + left chrome animate together; right sidebar opens as one chip; `pnpm check` and `pnpm typecheck` clean.
  ```

- **`docs/ui-ux-redesign.md`**: add a one-line cross-reference at the top: *"Superseded by [`ui-ux-redesign-v2.md`](./ui-ux-redesign-v2.md) for the bottom-bar / right-sidebar / header sections."*

### D.4 Memory note

Once shipped, drop `/memories/session/plan.md` from session memory (no longer needed).

---

## 9. File-by-file change inventory

| File | Action | Notes |
|---|---|---|
| [`apps/web/src/routes/_auth/route.tsx`](../apps/web/src/routes/_auth/route.tsx) | **Edit** | Skip `<header>` when active route id is `/_auth/fields/$id`. |
| [`apps/web/src/layouts/AnalysisLayout.tsx`](../apps/web/src/layouts/AnalysisLayout.tsx) | **Edit** | `h-dvh` (drop 3.5 rem); replace `BottomBar` with `BottomDock`; mount `BottomRow`; update `FitToFieldBounds` padding. |
| [`apps/web/src/routes/_auth/fields.$id.tsx`](../apps/web/src/routes/_auth/fields.$id.tsx) | **Edit** | `FieldDetailSkeleton` switches to `h-dvh`. |
| [`apps/web/src/components/shell/RightSidebar.tsx`](../apps/web/src/components/shell/RightSidebar.tsx) | **Edit** | Outer container owns `CHIP_BASE`; strip from rail + pane; `border-r border-white/10` divider on pane; cross-fade only. |
| [`apps/web/src/components/shell/BottomBar.tsx`](../apps/web/src/components/shell/BottomBar.tsx) | **Delete** | Replaced by `BottomDock`. |
| [`apps/web/src/components/shell/BottomDock.tsx`](../apps/web/src/components/shell/BottomDock.tsx) | **Create** | Full-width dock, `rounded-t-2xl`, `h-11` header + `max-h-[40vh] min-h-[260px]` body, `grid-cols-1 md:2 lg:4`. Lifts `CropInfoTab` / `ChartTab` / `ActivitiesTab` / `BottomBarBody`. |
| [`apps/web/src/components/shell/BottomRow.tsx`](../apps/web/src/components/shell/BottomRow.tsx) | **Create** | Fixed full-width row hosting `DateTimeline` (centre, `flex-1`) + `LayerControlCluster` (right). Animated `bottom` driven by `bottomBarTab`. |
| [`apps/web/src/components/map/overlays/DateTimeline.tsx`](../apps/web/src/components/map/overlays/DateTimeline.tsx) | **Edit** | Drop self-positioning; chips `flex-1 min-w-12 max-w-20`; outer chip `w-full max-w-[min(900px,calc(100vw-12rem))]`; keep arrows + hint. |
| [`apps/web/src/components/map/overlays/LayerControlCluster.tsx`](../apps/web/src/components/map/overlays/LayerControlCluster.tsx) | **Edit** | Drop `absolute right-20 bottom-3` (md+) and `absolute right-3 bottom-3` (`<md`); return chip/puck directly. |
| [`apps/web/src/components/map/overlays/MapOverlays.tsx`](../apps/web/src/components/map/overlays/MapOverlays.tsx) | **Edit** | Remove `DateTimeline` and `LayerControlCluster` (now in `BottomRow`). |
| [`apps/web/src/components/map/overlays/ZoomControls.tsx`](../apps/web/src/components/map/overlays/ZoomControls.tsx) | **Edit** | Re-anchor to `left-3` with `bottom` driven by `bottomBarTab` (`bottom-28` collapsed / `bottom-[calc(40vh+5rem)]` expanded). |
| [`apps/web/src/components/map/overlays/FullscreenButton.tsx`](../apps/web/src/components/map/overlays/FullscreenButton.tsx) | **Edit** | Stack 52 px above `ZoomControls` in both states. |
| [`apps/web/src/components/map/overlays/CloudHiddenToast.tsx`](../apps/web/src/components/map/overlays/CloudHiddenToast.tsx) | **Edit** | `bottom-[7rem]` collapsed / `bottom-[calc(40vh+6.5rem)]` expanded. |
| [`apps/web/src/components/map/overlays/ScaleBar.tsx`](../apps/web/src/components/map/overlays/ScaleBar.tsx) | _no change_ | Already top-right `lg+` only. |
| [`apps/web/src/components/map/overlays/CoordsBadge.tsx`](../apps/web/src/components/map/overlays/CoordsBadge.tsx) | _no change_ | Already top-left `lg+` only. |
| [`apps/web/src/components/shell/sidebar-items.ts`](../apps/web/src/components/shell/sidebar-items.ts) | _no change_ | Config stable. |
| [`apps/web/src/stores/useUiStore.ts`](../apps/web/src/stores/useUiStore.ts) | _no change_ | `bottomBarTab` + `activeSidebarItem` reused as-is. |
| [`apps/web/e2e/dashboard.spec.ts`](../apps/web/e2e/dashboard.spec.ts) | **Edit (snapshots only)** | Re-baseline analysis-screen visual diffs after manual review. |
| [`docs/implementation.md`](./implementation.md) | **Edit** | Append Module 5.7 ✅ entry. |
| [`docs/ui-ux-redesign.md`](./ui-ux-redesign.md) | **Edit** | Add cross-reference to this doc at the top. |
| [`docs/ui-ux-redesign-v2.md`](./ui-ux-redesign-v2.md) | **(this file)** | The plan itself. |

---

## 10. Verification matrix

| # | Check | How |
|---|---|---|
| V1 | `pnpm check` clean across `apps/web`. | Run locally before each commit. |
| V2 | `pnpm typecheck` clean across `apps/web`. | Same. |
| V3 | `/fields/$id` renders no `_auth` header. | Manual smoke in a fresh tab. |
| V4 | `/` and `/fields/new` still render the brand + `UserButton` header. | Manual smoke. |
| V5 | Bottom dock collapsed by default; chevron expands; ESC collapses; chevron regains focus on collapse. | Manual + keyboard. |
| V6 | When the dock expands: `BottomRow`, `ZoomControls`, `FullscreenButton`, `CloudHiddenToast` all transition `bottom` simultaneously (~200 ms) and never overlap. | Manual smoke at 1440 / 1280 / 1024 / 768 / 390 px. |
| V7 | `DateTimeline` chips fill the row width with no trailing gap when 9 placeholder scenes are shown. | Manual smoke; sanity check at 1440 / 1280 / 1024 px. |
| V8 | Temporarily padding `SCENES` to 30 chips falls back to horizontal scroll (chip min-width respected). | Manual smoke; revert padding before commit. |
| V9 | `LayerControlCluster` sits to the right of the timeline at every md+ width; collapses to a single puck + popover at `<md`. | Manual smoke. |
| V10 | Right sidebar rail click expands into one continuous chip — no double border, no double shadow, no gap; pane content cross-fades. | Manual smoke + DevTools border inspection. |
| V11 | Tab order: TopBar → top-right (`GetOverview` + `FieldSwitcher`) → BottomDock tabs → BottomDock chevron → DateTimeline → LayerCluster → RightSidebar rail → rail items. Esc closes pane and collapses dock. | Manual keyboard tour. |
| V12 | No console errors at first paint or after each chrome toggle. | DevTools console open during smoke. |
| V13 | `useUiStore` unit tests pass without edits. | `pnpm -F @viz-crop/web test`. |
| V14 | Playwright snapshots updated and committed only after manual review. | `playwright test --update-snapshots`. |
| V15 | `grep -rn "BottomBar" apps/web/src` returns no matches after deletion. | grep at the end of C.9. |

---

## 11. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Removing the header on `/fields/$id` strands users who only know "click avatar to sign out". | Low | Q1 confirmed they sign out from the dashboard; the back-arrow in `TopBar` already returns to `/`. |
| `useMatches()` route id matching diverges from TanStack Router's internal id (e.g. with route groups). | Low | Use the literal generated id from `routeTree.gen.ts` (`/_auth/fields/$id`); fall back to `useMatch({ from: '/_auth/fields/$id', shouldThrow: false })` if the comparison ever returns nothing. |
| Floating row + dock both fixed → on iOS Safari with the URL bar collapsing, `40vh` may briefly clip. | Low | `dvh` already handles dynamic viewport on the layout itself; `40vh` on the dock body is a max-height not a min-height, so worst case the user scrolls inside the dock. |
| Re-anchoring `ZoomControls` + `FullscreenButton` to the bottom-left could feel unfamiliar to users used to centre-left. | Low | The original position was already crowded by the chevron from the old tray; the bottom-left position groups left-edge controls together and is consistent with mobile map UX (Google Maps, Apple Maps). |
| Playwright visual diffs balloon. | Medium | Diff and review per-snapshot before re-baselining; commit pixel updates in a separate commit so the code change stays reviewable. |
| Lifting `CropInfoTab` / `ChartTab` / `ActivitiesTab` into the new file accidentally drops a styling variant. | Medium | Move them verbatim — do not refactor in the same PR. Keep the existing `CARD_CLASS` const and `Row` helper. |

---

## 12. Out of scope (explicitly deferred)

- Real timeline data wiring (Phase 6 — `useEosdaScenes`).
- Real Sample / Chart data (Phase 7).
- Persisting `LayerControlCluster.expanded` to `useUiStore` (still local state).
- Light-mode theming.
- Touch swipe-to-expand on the dock (chevron tap is sufficient for v2).
- Extracting a shared `useBottomDockBottomOffset()` hook — keep the Zustand selector inline in each chrome component for now; promote later if a fifth element starts using it.
- Multi-field switching for real (the `FieldSwitcherChip` placeholder stays as-is).
- Analytics / telemetry on dock + sidebar toggles.

---

## 13. Phase exit criteria

The redesign is complete when **all** of the following hold:

1. `/fields/$id` renders no `_auth` header; map fills `100dvh`.
2. `BottomDock` exists as a full-width dock with `Crop / Chart / Activities`; collapses to a flat bar; expands to ≤ 40 vh of cards in a `grid-cols-1 md:2 lg:4` layout.
3. `BottomRow` hosts `DateTimeline` (centred, `flex-1` chips, no trailing dead space) + `LayerControlCluster` (right) and shifts up in lockstep with the dock.
4. `ZoomControls`, `FullscreenButton`, `CloudHiddenToast` shift up with the dock and are never covered.
5. `RightSidebar` renders as a single growing chip with a hairline divider; opening a pane reads as expansion, not insertion.
6. `BottomBar.tsx` is deleted; no remaining imports.
7. `useUiStore` shape is unchanged; existing unit tests pass without edits.
8. Keyboard tour reaches every interactive element; Esc closes pane / collapses dock.
9. No console errors at first paint or after any chrome toggle.
10. `pnpm check` and `pnpm typecheck` are green for `apps/web`; Playwright snapshots re-baselined and committed.
