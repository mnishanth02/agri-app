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
