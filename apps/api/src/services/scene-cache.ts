/**
 * Module 4.4 — Scene cache service.
 *
 * `upsertScenes` / `listScenes` / `getMostRecentScene` mediate the
 * `cached_scenes` table. The Module 4.5 `warmField` orchestrator writes
 * via `upsertScenes` after a successful Search; Phase 7's analysis
 * timeline reads via `listScenes`; the Phase 6 default-scene picker (and
 * Module 4.5's smoke verification) reads via `getMostRecentScene`.
 *
 * Contract — per `docs/implementation.md` Module 4.4:
 *
 *   1. **Idempotent upsert.** `INSERT ... ON CONFLICT (field_id, view_id)
 *      DO UPDATE` so re-running warm-up for the same field with the same
 *      scenes is a no-op except for `last_seen_at` (and any field EOSDA
 *      revised — `cloudPercent`, `dataCoveragePercent`, `tmsTemplate`,
 *      `sceneId`, `sceneDate`). `created_at` is never overwritten so
 *      Phase 7 can show "first seen" in the timeline if it ever wants
 *      that signal.
 *   2. **Trust the wrapper, validate at the boundary anyway.**
 *      `searchScenes` already validates per-row shape (Module 4.3) so
 *      every `SceneDto` it returns is well-formed. We still defend
 *      against a caller passing junk by relying on TypeScript's
 *      structural type at compile time and on the `cached_scenes`
 *      column NOT NULL constraints at runtime — anything that slips
 *      past both surfaces as a `pg.DatabaseError`, not silent garbage.
 *   3. **Reads sort newest-first.** `cached_scenes_field_date_idx` is
 *      `(field_id, scene_date DESC NULLS LAST)`; both list and "most
 *      recent" reads use it. Date range filters apply against
 *      `scene_date` (the EOSDA acquisition date), not `created_at` /
 *      `last_seen_at` (those track our cache state, not the data).
 *   4. **Numeric → number coercion at read time.** PostgreSQL `numeric`
 *      columns surface as strings via node-postgres; we coerce back to
 *      `number` so callers see the same shape `searchScenes` produces.
 *      Coercion uses `Number(...)` and asserts `Number.isFinite` to
 *      catch DB corruption early instead of letting `NaN` flow into
 *      the analysis layer.
 *   5. **DI for tests.** Both write and read paths accept an optional
 *      `db: Db` so the integration tests can wrap each test in a pinned
 *      connection / transaction without sharing state with the
 *      process-wide pool.
 */
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { type Db, db as sharedDb } from '../db/client.js';
import { cachedScenes } from '../db/schema.js';
import type { SceneDto } from './eosda-search.js';

/**
 * Wire-shaped projection of a `cached_scenes` row used by the API surface
 * (`listScenesForApi` → `POST /api/eosda/scenes`).
 *
 * Distinct from the internal `SceneDto` (`./eosda-search.js`) which mirrors
 * EOSDA's Search shape and is consumed by the warm-up service. The wire DTO
 * adds the row identity (`id`, `fieldId`), the `source` discriminator, and
 * `createdAt`, all of which are required by the shared `sceneDto` zod that
 * validates the response on the client side.
 *
 * Numeric columns surface as PostgreSQL `numeric` strings via node-postgres;
 * we leave them as strings here and let the shared `sceneDto`'s
 * `z.coerce.number()` widen them to `number | null` at the boundary. Doing
 * the coercion here would duplicate the contract and risk drift if the
 * shared schema ever tightens precision.
 *
 * `tmsTemplate` is included for parity with the shared DTO but is metadata
 * only — Phase 6 tile fetches go through the `/api/eosda/render/...`
 * proxy (Module 6.3), not this URL.
 */
export interface SceneApiRow {
  id: string;
  fieldId: string;
  viewId: string;
  source: string;
  sceneDate: string;
  cloudPercent: string | null;
  dataCoveragePercent: string | null;
  tmsTemplate: string | null;
  createdAt: Date;
}

export interface SceneCacheOptions {
  /**
   * Drizzle handle. Defaults to the process-wide `sharedDb`. Inside
   * Fastify route handlers, prefer `request.server.db` so the call
   * participates in the app's pool lifecycle (relevant in tests that
   * spin up multiple Fastify instances).
   */
  db?: Db;
}

export interface ListScenesOptions extends SceneCacheOptions {
  /**
   * Inclusive date filter on `scene_date`. Either bound is optional;
   * pass nothing to read every cached scene for the field.
   */
  dateRange?: {
    /** Inclusive lower bound, `YYYY-MM-DD`. */
    from?: string;
    /** Inclusive upper bound, `YYYY-MM-DD`. */
    to?: string;
  };
}

/** Columns we read back into a `SceneDto`. Centralised so the three
 * read paths stay in lockstep and any new column addition surfaces as
 * a single edit. `lastSeenAt` and `createdAt` are intentionally NOT
 * projected — they're cache metadata, not part of the public DTO. */
const sceneSelect = {
  sceneId: cachedScenes.sceneId,
  viewId: cachedScenes.viewId,
  sceneDate: cachedScenes.sceneDate,
  cloudPercent: cachedScenes.cloudPercent,
  dataCoveragePercent: cachedScenes.dataCoveragePercent,
  tmsTemplate: cachedScenes.tmsTemplate,
};

/**
 * Convert a `cached_scenes` row (with stringy `numeric` columns and
 * possibly-null nullable text) into the strict `SceneDto` shape.
 *
 * Throws on null/non-finite values for fields the DTO requires. This
 * shouldn't happen in practice — `upsertScenes` only writes rows where
 * every field is well-formed — but if a future code path or manual
 * INSERT bypasses us, surfacing the violation as a thrown error here
 * is much louder (and easier to grep) than letting `NaN`/`null`
 * propagate into the UI.
 */
function rowToSceneDto(row: {
  sceneId: string | null;
  viewId: string;
  sceneDate: string;
  cloudPercent: string | null;
  dataCoveragePercent: string | null;
  tmsTemplate: string | null;
}): SceneDto {
  if (row.sceneId === null) {
    throw new Error(`scene-cache: row for view_id=${row.viewId} has NULL scene_id`);
  }
  if (row.tmsTemplate === null) {
    throw new Error(`scene-cache: row for view_id=${row.viewId} has NULL tms_template`);
  }
  if (row.cloudPercent === null) {
    throw new Error(`scene-cache: row for view_id=${row.viewId} has NULL cloud_percent`);
  }
  if (row.dataCoveragePercent === null) {
    throw new Error(`scene-cache: row for view_id=${row.viewId} has NULL data_coverage_percent`);
  }
  const cloud = Number(row.cloudPercent);
  if (!Number.isFinite(cloud)) {
    throw new Error(
      `scene-cache: row for view_id=${row.viewId} has non-finite cloud_percent=${row.cloudPercent}`,
    );
  }
  const dataCov = Number(row.dataCoveragePercent);
  if (!Number.isFinite(dataCov)) {
    throw new Error(
      `scene-cache: row for view_id=${row.viewId} has non-finite data_coverage_percent=${row.dataCoveragePercent}`,
    );
  }
  return {
    sceneId: row.sceneId,
    viewId: row.viewId,
    sceneDate: row.sceneDate,
    cloudPercent: cloud,
    dataCoveragePercent: dataCov,
    tmsTemplate: row.tmsTemplate,
  };
}

/**
 * Defensive: validate every numeric/required field in a `SceneDto` before
 * we hand it to PostgreSQL. Module 4.3's `searchScenes` already validates
 * per-row but `upsertScenes` is exported and TypeScript's `number` type
 * does not exclude `NaN` / `Infinity`. PostgreSQL accepts `'NaN'::numeric`
 * happily, so without this guard a `NaN` `cloudPercent` would write a row
 * that `rowToSceneDto` later rejects, breaking subsequent `listScenes`
 * and `getMostRecentScene` reads.
 */
function assertSceneIsWritable(scene: SceneDto): void {
  if (!Number.isFinite(scene.cloudPercent)) {
    throw new Error(
      `scene-cache: refusing to upsert view_id=${scene.viewId} with non-finite cloudPercent=${scene.cloudPercent}`,
    );
  }
  if (!Number.isFinite(scene.dataCoveragePercent)) {
    throw new Error(
      `scene-cache: refusing to upsert view_id=${scene.viewId} with non-finite dataCoveragePercent=${scene.dataCoveragePercent}`,
    );
  }
  if (scene.sceneId.length === 0) {
    throw new Error(`scene-cache: refusing to upsert view_id=${scene.viewId} with empty sceneId`);
  }
  if (scene.viewId.length === 0) {
    throw new Error('scene-cache: refusing to upsert with empty viewId');
  }
}

/**
 * Insert or refresh `cached_scenes` rows for `fieldId`.
 *
 * - On first INSERT for a `(field_id, view_id)` pair, every column is
 *   set from `scene` and `created_at` / `last_seen_at` default to `now()`.
 * - On subsequent re-INSERTs of the same pair, the columns that may
 *   have changed since the last warm-up — `scene_id`, `scene_date`,
 *   `cloud_percent`, `data_coverage_percent`, `tms_template` — are
 *   refreshed from the new row, and `last_seen_at` is bumped to `now()`.
 *   `created_at` is preserved.
 *
 * No-op on an empty `scenes` array (Drizzle would otherwise reject the
 * empty `INSERT ... VALUES` clause).
 */
export async function upsertScenes(
  fieldId: string,
  scenes: SceneDto[],
  options: SceneCacheOptions = {},
): Promise<void> {
  if (scenes.length === 0) return;
  const { db = sharedDb } = options;

  for (const scene of scenes) assertSceneIsWritable(scene);

  const rows = scenes.map((scene) => ({
    fieldId,
    viewId: scene.viewId,
    sceneId: scene.sceneId,
    sceneDate: scene.sceneDate,
    // Drizzle's `numeric` column expects a string for input — pg will
    // not implicitly coerce a JS `number` into a `numeric` parameter
    // and `node-postgres` would surface the type mismatch as a
    // 22P02 invalid_text_representation error.
    cloudPercent: scene.cloudPercent.toString(),
    dataCoveragePercent: scene.dataCoveragePercent.toString(),
    tmsTemplate: scene.tmsTemplate,
  }));

  await db
    .insert(cachedScenes)
    .values(rows)
    .onConflictDoUpdate({
      target: [cachedScenes.fieldId, cachedScenes.viewId],
      set: {
        sceneId: sql`excluded.scene_id`,
        sceneDate: sql`excluded.scene_date`,
        cloudPercent: sql`excluded.cloud_percent`,
        dataCoveragePercent: sql`excluded.data_coverage_percent`,
        tmsTemplate: sql`excluded.tms_template`,
        lastSeenAt: sql`now()`,
      },
    });
}

/**
 * Predicate used by both read paths to filter out rows that lack any
 * of the columns `rowToSceneDto` requires. The defensive throws in
 * `rowToSceneDto` would otherwise surface as a hard error on a single
 * malformed row, breaking the entire list. Today the only realistic
 * source of a partial row is a pre-Module-4.4 row where `scene_id`
 * defaulted to `NULL` from the migration, but applying the filter at
 * SQL level keeps the contract robust against any future writer that
 * bypasses `upsertScenes`.
 */
function isCompleteSceneRow() {
  return and(
    sql`${cachedScenes.sceneId} IS NOT NULL`,
    sql`${cachedScenes.tmsTemplate} IS NOT NULL`,
    sql`${cachedScenes.cloudPercent} IS NOT NULL`,
    sql`${cachedScenes.dataCoveragePercent} IS NOT NULL`,
  );
}

/**
 * List cached scenes for a field, newest-first by `scene_date` (with a
 * stable secondary sort on `view_id` so equal-date scenes have a
 * deterministic order).
 *
 * `dateRange` filters are inclusive against `scene_date` (the EOSDA
 * acquisition date, NOT our cache `created_at`). Pass
 * `dateRange: { from }` for "everything from this date forward" or
 * `{ to }` for "everything up to this date". Omit `dateRange` for the
 * full cache.
 */
export async function listScenes(
  fieldId: string,
  options: ListScenesOptions = {},
): Promise<SceneDto[]> {
  const { db = sharedDb, dateRange } = options;

  const conditions = [eq(cachedScenes.fieldId, fieldId), isCompleteSceneRow()];
  if (dateRange?.from) conditions.push(gte(cachedScenes.sceneDate, dateRange.from));
  if (dateRange?.to) conditions.push(lte(cachedScenes.sceneDate, dateRange.to));

  const rows = await db
    .select(sceneSelect)
    .from(cachedScenes)
    .where(and(...conditions))
    .orderBy(desc(cachedScenes.sceneDate), desc(cachedScenes.viewId));

  return rows.map(rowToSceneDto);
}

/**
 * Return the newest cached scene for `fieldId`, or `null` if the cache
 * is empty.
 *
 * Used for (a) Module 4.5's smoke verification ("after warm-up, this
 * should not be null when EOSDA has coverage") and (b) the Phase 6
 * default scene picker on `/fields/:id`.
 *
 * Tie-breaking on equal `scene_date`: prefer the row with the highest
 * `data_coverage_percent`, then the lowest `cloud_percent`, then the
 * lexicographically smallest `view_id`. This makes the Phase 6 default
 * stable across plans and biases toward the visually-best scene.
 */
export async function getMostRecentScene(
  fieldId: string,
  options: SceneCacheOptions = {},
): Promise<SceneDto | null> {
  const { db = sharedDb } = options;

  const rows = await db
    .select(sceneSelect)
    .from(cachedScenes)
    .where(and(eq(cachedScenes.fieldId, fieldId), isCompleteSceneRow()))
    .orderBy(
      desc(cachedScenes.sceneDate),
      desc(cachedScenes.dataCoveragePercent),
      cachedScenes.cloudPercent,
      cachedScenes.viewId,
    )
    .limit(1);

  const row = rows[0];
  return row ? rowToSceneDto(row) : null;
}

/**
 * Wire-shape projection of `cached_scenes`. Distinct from `sceneSelect`
 * (which feeds the internal `SceneDto`) — this adds `id`, `fieldId`,
 * `source`, and `createdAt` to satisfy the shared `sceneDto` zod consumed
 * by the client. `lastSeenAt` is selected alongside but stripped from the
 * returned row; the route uses it to compute the freshness window.
 */
const sceneApiSelect = {
  id: cachedScenes.id,
  fieldId: cachedScenes.fieldId,
  viewId: cachedScenes.viewId,
  source: cachedScenes.source,
  sceneDate: cachedScenes.sceneDate,
  cloudPercent: cachedScenes.cloudPercent,
  dataCoveragePercent: cachedScenes.dataCoveragePercent,
  tmsTemplate: cachedScenes.tmsTemplate,
  createdAt: cachedScenes.createdAt,
  lastSeenAt: cachedScenes.lastSeenAt,
};

/**
 * Read scenes for the public API surface (`POST /api/eosda/scenes`,
 * Module 6.1).
 *
 * Returns rows projected into `SceneApiRow` (the wire shape that satisfies
 * the shared `sceneDto` zod after `z.coerce.number()` runs on numeric
 * columns) ordered newest-first by `sceneDate`, with `viewId` as a stable
 * tie-breaker. Filters use the same `isCompleteSceneRow()` guard as
 * `listScenes` so partially-populated rows (where `view_id`/`scene_date`
 * is NULL or `tms_template`/`cloud_percent` would render unusable) are
 * never surfaced to the UI.
 *
 * Also returns `newestLastSeenAt`: the largest `last_seen_at` among rows
 * matching the query, or `null` when the result is empty. The route uses
 * this as the freshness signal — when it is older than the TTL (or null),
 * the route re-runs EOSDA Search and upserts.
 */
export async function listScenesForApi(
  fieldId: string,
  options: ListScenesOptions = {},
): Promise<{ scenes: SceneApiRow[]; newestLastSeenAt: Date | null }> {
  const { db = sharedDb, dateRange } = options;

  const conditions = [eq(cachedScenes.fieldId, fieldId), isCompleteSceneRow()];
  if (dateRange?.from) conditions.push(gte(cachedScenes.sceneDate, dateRange.from));
  if (dateRange?.to) conditions.push(lte(cachedScenes.sceneDate, dateRange.to));

  const rows = await db
    .select(sceneApiSelect)
    .from(cachedScenes)
    .where(and(...conditions))
    .orderBy(desc(cachedScenes.sceneDate), desc(cachedScenes.viewId));

  let newestLastSeenAt: Date | null = null;
  const scenes: SceneApiRow[] = rows.map(({ lastSeenAt, ...rest }) => {
    // `lastSeenAt` defaults to `now()` and the column is NOT NULL at the
    // schema level, so the !== null guard is defensive (a future schema
    // change that relaxes the constraint shouldn't crash the route).
    if (lastSeenAt !== null && (newestLastSeenAt === null || lastSeenAt > newestLastSeenAt)) {
      newestLastSeenAt = lastSeenAt;
    }
    return rest;
  });

  return { scenes, newestLastSeenAt };
}
