/**
 * Module 7.1 — Stats cache service.
 *
 * Mirrors `scene-cache.ts` for the `cached_ndvi_stats` table. The Module
 * 7.1 route writes via `upsertNdviStats` after a successful
 * `runMtStats`; the same route (and the Phase 7 hooks) read via
 * `listNdviStats`. `findMissingPairs` lets the route decide whether to
 * call `mt_stats` at all.
 *
 * Contract — per `docs/implementation.md` Module 7.1:
 *
 *   1. **Idempotent upsert.** `INSERT ... ON CONFLICT (field_id, view_id,
 *      index_name) DO UPDATE` so re-running the route for the same range
 *      is a no-op when EOSDA returns the same rows. `created_at` is never
 *      overwritten.
 *   2. **Wire shape preserved.** PostgreSQL `numeric` columns surface as
 *      strings via node-postgres; we keep them as strings on read and let
 *      the shared `ndviStatsDto` `z.coerce.number()` widen them on the
 *      client. Doing the coercion here would duplicate the contract.
 *   3. **Reads project to `NdviStatsApiRow`.** The same fields the shared
 *      zod expects (id, fieldId, viewId, indexName, sceneDate, cloud %,
 *      data coverage %, mean/min/max/p10/p90/median, createdAt).
 *   4. **Numeric guard at write.** `assertWritable` rejects non-finite
 *      `cloudPercent` / `dataCoveragePercent` so a NaN never lands in a
 *      `numeric` column (PostgreSQL accepts `'NaN'::numeric` happily and
 *      that would corrupt later reads).
 *   5. **DI for tests.** Both write and read paths accept an optional
 *      `db: Db` so integration tests can pin a connection without
 *      sharing state with the process-wide pool.
 */
import type { VegetationIndex } from '@viz-crop/shared';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { type Db, db as sharedDb } from '../db/client.js';
import { cachedNdviStats } from '../db/schema.js';

/**
 * Wire-shaped projection of a `cached_ndvi_stats` row used by the API
 * surface (`listNdviStats` → `POST /api/eosda/stats`).
 *
 * Numeric columns surface as PostgreSQL `numeric` strings via
 * node-postgres; we leave them as strings here and let the shared
 * `ndviStatsDto`'s `z.coerce.number()` widen them to `number | null` at
 * the boundary.
 */
export interface NdviStatsApiRow {
  id: string;
  fieldId: string;
  viewId: string;
  indexName: string;
  sceneDate: string;
  cloudPercent: string | null;
  dataCoveragePercent: string | null;
  mean: string | null;
  min: string | null;
  max: string | null;
  p10: string | null;
  p90: string | null;
  median: string | null;
  createdAt: Date;
}

/**
 * Single row written by `upsertNdviStats`. Mirrors the EOSDA-normalised
 * `NdviStatsRow` from `eosda-stats.ts` plus the `dataCoveragePercent`
 * pulled from the matching `cached_scenes` row (mt_stats does NOT return
 * data coverage).
 */
export interface NdviStatsWriteRow {
  viewId: string;
  indexName: VegetationIndex;
  sceneDate: string;
  cloudPercent: number | null;
  dataCoveragePercent: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
  p10: number | null;
  p90: number | null;
  median: number | null;
}

export interface StatsCacheOptions {
  /**
   * Drizzle handle. Defaults to the process-wide `sharedDb`. Inside
   * Fastify route handlers, prefer `request.server.db` so the call
   * participates in the app's pool lifecycle.
   */
  db?: Db;
}

export interface ListNdviStatsOptions extends StatsCacheOptions {
  viewIds?: string[];
  indexes?: VegetationIndex[];
  /** Inclusive date filter on `scene_date`; either bound is optional. */
  dateRange?: {
    from?: string;
    to?: string;
  };
}

export interface FindMissingPairsOptions extends StatsCacheOptions {}

/** Tuple identifying a `(viewId, indexName)` pair. */
export interface ViewIndexPair {
  viewId: string;
  indexName: VegetationIndex;
}

/**
 * Coerce a JS number to the string form Drizzle's `numeric` column
 * expects. `null` propagates so nullable stats fields can land as DB
 * NULL. `Number.isFinite` guards against NaN/Infinity which PostgreSQL
 * `numeric` would store as the literal string `'NaN'` and corrupt
 * later reads.
 */
function numericOrNull(value: number | null, label: string, viewId: string): string | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) {
    throw new Error(
      `stats-cache: refusing to upsert view_id=${viewId} with non-finite ${label}=${value}`,
    );
  }
  return value.toString();
}

function assertWritable(row: NdviStatsWriteRow): void {
  if (row.viewId.length === 0) {
    throw new Error('stats-cache: refusing to upsert with empty viewId');
  }
  if (row.sceneDate.length === 0) {
    throw new Error(`stats-cache: refusing to upsert view_id=${row.viewId} with empty sceneDate`);
  }
}

/**
 * Insert or refresh `cached_ndvi_stats` rows for `fieldId`.
 *
 * - On first INSERT for a `(field_id, view_id, index_name)` triple, every
 *   column is set from the row and `created_at` defaults to `now()`.
 * - On subsequent re-INSERTs of the same triple, the columns that may have
 *   changed since the last task — `scene_date`, `cloud_percent`,
 *   `data_coverage_percent`, `mean`/`min`/`max`/`p10`/`p90`/`median` —
 *   are refreshed. `created_at` is preserved.
 *
 * No-op on an empty `rows` array.
 */
export async function upsertNdviStats(
  fieldId: string,
  rows: NdviStatsWriteRow[],
  options: StatsCacheOptions = {},
): Promise<void> {
  if (rows.length === 0) return;
  const { db = sharedDb } = options;

  for (const row of rows) assertWritable(row);

  const values = rows.map((row) => ({
    fieldId,
    viewId: row.viewId,
    indexName: row.indexName,
    sceneDate: row.sceneDate,
    cloudPercent: numericOrNull(row.cloudPercent, 'cloudPercent', row.viewId),
    dataCoveragePercent: numericOrNull(row.dataCoveragePercent, 'dataCoveragePercent', row.viewId),
    mean: numericOrNull(row.mean, 'mean', row.viewId),
    min: numericOrNull(row.min, 'min', row.viewId),
    max: numericOrNull(row.max, 'max', row.viewId),
    p10: numericOrNull(row.p10, 'p10', row.viewId),
    p90: numericOrNull(row.p90, 'p90', row.viewId),
    median: numericOrNull(row.median, 'median', row.viewId),
  }));

  await db
    .insert(cachedNdviStats)
    .values(values)
    .onConflictDoUpdate({
      target: [cachedNdviStats.fieldId, cachedNdviStats.viewId, cachedNdviStats.indexName],
      set: {
        sceneDate: sql`excluded.scene_date`,
        cloudPercent: sql`excluded.cloud_percent`,
        dataCoveragePercent: sql`excluded.data_coverage_percent`,
        mean: sql`excluded.mean`,
        min: sql`excluded.min`,
        max: sql`excluded.max`,
        p10: sql`excluded.p10`,
        p90: sql`excluded.p90`,
        median: sql`excluded.median`,
      },
    });
}

const ndviStatsApiSelect = {
  id: cachedNdviStats.id,
  fieldId: cachedNdviStats.fieldId,
  viewId: cachedNdviStats.viewId,
  indexName: cachedNdviStats.indexName,
  sceneDate: cachedNdviStats.sceneDate,
  cloudPercent: cachedNdviStats.cloudPercent,
  dataCoveragePercent: cachedNdviStats.dataCoveragePercent,
  mean: cachedNdviStats.mean,
  min: cachedNdviStats.min,
  max: cachedNdviStats.max,
  p10: cachedNdviStats.p10,
  p90: cachedNdviStats.p90,
  median: cachedNdviStats.median,
  createdAt: cachedNdviStats.createdAt,
};

/**
 * Read NDVI/EVI/NDWI stats for the public API surface
 * (`POST /api/eosda/stats`, Module 7.1).
 *
 * Returns rows projected into `NdviStatsApiRow` ordered newest-first by
 * `sceneDate` with `viewId` then `indexName` as stable tie-breakers.
 * Optional filters narrow the result by `viewId` and `indexName`.
 */
export async function listNdviStats(
  fieldId: string,
  options: ListNdviStatsOptions = {},
): Promise<NdviStatsApiRow[]> {
  const { db = sharedDb, viewIds, indexes, dateRange } = options;

  const conditions = [eq(cachedNdviStats.fieldId, fieldId)];
  if (viewIds && viewIds.length > 0) conditions.push(inArray(cachedNdviStats.viewId, viewIds));
  if (indexes && indexes.length > 0) conditions.push(inArray(cachedNdviStats.indexName, indexes));
  if (dateRange?.from) conditions.push(gte(cachedNdviStats.sceneDate, dateRange.from));
  if (dateRange?.to) conditions.push(lte(cachedNdviStats.sceneDate, dateRange.to));

  return db
    .select(ndviStatsApiSelect)
    .from(cachedNdviStats)
    .where(and(...conditions))
    .orderBy(
      desc(cachedNdviStats.sceneDate),
      asc(cachedNdviStats.viewId),
      asc(cachedNdviStats.indexName),
    );
}

/**
 * Compute the `(viewId, indexName)` tuples NOT yet in
 * `cached_ndvi_stats` for the given field.
 *
 * The route uses the result to decide whether to spend EOSDA quota on
 * `mt_stats`: when the returned array is empty the cache is fully
 * populated and the route can return immediately.
 */
export async function findMissingPairs(
  fieldId: string,
  viewIds: string[],
  indexes: VegetationIndex[],
  options: FindMissingPairsOptions = {},
): Promise<ViewIndexPair[]> {
  if (viewIds.length === 0 || indexes.length === 0) return [];
  const { db = sharedDb } = options;

  const cached = await db
    .select({
      viewId: cachedNdviStats.viewId,
      indexName: cachedNdviStats.indexName,
    })
    .from(cachedNdviStats)
    .where(
      and(
        eq(cachedNdviStats.fieldId, fieldId),
        inArray(cachedNdviStats.viewId, viewIds),
        inArray(cachedNdviStats.indexName, indexes),
      ),
    );

  const have = new Set<string>();
  for (const row of cached) {
    have.add(`${row.viewId}\u0000${row.indexName}`);
  }

  const missing: ViewIndexPair[] = [];
  for (const viewId of viewIds) {
    for (const indexName of indexes) {
      if (!have.has(`${viewId}\u0000${indexName}`)) {
        missing.push({ viewId, indexName });
      }
    }
  }
  return missing;
}
