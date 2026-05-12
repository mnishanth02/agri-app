/**
 * Phase 6 adversarial review remediation — shared scene helpers.
 *
 * One source of truth for the "best per date" scene selection used by:
 *   - `useAutoSelectDefaultScene` (which scene the app picks when none
 *     is selected).
 *   - `DateTimeline` (which chips are rendered).
 *   - `CloudHiddenToast` (how many chips are hidden by the cloud filter).
 *
 * Centralising the logic here guarantees the auto-selected `viewId` is
 * always present in `DateTimeline`'s visible chip strip, and the
 * toast's hidden count uses the exact same selected-chip exception.
 */
import type { SceneDto } from '@viz-crop/shared';

/**
 * Group scenes by `sceneDate` and pick the BEST scene per date.
 *
 * "Best" = lowest `cloudPercent` (null treated as +∞), tiebreaker
 * highest `dataCoveragePercent` (null treated as -∞).
 *
 * Returned array sorted by `sceneDate` ASC (oldest first).
 */
export function bestPerDate(scenes: ReadonlyArray<SceneDto>): SceneDto[] {
  const groups = new Map<string, SceneDto>();
  for (const s of scenes) {
    // `sceneDate` is already an ISO YYYY-MM-DD string per shared zod
    // (`z.iso.date()`); the slice is defensive.
    const key = s.sceneDate.slice(0, 10);
    const current = groups.get(key);
    if (!current) {
      groups.set(key, s);
      continue;
    }
    const cloudCurrent = current.cloudPercent ?? Number.POSITIVE_INFINITY;
    const cloudCandidate = s.cloudPercent ?? Number.POSITIVE_INFINITY;
    if (cloudCandidate < cloudCurrent) {
      groups.set(key, s);
      continue;
    }
    if (cloudCandidate === cloudCurrent) {
      const coverageCurrent = current.dataCoveragePercent ?? Number.NEGATIVE_INFINITY;
      const coverageCandidate = s.dataCoveragePercent ?? Number.NEGATIVE_INFINITY;
      if (coverageCandidate > coverageCurrent) groups.set(key, s);
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.sceneDate.localeCompare(b.sceneDate));
}

/** Cloud cover above which a best-per-date chip is considered "cloudy"
 *  for the purposes of the timeline filter and the hidden toast. */
export const CLOUDY_THRESHOLD_PERCENT = 50;

/** Cloud cover ceiling for a scene to be considered as the auto-selected
 *  default. Stricter than {@link CLOUDY_THRESHOLD_PERCENT} so the default
 *  pick is comfortably below the "cloudy" line. */
export const DEFAULT_PICK_CLOUD_THRESHOLD_PERCENT = 30;

export function isCloudyScene(scene: SceneDto): boolean {
  return scene.cloudPercent != null && scene.cloudPercent > CLOUDY_THRESHOLD_PERCENT;
}

export type CloudFilteredBestScenesOptions = {
  showCloudyScenes: boolean;
  selectedViewId: string | null;
};

/**
 * Apply the cloudy-scene visibility rule to an already best-per-date
 * scene list. The active scene is always retained so the map never
 * displays a viewId that has no visible timeline chip.
 */
export function filterVisibleBestScenes(
  bestScenes: ReadonlyArray<SceneDto>,
  { showCloudyScenes, selectedViewId }: CloudFilteredBestScenesOptions,
): SceneDto[] {
  if (bestScenes.length === 0) return [];
  const baseline = showCloudyScenes
    ? [...bestScenes]
    : bestScenes.filter((scene) => !isCloudyScene(scene));
  if (selectedViewId === null) return baseline;
  if (baseline.some((scene) => scene.viewId === selectedViewId)) return baseline;
  const selected = bestScenes.find((scene) => scene.viewId === selectedViewId);
  if (!selected) return baseline;
  return [...baseline, selected].sort((a, b) => a.sceneDate.localeCompare(b.sceneDate));
}

export function countHiddenCloudyBestScenes(
  bestScenes: ReadonlyArray<SceneDto>,
  selectedViewId: string | null,
): number {
  const visibleViewIds = new Set(
    filterVisibleBestScenes(bestScenes, {
      showCloudyScenes: false,
      selectedViewId,
    }).map((scene) => scene.viewId),
  );

  let hidden = 0;
  for (const scene of bestScenes) {
    if (isCloudyScene(scene) && !visibleViewIds.has(scene.viewId)) hidden += 1;
  }
  return hidden;
}
