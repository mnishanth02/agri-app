import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * PostGIS `geometry(Polygon, 4326)` column.
 *
 * Drizzle 0.45's built-in `geometry()` helper hardcodes `geometry(point)` and
 * ignores the `type` / `srid` arguments, so we declare the column type via
 * `customType` to make sure both the generated migration SQL and the kit
 * snapshot carry the correct PostGIS type signature. We deliberately do not
 * implement `toDriver`/`fromDriver` here: callers must always go through the
 * `geometryFromGeoJson` / `geometryToGeoJson` SQL helpers (Module 1.3) so the
 * server controls SRID coercion and never trusts raw client geometry.
 */
const polygonGeometry = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geometry(Polygon,4326)';
  },
});

/**
 * `fields` — user-owned agricultural plots.
 *
 * - `geometry` is a PostGIS Polygon in EPSG:4326 (WGS84). The CHECK constraints
 *   guarantee validity and SRID at the database level so callers cannot smuggle
 *   in malformed or mis-projected geometry.
 * - `area_hectares` is a `STORED` generated column computed from the geometry's
 *   geographic area; never compute on the client (see architecture.md §5).
 */
export const fields = pgTable(
  'fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    cropType: varchar('crop_type', { length: 40 }).notNull(),
    season: varchar('season', { length: 20 }).notNull(),
    farmerName: varchar('farmer_name', { length: 120 }),
    village: varchar('village', { length: 120 }),
    district: varchar('district', { length: 120 }),
    state: varchar('state', { length: 120 }),
    geometry: polygonGeometry('geometry').notNull(),
    areaHectares: numeric('area_hectares', { precision: 10, scale: 2 }).generatedAlwaysAs(
      sql`ST_Area(geometry::geography) / 10000`,
    ),
    eosdaCropperRef: text('eosda_cropper_ref'),
    sowingDate: date('sowing_date'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('fields_user_idx').on(t.userId),
    index('fields_geom_gix').using('gist', t.geometry),
    check('fields_geometry_valid', sql`ST_IsValid(${t.geometry})`),
    check('fields_geometry_srid', sql`ST_SRID(${t.geometry}) = 4326`),
  ],
);

/**
 * `cached_scenes` — EOSDA Sentinel-2 scene metadata cached per field.
 *
 * Uniqueness on `(field_id, view_id)` lets us upsert idempotently and prevents
 * duplicate scene rows when the warm-up service re-runs for the same field.
 *
 * - `scene_id` is the EOSDA `sceneID` projection (e.g. `S2B_tile_…`). Nullable
 *   at the DB level so future backfills (or a fielded-projection rename on
 *   EOSDA's side) don't break the schema; `upsertScenes` always writes a value.
 * - `last_seen_at` records when the warm-up service last confirmed this scene
 *   exists in the EOSDA Search response. Distinct from `created_at`: that
 *   column captures the first time we ever saw this `(field, view_id)` pair,
 *   while `last_seen_at` advances on every successful warm-up so Phase 7's
 *   "recheck if older than N days" logic has a stable signal.
 */
export const cachedScenes = pgTable(
  'cached_scenes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fieldId: uuid('field_id')
      .notNull()
      .references(() => fields.id, { onDelete: 'cascade' }),
    viewId: text('view_id').notNull(),
    sceneId: text('scene_id'),
    source: varchar('source', { length: 20 }).notNull().default('sentinel-2'),
    sceneDate: date('scene_date').notNull(),
    cloudPercent: numeric('cloud_percent', { precision: 5, scale: 2 }),
    dataCoveragePercent: numeric('data_coverage_percent', { precision: 5, scale: 2 }),
    tmsTemplate: text('tms_template'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('cached_scenes_field_view_unique').on(t.fieldId, t.viewId),
    index('cached_scenes_field_date_idx').on(t.fieldId, t.sceneDate.desc()),
  ],
);

/**
 * `cached_ndvi_stats` — per-(field, viewId, indexName) zonal statistics from
 * EOSDA `mt_stats` tasks. NDVI is the default but the same shape covers EVI,
 * NDWI, etc.
 */
export const cachedNdviStats = pgTable(
  'cached_ndvi_stats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fieldId: uuid('field_id')
      .notNull()
      .references(() => fields.id, { onDelete: 'cascade' }),
    viewId: text('view_id').notNull(),
    indexName: varchar('index_name', { length: 20 }).notNull().default('NDVI'),
    sceneDate: date('scene_date').notNull(),
    cloudPercent: numeric('cloud_percent', { precision: 5, scale: 2 }),
    dataCoveragePercent: numeric('data_coverage_percent', { precision: 5, scale: 2 }),
    mean: numeric('mean', { precision: 6, scale: 4 }),
    min: numeric('min', { precision: 6, scale: 4 }),
    max: numeric('max', { precision: 6, scale: 4 }),
    p10: numeric('p10', { precision: 6, scale: 4 }),
    p90: numeric('p90', { precision: 6, scale: 4 }),
    median: numeric('median', { precision: 6, scale: 4 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('cached_ndvi_stats_field_view_index_unique').on(t.fieldId, t.viewId, t.indexName)],
);
