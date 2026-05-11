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
 * always present in `DateTimeline`'s visible chip strip and in
 * `CloudHiddenToast`'s count — the gpt-5.5 BLOCKER previously caused by
 * the auto-select hook picking from raw scenes while the timeline
 * filtered through best-per-date.
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
