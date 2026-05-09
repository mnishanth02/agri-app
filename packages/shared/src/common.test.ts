import { describe, expect, it } from 'vitest';

import {
  INDIA_BBOX,
  MAX_AREA_KM2,
  MIN_AREA_HECTARES,
  type PolygonGeoJson,
  polygonGeoJsonSchema,
} from './common.js';

/**
 * Build a closed square polygon centered at `(lon, lat)` with side length
 * `sideMeters`. Used to construct fixtures with a known approximate area
 * without hand-typing coordinates.
 *
 * The lon/lat → meters conversion is the standard small-angle approximation
 * (1° lat ≈ 111 km; 1° lon ≈ 111 km × cos(lat)). Turf computes the actual
 * area on the resulting polygon, so the approximation only needs to be good
 * enough to land clearly above or below the validation thresholds — every
 * fixture sits well inside its target band so float jitter doesn't matter.
 */
function squarePolygon(centerLon: number, centerLat: number, sideMeters: number): PolygonGeoJson {
  const halfSide = sideMeters / 2;
  const metersPerDegLat = 111_000;
  const metersPerDegLon = 111_000 * Math.cos((centerLat * Math.PI) / 180);
  const dLat = halfSide / metersPerDegLat;
  const dLon = halfSide / metersPerDegLon;

  const west = centerLon - dLon;
  const east = centerLon + dLon;
  const south = centerLat - dLat;
  const north = centerLat + dLat;

  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

// Mandya (Karnataka) — a real district in our pilot area. ~12.5 N, 76.9 E.
const MANDYA_LON = 76.9;
const MANDYA_LAT = 12.5;

describe('polygonGeoJsonSchema', () => {
  describe('exported constants', () => {
    it('MIN_AREA_HECTARES converts to 500 m²', () => {
      expect(MIN_AREA_HECTARES * 10_000).toBe(500);
    });

    it('MAX_AREA_KM2 converts to 200,000,000 m²', () => {
      expect(MAX_AREA_KM2 * 1_000_000).toBe(200_000_000);
    });

    it('INDIA_BBOX covers a generous extent', () => {
      // Sanity: bbox should be wide enough for mainland + Andaman.
      expect(INDIA_BBOX.maxLon - INDIA_BBOX.minLon).toBeGreaterThan(25);
      expect(INDIA_BBOX.maxLat - INDIA_BBOX.minLat).toBeGreaterThan(25);
    });
  });

  describe('valid polygons', () => {
    it('accepts a ~1 ha square in Mandya, Karnataka', () => {
      // 100 m × 100 m = 10,000 m² = 1 ha — comfortably between min and max.
      const polygon = squarePolygon(MANDYA_LON, MANDYA_LAT, 100);

      const result = polygonGeoJsonSchema.safeParse(polygon);

      expect(result.success).toBe(true);
    });
  });

  describe('structural validation', () => {
    it('rejects a polygon whose ring is not closed', () => {
      // 4 vertices, but last ≠ first — exercises the closure refinement
      // (not the `.min(4)` length check).
      const polygon = {
        type: 'Polygon' as const,
        coordinates: [
          [
            [76.9, 12.5],
            [76.901, 12.5],
            [76.901, 12.501],
            [76.9, 12.501], // not equal to first vertex
          ],
        ],
      };

      const result = polygonGeoJsonSchema.safeParse(polygon);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues.some((issue) => /must be closed/i.test(issue.message))).toBe(true);
    });

    it('rejects a multi-ring polygon (no holes allowed)', () => {
      // Outer ring (~1 ha) + inner ring (a tiny hole). Schema's
      // `.length(1)` on coordinates should reject this before the
      // superRefine runs.
      const outer = squarePolygon(MANDYA_LON, MANDYA_LAT, 100);
      const inner = squarePolygon(MANDYA_LON, MANDYA_LAT, 20);
      const outerRing = outer.coordinates[0];
      const innerRing = inner.coordinates[0];
      if (!outerRing || !innerRing) throw new Error('unreachable: square helper bug');
      const polygon = {
        type: 'Polygon' as const,
        coordinates: [outerRing, innerRing],
      };

      const result = polygonGeoJsonSchema.safeParse(polygon);

      expect(result.success).toBe(false);
    });
  });

  describe('bounds validation', () => {
    it('rejects a polygon outside the India bbox (NYC)', () => {
      // 100 m × 100 m square at Times Square — closed and small but well
      // outside India.
      const polygon = squarePolygon(-74.0, 40.7, 100);

      const result = polygonGeoJsonSchema.safeParse(polygon);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(
        result.error.issues.some((issue) => /outside the India bbox/i.test(issue.message)),
      ).toBe(true);
    });
  });

  describe('area validation', () => {
    it('rejects a polygon below the minimum area (sub-0.05 ha)', () => {
      // 10 m × 10 m = 100 m² = 0.01 ha — well below the 0.05 ha (500 m²)
      // floor.
      const polygon = squarePolygon(MANDYA_LON, MANDYA_LAT, 10);

      const result = polygonGeoJsonSchema.safeParse(polygon);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues.some((issue) => /below the minimum/i.test(issue.message))).toBe(
        true,
      );
    });

    it('rejects a polygon above the maximum area (> 200 km²)', () => {
      // 15 km × 15 km = 225 km² — clearly above the 200 km² ceiling.
      const polygon = squarePolygon(MANDYA_LON, MANDYA_LAT, 15_000);

      const result = polygonGeoJsonSchema.safeParse(polygon);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues.some((issue) => /exceeds the maximum/i.test(issue.message))).toBe(
        true,
      );
    });
  });
});
