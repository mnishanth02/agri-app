import area from '@turf/area';

/**
 * Module 3.4 — pure geometry helpers shared across the create-field flow.
 *
 * ## Why `@turf/area` directly instead of `@turf/turf`
 *
 * `apps/web` already depends on `@turf/turf` for ad-hoc utilities, but that
 * package is the full Turf barrel — importing `area` from it pulls every
 * other Turf module that lives in the same dependency closure (helpers,
 * meta, projection, etc.) and inflates the create-field route's JS bundle
 * by hundreds of KB even after tree-shaking. `@turf/area` is the standalone
 * single-purpose module (~3 KB) and is also what `@viz-crop/shared`'s
 * `polygonGeoJsonSchema` uses, so depending on it directly here keeps the
 * two area calculations in lockstep without dragging the barrel along.
 *
 * ## Why this matches `polygonGeoJsonSchema` to floating-point precision
 *
 * Both this helper and the schema call `area(geometry)` from `@turf/area`
 * (WGS84 spherical-excess formula) and divide / multiply by the same
 * constants. That means the live readout the form shows during drawing and
 * the post-finish validation result the schema produces always agree
 * exactly — there is no class of "live UI says 0.05 ha but schema rejected
 * as below 0.05 ha" bug from a second, slightly different formula.
 */
export function polygonAreaHectares(geometry: GeoJSON.Polygon): number {
  return area(geometry) / 10_000;
}
