import { z } from 'zod';

import { polygonGeoJsonSchema } from './common.js';

/**
 * The 10 crops that the dashboard's "Crop Type" dropdown supports — taken
 * verbatim from `docs/plan.md` §3 (Field Details Form). Order is significant:
 * it is also the dropdown's display order.
 */
export const cropTypeEnum = z.enum([
  'Rice',
  'Wheat',
  'Cotton',
  'Sugarcane',
  'Maize',
  'Soybean',
  'Pulses',
  'Groundnut',
  'Mustard',
  'Jowar',
]);

export type CropType = z.infer<typeof cropTypeEnum>;

/**
 * The four agricultural seasons used in Indian planning. `Annual` covers
 * perennial crops like Sugarcane that don't fit a single Kharif/Rabi/Zaid
 * window.
 */
export const seasonEnum = z.enum(['Kharif', 'Rabi', 'Zaid', 'Annual']);

export type Season = z.infer<typeof seasonEnum>;

/** Reusable bounded text field for the optional metadata columns. */
const metadataString = z.string().trim().min(1).max(120);

/** ISO-8601 date (YYYY-MM-DD) for `sowing_date`. We deliberately don't accept
 *  full datetimes so the contract matches the underlying `date` column. Drizzle's
 *  `date()` returns YYYY-MM-DD strings by default, so no preprocess is needed. */
const isoDate = z.iso.date();

/**
 * ISO-8601 datetime with offset.
 *
 * Drizzle's `timestamp({ withTimezone: true })` columns come back from
 * `node-postgres` as JavaScript `Date` objects, but the public API contract
 * is an ISO string (that's what `JSON.stringify(field)` would produce on the
 * way out). The preprocess accepts either a `Date` or an ISO string so the
 * same schema validates raw rows AND already-serialized JSON without route
 * handlers having to manually `.toISOString()` every timestamp before
 * `fieldDto.parse(row)`.
 */
const isoDateTime = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.iso.datetime({ offset: true }),
);

/**
 * `POST /api/fields` request body.
 *
 * Geometry is *required* on create — it cannot be added later because the
 * `area_hectares` generated column and `eosda_cropper_ref` warm-up depend on
 * it. The optional metadata fields mirror the nullable columns on the
 * `fields` table (see `apps/api/src/db/schema.ts`).
 */
export const createFieldDto = z.strictObject({
  name: z.string().trim().min(1).max(120),
  cropType: cropTypeEnum,
  season: seasonEnum,
  farmerName: metadataString.optional(),
  village: metadataString.optional(),
  district: metadataString.optional(),
  state: metadataString.optional(),
  sowingDate: isoDate.optional(),
  geometry: polygonGeoJsonSchema,
});

export type CreateFieldDto = z.infer<typeof createFieldDto>;

/**
 * `PATCH /api/fields/:id` request body.
 *
 * Geometry is **immutable for v2** — once a field is created its outline is
 * fixed. Editing geometry would invalidate cached EOSDA scenes/NDVI stats and
 * the `eosda_cropper_ref` and is intentionally out of scope. Re-create the
 * field if the boundary needs to change.
 *
 * The `.refine` guard rejects empty PATCH bodies so a no-op `{}` doesn't
 * succeed silently and bump `updated_at` for nothing.
 */
export const updateFieldDto = createFieldDto
  .partial()
  .omit({ geometry: true })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'PATCH body must include at least one field to update',
  });

export type UpdateFieldDto = z.infer<typeof updateFieldDto>;

/**
 * Shape of a `fields` row as serialized by the API to JSON.
 *
 * - `id`, `userId`: stable identifiers.
 * - `geometry`: GeoJSON Polygon, EPSG:4326 (server reprojects on insert).
 * - `areaHectares`: PostgreSQL `numeric` is returned as a string by
 *   `node-postgres`; routes coerce to `number` before responding, hence
 *   `z.coerce.number()` here so the same DTO can validate raw rows or
 *   already-coerced JSON.
 * - `createdAt` / `updatedAt`: ISO-8601 datetimes (the API serializes Dates
 *   to strings via `JSON.stringify`).
 */
export const fieldDto = z.object({
  id: z.uuid(),
  userId: z.string().min(1),
  name: z.string(),
  cropType: cropTypeEnum,
  season: seasonEnum,
  farmerName: z.string().nullable(),
  village: z.string().nullable(),
  district: z.string().nullable(),
  state: z.string().nullable(),
  geometry: polygonGeoJsonSchema,
  areaHectares: z.coerce.number().nullable(),
  eosdaCropperRef: z.string().nullable(),
  sowingDate: isoDate.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export type FieldDto = z.infer<typeof fieldDto>;
