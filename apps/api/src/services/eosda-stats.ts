/**
 * Module 7.1 — EOSDA `mt_stats` wrapper.
 *
 * `runMtStats({ geometry, indexes, dateRange, log, signal? })` creates an
 * EOSDA `mt_stats` task, polls it to completion, and normalises the
 * loosely-typed response into the app's `NdviStatsRow[]` shape.
 *
 * Contract — per `docs/implementation.md` §7.1 and `docs/review-findings.md`
 * §3.7:
 *
 *   1. **Endpoints.** Create-task `POST /api/gdw/api`, poll
 *      `GET /api/gdw/api/<task_id>`. Both go through `eosdaRequest`
 *      so auth, path-validation, and sanitised logging are uniform with
 *      Search/Cropper.
 *   2. **`reference` id.** `vizcrop-${shortHash}-${timestamp}` where
 *      `shortHash` is the first 12 hex chars of `sha256(fieldId|sortedIndexes|
 *      date_start|date_end)`. The hash gives a useful grep-key in EOSDA
 *      dashboards while the timestamp guarantees uniqueness so we never
 *      accidentally rejoin a stale task.
 *   3. **Polling.** 2-second interval via `setTimeout` + `await` (NOT
 *      `setInterval`) so cancellation halts cleanly. Cap user-visible wait
 *      at `min(task_timeout, 60)` seconds. On cap, throw `StatsTimeoutError`
 *      carrying the `taskId` so the route can map to HTTP 504.
 *   4. **Response normalisation.** EOSDA returns
 *      `{ result: [{ scene_id, view_id, date, cloud, indexes: { NDVI: {...}, ... } }] }`.
 *      We project to one row per `(viewId, indexName)` tuple with the
 *      columns persisted in `cached_ndvi_stats` (`mean`, `min`, `max`,
 *      `p10`, `p90`, `median`).
 *
 *      > ⚠️ DEVIATION (Module 7.1): EOSDA also returns `std`, `variance`,
 *      > `q1`, `q3` per scene/index. The schema has no columns for them
 *      > and v2 has no UI for them — discarded by choice. A future phase
 *      > that needs them must add columns + a migration.
 *
 *   5. **No side effects.** This wrapper only does the HTTP calls. Caching
 *      into `cached_ndvi_stats` is `stats-cache.ts`'s job; the route layer
 *      orchestrates auth + ownership + cache lookup.
 *   6. **Errors propagate.** Transport / EOSDA non-2xx bubble up as the
 *      original error from `eosdaRequest` (a `TypeError` or `EosdaError`)
 *      so the route can decide whether to degrade to stale cache.
 */
import { createHash } from 'node:crypto';
import type { PolygonGeoJson, VegetationIndex } from '@viz-crop/shared';
import { type EosdaLogger, eosdaRequest } from './eosda-client.js';

/**
 * Polling interval. 2s mirrors the `review-findings.md` §3.7 contract and
 * leaves room under the 10 req/min EOSDA rate limit (one poll task is
 * 30 polls/minute, but we cap the total at 60s so a single task is at
 * most 30 polls in absolute terms).
 */
const POLL_INTERVAL_MS = 2_000;

/**
 * Hard ceiling on user-visible wait, regardless of `task_timeout`. The
 * route returns 504 past this and the client retries via `useQuery`'s
 * `retry: 1, retryDelay: 10_000` (Module 7.2).
 */
const POLL_MAX_WAIT_MS = 60_000;

/** Short hash length (hex chars) for the `reference` id. 12 = 48 bits — */
/** plenty of search-uniqueness without making EOSDA dashboards unreadable. */
const REFERENCE_HASH_LENGTH = 12;

/**
 * One row of normalised statistics for a single `(viewId, indexName)`
 * pair. Fields mirror the persisted columns in `cached_ndvi_stats` plus
 * the per-scene `cloudPercent` (EOSDA `cloud`) and `sceneDate` (EOSDA
 * `date`) we use to populate them on first write.
 *
 * Numeric stats are `null` when EOSDA omitted them (rare — only happens
 * when the AOI/date pair has no usable pixels, e.g. fully-clouded).
 *
 * `dataCoveragePercent` is intentionally absent: EOSDA `mt_stats` does
 * not return data coverage. We carry over the value from the matching
 * `cached_scenes` row at upsert time (see `stats-cache.upsertNdviStats`).
 */
export interface NdviStatsRow {
  viewId: string;
  indexName: VegetationIndex;
  sceneDate: string;
  cloudPercent: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
  p10: number | null;
  p90: number | null;
  median: number | null;
}

export interface RunMtStatsOptions {
  /** Field polygon — passed verbatim into EOSDA's `params.geometry`. */
  geometry: PolygonGeoJson;
  /** Vegetation indexes to compute (1–3 per request). */
  indexes: VegetationIndex[];
  /** Inclusive date window, `YYYY-MM-DD`. */
  dateRange: { from: string; to: string };
  /**
   * Stable id for the request — used in the `reference` hash so the
   * EOSDA dashboard can be grepped by field. Has no security impact
   * (the hash is one-way and the field id is already in our DB).
   */
  fieldId: string;
  /**
   * Optional structured logger forwarded into `eosdaRequest`. When
   * provided, every request logs `{ path, status }` (no key, no full URL).
   */
  log?: EosdaLogger;
}

/** Thrown when polling exceeds {@link POLL_MAX_WAIT_MS}. */
export class StatsTimeoutError extends Error {
  readonly taskId: string;
  constructor(taskId: string) {
    super(`mt_stats task ${taskId} did not complete within ${POLL_MAX_WAIT_MS}ms`);
    this.name = 'StatsTimeoutError';
    this.taskId = taskId;
  }
}

/** Wire shape of the create-task response — we only consume `task_id`. */
interface CreateTaskResponse {
  status?: string;
  task_id?: unknown;
  task_timeout?: unknown;
}

/** Wire shape of the poll response — `result` is present iff the task is done. */
interface PollResponse {
  errors?: unknown;
  status?: string;
  result?: unknown;
}

interface RawSceneRow {
  scene_id?: unknown;
  view_id?: unknown;
  date?: unknown;
  cloud?: unknown;
  indexes?: unknown;
}

interface RawIndexStats {
  average?: unknown;
  median?: unknown;
  min?: unknown;
  max?: unknown;
  p10?: unknown;
  p90?: unknown;
}

/**
 * Build the deterministic-then-unique `reference` id described in
 * `docs/review-findings.md` §3.7 and the Phase 7 plan corrections.
 *
 * Rationale:
 *   - The hash gives a useful grep-key in EOSDA dashboards (operators
 *     can find every task tied to a particular field/index/window).
 *   - The trailing `Date.now()` makes each request unique so we never
 *     accidentally rejoin a stale task on EOSDA's side.
 */
export function buildReferenceId(opts: {
  fieldId: string;
  indexes: VegetationIndex[];
  dateRange: { from: string; to: string };
  now?: number;
}): string {
  const sortedIndexes = [...opts.indexes].sort();
  const material = `${opts.fieldId}|${sortedIndexes.join(',')}|${opts.dateRange.from}|${opts.dateRange.to}`;
  const shortHash = createHash('sha256')
    .update(material)
    .digest('hex')
    .slice(0, REFERENCE_HASH_LENGTH);
  const ts = opts.now ?? Date.now();
  return `vizcrop-${shortHash}-${ts}`;
}

function asTaskId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('eosda mt_stats: create response missing string `task_id`');
  }
  return value;
}

/**
 * Coerce a raw `result[i].indexes[name].<field>` value to `number | null`.
 * EOSDA can return numbers, numeric strings, or omit the field. `null` and
 * non-finite numerics flow through as `null` so the column nullability in
 * `cached_ndvi_stats` is honoured.
 */
function coerceStat(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    if (value.length === 0) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isVegetationIndex(value: string): value is VegetationIndex {
  return value === 'NDVI' || value === 'EVI' || value === 'NDWI';
}

/**
 * Project one EOSDA scene row into one `NdviStatsRow` per `(viewId, index)`
 * tuple. Skips index entries whose key isn't a known `VegetationIndex`
 * (keeps the wire schema future-proof against EOSDA adding e.g. `MSAVI`
 * before our enum catches up).
 */
function mapSceneRow(raw: unknown, sceneIndex: number): NdviStatsRow[] {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`eosda mt_stats: result[${sceneIndex}] is not an object`);
  }
  const r = raw as RawSceneRow;
  if (typeof r.view_id !== 'string' || r.view_id.length === 0) {
    throw new Error(`eosda mt_stats: result[${sceneIndex}].view_id missing or non-string`);
  }
  if (typeof r.date !== 'string' || r.date.length === 0) {
    throw new Error(`eosda mt_stats: result[${sceneIndex}].date missing or non-string`);
  }
  if (typeof r.indexes !== 'object' || r.indexes === null) {
    throw new Error(`eosda mt_stats: result[${sceneIndex}].indexes missing or not an object`);
  }
  const cloudPercent = coerceStat(r.cloud);
  const indexesObj = r.indexes as Record<string, unknown>;
  const rows: NdviStatsRow[] = [];
  for (const [name, statsValue] of Object.entries(indexesObj)) {
    if (!isVegetationIndex(name)) continue;
    if (typeof statsValue !== 'object' || statsValue === null) continue;
    const stats = statsValue as RawIndexStats;
    rows.push({
      viewId: r.view_id,
      indexName: name,
      sceneDate: r.date,
      cloudPercent,
      mean: coerceStat(stats.average),
      min: coerceStat(stats.min),
      max: coerceStat(stats.max),
      p10: coerceStat(stats.p10),
      p90: coerceStat(stats.p90),
      median: coerceStat(stats.median),
    });
  }
  return rows;
}

/**
 * Sleep `ms` milliseconds. Resolves on the next tick when `ms <= 0`.
 * Wrapping `setTimeout` in a Promise lets the polling loop `await` between
 * polls without holding open an `setInterval` we can't cleanly cancel.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    setTimeout(resolve, ms);
  });
}

/**
 * Create an `mt_stats` task and poll it to completion. Returns the
 * normalised stats rows.
 *
 * Polling deadline = `min(task_timeout, POLL_MAX_WAIT_MS)`. On expiry,
 * throws `StatsTimeoutError` so the route can map to HTTP 504.
 *
 * EOSDA contract:
 *   - Create response: `{ task_id, task_timeout, status: 'created' }`.
 *   - Poll response: `{ status?, errors?, result? }`. `result` is present
 *     when the task is done. `errors` (when non-empty) is surfaced as a
 *     thrown `Error`; transport / non-2xx is already an `EosdaError` from
 *     `eosdaRequest`.
 */
export async function runMtStats(opts: RunMtStatsOptions): Promise<NdviStatsRow[]> {
  const { geometry, indexes, dateRange, fieldId, log } = opts;

  const reference = buildReferenceId({ fieldId, indexes, dateRange });

  const create = await eosdaRequest<CreateTaskResponse>('/api/gdw/api', {
    method: 'POST',
    body: JSON.stringify({
      type: 'mt_stats',
      params: {
        bm_type: indexes,
        date_start: dateRange.from,
        date_end: dateRange.to,
        geometry,
        reference,
        sensors: ['sentinel2'],
        cloud_masking_level: 1,
      },
    }),
    ...(log ? { log } : {}),
  });

  const taskId = asTaskId(create.task_id);
  const upstreamTimeoutMs =
    typeof create.task_timeout === 'number' && Number.isFinite(create.task_timeout)
      ? create.task_timeout * 1_000
      : Number.POSITIVE_INFINITY;
  const deadlineMs = Date.now() + Math.min(upstreamTimeoutMs, POLL_MAX_WAIT_MS);

  // Poll loop. We `await sleep(...)` between polls (NOT `setInterval`) so
  // a future cancellation can be threaded in without orphaning timers.
  while (true) {
    const poll = await eosdaRequest<PollResponse>(`/api/gdw/api/${encodeURIComponent(taskId)}`, {
      method: 'GET',
      ...(log ? { log } : {}),
    });

    const hasErrors = Array.isArray(poll.errors) && poll.errors.length > 0;
    const hasResult = poll.result !== undefined && poll.result !== null;

    // EOSDA reports per-scene problems (e.g. "AOI contains clouds only")
    // in `errors[]` even when the task completes with usable rows for
    // other scenes. Treating any `errors[]` as fatal would mask the
    // partial success and force a 502. Per-scene errors are non-fatal —
    // we log them and proceed with whatever `result` rows are available.
    // A task with only `errors[]` and no `result` is a true failure.
    if (hasErrors) {
      log?.warn(
        { taskId, errors: poll.errors },
        'eosda mt_stats: task returned per-scene error(s); continuing with successful scenes',
      );
    }

    if (hasResult) {
      if (!Array.isArray(poll.result)) {
        throw new Error(`eosda mt_stats: task ${taskId} returned non-array result`);
      }
      const rows: NdviStatsRow[] = [];
      poll.result.forEach((scene, idx) => {
        rows.push(...mapSceneRow(scene, idx));
      });
      return rows;
    }

    if (hasErrors) {
      // Terminal failure: errors with no result.
      const preview = JSON.stringify(poll.errors).slice(0, 500);
      throw new Error(
        `eosda mt_stats: task ${taskId} failed with ${(poll.errors as unknown[]).length} error(s) and no result: ${preview}`,
      );
    }

    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) {
      throw new StatsTimeoutError(taskId);
    }
    // Sleep at most the remaining budget so the final poll happens at
    // (or just past) the deadline rather than one full interval early.
    await sleep(Math.min(POLL_INTERVAL_MS, remainingMs));
  }
}
