/**
 * Module 6.2 — `useAutoSelectDefaultScene`.
 *
 * Side-effect hook that keeps `useUiStore.selectedViewId` valid for the
 * currently visited field. It is intentionally separate from the
 * `useEosdaScenes` query (sibling file) so that:
 *
 *   1. The query stays side-effect free — any component can subscribe
 *      (DateTimeline, CloudHiddenToast, …) without racing each other
 *      on writes to the shared store.
 *   2. There is exactly ONE owner of the auto-select decision; mount
 *      this hook once from `AnalysisLayout` and the rest of the tree
 *      reads `selectedViewId` as a derived signal.
 *
 * **Auto-select rule (Phase-6 plan refinement, critique #3):**
 *
 *   if scenes is empty → no-op (DateTimeline shows its empty state)
 *   else if selectedViewId is null OR is NOT in the best-per-date list →
 *     pick newest scene with cloudPercent < 30 (fallback: newest in the
 *     best-per-date list) and write it to the store
 *   else → leave selection alone (still valid for this field)
 *
 * The candidate set is `bestPerDate(scenes)` from `@/lib/scene-helpers`
 * — the SAME helper DateTimeline and CloudHiddenToast use. This is the
 * fix for the gpt-5.5 BLOCKER where the hook could pick a scene that
 * the timeline never renders (because it lost the best-per-date
 * tiebreaker for its date), leaving the user with an "active" viewId
 * that has no chip.
 *
 * `bestPerDate` returns oldest-first; we reverse it locally so
 * `Array.prototype.find` returns the newest non-cloudy candidate. The
 * fallback to the newest entry covers the all-cloudy case so the user
 * still sees *something* — DateTimeline always renders the active chip
 * even when cloudy, so the fallback selection remains visible
 * regardless of the cloud toggle.
 *
 * The effect deliberately reads `selectedViewId` via
 * `useUiStore.getState()` instead of subscribing, so a downstream-
 * triggered selection change does NOT re-run the effect (only
 * `[scenes, fieldId]` matter for the auto-select decision). This keeps
 * the hook idempotent: once it has written a valid selection, further
 * user clicks on DateTimeline chips won't bounce the selection back to
 * the auto-picked default.
 *
 * Per repo convention (TanStack Query is the source of truth for
 * server data) this hook NEVER copies `query.data` into local React
 * state — it only writes the *derived* selection into the SHARED
 * `useUiStore`, and only when the current selection is invalid.
 */

import { useEffect } from 'react';
import { useEosdaScenes } from '@/hooks/useEosdaScenes';
import { bestPerDate, DEFAULT_PICK_CLOUD_THRESHOLD_PERCENT } from '@/lib/scene-helpers';
import { useUiStore } from '@/stores/useUiStore';

/**
 * Mount once from `AnalysisLayout`. Returns `null` (the call site
 * doesn't need anything; the return type is reserved so a future
 * caller could surface a "settling" indicator without a breaking API
 * change).
 */
export function useAutoSelectDefaultScene(fieldId: string): null {
  const setSelectedViewId = useUiStore((s) => s.setSelectedViewId);
  const query = useEosdaScenes(fieldId);
  const scenes = query.data;

  useEffect(() => {
    if (!scenes || scenes.length === 0) return;

    // Pick from the SAME best-per-date list the timeline renders so the
    // auto-selected viewId is guaranteed to have a visible chip.
    const candidates = bestPerDate(scenes);
    if (candidates.length === 0) return;

    // `bestPerDate` returns oldest-first; reverse so `find` returns the
    // newest non-cloudy candidate.
    const newestFirst = [...candidates].reverse();

    const currentSelection = useUiStore.getState().selectedViewId;
    const isCurrentValid =
      currentSelection !== null && newestFirst.some((s) => s.viewId === currentSelection);
    if (isCurrentValid) return;

    const nonCloudy = newestFirst.find(
      (s) => s.cloudPercent !== null && s.cloudPercent < DEFAULT_PICK_CLOUD_THRESHOLD_PERCENT,
    );
    // `noUncheckedIndexedAccess` — `newestFirst[0]` is `SceneDto | undefined`;
    // we just checked `candidates.length > 0` so it's non-null at runtime,
    // and the explicit `?? null` keeps the type checker happy.
    const next = nonCloudy ?? newestFirst[0] ?? null;
    if (next === null) return;

    setSelectedViewId(next.viewId);
    // `fieldId` is intentionally NOT in the dep list: when it changes,
    // `useEosdaScenes(fieldId)` produces a new query whose `data` flips
    // to `undefined` (loading) and then to the new array, so the
    // `scenes` identity covers field navigation already. Adding
    // `fieldId` would re-run the effect on the loading-tick with the
    // STALE scenes from the previous field — exactly the bug we want
    // to avoid. Linted by Biome's `useExhaustiveDependencies` rule.
  }, [scenes, setSelectedViewId]);

  return null;
}
