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
 * Refinements (Module 1.4):
 *  - Every ring is closed (first vertex equals last vertex *by value*).
 *  - Every vertex sits inside `INDIA_BBOX`.
 *
 * Area refinements (sub-0.05 ha, > 200 km²) live in Module 1.5 alongside the
 * vitest suite that covers them.
 */
export const polygonGeoJsonSchema = z
  .strictObject({
    type: z.literal('Polygon'),
    coordinates: z.array(ringSchema).min(1),
  })
  .superRefine((polygon, ctx) => {
    polygon.coordinates.forEach((ring, ringIdx) => {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
        ctx.addIssue({
          code: 'custom',
          path: ['coordinates', ringIdx],
          message: 'GeoJSON ring must be closed: first and last positions must be equal',
        });
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
        }
      });
    });
  });

export type PolygonGeoJson = z.infer<typeof polygonGeoJsonSchema>;
