# Field Analysis UI/UX Redesign Plan

> **Superseded by [`ui-ux-redesign-v2.md`](./ui-ux-redesign-v2.md)** for the bottom-bar / right-sidebar / header sections (Module 5.7). The rest of this document still applies to Module 5.6 (edge-anchored chrome v1).

> Companion to [`implementation.md`](./implementation.md). Phase 5 has shipped the full layout (`/fields/$id`) but the chrome is overcrowded and breaks on common laptop widths. This document specifies the redesign and is meant to be executed **before** Phase 6 begins so NDVI tiles land in the corrected chrome rather than the legacy one.
>
> **Document version:** 1.0
> **Status:** Proposed — awaiting implementation kickoff
> **Source of truth:** [`plan.md`](./plan.md) § 2 ("Field Analysis Screen Anatomy") still owns the *what*. This document owns the *how it should look and behave*. Any conflict — this doc wins for visuals/positioning, `plan.md` wins for product behaviour and data wiring.
> **Phase entry:** Phase 5 complete (it is). Phase 6 must wait for this redesign so NDVI tile work targets the new layout.

---

## Table of contents

- [1. Why we are redesigning](#1-why-we-are-redesigning)
- [2. Design principles](#2-design-principles)
- [3. New screen anatomy](#3-new-screen-anatomy)
- [4. Locked decisions](#4-locked-decisions)
- [5. Module R.A — Layout architecture (kill the dodge)](#5-module-ra--layout-architecture-kill-the-dodge)
- [6. Module R.B — Component compaction](#6-module-rb--component-compaction)
- [7. Module R.C — Responsive behaviour](#7-module-rc--responsive-behaviour)
- [8. Module R.D — Visual polish + cleanup](#8-module-rd--visual-polish--cleanup)
- [9. Phase exit criteria](#9-phase-exit-criteria)
- [10. File-by-file change inventory](#10-file-by-file-change-inventory)
- [11. Verification matrix](#11-verification-matrix)
- [12. Out of scope](#12-out-of-scope)
- [13. Appendix — Design tokens](#13-appendix--design-tokens)

---

## 1. Why we are redesigning

After dogfooding `/fields/$id` at common laptop widths, four problems consistently surface:

| # | Symptom | Root cause |
|---|---|---|
| 1 | When the right pane opens, **every other shell shifts left** and on viewports ≤ 1280 px part of the centred chrome lands outside the viewport. | A "dodge" pattern: `AnalysisLayout` and four overlays each apply `lg:[transform:translateX(calc(-50%_-_11rem))]` or `lg:right-[25rem]` when `useUiStore.activeSidebarItem !== null`. See [`AnalysisLayout.tsx` lines 110–169](../apps/web/src/layouts/AnalysisLayout.tsx) and the matching guards in [`AnalysisToolbar.tsx`](../apps/web/src/components/map/overlays/AnalysisToolbar.tsx), [`DateTimeline.tsx`](../apps/web/src/components/map/overlays/DateTimeline.tsx), [`SourceSwitcher.tsx`](../apps/web/src/components/map/overlays/SourceSwitcher.tsx), [`ScaleBar.tsx`](../apps/web/src/components/map/overlays/ScaleBar.tsx). |
| 2 | Two stacked centred bars at the top consume **~96 px of vertical space** (TopBar at `top-3` + AnalysisToolbar at `top-20`) before the map breathes. | Two separate centred chips that should be one corner cluster. |
| 3 | The NDVI/EVI/NDWI switcher is **3 wide pill buttons** (~220 px) plus an always-visible opacity row (~190 px) plus a download icon — the entire row dominates the screen even when idle. | Always-visible controls instead of a single expand-on-click cluster. |
| 4 | The 640 px-wide centred BottomBar **overlaps** SourceSwitcher / DateTimeline / right pane. | The BottomBar competes with the DateTimeline for the centred slot. |

The reference UI from a comparable agriculture product solves all four by using **edge-anchored chrome** (corners + sides only, never centred competing) and by **collapsing related controls into single dropdowns/popovers**.

---

## 2. Design principles

These principles drive every decision below; cite them in PR review when something violates one.

1. **The map is the hero.** Chrome reserves the corners; the map owns the centre.
2. **Edge-anchored, never centre-spine.** Centred chrome competes with the map; corner chrome stays out of the way.
3. **Nothing dodges.** Opening any panel never repositions any other panel. If two would overlap, one is wrong.
4. **One control = one chip.** Related controls live in one frosted chip; unrelated controls live in separate chips.
5. **Compact by default, expand on intent.** Always-visible rows become icon-popovers; details surface on click.
6. **Same shape everywhere.** One height (`h-10` chips, `h-9` icon buttons), one inset (`3` = 12 px), one frosted style.
7. **Mobile is a Sheet.** Below `md`, persistent overlays escalate to shadcn `Sheet` so they stop fighting for space.
8. **State shape is sacred.** `useUiStore` keeps its current shape; only visual binding components change.

---

## 3. New screen anatomy

### 3.1 Diagram (lg+)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [TopBar chip]                                  [Get Overview ✦] [All fields ▾]│  ← top-3 (12 px)
│                                                                              │
│                                                                              │
│ [Coords chip]                                                                │  ← top-3 left-3
│                                                                              │
│                                                                              │
│  [+]                                                                         │  ← left-3, vertically centred
│  [-]                                                                         │
│  [⛶]                                                                         │
│                                                                              │
│                                                                            ▕▏│  ← right rail (64 px)
│                                                                            ▕▏│
│                                                                            ▕▏│  optional pane to its left (300 px)
│                                                                            ▕▏│
│                                                                              │
│                                                                              │
│ [Cloud notice ✕]   ←  26 Feb · 03 Mar · ··· · 27 Apr  →  Next: 7 May         │  ← bottom-20 (above tray)
│                                                                              │
│ [Crop · Chart · Activities ▴]                       [LayerControlCluster ▴]  │  ← bottom-3
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Element inventory

| Position | Element | Width | Height | Notes |
|---|---|---|---|---|
| Top-left | `TopBar` chip | `auto` (~280 px max) | 40 px | back · field · area · crop tag |
| Top-right | `FieldSwitcherChip` + `GetOverviewButton` | auto | 40 px | extracted from TopBar |
| Left middle | `ZoomControls` + `FullscreenButton` | 40 px | stacked | unchanged position |
| Left top | `CoordsBadge` | 256 px | 36 px | already lg-only |
| Right edge | `RightSidebar` rail | 64 px | full-height | unchanged |
| Right edge (optional) | `RightSidebar` pane | 300 px | full-height | overlays — does NOT push other chrome |
| Bottom-centre | `DateTimeline` | `min(720px, viewport - rail - cluster - 32px)` | 36 px | scrollable date chips |
| Bottom-left | `BottomBar` tray | 280 px collapsed / 360 px expanded | 36 px → 320 px | becomes a tray, not a centred bar |
| Bottom-left (above tray) | `CloudHiddenToast` | auto | 36 px | auto-dismiss after 8 s |
| Bottom-right | `LayerControlCluster` | 360 px expanded / 40 px collapsed | 40 px | new — replaces `AnalysisToolbar` + `SourceSwitcher` |

### 3.3 Z-index tiers

| Tier | z-index | Members |
|---|---|---|
| Map content | n/a (canvas) | basemap, field polygon, NDVI tiles |
| Edge chrome | `z-10` | TopBar, BottomBar, LayerControlCluster, DateTimeline, ZoomControls, FullscreenButton, ScaleBar, CoordsBadge, CloudHiddenToast |
| Right pane | `z-20` | RightSidebar pane (slides over map, under modals) |
| Popovers / dropdowns | shadcn defaults (`z-50`) | IndexDropdown, OpacityPopover, AllFields dropdown, BottomBar tooltips |
| Sheets (`<md` only) | `z-50` | RightPaneSheet, BottomBarSheet, LayerClusterPopover (mobile) |

---

## 4. Locked decisions

These were the three open questions in the kick-off plan; we are baking them in here as decided so implementation does not stall.

### D1. "Get Overview" survives but is **demoted**

- Removed from the TopBar chip.
- Re-rendered in the new top-right slot as a **sparkle icon button** (`SparklesIcon` from lucide, `aria-label="Get overview (coming soon)"`, `aria-disabled="true"`).
- Same disabled-but-keyboard-reachable + tooltip pattern as today (`Tooltip` content: "Get overview coming soon…").
- Sits to the left of the "All fields ▾" chip.
- Rationale: signals the future affordance without occupying the screen's main horizontal axis.

### D2. BottomBar becomes a **bottom-left tray**

- Anchored at `bottom-3 left-3` (no longer centred).
- Collapsed: 36 px-tall pill with three tab triggers — `Crop · Chart · Activities ▴`.
- Expanded: 320 × 320 popover that slides up over the map; the underlying map remains pannable around it because the tray's footprint is small.
- Crop info grid drops from `grid-cols-4` to `grid-cols-2` so each card is readable at the new width.
- Below `md` the expanded popover escalates to a shadcn `Sheet` from the bottom edge (see Module R.C).
- Rationale: stops competing with `DateTimeline` for the centred bottom slot, matches the reference UI's left-anchored panel.

### D3. RightSidebar default state is **viewport-responsive**

- On `lg+` (≥ 1024 px): `useUiStore.activeSidebarItem` defaults to `'sample'` (current behaviour preserved — the Sample pane is the screen's most useful sidebar item once Phase 7 lands).
- On `<lg`: defaults to `null` (collapsed) so the map is the hero on narrower screens.
- Implementation: `useUiStore` initial state stays `'sample'`; `AnalysisLayout` runs a one-shot effect on first mount that calls `setActiveSidebarItem(null)` when `window.matchMedia('(max-width: 1023px)').matches`. The effect is gated on a `hasInitialisedRef` so it never overrides a user-driven toggle.
- Rationale: matches the principle "the map is the hero" on small screens without losing the Sample pane's discoverability on large ones.

---

## 5. Module R.A — Layout architecture (kill the dodge)

Depends on: nothing (Phase 5 is the entry point). Blocks: R.B, R.C, R.D.

### R.A.1 — Strip every dodge transform

Edit each file below and remove the `sidebarPaneOpen`-conditional class:

- [`apps/web/src/layouts/AnalysisLayout.tsx`](../apps/web/src/layouts/AnalysisLayout.tsx)
  - Remove the wrapper `<div>` around `<TopBar>` (lines ~108–119). TopBar self-positions in R.A.2.
  - Remove the wrapper `<div>` around `<BottomBar>` (lines ~150–168). BottomBar self-positions in R.A.2.
  - Drop `const sidebarPaneOpen = activeSidebarItem !== null;` and the surrounding `useUiStore` selector — `AnalysisLayout` no longer needs it.
- [`apps/web/src/components/map/overlays/AnalysisToolbar.tsx`](../apps/web/src/components/map/overlays/AnalysisToolbar.tsx) — file is **deleted** in R.B.3.
- [`apps/web/src/components/map/overlays/DateTimeline.tsx`](../apps/web/src/components/map/overlays/DateTimeline.tsx) — drop `sidebarPaneOpen` selector and the `lg:[transform:translateX(...)]` line. Recentre using `left-1/2 -translate-x-1/2` only.
- [`apps/web/src/components/map/overlays/SourceSwitcher.tsx`](../apps/web/src/components/map/overlays/SourceSwitcher.tsx) — file is **folded into `LayerControlCluster`** in R.B.3 (delete after).
- [`apps/web/src/components/map/overlays/ScaleBar.tsx`](../apps/web/src/components/map/overlays/ScaleBar.tsx) — drop `sidebarPaneOpen` selector and the `lg:right-[25rem]` line; pin to `right-3` instead of `right-20`.
- [`apps/web/src/components/map/overlays/CloudHiddenToast.tsx`](../apps/web/src/components/map/overlays/CloudHiddenToast.tsx) — keep the `bottom`-shift on `bottomBarTab` (still needs to clear the tray when expanded), but drop any sidebar-related class.

**Done when:** `grep -r "sidebarPaneOpen" apps/web/src` returns zero matches except inside `RightSidebar.tsx` (where it owns the rail expand) and the **deleted** files awaiting removal.

### R.A.2 — Re-anchor the four primary shells

Inside the `<div className="pointer-events-none absolute inset-0">` chrome wrapper in [`AnalysisLayout.tsx`](../apps/web/src/layouts/AnalysisLayout.tsx), render the shells as bare children with their own positioning:

```tsx
<div className="pointer-events-none absolute inset-0">
  {/* top-left */}
  <div className="pointer-events-auto absolute top-3 left-3">
    <TopBar field={field} titleId={fieldTitleId} />
  </div>

  {/* top-right */}
  <div className="pointer-events-auto absolute top-3 right-20 flex items-center gap-2">
    <GetOverviewButton />
    <FieldSwitcherChip />
  </div>

  {/* left middle, right edge, bottom edges */}
  <MapOverlays />

  {/* right edge */}
  <div className="pointer-events-auto absolute top-3 right-3 bottom-3">
    <RightSidebar field={field} />
  </div>

  {/* bottom-left tray */}
  <div className="pointer-events-auto absolute bottom-3 left-3">
    <BottomBar field={field} />
  </div>
</div>
```

The top-right wrapper uses `right-20` (clears the 64 px rail at `right-3`).
`MapOverlays` continues to mount the map-coupled overlays (zoom, fullscreen, scale, coords, cloud notice, date timeline, layer cluster).

**Done when:** Build succeeds and the screen renders with chrome only at edges (no centred TopBar / AnalysisToolbar visible).

### R.A.3 — Recompute `FitToFieldBounds` padding

In [`AnalysisLayout.tsx`](../apps/web/src/layouts/AnalysisLayout.tsx) `FitToFieldBounds`, replace the current padding with the new geometry:

```ts
map.fitBounds(bounds, {
  padding: { top: 64, right: 88, bottom: 96, left: 88 },
  animate: false,
  maxZoom: 17,
});
```

Reasoning:
- `top: 64` — clears the 40 px TopBar plus 12 px margin and 12 px breathing room.
- `right: 88` — clears the 64 px rail plus 12 px margin and 12 px breathing room. The optional pane *overlays* and is not factored in.
- `bottom: 96` — clears the 36 px DateTimeline + the 36 px collapsed BottomBar tray + 24 px breathing room. Expanded states do not factor in (they are user-triggered).
- `left: 88` — symmetric with right; clears the 40 px zoom column plus margins.

**Done when:** First paint of `/fields/$id` shows the polygon centred with no chrome overlapping the polygon's bbox.

### R.A.4 — Add `useResponsiveSidebarDefault` effect (D3)

Add to [`AnalysisLayout.tsx`](../apps/web/src/layouts/AnalysisLayout.tsx):

```ts
const setActiveSidebarItem = useUiStore((s) => s.setActiveSidebarItem);
const hasInitialisedRef = useRef(false);

useEffect(() => {
  if (hasInitialisedRef.current) return;
  hasInitialisedRef.current = true;
  if (typeof window === 'undefined') return;
  const isNarrow = window.matchMedia('(max-width: 1023px)').matches;
  if (isNarrow) setActiveSidebarItem(null);
}, [setActiveSidebarItem]);
```

A one-shot effect: only runs once per mount, only collapses the rail when the screen enters narrow, and never reopens it. After that, the user owns the state.

**Done when:** Loading `/fields/$id` at 1024 px+ shows Sample pane open; loading at 1023 px shows the rail collapsed; toggling the rail and resizing does not re-trigger the default.

---

## 6. Module R.B — Component compaction

Depends on: R.A complete. Blocks: R.C, R.D.

### R.B.1 — `IndexSwitcher` → `IndexDropdown`

Refactor [`apps/web/src/components/map/overlays/IndexSwitcher.tsx`](../apps/web/src/components/map/overlays/IndexSwitcher.tsx):

- Three pill buttons → single `DropdownMenu` trigger.
- Trigger shape: `[swatch] NDVI ▾`. Width ~96 px (vs 220 px today).
- The 8 px swatch uses the per-band colormap accent (NDVI → emerald-400, EVI → emerald-300, NDWI → sky-400) so the trigger reads at a glance.
- Each `DropdownMenuItem` has `aria-checked={selectedIndex === value}` + a leading swatch + a trailing checkmark when active.
- Keyboard semantics: shadcn `DropdownMenu` already provides arrow-key traversal and Enter/Space activation.
- Component is **renamed** to `IndexDropdown` (file rename + import updates) so the caller name reflects the new shape.
- Bound store unchanged: `useUiStore.selectedIndex` / `setSelectedIndex`.

**Done when:** Selecting a band updates the trigger label and swatch; opening the dropdown shows the active band with a check; the trigger is < 100 px wide.

### R.B.2 — `OpacitySlider` → `OpacityPopover`

Refactor [`apps/web/src/components/map/overlays/OpacitySlider.tsx`](../apps/web/src/components/map/overlays/OpacitySlider.tsx):

- Always-visible row → `Popover` whose trigger is a single icon button (`SlidersHorizontalIcon`, 36 × 36 px).
- Trigger `aria-label="Opacity ({percent}%)"` so screen readers know the current value without opening.
- Popover content: a 200 px-wide horizontal slider + `0%` / `100%` end-cap labels + a centred percent readout.
- Popover side: `top` (we are anchored at the bottom edge), align `end`.
- Component renamed `OpacityPopover`.
- Bound store unchanged.

**Done when:** Click the icon → popover opens with the slider; dragging updates the icon's `aria-label` and the bound `useUiStore.ndviOpacity`; Esc closes.

### R.B.3 — New `LayerControlCluster`

Create [`apps/web/src/components/map/overlays/LayerControlCluster.tsx`](../apps/web/src/components/map/overlays/LayerControlCluster.tsx):

- One frosted chip housing — left to right —
  1. `SourceChip` (replaces `SourceSwitcher` — same disabled `Sentinel-2 ▾` semantics, but the chip itself becomes the cluster's first segment, no separate floating element).
  2. vertical hairline (`h-6 w-px bg-white/15`).
  3. `IndexDropdown` (R.B.1).
  4. `OpacityPopover` (R.B.2).
  5. `PaletteIcon` button (stub — `aria-disabled="true"`, tooltip "Palette coming soon…"). Defer wiring to Phase 7.
  6. `DownloadButton` (existing, unchanged).
  7. trailing chevron `▾` that **collapses** the entire cluster to a single 40 × 40 icon-only puck (`LayersIcon`) on demand, with `aria-pressed` toggling the local `expanded` state. Persist that state in `useUiStore` only if a future requirement asks; for now keep it component-local.
- Chip dims: `h-10`, `rounded-lg`, max-width `360px`, anchored `bottom-3 right-20` (clears the rail).
- File **deletes**: [`AnalysisToolbar.tsx`](../apps/web/src/components/map/overlays/AnalysisToolbar.tsx) and [`SourceSwitcher.tsx`](../apps/web/src/components/map/overlays/SourceSwitcher.tsx).
- Update [`MapOverlays.tsx`](../apps/web/src/components/map/overlays/MapOverlays.tsx) — remove the two deleted imports, add `<LayerControlCluster />`.

**Done when:** All three former chips have collapsed into one chip in the bottom-right corner; the chip never overlaps the rail; collapsing reduces it to a single icon.

### R.B.4 — Trim `TopBar`

Edit [`apps/web/src/components/shell/TopBar.tsx`](../apps/web/src/components/shell/TopBar.tsx):

- Remove the `Tooltip`-wrapped "Get Overview" `Button` and the "All fields" `DropdownMenu` block (they migrate to D1 + R.B.5).
- Remove the `cropType` `<span>` to avoid wrapping past 320 px on narrow content; if we need it back, surface it as a small line under the field name or absorb into the metadata sidebar in a later module. (Keep it simple now.)
- Resulting chip: back arrow · pin icon · field name · area. Target chip width < 280 px.
- Reduce height from 48 px → 40 px (`h-10`) and rounded-full → `rounded-lg` to align with R.D's design tokens.

**Done when:** TopBar fits comfortably in the top-left corner of a 1024 px viewport with no truncation.

### R.B.5 — Extract `FieldSwitcherChip` + `GetOverviewButton`

Create two small files in [`apps/web/src/components/shell/`](../apps/web/src/components/shell/):

- `GetOverviewButton.tsx` — single 40 × 40 sparkle icon button, `aria-disabled="true"`, tooltip "Get overview coming soon…". (D1.)
- `FieldSwitcherChip.tsx` — the existing `DropdownMenu` block hoisted out of TopBar, restyled to the new chip dims (`h-10`, `rounded-lg`).

Both render unchanged behaviour — zero new product capability, just relocation. They are imported and rendered from the top-right slot in [`AnalysisLayout.tsx`](../apps/web/src/layouts/AnalysisLayout.tsx) (R.A.2).

**Done when:** Both elements render at top-right, behave identically to their previous in-TopBar versions, and pass the existing visual smoke.

### R.B.6 — Shrink `BottomBar` to bottom-left tray (D2)

Edit [`apps/web/src/components/shell/BottomBar.tsx`](../apps/web/src/components/shell/BottomBar.tsx):

- Drop the `w-[640px] max-w-[calc(100vw-1.5rem)]` constraint. New collapsed width: `w-[280px]`. Expanded width: `w-[360px]`.
- Drop the centred-spine assumption: the parent now positions the tray at `bottom-3 left-3` (R.A.2), so the component itself becomes width-only.
- Header height drops from 48 px → 36 px (`h-9`).
- Tab triggers go from `h-9 px-3` → `h-7 px-2 text-xs`.
- Expanded panel height drops from 280 px → 280 px (unchanged) but width fits the new envelope.
- `CropInfoTab` grid: `grid-cols-1 md:grid-cols-4` → `grid-cols-1 md:grid-cols-2` so each card has ~160 px width and remains readable.
- Remove the four-card layout assumption from `CropInfoTab`'s a11y heading order; cards still have the same `<h3>` ids so existing tests pass.

**Done when:** Tray sits in the bottom-left at every breakpoint; expanded panel never overlaps DateTimeline or LayerControlCluster on widths ≥ 1024 px; CropInfo cards are readable.

### R.B.7 — Redesign `DateTimeline` visual

Edit [`apps/web/src/components/map/overlays/DateTimeline.tsx`](../apps/web/src/components/map/overlays/DateTimeline.tsx):

- Replace the 6 dots on a hairline with a horizontal scrollable row of date chips (visual stub — Phase 6 wires data).
- Each chip: 36 × 36 px, `rounded-md`, font `text-[10px]`, two-line label (`26 Feb` / `'26`).
- Active chip: `bg-emerald-400/20 ring-1 ring-emerald-300`.
- Cloudy chip: small `CloudIcon` overlay top-right.
- Left/right scroll arrows: 28 × 28 px buttons at each end (`ChevronLeft` / `ChevronRight`).
- Right end: a "Next image MMM d" hint pill, dimmed (`text-white/55`).
- Width: `w-full` constrained by parent — see R.A.2; effective `min(720px, viewport - rail - cluster - 32px)`.
- Drop the `lg:[transform:translateX(...)]` dodge classes (already covered in R.A.1).
- Vertical anchor: `bottom-20` always (no longer needs to track the BottomBar's expanded state because the tray is in the corner now).

**Done when:** The strip renders 8–12 placeholder date chips at 1024 px width, scrolls horizontally with the arrows, and visually matches the reference screenshot's bottom strip.

### R.B.8 — Reposition `CloudHiddenToast`

Edit [`apps/web/src/components/map/overlays/CloudHiddenToast.tsx`](../apps/web/src/components/map/overlays/CloudHiddenToast.tsx):

- New position: `bottom-16 left-3` (sits above the collapsed BottomBar tray).
- Add an auto-dismiss timer: 8 seconds via `setTimeout` in a `useEffect`; clear on unmount; respect `prefers-reduced-motion` (the chip itself has no animation, so this is just about timer behaviour — no change).
- When `bottomBarTab !== null` (BottomBar expanded), shift to `bottom-[22rem]` to clear the expanded tray. Same `motion-safe:transition-[bottom]` as today.
- Keep the manual dismiss `XIcon` for keyboard parity.

**Done when:** Toast appears on first paint, dismisses automatically after 8 s, and never overlaps the BottomBar tray in either state.

---

## 7. Module R.C — Responsive behaviour

Depends on: R.B complete. Blocks: R.D.

### R.C.1 — `RightSidebar` pane → `Sheet` on `<md`

Edit [`apps/web/src/components/shell/RightSidebar.tsx`](../apps/web/src/components/shell/RightSidebar.tsx):

- Extract the existing `Pane` component into a `PaneBody` (presentational — header + body, no positioning).
- Detect viewport via `useMediaQuery('(min-width: 768px)')` (add the hook to [`apps/web/src/hooks/`](../apps/web/src/hooks/) if it doesn't already exist; trivial wrapper around `window.matchMedia` with SSR guard).
- On `md+`: render `<PaneBody />` inline next to the rail (current behaviour).
- On `<md`: render `<Sheet open={activeSidebarItem !== null}><SheetContent side="right">{<PaneBody />}</SheetContent></Sheet>`. The rail still sits at `right-3` and continues to act as the trigger.
- The rail is **always** persistent on every breakpoint — only the pane escalates.
- Focus restore on Sheet close: shadcn `Sheet` handles this; keep the existing `lastTriggerRef` logic so it works in both render modes.

**Done when:** At ≥ 768 px the pane behaves identically to today; at < 768 px the same content opens as a right-side Sheet with a backdrop scrim and Esc-to-close.

### R.C.2 — `BottomBar` expanded → `Sheet` on `<md`

Edit [`apps/web/src/components/shell/BottomBar.tsx`](../apps/web/src/components/shell/BottomBar.tsx):

- Same pattern: extract the expanded panel body into a `BottomBarBody` (`CropInfoTab` / `ChartTab` / `ActivitiesTab` already factored).
- Detect viewport via `useMediaQuery('(min-width: 768px)')`.
- On `md+`: render the panel inline beneath the tray header (current behaviour after R.B.6).
- On `<md`: keep the 36 px collapsed pill in the corner; on expand, render `<Sheet open={isExpanded}><SheetContent side="bottom">{<BottomBarBody />}</SheetContent></Sheet>`.
- The chevron remains the toggle; it now opens the Sheet instead of mounting an inline panel.

**Done when:** ≥ 768 px expanded panel renders inline; < 768 px expanded panel opens as a bottom Sheet with handle + scrim.

### R.C.3 — `LayerControlCluster` collapses on `<md`

Edit [`apps/web/src/components/map/overlays/LayerControlCluster.tsx`](../apps/web/src/components/map/overlays/LayerControlCluster.tsx):

- Default to **collapsed (icon puck)** on `<md` regardless of user toggle history; clicking opens a `Popover` containing the same controls stacked vertically (vertical instead of horizontal hairline separators).
- On `md+` default to **expanded** (the full cluster row). The user's toggle still wins after first interaction.

**Done when:** At < 768 px the cluster is a single `LayersIcon` puck; tapping opens a vertical popover with all controls; at ≥ 768 px the cluster is the full row.

### R.C.4 — Hide non-essential overlays on `<lg`

- `CoordsBadge` — already gated on `lg:inline-flex`; verify nothing regresses.
- `ScaleBar` — add `hidden lg:inline-flex`. The scale bar is helpful but not critical at small widths.

**Done when:** On a 768 px viewport, neither `CoordsBadge` nor `ScaleBar` renders.

---

## 8. Module R.D — Visual polish + cleanup

Depends on: R.A, R.B, R.C complete.

### R.D.1 — Standardise frosted chrome tokens

Add to [`apps/web/src/lib/utils.ts`](../apps/web/src/lib/utils.ts) (or a new `apps/web/src/lib/tokens.ts` if `utils` feels overloaded) two exports:

```ts
export const CHIP_BASE = 'rounded-lg border border-white/10 bg-black/70 text-white shadow-lg backdrop-blur-md saturate-150';
export const CHIP_FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/70';
```

Refactor each chip component (TopBar, RightSidebar rail, RightSidebar pane, BottomBar tray, LayerControlCluster, CoordsBadge, ScaleBar, CloudHiddenToast, FieldSwitcherChip, GetOverviewButton) to compose `CHIP_BASE` instead of repeating the literal string. This is a mechanical refactor — values do not change, only the source-of-truth.

**Done when:** Searching for the literal `bg-black/70` returns only the constants file; every chip uses the same hairline + blur recipe.

### R.D.2 — Drop dead transition CSS

After R.A.1 every `motion-safe:transition-transform motion-safe:duration-200` paired with a removed `lg:[transform:translateX(...)]` becomes dead. Remove the matching `transition-transform` line from each shell so we don't ship transitions that never trigger.

Keep the genuine width transition on `RightSidebar` (the rail → rail+pane width change is real and animated).

**Done when:** A `grep -rn "motion-safe:transition-transform" apps/web/src` review confirms only the RightSidebar width transition remains.

### R.D.3 — Verify no overlay still consults `sidebarPaneOpen`

Final cleanup pass:

```bash
grep -rn "activeSidebarItem !== null" apps/web/src
grep -rn "sidebarPaneOpen" apps/web/src
```

Only [`RightSidebar.tsx`](../apps/web/src/components/shell/RightSidebar.tsx) and the `setActiveSidebarItem` callers (rail buttons, R.A.4 init effect) should appear.

**Done when:** Both greps return only the expected files.

### R.D.4 — Refresh `docs/plan.md` § 2

Update the "Field Analysis Screen Anatomy" section in [`plan.md`](./plan.md):

- Replace the table that puts the index/source/opacity cluster at "Bottom-right cluster" with a single line: "Bottom-right: `LayerControlCluster` (source · index · opacity · palette · download · collapse)".
- Add a "Top-right" row: "`GetOverviewButton`, `FieldSwitcherChip`".
- Note the BottomBar tray relocation under the "Bottom bar" bullet.
- Note the responsive Sheet escalation under the relevant bullets.
- Add a one-line cross-reference: "See [`docs/ui-ux-redesign.md`](./ui-ux-redesign.md) for the visual rationale and module-level execution plan."

**Done when:** `plan.md` § 2 reflects the new anatomy and links back to this doc.

### R.D.5 — Update `docs/implementation.md` Phase 5

After all modules above land, append a "Module 5.6 — UI/UX redesign ✅ (completed YYYY-MM-DD)" entry under Phase 5 in [`implementation.md`](./implementation.md), with a one-paragraph summary and a link to this doc. Module 5.6 only exists for tracking — its work is governed by R.A–R.D here.

**Done when:** `implementation.md` Phase 5 closes with a link to this redesign doc and the date.

---

## 9. Phase exit criteria

The redesign is complete when **all** of the following hold:

1. **Layout**: chrome is edge-anchored — TopBar top-left, top-right slot, ZoomControls left-middle, RightSidebar right, DateTimeline bottom-centre, BottomBar tray bottom-left, LayerControlCluster bottom-right. No centred competing chrome.
2. **No dodge**: opening or closing the right pane does not visibly move *any* other element. Verified by Playwright screenshot diff at 1024, 1280, 1440 px.
3. **Compaction**: AnalysisToolbar and SourceSwitcher files are deleted; one cluster chip exists in their place; IndexSwitcher is a dropdown; OpacitySlider is a popover.
4. **Responsive**: at < 768 px, RightSidebar pane and BottomBar expanded body open as Sheets; LayerControlCluster collapses to a single icon puck; CoordsBadge and ScaleBar are hidden.
5. **Defaults (D3)**: `/fields/$id` first-paint shows the rail expanded on `lg+` and collapsed on `<lg`. Manual rail toggles are not overridden after the first paint.
6. **State stability**: `useUiStore` shape is unchanged; existing unit tests pass without edits.
7. **A11y unchanged or improved**: keyboard tour TopBar → top-right → cluster → DateTimeline → BottomBar tray → RightSidebar still reaches every interactive element; Esc closes pane / Sheet / popovers; arrow keys still traverse the rail.
8. **No console errors** at first paint and after each toggle.
9. **`pnpm check` and `pnpm typecheck`** are green for `apps/web`.
10. **Phase 6 unblocked**: the LayerControlCluster's `IndexDropdown` and `OpacityPopover` already write to the same `useUiStore` keys as before, so Phase 6's NDVI tile binding requires zero additional plumbing.

---

## 10. File-by-file change inventory

| File | Action | Notes |
|---|---|---|
| [`apps/web/src/layouts/AnalysisLayout.tsx`](../apps/web/src/layouts/AnalysisLayout.tsx) | **Edit** | Drop dodge wrappers; re-anchor TopBar top-left + new top-right slot; update `FitToFieldBounds` padding; add D3 init effect. |
| [`apps/web/src/components/shell/TopBar.tsx`](../apps/web/src/components/shell/TopBar.tsx) | **Edit** | Remove Get Overview / All fields / crop tag; shrink to `h-10 rounded-lg`; compose `CHIP_BASE`. |
| [`apps/web/src/components/shell/GetOverviewButton.tsx`](../apps/web/src/components/shell/GetOverviewButton.tsx) | **Create** | Sparkle icon button, `aria-disabled`, tooltip "Get overview coming soon…". |
| [`apps/web/src/components/shell/FieldSwitcherChip.tsx`](../apps/web/src/components/shell/FieldSwitcherChip.tsx) | **Create** | "All fields ▾" dropdown hoisted out of TopBar. |
| [`apps/web/src/components/shell/RightSidebar.tsx`](../apps/web/src/components/shell/RightSidebar.tsx) | **Edit** | Extract `PaneBody`; gate inline vs Sheet on `useMediaQuery('(min-width: 768px)')`; compose `CHIP_BASE`. |
| [`apps/web/src/components/shell/BottomBar.tsx`](../apps/web/src/components/shell/BottomBar.tsx) | **Edit** | Bottom-left tray sizing; `h-9` header; `grid-cols-2` for CropInfo; gate inline vs Sheet on `useMediaQuery('(min-width: 768px)')`. |
| [`apps/web/src/components/shell/sidebar-items.ts`](../apps/web/src/components/shell/sidebar-items.ts) | _no change_ | Config stays. |
| [`apps/web/src/components/map/overlays/MapOverlays.tsx`](../apps/web/src/components/map/overlays/MapOverlays.tsx) | **Edit** | Remove `<AnalysisToolbar />` + `<SourceSwitcher />`; add `<LayerControlCluster />`. |
| [`apps/web/src/components/map/overlays/AnalysisToolbar.tsx`](../apps/web/src/components/map/overlays/AnalysisToolbar.tsx) | **Delete** | Replaced by `LayerControlCluster`. |
| [`apps/web/src/components/map/overlays/SourceSwitcher.tsx`](../apps/web/src/components/map/overlays/SourceSwitcher.tsx) | **Delete (folded)** | Logic moves into `LayerControlCluster` as the `SourceChip` segment. |
| [`apps/web/src/components/map/overlays/LayerControlCluster.tsx`](../apps/web/src/components/map/overlays/LayerControlCluster.tsx) | **Create** | Source · Index · Opacity · Palette · Download + collapse chevron. |
| [`apps/web/src/components/map/overlays/IndexSwitcher.tsx`](../apps/web/src/components/map/overlays/IndexSwitcher.tsx) | **Edit + rename → `IndexDropdown.tsx`** | Refactor to dropdown; preserve `useUiStore` binding. |
| [`apps/web/src/components/map/overlays/OpacitySlider.tsx`](../apps/web/src/components/map/overlays/OpacitySlider.tsx) | **Edit + rename → `OpacityPopover.tsx`** | Refactor to icon-popover; preserve `useUiStore` binding. |
| [`apps/web/src/components/map/overlays/DownloadButton.tsx`](../apps/web/src/components/map/overlays/DownloadButton.tsx) | _no change_ | Lifted as-is into the cluster. |
| [`apps/web/src/components/map/overlays/DateTimeline.tsx`](../apps/web/src/components/map/overlays/DateTimeline.tsx) | **Edit** | New visual (date chips with arrows + "Next image" hint); remove dodge classes; fixed `bottom-20`. |
| [`apps/web/src/components/map/overlays/CloudHiddenToast.tsx`](../apps/web/src/components/map/overlays/CloudHiddenToast.tsx) | **Edit** | Reposition above the bottom-left tray; add 8 s auto-dismiss; drop sidebar-conditional class. |
| [`apps/web/src/components/map/overlays/ScaleBar.tsx`](../apps/web/src/components/map/overlays/ScaleBar.tsx) | **Edit** | `right-3` always; `hidden lg:inline-flex`; drop dodge classes. |
| [`apps/web/src/components/map/overlays/CoordsBadge.tsx`](../apps/web/src/components/map/overlays/CoordsBadge.tsx) | _no change_ | Already lg-only. |
| [`apps/web/src/components/map/overlays/ZoomControls.tsx`](../apps/web/src/components/map/overlays/ZoomControls.tsx) | _no change_ | Position stays. |
| [`apps/web/src/components/map/overlays/FullscreenButton.tsx`](../apps/web/src/components/map/overlays/FullscreenButton.tsx) | _no change_ | Position stays. |
| [`apps/web/src/hooks/useMediaQuery.ts`](../apps/web/src/hooks/useMediaQuery.ts) | **Create (if missing)** | Trivial wrapper around `window.matchMedia` with SSR guard; used by R.C. |
| [`apps/web/src/lib/tokens.ts`](../apps/web/src/lib/tokens.ts) | **Create** | `CHIP_BASE`, `CHIP_FOCUS` constants for R.D.1. |
| [`apps/web/src/stores/useUiStore.ts`](../apps/web/src/stores/useUiStore.ts) | _no change_ | State shape preserved. |
| [`apps/web/e2e/dashboard.spec.ts`](../apps/web/e2e/dashboard.spec.ts) | **Edit** | Add 1024 × 720 and 768 × 1024 visual regressions; assert pane open does not move TopBar. |
| [`docs/plan.md`](./plan.md) | **Edit** | Refresh § 2 anatomy table; add cross-reference to this doc (R.D.4). |
| [`docs/implementation.md`](./implementation.md) | **Edit** | Append Module 5.6 ✅ entry on completion (R.D.5). |
| [`docs/ui-ux-redesign.md`](./ui-ux-redesign.md) | **(this file)** | The plan itself. |

---

## 11. Verification matrix

| # | Check | How |
|---|---|---|
| V1 | `pnpm check` clean across `apps/web`. | Run locally before each commit. |
| V2 | `pnpm typecheck` clean across `apps/web`. | Same. |
| V3 | At 1024 × 720, opening/closing the right pane visibly moves *only* the pane. | Manual smoke + Playwright screenshot diff. |
| V4 | At 1280 × 800, all chrome stays inside the viewport. | Manual smoke. |
| V5 | At 1440 × 900, BottomBar tray and DateTimeline never overlap; LayerControlCluster never overlaps the rail. | Manual smoke. |
| V6 | At 768 × 1024, RightSidebar pane opens as a right-side Sheet; BottomBar expanded opens as a bottom Sheet; LayerControlCluster is a single icon puck. | Manual smoke + Playwright at the small viewport. |
| V7 | First paint at `lg+`: rail open with Sample pane. First paint at `<lg`: rail collapsed. | Playwright in two viewports. |
| V8 | Tab order: TopBar → top-right → cluster → DateTimeline → BottomBar tray → RightSidebar rail → rail buttons. | Manual keyboard tour. |
| V9 | Esc closes pane, Sheet, every popover/dropdown. | Manual keyboard tour. |
| V10 | Arrow keys still traverse RightSidebar rail; Home/End jump to ends. | Manual keyboard tour. |
| V11 | No console errors at first paint or after each chrome toggle. | DevTools console open during smoke. |
| V12 | `useUiStore` unit tests pass without edits. | `pnpm -F @viz-crop/web test`. |
| V13 | `dashboard.spec.ts` snapshots updated and committed. | Playwright `--update-snapshots` then re-run. |
| V14 | `grep -rn "sidebarPaneOpen\|activeSidebarItem !== null" apps/web/src` only appears in `RightSidebar.tsx`, `LayerControlCluster.tsx` (if used), and the D3 init effect. | grep at the end of R.D.3. |
| V15 | `grep -rn "AnalysisToolbar\|SourceSwitcher" apps/web/src` returns no matches. | grep after R.B.3. |

---

## 12. Out of scope

The following are intentionally deferred and must be tracked separately if needed:

- **Phase 6 NDVI tile wiring** — the cluster's `IndexDropdown` / `OpacityPopover` keep their store bindings; Phase 6 plugs the raster source in unchanged.
- **Real DateTimeline data** — the strip remains a stub until Phase 6 Module 6.2 lands `useEosdaScenes`.
- **Sample / Chart real data** — Phase 7.
- **Touch/gesture support beyond Sheet swipe-to-close** — shadcn Sheet's defaults are sufficient for v2; native gesture handlers can come later.
- **Top-right field switching for real** — `FieldSwitcherChip` keeps its disabled placeholder dropdown until a multi-field switching feature is scoped.
- **Theme support (light mode)** — current chrome is dark-only by design; a light-mode pass is a separate phase.
- **Persisting LayerControlCluster collapsed state** — local component state for now; promote to `useUiStore` only if a UX requirement asks.

---

## 13. Appendix — Design tokens

| Token | Value | Used by |
|---|---|---|
| Chip base classes | `rounded-lg border border-white/10 bg-black/70 text-white shadow-lg backdrop-blur-md saturate-150` | Every frosted chip (`CHIP_BASE` constant). |
| Focus ring | `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/70` | Every interactive control on dark chrome (`CHIP_FOCUS` constant). |
| Chip height | `h-10` (40 px) | TopBar, FieldSwitcherChip, GetOverviewButton, LayerControlCluster (expanded). |
| Icon-button height | `h-9 w-9` (36 px) | DownloadButton, OpacityPopover trigger, BottomBar chevron, all rail buttons. |
| Inset from viewport | `3` (12 px) | Every edge-anchored chip's anchor (`top-3`, `right-3`, `bottom-3`, `left-3`); `right-20` for top-right slot to clear the rail. |
| Border-radius | `rounded-lg` | Every chip. (Was a mix of `rounded-md` / `rounded-full` — standardise.) |
| Right rail width | `w-16` (64 px) | RightSidebar collapsed. |
| Right pane width | `w-[300px]` | RightSidebar pane (down from 364 — pane no longer needs to budget for the rail beside it because the rail is rendered separately at `right-3`). |
| BottomBar tray collapsed width | `w-[280px]` | BottomBar header pill. |
| BottomBar tray expanded width | `w-[360px]` | BottomBar expanded panel on `md+`. |
| LayerControlCluster width | `max-w-[360px]` | Cluster expanded. |
| Index swatches | NDVI `bg-emerald-400`, EVI `bg-emerald-300`, NDWI `bg-sky-400` | `IndexDropdown` trigger + items. |
| Active highlight | `bg-emerald-400/20 ring-1 ring-emerald-300` | Active DateTimeline chip, active rail button. |
| Animation duration | `200 ms` | Width transition on RightSidebar; Sheet enter/exit (shadcn default 500 ms is too slow — override to 200 ms in Sheet variants). |
| Auto-dismiss (CloudHiddenToast) | `8000 ms` | `setTimeout` in component. |
