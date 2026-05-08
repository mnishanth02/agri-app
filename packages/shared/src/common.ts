import area from '@turf/area';
import { z } from 'zod';

/**
 * India bounding box used by `polygonGeoJsonSchema` to reject geometry that
 * couldn't possibly be a real Indian field. Matches the bbox documented in
 * `docs/implementation.md` Module 1.4.
 *
 * Bounds are **inclusive**: a vertex sitting exactly on the boundary is
 * accepted. The bbox is intentionally generous (covers Andaman & Nicobar in
 * the east, Kashmir in the north) so legitimate plots in any state pass.
 */
export const INDIA_BBOX = {
  minLon: 68,
  minLat: 6,
  maxLon: 98,
  maxLat: 38,
} as const;

/**
 * Minimum field area in hectares (= 500 m²). Plots smaller than this are
 * almost always digitisation errors — a real "smallest" Indian plot is
 * ~0.1 ha (one *gunta* in Karnataka). 0.05 ha is a generous floor that
 * still catches stray clicks.
 */
export const MIN_AREA_HECTARES = 0.05;

/**
 * Maximum field area in km² (= 200,000,000 m²). Anything bigger is almost
 * certainly an estate / region polygon, not a single field. Acts as a
 * sanity guard against zoom-level mistakes in the drawing tool.
 */
export const MAX_AREA_KM2 = 200;

const MIN_AREA_M2 = MIN_AREA_HECTARES * 10_000;
const MAX_AREA_M2 = MAX_AREA_KM2 * 1_000_000;

/** A GeoJSON `[longitude, latitude]` position. Floats are required by the
 *  GeoJSON spec; the per-axis ranges here are the *world* bounds — the India
 *  bbox refinement is applied at the polygon level so error messages can
 *  point at the offending ring/vertex rather than the raw position. */
const positionSchema = z.tuple([z.number().gte(-180).lte(180), z.number().gte(-90).lte(90)]);

/** A GeoJSON linear ring: at least 4 positions (3 distinct vertices + the
 *  explicit closing position equal to the first). */
const ringSchema = z.array(positionSchema).min(4);

/**
 * Strict GeoJSON Polygon schema for Indian agricultural fields.
 *
 * Why `strictObject`:
 *  - This schema validates the **API payload** that the client sends to
 *    `POST /api/fields`, not arbitrary GeoJSON files. Disallowing extra keys
 *    (`bbox`, `crs`, etc.) keeps the contract small and prevents any client
 *    from smuggling fields the server hasn't agreed to.
 *
 * Why **single-ring** (`coordinates.length === 1`):
 *  - GeoJSON Polygons technically allow inner rings as holes, but the v2
 *    drawing tool emits single-ring polygons only and "field with a hole"
 *    has no clear UX (does the cached EOSDA scene cover the hole?). Reject
 *    multi-ring polygons up front so the contract stays unambiguous. If
 *    holes are needed later, add a separate `polygonWithHolesSchema`.
 *
 * Refinements (Module 1.4 + 1.5):
 *  - Every ring is closed (first vertex equals last vertex *by value*).
 *  - Every vertex sits inside `INDIA_BBOX`.
 *  - Computed area is between `MIN_AREA_HECTARES` and `MAX_AREA_KM2`. Area
 *    is computed by `@turf/area` (WGS84 spherical-excess formula); PostGIS
 *    will independently compute the canonical `area_hectares` value on
 *    insert via the generated column, so this check is purely a guardrail
 *    against obvious user errors before the row hits the database.
 *
 * Geometry validity (no self-intersections, no slivers) is enforced by the
 * `ST_IsValid` CHECK constraint on the `fields.geometry` column — see
 * `docs/implementation.md` Pending Items for the planned client-side check.
 */
export const polygonGeoJsonSchema = z
  .strictObject({
    type: z.literal('Polygon'),
    coordinates: z.array(ringSchema).length(1),
  })
  .superRefine((polygon, ctx) => {
    let hasStructuralIssue = false;

    polygon.coordinates.forEach((ring, ringIdx) => {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
        ctx.addIssue({
          code: 'custom',
          path: ['coordinates', ringIdx],
          message: 'GeoJSON ring must be closed: first and last positions must be equal',
        });
        hasStructuralIssue = true;
      }

      ring.forEach((position, posIdx) => {
        const [lon, lat] = position;
        if (
          lon < INDIA_BBOX.minLon ||
          lon > INDIA_BBOX.maxLon ||
          lat < INDIA_BBOX.minLat ||
          lat > INDIA_BBOX.maxLat
        ) {
          ctx.addIssue({
            code: 'custom',
            path: ['coordinates', ringIdx, posIdx],
            message: `Position [${lon}, ${lat}] is outside the India bbox [${INDIA_BBOX.minLon}, ${INDIA_BBOX.minLat}, ${INDIA_BBOX.maxLon}, ${INDIA_BBOX.maxLat}]`,
          });
          hasStructuralIssue = true;
        }
      });
    });

    // Skip the area calc if the polygon is structurally broken — turf would
    // either throw or report a meaningless number, and the user is better
    // served by fixing the closure / bbox issue first.
    if (hasStructuralIssue) return;

    const areaM2 = area(polygon);

    if (areaM2 < MIN_AREA_M2) {
      ctx.addIssue({
        code: 'custom',
        path: ['coordinates'],
        message: `Polygon area ${(areaM2 / 10_000).toFixed(4)} ha is below the minimum ${MIN_AREA_HECTARES} ha`,
      });
    } else if (areaM2 > MAX_AREA_M2) {
      ctx.addIssue({
        code: 'custom',
        path: ['coordinates'],
        message: `Polygon area ${(areaM2 / 1_000_000).toFixed(2)} km² exceeds the maximum ${MAX_AREA_KM2} km²`,
      });
    }
  });

export type PolygonGeoJson = z.infer<typeof polygonGeoJsonSchema>;
