/**
 * Module 7.1 — `POST /api/eosda/stats`.
 *
 * Returns cached NDVI/EVI/NDWI zonal statistics for one of the caller's
 * fields. The route is the cache-first surface that powers the Phase 7
 * Sample pane and Chart tab: it reads `cached_ndvi_stats` first, and
 * only fires an EOSDA `mt_stats` task when the requested
 * `(viewId, indexName)` pairs are missing from the cache.
 *
 * Auth + ownership:
 *   - `requireUser` rejects any anonymous caller with 401.
 *   - The single ownership query also returns the field's geometry — that
 *     way `mt_stats` can run without a second SELECT and any "field not
 *     yours" case collapses cleanly to 404 (we deliberately do not
 *     distinguish "doesn't exist" from "owned by someone else"; same
 *     precedent as `fields.ts`).
 *
 * Cache-first orchestration:
 *   1. Resolve the date window via the shared `resolveDateRange` (Module
 *      6.1 + 7.1 use the same default to keep the timeline and the
 *      stats series in lockstep).
 *   2. List the cached scene `view_ids` for the field within the window
 *      via `listScenesForApi`.
 *   3. **Empty scene cache** → return `{ stats: [], error:
 *      'NO_SCENES_FOR_RANGE' }` (HTTP 200, no EOSDA call). The frontend
 *      renders an empty-state message; we do not waste quota running
 *      `mt_stats` against zero scenes.
 *   4. **At least one scene** → compute missing `(viewId, index)` pairs
 *      via `findMissingPairs`.
 *      - **All cached** → re-read and return.
 *      - **At least one missing** → fire ONE `mt_stats` task for the
 *        FULL geometry + FULL `dateRange` + ALL requested indexes (one
 *        task covers many scenes so this is cheap on quota), upsert the
 *        results joined with the per-scene `dataCoveragePercent` from
 *        `cached_scenes`, then re-read so the wire shape matches the
 *        shared zod.
 *
 * Error degradation:
 *   - `StatsTimeoutError` → HTTP 504 with `{ error: 'STATS_TIMEOUT',
 *     taskId }` so the client can retry per Module 7.2.
 *   - Any other EOSDA / transport error → fall back to whatever cache
 *     rows already exist (possibly stale), mirroring the Phase 6
 *     "Search threw, return cached" pattern. Only return 502 when the
 *     cache is empty (no usable data at all).
 */
import { getAuth } from '@clerk/fastify';
import {
  type EosdaStatsResponse,
  eosdaStatsRequest,
  NO_SCENES_FOR_RANGE,
  type PolygonGeoJson,
  type VegetationIndex,
} from '@viz-crop/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { type ZodError, z } from 'zod';
import { geometryToGeoJson } from '../db/geometry.js';
import { fields } from '../db/schema.js';
import { resolveDateRange } from '../lib/date-range.js';
import { requireUser } from '../plugins/auth.js';
import { type NdviStatsRow, runMtStats, StatsTimeoutError } from '../services/eosda-stats.js';
import { listScenesForApi, type SceneApiRow } from '../services/scene-cache.js';
import {
  findMissingPairs,
  listNdviStats,
  type NdviStatsApiRow,
  type NdviStatsWriteRow,
  upsertNdviStats,
} from '../services/stats-cache.js';

/** Default `indexes` when the caller omits the field. Matches plan spec. */
const DEFAULT_INDEXES: VegetationIndex[] = ['NDVI'];

/**
 * Translate a zod validation failure into a 400 with a compact
 * `{ field: [messages] }` map (`z.flattenError`). Mirrors `fields.ts` so
 * every route's malformed-body error envelope is structurally identical.
 */
function rejectInvalidRequest(
  app: FastifyInstance,
  error: ZodError,
  message = 'Invalid request',
): never {
  const flat = z.flattenError(error);
  throw app.httpErrors.badRequest(
    `${message}: ${JSON.stringify({
      formErrors: flat.formErrors,
      fieldErrors: flat.fieldErrors,
    })}`,
  );
}

/** Return the authenticated `userId` (`requireUser` guarantees presence). */
function authedUserId(request: FastifyRequest): string {
  const { userId } = getAuth(request);
  if (!userId) {
    throw request.server.httpErrors.unauthorized('Authentication required');
  }
  return userId;
}

/**
 * Join EOSDA's `mt_stats` rows (lacking `dataCoveragePercent`) with the
 * per-scene data coverage from `cached_scenes`. The result is the row
 * set we persist into `cached_ndvi_stats`.
 *
 * Rows whose `viewId` isn't in the scene cache are dropped: they would
 * be a contract violation (we only ever ask `mt_stats` about scenes we
 * have cached). Logging the drop keeps the "EOSDA returned a row we
 * didn't ask about" case visible.
 */
function joinWithCoverage(
  statsRows: NdviStatsRow[],
  scenesByViewId: Map<string, SceneApiRow>,
  log: FastifyRequest['log'],
  fieldId: string,
): NdviStatsWriteRow[] {
  const out: NdviStatsWriteRow[] = [];
  for (const row of statsRows) {
    const scene = scenesByViewId.get(row.viewId);
    if (!scene) {
      log.warn(
        { fieldId, viewId: row.viewId },
        'eosda/stats: mt_stats returned row for unknown view_id; skipping',
      );
      continue;
    }
    const coverageStr = scene.dataCoveragePercent;
    const dataCoveragePercent =
      coverageStr === null || coverageStr === undefined ? null : Number(coverageStr);
    out.push({
      viewId: row.viewId,
      indexName: row.indexName,
      sceneDate: row.sceneDate,
      cloudPercent: row.cloudPercent,
      dataCoveragePercent:
        dataCoveragePercent !== null && Number.isFinite(dataCoveragePercent)
          ? dataCoveragePercent
          : null,
      mean: row.mean,
      min: row.min,
      max: row.max,
      p10: row.p10,
      p90: row.p90,
      median: row.median,
    });
  }
  return out;
}

/**
 * Synthesise tombstone (all-stats-null) rows for `(viewId, indexName)`
 * pairs that were in the request but absent from EOSDA's `mt_stats`
 * response.
 *
 * EOSDA legitimately omits scenes with no usable pixels (full cloud
 * cover, edge-of-orbit slivers, etc). Without a tombstone the next call
 * to `findMissingPairs` would still see them as missing and the route
 * would re-spend quota indefinitely. Persisting an empty row (cloud %
 * + data coverage % from `cached_scenes`, every stat NULL) lets the
 * cache record "we asked, EOSDA had nothing". The Sample / Chart UI
 * already handles `null` stat values via the `getNdviColor` `'gray'`
 * branch (Module 7.3 / 7.4).
 */
function tombstoneRowsForMissing(
  requestedIndexes: VegetationIndex[],
  requestedViewIds: string[],
  returnedKeys: Set<string>,
  scenesByViewId: Map<string, SceneApiRow>,
): NdviStatsWriteRow[] {
  const out: NdviStatsWriteRow[] = [];
  for (const viewId of requestedViewIds) {
    for (const indexName of requestedIndexes) {
      if (returnedKeys.has(`${viewId}\u0000${indexName}`)) continue;
      const scene = scenesByViewId.get(viewId);
      if (!scene) continue;
      const cloudStr = scene.cloudPercent;
      const cloudPercent = cloudStr === null || cloudStr === undefined ? null : Number(cloudStr);
      const coverageStr = scene.dataCoveragePercent;
      const dataCoveragePercent =
        coverageStr === null || coverageStr === undefined ? null : Number(coverageStr);
      out.push({
        viewId,
        indexName,
        sceneDate: scene.sceneDate,
        cloudPercent: cloudPercent !== null && Number.isFinite(cloudPercent) ? cloudPercent : null,
        dataCoveragePercent:
          dataCoveragePercent !== null && Number.isFinite(dataCoveragePercent)
            ? dataCoveragePercent
            : null,
        mean: null,
        min: null,
        max: null,
        p10: null,
        p90: null,
        median: null,
      });
    }
  }
  return out;
}

const eosdaStatsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /api/eosda/stats — read-or-compute NDVI stats for a field.
   *
   * Body: `{ fieldId, indexes?, dateRange? }` — see `eosdaStatsRequest`
   * for the wire schema. Returns the cache rows (newest-first) projected
   * into the shared `ndviStatsDto` shape, or `{ stats: [], error:
   * 'NO_SCENES_FOR_RANGE' }` when the scene cache is empty for the
   * requested window.
   */
  app.post('/eosda/stats', { preHandler: requireUser }, async (request, reply) => {
    const userId = authedUserId(request);

    const parsed = eosdaStatsRequest.safeParse(request.body);
    if (!parsed.success) rejectInvalidRequest(app, parsed.error, 'Invalid request body');
    const { fieldId, indexes: requestedIndexes, dateRange: requestedRange } = parsed.data;
    const indexes: VegetationIndex[] = requestedIndexes ?? DEFAULT_INDEXES;

    const range = resolveDateRange(requestedRange, new Date());

    const ownershipRows = await app.db
      .select({
        id: fields.id,
        geometry: geometryToGeoJson(fields.geometry),
      })
      .from(fields)
      .where(and(eq(fields.id, fieldId), eq(fields.userId, userId)))
      .limit(1);

    const fieldRow = ownershipRows[0];
    if (!fieldRow) throw app.httpErrors.notFound('Field not found');

    const sceneList = await listScenesForApi(fieldId, { db: app.db, dateRange: range });
    if (sceneList.scenes.length === 0) {
      const empty: EosdaStatsResponse = { stats: [], error: NO_SCENES_FOR_RANGE };
      return empty;
    }

    const viewIds = sceneList.scenes.map((s) => s.viewId);
    const missing = await findMissingPairs(fieldId, viewIds, indexes, { db: app.db });

    if (missing.length > 0) {
      const scenesByViewId = new Map<string, SceneApiRow>();
      for (const scene of sceneList.scenes) scenesByViewId.set(scene.viewId, scene);

      try {
        const fetched = await runMtStats({
          fieldId,
          geometry: fieldRow.geometry as PolygonGeoJson,
          indexes,
          dateRange: range,
          log: request.log,
        });
        const writable = joinWithCoverage(fetched, scenesByViewId, request.log, fieldId);
        // Tombstone the (viewId, indexName) pairs we asked about that
        // EOSDA didn't return. Without this, every future request would
        // see them in `findMissingPairs` and re-spend quota forever.
        const returnedKeys = new Set<string>();
        for (const row of writable) returnedKeys.add(`${row.viewId}\u0000${row.indexName}`);
        const tombstones = tombstoneRowsForMissing(indexes, viewIds, returnedKeys, scenesByViewId);
        if (tombstones.length > 0) {
          request.log.info(
            { fieldId, missingCount: tombstones.length, returnedCount: writable.length },
            'eosda/stats: persisting tombstones for pairs absent from mt_stats response',
          );
        }
        const allRows = writable.concat(tombstones);
        if (allRows.length > 0) {
          await upsertNdviStats(fieldId, allRows, { db: app.db });
        }
      } catch (err) {
        if (err instanceof StatsTimeoutError) {
          // The client (Module 7.2) retries once after 10s on this shape.
          // We surface the taskId so a future ops dashboard can correlate.
          request.log.warn({ fieldId, taskId: err.taskId }, 'eosda/stats: mt_stats poll timed out');
          reply.code(504);
          return { error: 'STATS_TIMEOUT', taskId: err.taskId };
        }
        // Fall back to whatever cache rows we have. The user sees stale
        // data rather than an error spinner.
        request.log.error({ err, fieldId }, 'eosda/stats: mt_stats failed; falling back to cache');
      }
    }

    const stats = await listNdviStats(fieldId, {
      db: app.db,
      viewIds,
      indexes,
      dateRange: range,
    });

    // If we tried to refresh AND the cache is still empty for these
    // pairs, the upstream is genuinely broken for this caller. Surface
    // 502 so the client doesn't render "happy path" with no rows.
    if (missing.length > 0 && stats.length === 0) {
      throw app.httpErrors.badGateway('EOSDA mt_stats unavailable and no cached stats');
    }

    // Note: `NdviStatsApiRow` carries numeric columns as strings (per
    // node-postgres) and `createdAt` as a JS `Date`. The shared
    // `eosdaStatsResponse` zod runs `z.coerce.number()` and the
    // `isoDateTime` Date→string preprocess on the client side, so these
    // wire-shape fields parse cleanly into the strict `NdviStatsDto`.
    // Type cast is safe — the wire shape mirrors `NdviStatsApiRow`.
    return { stats: stats as unknown as EosdaStatsResponse['stats'] };
  });
};

export default eosdaStatsRoutes;

// Re-export type to keep the route plugin's intent grep-friendly.
export type { NdviStatsApiRow };
