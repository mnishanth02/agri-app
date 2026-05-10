/**
 * Module 4.3 — EOSDA Search wrapper.
 *
 * `searchScenes({ geometry, from, to, limit?, page? })` queries EOSDA's
 * single-dataset Sentinel-2 Search endpoint and normalises the loosely-typed
 * response into the app's `SceneDto` shape.
 *
 * Contract — per `docs/implementation.md` Module 4.3 and
 * `docs/review-findings.md` §3.5.4:
 *
 *   1. **Endpoint.** `POST /api/lms/search/v2/sentinel2`. The
 *      multi-dataset endpoint exists but v2 of viz-crop only consumes
 *      Sentinel-2; if we ever need Landsat/Modis we can add a sibling
 *      function.
 *   2. **Request body.** Includes `intersection_validation: true` (so EOSDA
 *      rejects malformed polygons up front), the explicit `fields` list we
 *      consume, `limit`/`page`, `search.shape` (the field polygon),
 *      `search.shapeRelation: 'CONTAINS'` (we want scenes that fully cover
 *      the AOI), `search.cloudCoverage: { from: 0, to: 80 }`, the date
 *      range, and `sort: { date: 'desc' }` (newest first — Module 4.5's
 *      "latest scene" warm-up assumes this).
 *   3. **Response normalisation.** EOSDA mixes camelCase, snake_case, and
 *      capital-ID conventions across endpoints; we project the fields we
 *      need into a stable shape (see {@link SceneDto}). `tmsTemplate` is
 *      stored as metadata only — Render tiles MUST be built from `viewId`
 *      via our authenticated proxy (Module 6.3) so we never leak the API
 *      key in `<img>`/`fetch` URLs.
 *   4. **No side effects.** This wrapper only does the HTTP call. Caching
 *      into `cached_scenes` is Module 4.4's job (`upsertScenes`); the
 *      orchestration layer is Module 4.5 (`warmField`).
 *   5. **Errors propagate.** Unlike the Cropper wrapper (which swallows
 *      everything to `null`), Search returns an empty array only when EOSDA
 *      itself returns `{ results: [] }`. Network/transport failures and
 *      EOSDA non-2xx responses bubble up as the original error from
 *      `eosdaRequest` (a `TypeError` or an `EosdaError`); the orchestrator
 *      handles those via `Promise.allSettled`. This keeps "no coverage"
 *      distinguishable from "EOSDA is down" at the call site.
 */
import type { PolygonGeoJson } from '@viz-crop/shared';
import { type EosdaLogger, eosdaRequest } from './eosda-client.js';

/**
 * Stable, app-side projection of an EOSDA Sentinel-2 search result. The
 * field names intentionally diverge from EOSDA's wire format so callers
 * never have to remember which API uses `sceneID` vs `scene_id` vs
 * `sceneId`. The Drizzle `cached_scenes` table (Phase 1.2) and the
 * `SceneDto` zod schema in `@viz-crop/shared` (Phase 6) both consume this
 * shape directly.
 */
export interface SceneDto {
  /** EOSDA scene identifier — the human-readable tile id (e.g. `S2B_tile_…`). */
  sceneId: string;
  /** EOSDA `view_id` — the slash-delimited path used to build Render tile URLs. */
  viewId: string;
  /** Acquisition date in `YYYY-MM-DD` (EOSDA's native format; not parsed). */
  sceneDate: string;
  /** Cloud-cover percentage 0–100. */
  cloudPercent: number;
  /** Data-coverage percentage 0–100 (how much of the tile contains data). */
  dataCoveragePercent: number;
  /**
   * Raw EOSDA TMS template — usually a `render.eosda.com` URL with
   * `{band}/{z}/{x}/{y}` placeholders. **Do not** hand this to MapLibre
   * directly: app tiles must go through our Render proxy (Module 6.3). We
   * only retain it for diagnostics and possible future use.
   */
  tmsTemplate: string;
}

/**
 * EOSDA Sentinel-2 search result schema (for documentation only).
 *
 * EOSDA's `fields` projection is tolerant — typos or upstream renames
 * silently drop fields from the response. We therefore validate every
 * row at runtime in `mapResult` (cheap typeof / `Number.isFinite`
 * checks). zod is intentionally NOT used here: Search responses can be
 * large for the analysis timeline, and per-row schema parsing overhead
 * outweighs the structural-clarity benefit when we only consume six
 * primitive fields.
 *
 * Reference shape (per `docs/review-findings.md` §3.5.4):
 *   sceneID: string                  — capital ID
 *   view_id: string                  — snake_case
 *   date: string  (`YYYY-MM-DD`)
 *   cloudCoverage: number            — 0–100
 *   dataCoveragePercentage: number   — 0–100
 *   tms: string                      — render.eosda.com URL template
 */

interface RawSearchResponse {
  meta?: { found?: number; page?: number; limit?: number };
  results?: unknown;
}

export interface SearchScenesOptions {
  /** Field polygon — passed verbatim into EOSDA's `search.shape`. */
  geometry: PolygonGeoJson;
  /** Inclusive lower bound, `YYYY-MM-DD`. */
  from: string;
  /** Inclusive upper bound, `YYYY-MM-DD`. */
  to: string;
  /**
   * Page size. Defaults to `10`. Module 4.5's create-time warm-up passes
   * `1` (latest scene only); the analysis timeline (Phase 7) will request
   * a wider page.
   */
  limit?: number;
  /** 1-indexed page. Defaults to `1`. */
  page?: number;
  /**
   * Optional structured logger forwarded into `eosdaRequest`. When
   * provided, every request logs `{ path, status }` (no key, no full URL).
   */
  log?: EosdaLogger;
}

/**
 * Lowest cloudCoverage filter we ever ask EOSDA for. Centralised so the
 * future "cloud cover preference" UI (Phase 8) can override it without
 * fiddling with hand-written request bodies.
 */
const CLOUD_COVERAGE_MIN = 0;
/**
 * Highest cloudCoverage we accept. 80 follows the spec in
 * `docs/implementation.md` §4.3 and matches the EOSDA examples; tuning
 * this is a Phase 8 decision.
 */
const CLOUD_COVERAGE_MAX = 80;

const DEFAULT_LIMIT = 10;
const DEFAULT_PAGE = 1;

const SEARCH_FIELDS = [
  'date',
  'sceneID',
  'view_id',
  'cloudCoverage',
  'dataCoveragePercentage',
  'tms',
] as const;

function mapResult(raw: unknown, index: number): SceneDto {
  // Per-element validation. The outer `Array.isArray` check above proves
  // the container is an array, but EOSDA's `fields` projection is a
  // tolerant filter — any field name we typo or that EOSDA renames in a
  // future API revision becomes silently absent, and a blind cast would
  // happily produce a `SceneDto` whose runtime values violate the
  // declared types. Module 4.4's `upsertScenes` would then write garbage
  // into `cached_scenes`. Cheap typeof / Number.isFinite checks catch
  // this at the boundary; the per-row cost is negligible compared to the
  // network round trip.
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`eosda search: results[${index}] is not an object`);
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.sceneID !== 'string' || r.sceneID.length === 0) {
    throw new Error(`eosda search: results[${index}].sceneID missing or non-string`);
  }
  if (typeof r.view_id !== 'string' || r.view_id.length === 0) {
    throw new Error(`eosda search: results[${index}].view_id missing or non-string`);
  }
  if (typeof r.date !== 'string' || r.date.length === 0) {
    throw new Error(`eosda search: results[${index}].date missing or non-string`);
  }
  if (typeof r.cloudCoverage !== 'number' || !Number.isFinite(r.cloudCoverage)) {
    throw new Error(`eosda search: results[${index}].cloudCoverage missing or non-finite`);
  }
  if (typeof r.dataCoveragePercentage !== 'number' || !Number.isFinite(r.dataCoveragePercentage)) {
    throw new Error(`eosda search: results[${index}].dataCoveragePercentage missing or non-finite`);
  }
  if (typeof r.tms !== 'string' || r.tms.length === 0) {
    throw new Error(`eosda search: results[${index}].tms missing or non-string`);
  }
  return {
    sceneId: r.sceneID,
    viewId: r.view_id,
    sceneDate: r.date,
    cloudPercent: r.cloudCoverage,
    dataCoveragePercent: r.dataCoveragePercentage,
    tmsTemplate: r.tms,
  };
}

/**
 * Search Sentinel-2 scenes intersecting `geometry` between `from` and `to`.
 *
 * Returns scenes ordered newest-first. May return an empty array when
 * EOSDA has no coverage for the polygon in the window — callers (Module
 * 4.5) should treat that as a non-error and consider widening the date
 * range.
 *
 * Throws on transport/HTTP errors so `Promise.allSettled` in Module 4.5
 * can distinguish "no scenes" from "EOSDA failed".
 */
export async function searchScenes(opts: SearchScenesOptions): Promise<SceneDto[]> {
  const { geometry, from, to, limit = DEFAULT_LIMIT, page = DEFAULT_PAGE, log } = opts;

  const response = await eosdaRequest<RawSearchResponse>('/api/lms/search/v2/sentinel2', {
    method: 'POST',
    body: JSON.stringify({
      intersection_validation: true,
      fields: SEARCH_FIELDS,
      limit,
      page,
      search: {
        date: { from, to },
        cloudCoverage: { from: CLOUD_COVERAGE_MIN, to: CLOUD_COVERAGE_MAX },
        shape: geometry,
        shapeRelation: 'CONTAINS',
      },
      sort: { date: 'desc' },
    }),
    ...(log ? { log } : {}),
  });

  // Treat an absent or `null` `results` field as a confirmed empty
  // response. Earlier revisions of this wrapper threw on those shapes to
  // distinguish "EOSDA confirmed no scenes" from "EOSDA returned a
  // malformed payload". The Phase 4 reviews flagged that as a real
  // false-positive risk: when EOSDA has no Sentinel-2 coverage for a
  // polygon, observed responses can come back as `{ meta: { found: 0 } }`
  // (no `results` key) or `{ meta: ..., results: null }`. With the old
  // throw, Module 4.5's orchestrator would log every such no-coverage
  // case as "warm-up: search failed" *and* skip its 180/365-day fallback
  // widening (per `field-warmup.ts` JSDoc lines 33-36, fallback widening
  // only happens on an empty array, not a thrown error).
  //
  // The new contract: missing or `null` `results` ⇒ empty array (which
  // makes the fallback walk continue). Any OTHER non-array shape (e.g.
  // an object, number, string) is still a contract violation and throws,
  // because silently coercing those to `[]` would let warm-up cache an
  // incorrect no-coverage state from a genuinely garbled upstream
  // response. A Search throw means EOSDA itself is broken; the Module
  // 4.5 orchestrator catches that at `Promise.allSettled` and logs once.
  const rawResults = response.results ?? [];
  if (!Array.isArray(rawResults)) {
    throw new Error('eosda search: response.results was present but not an array');
  }
  return rawResults.map(mapResult);
}
