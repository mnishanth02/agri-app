import { type SQL, type SQLWrapper, sql } from 'drizzle-orm';

/**
 * Build a PostGIS geometry SQL fragment from a GeoJSON object (already
 * validated upstream by `polygonGeoJsonSchema` in `@viz-crop/shared`).
 *
 * The geometry is constructed via `ST_GeomFromGeoJSON` and then explicitly
 * reprojected/tagged as EPSG:4326 (WGS84) with `ST_SetSRID`. We *always*
 * coerce the SRID server-side instead of trusting any `crs` member that may
 * have travelled with the GeoJSON — the matching CHECK constraint in
 * `apps/api/src/db/schema.ts` enforces SRID 4326 at the database level too.
 *
 * The serialized JSON is bound as a SQL **parameter** by Drizzle's tagged
 * template (it is not concatenated into the SQL string), so no client value
 * reaches the SQL parser directly.
 */
export function geometryFromGeoJson(geom: unknown): SQL {
  if (geom === undefined || geom === null) {
    throw new TypeError('geometryFromGeoJson: geom must not be null/undefined');
  }
  const json = JSON.stringify(geom);
  return sql`ST_SetSRID(ST_GeomFromGeoJSON(${json}), 4326)`;
}

/**
 * Project a PostGIS geometry column (or arbitrary geometry-typed SQL fragment)
 * back to a GeoJSON object on SELECT.
 *
 * The cast to `::json` lets `node-postgres` decode the result as a parsed JS
 * object instead of a raw string — callers receive a ready-to-validate
 * GeoJSON literal that pairs with `polygonGeoJsonSchema`.
 */
export function geometryToGeoJson(col: SQLWrapper): SQL {
  return sql`ST_AsGeoJSON(${col})::json`;
}
