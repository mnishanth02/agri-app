/**
 * Module 6.1 — `POST /api/eosda/scenes`.
 *
 * Returns the cached Sentinel-2 scene timeline for one of the caller's
 * fields. The route is the cache-first surface that powers the Phase 6
 * `DateTimeline`: it reads `cached_scenes` first and only re-issues an
 * EOSDA Search when the cache is empty/stale or the caller explicitly
 * asks for a refresh. Module 4.5's create-time warm-up has already
 * populated `cached_scenes` with the latest single scene; this route
 * expands that into a multi-scene timeline on demand.
 *
 * Auth + ownership:
 *   - `requireUser` rejects any anonymous caller with 401.
 *   - The single ownership query also returns the field's geometry — that
 *     way Search can run without a second SELECT and any "field not yours"
 *     case collapses cleanly to 404 (we deliberately do not distinguish
 *     "doesn't exist" from "owned by someone else"; same precedent as
 *     `fields.ts`).
 *
 * Freshness rule (per session plan, refined from `docs/implementation.md`
 * §6.1 Done-when):
 *   - `forceRefresh: true` always triggers a Search.
 *   - An empty cache for the requested range triggers a Search.
 *   - A cache whose newest `last_seen_at` is older than {@link FRESHNESS_TTL_MS}
 *     triggers a Search. This catches the post-warm-up case where the
 *     cache contains only the single scene Module 4.5 fetched, and
 *     bounds the staleness of every subsequent visit.
 *   - On a Search round-trip we re-read the cache so the response always
 *     mirrors what's persisted (vs. a fresh-from-EOSDA shape that would
 *     diverge from the wire `sceneDto`).
 *
 * The 24h TTL means subsequent visits to the same field within a day are
 * pure cache hits — cheap on EOSDA quota and fast for the user.
 */
import { getAuth } from '@clerk/fastify';
import { eosdaScenesRequest, type PolygonGeoJson } from '@viz-crop/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { type ZodError, z } from 'zod';
import { geometryToGeoJson } from '../db/geometry.js';
import { fields } from '../db/schema.js';
import { requireUser } from '../plugins/auth.js';
import { searchScenes } from '../services/eosda-search.js';
import { listScenesForApi, upsertScenes } from '../services/scene-cache.js';

/**
 * Maximum age (ms) of the newest cached scene before the route forces an
 * EOSDA Search refresh. 24h matches the Phase 6 plan's session refinement
 * (#1, #3): stale enough to catch new Sentinel-2 acquisitions on the next
 * day without paying EOSDA quota for every reload within the same day.
 */
const FRESHNESS_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Default Search window in days when the caller omits `dateRange`. Matches
 * the warm-up's initial window (`DEFAULT_INITIAL_WINDOW_DAYS = 90` in
 * `field-warmup.ts`) so a "cold" route call asks EOSDA for the same
 * timeline the Phase 4 warm-up would have asked for, just at higher
 * `limit` (timeline view vs. latest-only).
 */
const DEFAULT_WINDOW_DAYS = 90;

/**
 * Page size we ask EOSDA Search for when the route refreshes the cache.
 * Module 4.5 only caches `limit=1` (latest scene); 30 is enough to fill a
 * 90-day timeline on Sentinel-2's ~5-day cadence with comfortable
 * headroom for cloud filtering. Capping the page size avoids hot-loading
 * the entire archive when a future caller passes a multi-year range.
 */
const SEARCH_LIMIT = 30;

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

/** Convert a `Date` to a UTC `YYYY-MM-DD` string (mirrors `field-warmup.ts`). */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Resolve the request's `dateRange` (with possibly-omitted bounds) into a
 * concrete `{ from, to }` window in UTC `YYYY-MM-DD`. Defaults `to` to
 * today and `from` to `to − DEFAULT_WINDOW_DAYS`. Subtracting in
 * milliseconds keeps the math DST-agnostic.
 *
 * NOTE: `from` is anchored to the *resolved* `to` (not to `now`) so a
 * caller that passes only `to: '2024-01-01'` gets a 90-day window
 * ending on that date, NOT a 90-day window ending today (which would
 * almost certainly skip the date the caller asked about).
 */
function resolveDateRange(
  requested: { from?: string | undefined; to?: string | undefined } | undefined,
  now: Date,
): { from: string; to: string } {
  const to = requested?.to ?? toIsoDate(now);
  if (requested?.from) return { from: requested.from, to };
  // Anchor the default `from` window on the resolved `to` so explicit
  // historical `to` values produce a meaningful window around them.
  const toMs = Date.parse(`${to}T00:00:00Z`);
  const anchorMs = Number.isFinite(toMs) ? toMs : now.getTime();
  const fromMs = anchorMs - DEFAULT_WINDOW_DAYS * 86_400_000;
  return { from: toIsoDate(new Date(fromMs)), to };
}

const eosdaScenesRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /api/eosda/scenes — read-or-refresh scene timeline for a field.
   *
   * Body: `{ fieldId, dateRange?, forceRefresh? }` — see
   * `eosdaScenesRequest` for the wire schema. Returns the cache rows
   * (newest-first) projected into the shared `sceneDto` shape.
   */
  app.post('/eosda/scenes', { preHandler: requireUser }, async (request) => {
    const userId = authedUserId(request);

    const parsed = eosdaScenesRequest.safeParse(request.body);
    if (!parsed.success) rejectInvalidRequest(app, parsed.error, 'Invalid request body');
    const { fieldId, dateRange: requestedRange, forceRefresh } = parsed.data;

    const range = resolveDateRange(requestedRange, new Date());

    // Single ownership-and-geometry SELECT. We need the geometry to issue
    // Search on a refresh; folding it into the ownership check avoids a
    // second round-trip on the cold path. Like `fields.ts`, "not yours"
    // and "doesn't exist" both surface as 404 to prevent UUID enumeration.
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

    const initial = await listScenesForApi(fieldId, { db: app.db, dateRange: range });

    const cacheStale =
      initial.newestLastSeenAt !== null &&
      Date.now() - initial.newestLastSeenAt.getTime() > FRESHNESS_TTL_MS;
    const needRefresh = forceRefresh === true || initial.scenes.length === 0 || cacheStale;

    let scenesOut = initial.scenes;
    if (needRefresh) {
      // Search throws on transport / EOSDA non-2xx; the route catches that
      // and falls back to whatever the cache has (possibly empty) rather
      // than failing the whole request. The user still sees the timeline
      // they had a moment ago and the structured log captures the EOSDA
      // failure for ops to investigate.
      try {
        const fetched = await searchScenes({
          geometry: fieldRow.geometry as PolygonGeoJson,
          from: range.from,
          to: range.to,
          limit: SEARCH_LIMIT,
          log: request.log,
        });
        if (fetched.length > 0) {
          await upsertScenes(fieldId, fetched, { db: app.db });
        }
      } catch (err) {
        request.log.error({ err, fieldId }, 'eosda/scenes: search refresh failed');
      }

      // Re-read so the response shape matches what's persisted (the wire
      // `sceneDto` carries `id`/`createdAt` that EOSDA's Search response
      // does not). Even if Search threw, this returns whatever stale cache
      // we already had — the user sees the previous timeline rather than
      // an empty one.
      const refreshed = await listScenesForApi(fieldId, { db: app.db, dateRange: range });
      scenesOut = refreshed.scenes;
    }

    // Note: `SceneApiRow` carries `cloudPercent` / `dataCoveragePercent`
    // as PostgreSQL `numeric` strings (per node-postgres) and `createdAt`
    // as a JS `Date`. The shared `eosdaScenesResponse` zod runs
    // `z.coerce.number()` and the `isoDateTime` Date→string preprocess on
    // the client side, so these wire-shape fields parse cleanly into the
    // strict `SceneDto`. The route does not pre-`.parse(...)` because the
    // response zod is the *client* boundary contract — re-parsing here
    // would just duplicate work and surface error messages on the wrong
    // side of the network.
    return { scenes: scenesOut };
  });
};

export default eosdaScenesRoutes;
