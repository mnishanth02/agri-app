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
