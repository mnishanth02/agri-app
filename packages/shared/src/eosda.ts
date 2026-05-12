import { z } from 'zod';

/**
 * Stub schemas for EOSDA-derived data. These mirror the shapes of the
 * `cached_scenes` and `cached_ndvi_stats` tables (see `apps/api/src/db/schema.ts`)
 * so we can start typing route handlers and React Query payloads.
 *
 * They will be tightened in later phases:
 *  - Module 4.x adds the EOSDA Search/warm-up integration and may add fields
 *    such as `tmsTemplate` per-band variants.
 *  - Module 7.x adds the Statistics flow and will likely add percentiles and
 *    histogram bins to `ndviStatsDto`.
 *
 * For now keep them minimal but honest about nullability so callers can
 * compile against `@viz-crop/shared` from Phase 1 onward without churn.
 */

const isoDate = z.iso.date();
/** Accept Drizzle/`pg` `Date` rows OR ISO strings — see `field.ts` for the
 *  rationale. Same preprocess so the EOSDA DTOs stay symmetric with `fieldDto`. */
const isoDateTime = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.iso.datetime({ offset: true }),
);

/** A single Sentinel-2 scene cached for one field (one row of `cached_scenes`). */
export const sceneDto = z.object({
  id: z.uuid(),
  fieldId: z.uuid(),
  viewId: z.string().min(1),
  source: z.string().min(1).default('sentinel-2'),
  sceneDate: isoDate,
  cloudPercent: z.coerce.number().nullable(),
  dataCoveragePercent: z.coerce.number().nullable(),
  tmsTemplate: z.string().nullable(),
  createdAt: isoDateTime,
});

export type SceneDto = z.infer<typeof sceneDto>;

/** Zonal statistics for one (field, view, index) tuple from EOSDA `mt_stats`. */
export const ndviStatsDto = z.object({
  id: z.uuid(),
  fieldId: z.uuid(),
  viewId: z.string().min(1),
  indexName: z.string().min(1).default('NDVI'),
  sceneDate: isoDate,
  cloudPercent: z.coerce.number().nullable(),
  dataCoveragePercent: z.coerce.number().nullable(),
  mean: z.coerce.number().nullable(),
  min: z.coerce.number().nullable(),
  max: z.coerce.number().nullable(),
  p10: z.coerce.number().nullable(),
  p90: z.coerce.number().nullable(),
  median: z.coerce.number().nullable(),
  createdAt: isoDateTime,
});

export type NdviStatsDto = z.infer<typeof ndviStatsDto>;

/**
 * Request body for `POST /api/eosda/scenes` (Module 6.1).
 *
 * `dateRange.from`/`to` are inclusive `YYYY-MM-DD` strings filtered against
 * `cached_scenes.scene_date`. Both bounds are optional — the route fills in
 * a default `[today − 90d, today]` window when omitted, matching the
 * Sentinel-2 cadence used by the analysis timeline.
 *
 * `forceRefresh: true` skips the freshness check entirely and forces an
 * EOSDA Search round-trip even if the cache is fully populated. Useful for
 * a "refresh" button or after the user changes their date filter and wants
 * to be sure they've seen every scene EOSDA knows about.
 *
 * Date strings (not datetimes) — `cached_scenes.scene_date` is a PostgreSQL
 * `date` column, and the rest of the EOSDA wrappers (`searchScenes`,
 * `dateRangeForWindow`) all consume `YYYY-MM-DD`. Keeping the wire format
 * symmetric avoids per-route timezone normalisation.
 */
export const eosdaScenesRequest = z.object({
  fieldId: z.uuid(),
  dateRange: z
    .object({
      from: isoDate.optional(),
      to: isoDate.optional(),
    })
    .optional(),
  forceRefresh: z.boolean().optional(),
});

export type EosdaScenesRequest = z.infer<typeof eosdaScenesRequest>;

/**
 * Response shape for `POST /api/eosda/scenes`. Scenes are ordered
 * newest-first by `sceneDate`, then by `viewId` for a deterministic tie
 * break (mirrors the order produced by `listScenesForApi`).
 */
export const eosdaScenesResponse = z.object({
  scenes: z.array(sceneDto),
});

export type EosdaScenesResponse = z.infer<typeof eosdaScenesResponse>;

/**
 * Vegetation index identifier accepted by the Statistics API. Mirrors the
 * `bm_type` enumeration from EOSDA `mt_stats` (see
 * `docs/review-findings.md` §3.7). Up to 3 may be requested per task.
 */
export const vegetationIndex = z.enum(['NDVI', 'EVI', 'NDWI']);
export type VegetationIndex = z.infer<typeof vegetationIndex>;

/**
 * Hard cap on the number of vegetation indexes per Statistics request,
 * mirroring EOSDA's documented `bm_type` limit of 3. Centralised here so
 * both client (when assembling the request) and server (when validating
 * the body) reference the same constant.
 */
export const MAX_INDEXES_PER_STATS_REQUEST = 3;

/**
 * Request body for `POST /api/eosda/stats` (Module 7.1).
 *
 * `indexes` defaults to `['NDVI']` when omitted. `dateRange.from`/`to`
 * mirror the scenes route's contract (last-90-days when omitted, anchored
 * on the resolved `to`). Both date bounds are inclusive `YYYY-MM-DD`
 * filtered against `cached_ndvi_stats.scene_date`.
 */
export const eosdaStatsRequest = z.object({
  fieldId: z.uuid(),
  indexes: z.array(vegetationIndex).min(1).max(MAX_INDEXES_PER_STATS_REQUEST).optional(),
  dateRange: z
    .object({
      from: isoDate.optional(),
      to: isoDate.optional(),
    })
    .optional(),
});

export type EosdaStatsRequest = z.infer<typeof eosdaStatsRequest>;

/**
 * Discriminator returned in `eosdaStatsResponse.error` when the requested
 * date range has no cached scenes for the field. The route returns this
 * with HTTP 200 (empty is a legitimate steady state) so the frontend can
 * render an empty-state message without burning EOSDA `mt_stats` quota.
 */
export const NO_SCENES_FOR_RANGE = 'NO_SCENES_FOR_RANGE' as const;

/**
 * Response shape for `POST /api/eosda/stats`. Stats are ordered
 * newest-first by `sceneDate`, then by `viewId` and `indexName` for a
 * deterministic tie-break (mirrors `listNdviStats`).
 *
 * `error: 'NO_SCENES_FOR_RANGE'` is set when the route short-circuits on
 * an empty scene cache for the requested range. `stats` is `[]` in that
 * case. Other 5xx/4xx error shapes (`STATS_TIMEOUT` etc.) are surfaced as
 * non-200 responses, NOT as `error` fields here.
 */
export const eosdaStatsResponse = z.object({
  stats: z.array(ndviStatsDto),
  error: z.literal(NO_SCENES_FOR_RANGE).optional(),
});

export type EosdaStatsResponse = z.infer<typeof eosdaStatsResponse>;
