/**
 * Module 6.3 — `GET /api/eosda/render/:z/:x/:y`.
 *
 * Authenticated proxy that turns a MapLibre `{z}/{x}/{y}` raster tile
 * request into the corresponding EOSDA Render API call:
 *
 *   `GET https://api-connect.eos.com/api/render/<view_id>/<band>/<z>/<x>/<y>`
 *
 * Why a proxy at all (vs. signing tile URLs in the browser):
 *   - The browser must NEVER see `EOSDA_API_KEY`. Header auth on the
 *     server keeps the secret out of every URL, log, error message, and
 *     `referer` header. See `docs/review-findings.md` §3.5.2.
 *   - We can enforce ownership and gate quota: the route refuses any
 *     `(fieldId, viewId)` pair the user does not own AND that is not in
 *     `cached_scenes`. Together these prevent enumeration attacks
 *     against EOSDA's per-key tile quota.
 *
 * Reused security boundary:
 *   - `eosdaFetch` (Module 4.1 sibling of `eosdaRequest`) carries the
 *     header injection, `assertSafePath` guards, and sanitised logging.
 *     We never reimplement those here.
 */
import { getAuth } from '@clerk/fastify';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type ZodError, z } from 'zod';
import { cachedScenes, fields } from '../db/schema.js';
import { requireUser } from '../plugins/auth.js';
import { eosdaFetch } from '../services/eosda-client.js';

/**
 * Per-band rendering defaults. Set unconditionally on every upstream
 * call: cheap if EOSDA's default already matches, required when it
 * silently falls back to grayscale (see `docs/review-findings.md` §3.6).
 *
 * `RdYlGn` is the standard greenness ramp for vegetation indexes;
 * `Blues` reads more naturally for water (NDWI). All three indexes use
 * the symmetric `[-1, 1]` MIN_MAX so heatmap colour mapping is stable
 * across scenes — no per-scene auto-stretch surprises.
 */
const COLOR_DEFAULTS = {
  NDVI: { COLORMAP: 'RdYlGn', MIN_MAX: '-1,1' },
  EVI: { COLORMAP: 'RdYlGn', MIN_MAX: '-1,1' },
  NDWI: { COLORMAP: 'Blues', MIN_MAX: '-1,1' },
} as const satisfies Record<string, { COLORMAP: string; MIN_MAX: string }>;

type Band = keyof typeof COLOR_DEFAULTS;

/**
 * Defense-in-depth allowlist for the decoded `viewId`. EOSDA scene
 * identifiers are shaped like `S2/16/T/EL/2023/7/31/0` — strictly
 * `[A-Za-z0-9/_-]`. Anything outside that alphabet is either a bug in
 * the client, a typo, or an injection attempt; we reject all three.
 *
 * We also reject `..` segments and leading `/` separately so a future
 * widening of this regex (e.g. allowing `.` for some new EOSDA scene
 * shape) cannot accidentally re-enable path traversal.
 */
const VIEW_ID_ALLOWED = /^[A-Za-z0-9/_-]+$/;

/** Slippy-map XYZ tile coordinates. `z` is capped at 22 (≈ 2 cm/px at the
 * equator) — EOSDA's native Sentinel-2 resolution caps out far below this
 * but we still want a hard ceiling so a runaway client cannot enumerate
 * arbitrarily deep zoom levels into our quota. */
const paramsSchema = z.object({
  z: z.coerce.number().int().min(0).max(22),
  x: z.coerce.number().int().min(0),
  y: z.coerce.number().int().min(0),
});

const querySchema = z.object({
  fieldId: z.uuid(),
  // Cap viewId at 256 chars — real EOSDA viewIds are ≤ ~30 chars; the
  // ceiling exists purely so a malformed client cannot send a megabyte
  // query string into our quota check.
  viewId: z.string().min(1).max(256),
  band: z.enum(['NDVI', 'EVI', 'NDWI']),
});

/**
 * Translate a zod failure into a 400 with the standard sensible envelope.
 * Mirrors the helper in `routes/fields.ts`; duplicated rather than shared
 * to keep route files independent (no cross-file imports for plain helpers).
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

/** Authenticated userId — `requireUser` guarantees presence; the throw
 * is a defensive belt-and-braces against future preHandler reordering. */
function authedUserId(request: FastifyRequest): string {
  const { userId } = getAuth(request);
  if (!userId) {
    throw request.server.httpErrors.unauthorized('Authentication required');
  }
  return userId;
}

/**
 * Try to decode a percent-encoded `viewId` query value. The frontend
 * encodes the literal `/` characters in viewIds via `encodeURIComponent`
 * before placing them in the MapLibre tile URL template. Fastify's
 * default query parser will already decode percent sequences once, so
 * for typical inputs this is effectively a no-op — but keeping the
 * explicit decode here makes the contract symmetric with the frontend
 * and catches any deployment where a non-default query parser is wired
 * up. Wrapped in try/catch because malformed sequences (`%ZZ`, etc.)
 * raise `URIError`, which we map to 400 rather than 500.
 */
function safeDecode(viewId: string): string | null {
  try {
    return decodeURIComponent(viewId);
  } catch {
    return null;
  }
}

const eosdaRenderRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get('/eosda/render/:z/:x/:y', { preHandler: requireUser }, async (request, reply) => {
    const userId = authedUserId(request);

    const params = paramsSchema.safeParse(request.params);
    if (!params.success) rejectInvalidRequest(app, params.error, 'Invalid path parameters');

    const query = querySchema.safeParse(request.query);
    if (!query.success) rejectInvalidRequest(app, query.error, 'Invalid query parameters');

    const { z: zVal, x: xVal, y: yVal } = params.data;
    const { fieldId, viewId: rawViewId, band } = query.data;

    // XYZ tile bounds: at zoom z there are exactly 2^z tiles per axis.
    // Refusing out-of-range coords here prevents an attacker from sending
    // arbitrary high-x/high-y combinations that would otherwise burn our
    // EOSDA quota looking up tiles that cannot exist.
    const tilesPerAxis = 2 ** zVal;
    if (xVal >= tilesPerAxis || yVal >= tilesPerAxis) {
      throw app.httpErrors.badRequest('Invalid tile coordinates: x and y must be < 2^z');
    }

    const decodedViewId = safeDecode(rawViewId);
    if (decodedViewId === null) {
      throw app.httpErrors.badRequest('Invalid viewId: malformed percent-encoding');
    }
    if (
      decodedViewId.length === 0 ||
      decodedViewId.includes('..') ||
      decodedViewId.startsWith('/') ||
      !VIEW_ID_ALLOWED.test(decodedViewId)
    ) {
      throw app.httpErrors.badRequest('Invalid viewId: contains disallowed characters');
    }

    // Single round-trip: ownership (LEFT-anchored on `fields` so we can
    // distinguish "wrong owner" from "scene not cached" only INTERNALLY
    // — both surface as 404 to avoid leaking which condition failed).
    // `eosda_cropper_ref` lives on `fields` (not its own table), so a
    // single LEFT JOIN against `cached_scenes` gives us everything.
    const rows = await app.db
      .select({
        cropperRef: fields.eosdaCropperRef,
        sceneViewId: cachedScenes.viewId,
      })
      .from(fields)
      .leftJoin(
        cachedScenes,
        and(eq(cachedScenes.fieldId, fields.id), eq(cachedScenes.viewId, decodedViewId)),
      )
      .where(and(eq(fields.id, fieldId), eq(fields.userId, userId)))
      .limit(1);

    const row = rows[0];
    // Both branches collapse to 404 — see the JSDoc on the SELECT above.
    if (!row || row.sceneViewId === null) {
      throw app.httpErrors.notFound('Scene not available');
    }

    const upstreamQuery = new URLSearchParams({
      CALIBRATE: '1',
      mimetype: 'image/png',
      ...COLOR_DEFAULTS[band as Band],
    });
    if (row.cropperRef) {
      upstreamQuery.set('cropper_ref', row.cropperRef);
    }

    const upstreamPath = `/api/render/${decodedViewId}/${band}/${zVal}/${xVal}/${yVal}?${upstreamQuery.toString()}`;

    let upstream: Response;
    try {
      upstream = await eosdaFetch(upstreamPath, { method: 'GET', log: request.log });
    } catch (err) {
      // Network / transport failure (or assertSafePath rejection if a
      // bug in this route ever produces an unsafe path). Map to 502 so
      // MapLibre re-tries the tile rather than caching a hard error.
      // Logging for the fetch failure happens inside `eosdaFetch`; the
      // assertion-failure path is rare enough that an extra log here is
      // worth the duplication.
      request.log.error({ err, fieldId }, 'render upstream failed');
      throw app.httpErrors.badGateway('Upstream render request failed');
    }

    if (!upstream.ok) {
      // Mirror the upstream status but NEVER forward the upstream body.
      // EOSDA's error pages can echo the request URL — if a future
      // `useQueryAuth` flip is ever needed for Render, that body would
      // carry our API key. Empty body is the safest mirror.
      reply.code(upstream.status);
      return reply.send();
    }

    let png: Buffer;
    try {
      png = Buffer.from(await upstream.arrayBuffer());
    } catch (err) {
      // Mid-stream disconnect or any other failure draining the upstream
      // body. We've already validated `upstream.ok` so this is purely a
      // transport-side issue — surface as 502. NEVER forward the partial
      // bytes even if some are buffered: a half-decoded PNG could leak
      // EOSDA error markup if the upstream switched mid-stream from
      // image to text/html. We also use an explicit empty body (mirroring
      // the `!upstream.ok` branch above) rather than throwing
      // `badGateway`, because MapLibre treats the response as image bytes
      // — a JSON error envelope would be discarded anyway, and the
      // empty-body pattern keeps the wire shape consistent across all
      // 502 paths from this route.
      request.log.error({ err, fieldId }, 'render upstream body read failed');
      reply.code(502);
      return reply.send();
    }

    // Order matters: set Content-Type BEFORE .send() so Fastify's
    // default `application/json` serializer never observes the Buffer.
    // Cache-Control is `private` because the proxy is per-user and the
    // upstream tile is selected by ownership — public caches must not
    // share these.
    reply.header('Content-Type', 'image/png').header('Cache-Control', 'private, max-age=86400');
    return reply.send(png);
  });
};

export default eosdaRenderRoutes;
