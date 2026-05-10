/**
 * Module 4.5 — `field-warmup` orchestrator.
 *
 * `warmField(fieldId)` is the one place where the per-field background
 * warm-up flow lives. It runs after a field is created (Module 4.6 wires
 * it into `POST /api/fields` as a fire-and-forget `void warmField(id)`)
 * and is responsible for:
 *
 *   1. Loading the field row (id, geometry, existing `eosdaCropperRef`).
 *   2. Issuing the EOSDA Cropper POST (Module 4.2) and the latest-scene
 *      Search call (Module 4.3) **in parallel**.
 *   3. Persisting the latest scene into `cached_scenes` (Module 4.4) when
 *      Search succeeds.
 *
 * Cropper/Search orchestration:
 *   - Cropper is kicked off fire-and-forget with its own `.catch(...)`.
 *     Search is awaited independently so a slow/hung Cropper POST never
 *     delays scene caching once Search returns.
 *   - `searchScenes` throws on transport / non-2xx EOSDA responses (per
 *     `services/eosda-search.ts` JSDoc lines 31-37 and the explicit
 *     `throw` at line 222). The Search branch catches that directly and
 *     logs `{ fieldId, err }` cleanly.
 *
 * Window-fallback strategy for Search:
 *   - Sentinel-2 cadence over India is ~5 days, but cloud filters at
 *     the EOSDA boundary (`cloudCoverage <= 80`) plus seasonal monsoons
 *     can starve a 90-day window of usable scenes. Rather than over-fetch
 *     a year up front (slower, larger response, more EOSDA quota), we
 *     widen the window *only on demonstrated emptiness*: if the 90-day
 *     window returned `[]`, retry with 180 days; if that's also empty,
 *     retry with 365 days. We stop at the first non-empty result.
 *   - We do **NOT** widen the window on a thrown error — a transport
 *     failure means EOSDA is unreachable, not that the polygon has no
 *     coverage. Falling back through 180/365 in that case would just
 *     hammer a failing endpoint twice more.
 *
 * Error-classification contract (per `docs/implementation.md` §4.5):
 *   - Field-not-found: log `warn` `{ fieldId }` and return cleanly.
 *   - Cropper failure: `getOrCreateCropperRef` swallows everything to
 *     `null` internally (see `services/eosda-cropper.ts` lines 27-32)
 *     and never throws under current behaviour. We still attach a
 *     defensive `.catch(...)` — if a future change leaks an exception out
 *     of Cropper, we want a structured log rather than an
 *     `unhandledRejection` in the warm-up.
 *   - Search failure (thrown): log `error` `{ fieldId, err }` and return
 *     cleanly. We do NOT re-throw and we do NOT try fallback windows.
 *   - Search empty across all windows: log `info` `{ fieldId }` ("no
 *     coverage") and return cleanly. Cropper persistence (if it
 *     succeeded) has already happened inside `getOrCreateCropperRef`,
 *     so there is nothing further to do for that branch.
 *   - `loadField` and `upsertScenes` failures (DB went away, schema
 *     drift, etc.) are truly unexpected. We let them reject so Module
 *     4.6's single outer `.catch(...)` (in the route handler) logs them
 *     once with `{ fieldId, err }` — avoiding double-handling where the
 *     outer catch never fires. The one exception is SQLSTATE `23503`
 *     (foreign_key_violation) on `upsertScenes`: that means the user
 *     deleted the field while warm-up was still in flight (the
 *     CASCADE removed the parent row), which is a benign lifecycle
 *     event, not a failure. We log it at `info` and return cleanly so
 *     it never reaches the route-level `.catch(...)` and never
 *     contributes to error-rate monitors.
 *
 * Logging hygiene:
 *   - Every log payload uses `{ fieldId, err }` or `{ fieldId, status,
 *     body }`. The full URL, `EOSDA_BASE`, and `EOSDA_API_KEY` are
 *     never logged (the underlying `eosdaRequest` enforces this for its
 *     own log lines; this orchestrator mirrors the contract).
 */
import type { PolygonGeoJson } from '@viz-crop/shared';
import { eq } from 'drizzle-orm';
import { DatabaseError } from 'pg';
import { type Db, db as sharedDb } from '../db/client.js';
import { geometryToGeoJson } from '../db/geometry.js';
import { fields } from '../db/schema.js';
import type { EosdaLogger } from './eosda-client.js';
import { getOrCreateCropperRef } from './eosda-cropper.js';
import { type SceneDto, searchScenes } from './eosda-search.js';
import { upsertScenes } from './scene-cache.js';

/** Default initial Search window in days. Spec §4.5 says "e.g. 90 days". */
export const DEFAULT_INITIAL_WINDOW_DAYS = 90;

/**
 * Default fallback windows tried in order when a previous window
 * returned `[]`. Spec §4.5 calls out "180/365 days". The sequence is
 * `[180, 365]` (the initial 90-day window is configured separately so
 * each value can be overridden independently).
 */
export const DEFAULT_FALLBACK_WINDOWS_DAYS: readonly number[] = [180, 365] as const;

/** Console-backed default logger; matches the shape used in `eosda-cropper.ts`. */
const consoleLog: EosdaLogger = {
  info: (obj, msg) => console.info(msg ?? '', obj),
  warn: (obj, msg) => console.warn(msg ?? '', obj),
  error: (obj, msg) => console.error(msg ?? '', obj),
};

export interface WarmFieldOptions {
  /**
   * Drizzle handle. Defaults to the process-wide `sharedDb`. Inside
   * Fastify route handlers, prefer `request.server.db` so the call
   * participates in the app's pool lifecycle (relevant in tests that
   * spin up multiple Fastify instances). The same handle is forwarded
   * to `getOrCreateCropperRef` and `upsertScenes`.
   */
  db?: Db;
  /**
   * Structured logger. Defaults to a `console`-backed adapter.
   * Production callers should pass `request.log` (pino) so warm-up
   * lines land alongside the request that triggered them. The same
   * logger is forwarded into Cropper, Search, and the underlying
   * `eosdaRequest`.
   */
  log?: EosdaLogger;
  /**
   * Initial Search window length in days. The orchestrator tries this
   * window first; if Search returns `[]`, it then walks
   * `fallbackWindowsDays` until either a non-empty result arrives or
   * all windows are exhausted. Defaults to {@link DEFAULT_INITIAL_WINDOW_DAYS}.
   */
  initialWindowDays?: number;
  /**
   * Ordered list of fallback Search window lengths in days. Tried in
   * order after `initialWindowDays` returns `[]`. Defaults to
   * {@link DEFAULT_FALLBACK_WINDOWS_DAYS} (`[180, 365]`).
   */
  fallbackWindowsDays?: readonly number[];
  /**
   * Clock injection for tests. Defaults to `() => new Date()`. Date
   * window arithmetic uses UTC `YYYY-MM-DD` so DST/local-tz never
   * shifts a window by a day.
   */
  now?: () => Date;
}

/**
 * Local projection for `loadField`. We deliberately do NOT include
 * `userId`, `name`, etc.: warm-up only needs the geometry and the
 * existing cropper ref. Keeping the projection narrow makes it obvious
 * at the boundary which columns warm-up can rely on.
 *
 * `geometryToGeoJson` already wraps the column in `ST_AsGeoJSON(...)::json`,
 * which `node-postgres` decodes into a parsed JS object — `geometry`
 * arrives as a `PolygonGeoJson` literal, NOT a JSON string. Drizzle
 * infers the column type as `unknown` from the raw SQL fragment, so we
 * cast at the boundary; the database's `fields_geometry_valid` /
 * `fields_geometry_srid` CHECK constraints already guarantee the shape.
 */
const warmFieldSelect = {
  id: fields.id,
  geometry: geometryToGeoJson(fields.geometry),
  eosdaCropperRef: fields.eosdaCropperRef,
};

interface WarmFieldRow {
  id: string;
  geometry: PolygonGeoJson;
  eosdaCropperRef: string | null;
}

/**
 * Convert a `Date` to a UTC `YYYY-MM-DD` string. EOSDA Search consumes
 * dates in this format (per Module 4.3) and PostgreSQL's `date` column
 * is timezone-agnostic, so we normalise on the UTC slice. Using
 * `toISOString().slice(0, 10)` rather than per-locale formatting means
 * a developer running tests in IST and a CI runner in UTC produce the
 * same window for the same `now()` instant.
 */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Compute `{ from, to }` for a Search window of `days` ending at
 * `now`. Both bounds are inclusive UTC `YYYY-MM-DD`.
 *
 * `to` is `toIsoDate(now)` (today, UTC); `from` is `to - days` in
 * milliseconds. Subtracting via `Date.getTime() - days * 86400_000`
 * is safe across DST boundaries because both sides are absolute UTC
 * instants (no local-tz fold). For `days = 90`, this produces a 91-day
 * inclusive range (today plus the previous 90 days), which matches the
 * spirit of "recent 90-day window" in the spec.
 */
export function dateRangeForWindow(now: Date, days: number): { from: string; to: string } {
  const to = toIsoDate(now);
  const fromMs = now.getTime() - days * 86_400_000;
  const from = toIsoDate(new Date(fromMs));
  return { from, to };
}

/**
 * Walk `windowsDays` (initial + fallbacks) issuing a `searchScenes`
 * call for each, returning the first scene from the first non-empty
 * window. Returns `null` if every window returned `[]`.
 *
 * Throws (does NOT widen) on transport / EOSDA errors. The caller
 * (`warmField`) catches the throw and logs it as a Search failure.
 */
async function searchLatestSceneWithFallback(
  geometry: PolygonGeoJson,
  windowsDays: readonly number[],
  now: Date,
  log: EosdaLogger,
): Promise<SceneDto | null> {
  for (const days of windowsDays) {
    const { from, to } = dateRangeForWindow(now, days);
    const scenes = await searchScenes({ geometry, from, to, limit: 1, log });
    if (scenes.length > 0) {
      const scene = scenes[0];
      // searchScenes already validates per-row shape; if scenes is
      // non-empty, scenes[0] is defined. The `if` is a TS-narrowing
      // guard, not a runtime concern.
      if (scene) return scene;
    }
  }
  return null;
}

/**
 * Run the post-create warm-up flow for `fieldId`.
 *
 * - Loads the field; logs warn + returns if it doesn't exist.
 * - Starts Cropper in the background, then awaits latest-scene Search
 *   (with fallback windows) independently.
 * - On Search success, upserts `latestScene` into `cached_scenes`
 *   (or no-ops on `null`, since `upsertScenes([])` is itself a no-op).
 * - Logs `{ fieldId, err }` for any inspected failure and returns
 *   cleanly. Lets `loadField` / `upsertScenes` failures reject so the
 *   Module 4.6 outer `.catch(...)` records them.
 */
/**
 * Walk the cause chain looking for a `pg.DatabaseError` with SQLSTATE
 * `23503` (foreign_key_violation). Drizzle 0.45 wraps every query
 * failure in `DrizzleQueryError`, exposing the underlying pg error at
 * `.cause` — so a naive `err instanceof DatabaseError` check would
 * miss every real production case. We bound the walk at 8 hops to
 * avoid pathological cyclic causes.
 */
function isForeignKeyViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let i = 0; i < 8 && current != null; i += 1) {
    if (current instanceof DatabaseError && current.code === '23503') {
      return true;
    }
    current = (current as { cause?: unknown } | null)?.cause;
  }
  return false;
}

export async function warmField(fieldId: string, options: WarmFieldOptions = {}): Promise<void> {
  const {
    db = sharedDb,
    log = consoleLog,
    initialWindowDays = DEFAULT_INITIAL_WINDOW_DAYS,
    fallbackWindowsDays = DEFAULT_FALLBACK_WINDOWS_DAYS,
    now = () => new Date(),
  } = options;

  // loadField — let DB failures propagate so Module 4.6's outer catch logs them.
  const rows = await db.select(warmFieldSelect).from(fields).where(eq(fields.id, fieldId)).limit(1);

  const rawRow = rows[0];
  if (!rawRow) {
    log.warn({ fieldId }, 'warm-up: field not found');
    return;
  }
  const field: WarmFieldRow = {
    id: rawRow.id,
    geometry: rawRow.geometry as PolygonGeoJson,
    eosdaCropperRef: rawRow.eosdaCropperRef,
  };

  const windows = [initialWindowDays, ...fallbackWindowsDays] as const;
  // Snapshot `now` once so every fallback window is anchored to the
  // same instant; otherwise a slow EOSDA response could shift the
  // 180-day window by seconds vs the 90-day window.
  const nowAt = now();

  // Cropper today never throws (it swallows internally to `null`), but
  // a future change could leak an exception. Surface that defensively
  // rather than letting it become an `unhandledRejection`. Do not await
  // it here: scene caching should proceed as soon as Search finishes,
  // even if the Cropper POST is slow or never settles.
  void getOrCreateCropperRef(field, { db, log }).catch((err) => {
    log.error({ fieldId, err }, 'warm-up: cropper rejected unexpectedly');
  });

  let latestScene: SceneDto | null;
  try {
    latestScene = await searchLatestSceneWithFallback(field.geometry, windows, nowAt, log);
  } catch (err) {
    log.error({ fieldId, err }, 'warm-up: search failed');
    return;
  }

  if (latestScene === null) {
    log.info({ fieldId }, 'warm-up: no scenes found in any fallback window');
    // Empty `scenes` is a no-op inside `upsertScenes`, but skipping the
    // call entirely makes the intent explicit and avoids a needless
    // import-level dependency in the "no coverage" path.
    return;
  }

  // Delete-after-create race: if the user deleted the field while
  // warm-up was in flight, the `cached_scenes.field_id` FK ON DELETE
  // CASCADE has already removed the parent row, and a fresh INSERT
  // raises SQLSTATE `23503` (foreign_key_violation). That is an
  // expected lifecycle event for a user action, NOT an EOSDA / DB
  // failure — surfacing it as the route's `warm failed` error log
  // would generate false-positive alerts. Translate into an info log
  // so operators can still see the race in trace mode without it
  // tripping production error monitors. Anything else from upsert
  // (DB went away, schema drift, etc.) still rejects so Module 4.6's
  // outer `.catch(...)` records it.
  //
  // Drizzle 0.45 wraps every query failure in `DrizzleQueryError`
  // with the underlying `pg.DatabaseError` exposed via `.cause`, so
  // we check both the immediate error AND its cause chain.
  try {
    await upsertScenes(field.id, [latestScene], { db });
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      log.info(
        { fieldId },
        'warm-up: field deleted before scene cache wrote; skipping (benign race)',
      );
      return;
    }
    throw err;
  }
}
