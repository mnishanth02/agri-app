/**
 * Module 3.1 — `useUiStore` (Zustand).
 *
 * Holds the **shared UI selection state** for the analysis screen
 * (`/fields/$id`, built in Phases 5–7): which Sentinel-2 scene is selected,
 * which vegetation index is overlaid, the NDVI raster opacity, and which
 * sidebar / bottom-bar tab is open. The store is created in Phase 3 so the
 * shape is locked in before the consuming components land — it is **not
 * read by `/fields/new`** (the create flow only uses `useFieldStore`).
 *
 * Resolved choices for ambiguous defaults (with citations):
 *
 * - **`selectedIndex` union: `'NDVI' | 'EVI' | 'NDWI'`, default `'NDVI'`.**
 *   `plan.md` line 17 ("EOSDA Render supports Sentinel-2 index aliases such
 *   as `NDVI`, `EVI`, and `NDWI`") and line 231 ("`IndexSwitcher` toggles
 *   NDVI / EVI / NDWI") fix this set. `implementation.md` line 702
 *   (`IndexSwitcher` … "NDVI/EVI/NDWI") agrees. NDVI is the v2 hero overlay
 *   so it is the natural default.
 * - **`ndviOpacity` default: `0.75`.** `plan.md` line 229 ("opacity from
 *   Zustand (default 0.75)") and `implementation.md` line 775
 *   ("`raster-opacity` bound to `ndviOpacity` (default 0.75)") are explicit.
 *   The setter accepts any `number`; clamping to `[0, 1]` is the slider
 *   component's job, not the store's.
 * - **`activeSidebarItem` union.** From `plan.md` § 2 ("Field Analysis
 *   Screen Anatomy → Right sidebar"): `sample` (only fully wired in v2),
 *   `monitoring`, `weather`, `fieldActivity`, `vraMaps`, `scoutTasks`,
 *   `dataManager`, `fieldManager`, `aiAssistant`, `notifications`,
 *   `helpCenter`, `marketplace`. The sidebar is collapsible
 *   (`plan.md` line 84: "Collapsed = ~64 px (icons only)"), so `null`
 *   represents the collapsed state. Default is `'sample'` — the only pane
 *   that renders real content in v2 (`plan.md` line 113;
 *   `implementation.md` line 857: `activeSidebarItem === 'sample'`).
 * - **`bottomBarTab` union: `'cropInfo' | 'chart' | 'activities'`.** Per
 *   `plan.md` lines 97–100 ("Three tab shells: Crop info, Chart,
 *   Activities") and `implementation.md` line 687 (Module 5.4 tab list).
 *   The bottom bar is collapsible (`plan.md` line 97: "collapsible
 *   (~280 px when open)"), so `null` = closed. Module 5.8 changed the
 *   default to `null` so the dock is collapsed on first paint.
 * - **`bottomDockHeightVh` default: `40`.** Module 5.8 makes the dock
 *   body resizable via a drag-grabber. Stored as a vh number rather than
 *   a CSS string so consumers can compose it (e.g.
 *   `calc(${vh}vh + 7rem)` for the dock total height). Range is clamped
 *   by the drag handler to `[BOTTOM_DOCK_MIN_VH, BOTTOM_DOCK_MAX_VH]`;
 *   the store stays dumb (no clamping) so unit tests can exercise edge
 *   values.
 *
 * Sidebar item / tab ids are camelCased to match the existing TS convention
 * (`fieldActivity`, not `field-activity`); they are internal app keys, not
 * URL slugs or copy strings.
 *
 * See `useFieldStore.ts` for the rationale on splitting state vs actions
 * types and for the canonical selector / `useShallow` consumer pattern. The
 * same conventions apply here.
 *
 * ## Canonical consumer pattern
 *
 * ```ts
 * // Single value:
 * const selectedIndex = useUiStore((s) => s.selectedIndex);
 *
 * // Multiple values — useShallow keeps the consumer from re-rendering when
 * // an unrelated slice (e.g., ndviOpacity) changes.
 * import { useShallow } from 'zustand/react/shallow';
 * const { selectedViewId, selectedIndex, ndviOpacity } = useUiStore(
 *   useShallow((s) => ({
 *     selectedViewId: s.selectedViewId,
 *     selectedIndex: s.selectedIndex,
 *     ndviOpacity: s.ndviOpacity,
 *   })),
 * );
 * ```
 */

import { create } from 'zustand';

/**
 * Vegetation indices supported by the analysis screen. Locked to the
 * EOSDA Render v2 alias allowlist (`plan.md` line 17). If a future module
 * adds another alias (e.g., `NDMI`), extend this union — do not widen to
 * `string`.
 */
export type VegetationIndex = 'NDVI' | 'EVI' | 'NDWI';

/**
 * Right sidebar items from `plan.md` § 2 → "Right sidebar". Only `sample`
 * renders a real pane in v2; the rest render a "Coming soon" placeholder
 * (Module 5.3). `null` represents the collapsed icon-rail state.
 */
export type SidebarItem =
  | 'sample'
  | 'monitoring'
  | 'weather'
  | 'fieldActivity'
  | 'vraMaps'
  | 'scoutTasks'
  | 'dataManager'
  | 'fieldManager'
  | 'aiAssistant'
  | 'notifications'
  | 'helpCenter'
  | 'marketplace';

/**
 * Bottom-bar tabs from `plan.md` § 2 → "Bottom bar". `null` = bar
 * collapsed.
 */
export type BottomBarTab = 'cropInfo' | 'chart' | 'activities';

/**
 * Min / max body height for the resizable BottomDock body, in `vh`.
 * The drag handler in `BottomDock.tsx` clamps to this range; values
 * outside are technically allowed by the store but should not be set
 * by production callers. Below the minimum the dock collapses entirely
 * (`bottomBarTab` becomes `null`).
 */
export const BOTTOM_DOCK_MIN_VH = 15;
export const BOTTOM_DOCK_MAX_VH = 70;
export const BOTTOM_DOCK_DEFAULT_VH = 40;

export type UiStoreState = {
  /** Selected EOSDA View ID (e.g., `S2/43/P/GK/2026/3/23/0`). */
  selectedViewId: string | null;
  selectedIndex: VegetationIndex;
  /** Overlay opacity in `[0, 1]`. Not clamped by the store. */
  ndviOpacity: number;
  /** `null` when the sidebar is collapsed. */
  activeSidebarItem: SidebarItem | null;
  /** `null` when the bottom bar is collapsed. */
  bottomBarTab: BottomBarTab | null;
  /**
   * Body height of the BottomDock when expanded, in `vh`. Ignored when
   * `bottomBarTab === null`. Module 5.8 added this so users can drag the
   * top-edge grabber to resize.
   */
  bottomDockHeightVh: number;
};

export type UiStoreActions = {
  setSelectedViewId: (viewId: string | null) => void;
  setSelectedIndex: (index: VegetationIndex) => void;
  /**
   * Sets overlay opacity. Callers (e.g., the opacity slider) own the
   * `[0, 1]` bounds — keeping the store dumb means tests don't have to
   * reason about silent clamping.
   */
  setNdviOpacity: (opacity: number) => void;
  setActiveSidebarItem: (item: SidebarItem | null) => void;
  setBottomBarTab: (tab: BottomBarTab | null) => void;
  /**
   * Sets the BottomDock body height in `vh`. The drag handler is
   * responsible for clamping to `[BOTTOM_DOCK_MIN_VH,
   * BOTTOM_DOCK_MAX_VH]` and for collapsing the dock when the user
   * drags below the minimum.
   */
  setBottomDockHeightVh: (vh: number) => void;
};

export type UiStore = UiStoreState & UiStoreActions;

const INITIAL_STATE: UiStoreState = {
  selectedViewId: null,
  selectedIndex: 'NDVI',
  ndviOpacity: 0.75,
  activeSidebarItem: 'sample',
  bottomBarTab: null,
  bottomDockHeightVh: BOTTOM_DOCK_DEFAULT_VH,
};

export const useUiStore = create<UiStore>()((set) => ({
  ...INITIAL_STATE,
  setSelectedViewId: (viewId) => set({ selectedViewId: viewId }),
  setSelectedIndex: (index) => set({ selectedIndex: index }),
  setNdviOpacity: (opacity) => set({ ndviOpacity: opacity }),
  setActiveSidebarItem: (item) => set({ activeSidebarItem: item }),
  setBottomBarTab: (tab) => set({ bottomBarTab: tab }),
  setBottomDockHeightVh: (vh) => set({ bottomDockHeightVh: vh }),
}));
