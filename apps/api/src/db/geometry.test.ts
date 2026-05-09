import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, describe, expect, it } from 'vitest';

// We import the shared `pool` from `client.js` (rather than calling
// `createDbClient()`) because the module-level shared client is constructed
// at import time anyway — using it directly keeps the test to a single
// `pg.Pool` we can deterministically end in `afterAll`.
//
// Vitest's default `pool: 'threads'` runs each test file in an isolated
// worker thread, so any future API test files import `client.js` afresh and
// get their own per-thread shared pool — closing this file's pool here does
// not strand other files. `vitest.config.ts` additionally disables file
// parallelism so we don't pile concurrent connections onto the dev PostGIS.
import { pool } from './client.js';
import { geometryFromGeoJson, geometryToGeoJson } from './geometry.js';

type GeoJsonPolygon = {
  type: 'Polygon';
  coordinates: Array<Array<[number, number]>>;
};

describe('PostGIS geometry helpers', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('round-trips a polygon through INSERT + SELECT via a temp table', async () => {
    // ~1 ha plot near Mandya, Karnataka — well inside the India bbox refinement
    // (`[68, 6, 98, 38]`) used by `polygonGeoJsonSchema` in @viz-crop/shared.
    const polygon: GeoJsonPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [76.9, 12.5],
          [76.9009, 12.5],
          [76.9009, 12.5009],
          [76.9, 12.5009],
          [76.9, 12.5],
        ],
      ],
    };

    // Pin a single pg connection for the test. TEMP tables are session-local
    // and `db.execute()` would otherwise pick a different pooled connection
    // per call. Drizzle accepts a `PoolClient` directly, so we get the same
    // tagged-template ergonomics on a single session.
    const client = await pool.connect();
    try {
      const sessionDb = drizzle(client);

      await sessionDb.execute(
        sql`CREATE TEMP TABLE geom_roundtrip_test (
              id serial PRIMARY KEY,
              geom geometry(Polygon, 4326) NOT NULL
            ) ON COMMIT PRESERVE ROWS`,
      );

      // INSERT goes through `geometryFromGeoJson` exactly as Module 1.6's
      // POST /api/fields will. The PostGIS typmod (Polygon, 4326) on the
      // column will reject mismatched SRIDs / geometry kinds, proving the
      // helper is producing correctly-tagged geometry.
      await sessionDb.execute(
        sql`INSERT INTO geom_roundtrip_test (geom) VALUES (${geometryFromGeoJson(polygon)})`,
      );

      // SELECT uses `geometryToGeoJson` against a column reference — same
      // shape Module 1.6 will use for `GET /api/fields`.
      const result = await sessionDb.execute<{ g: GeoJsonPolygon; srid: number }>(
        sql`SELECT ${geometryToGeoJson(sql`geom`)} AS g, ST_SRID(geom) AS srid
            FROM geom_roundtrip_test`,
      );

      const row = result.rows[0];
      expect(row).toBeDefined();
      if (!row) throw new Error('unreachable');

      // ST_AsGeoJSON(...)::json must come back as a parsed object, not a string.
      expect(typeof row.g).toBe('object');
      expect(row.g.type).toBe('Polygon');
      expect(row.g.coordinates).toHaveLength(1);

      const outer = row.g.coordinates[0];
      const expectedRing = polygon.coordinates[0];
      if (!outer || !expectedRing) throw new Error('unreachable');
      expect(outer).toHaveLength(expectedRing.length);

      for (let i = 0; i < outer.length; i++) {
        const expected = expectedRing[i];
        const actual = outer[i];
        expect(actual).toBeDefined();
        if (!expected || !actual) throw new Error('unreachable');
        expect(actual[0]).toBeCloseTo(expected[0], 6);
        expect(actual[1]).toBeCloseTo(expected[1], 6);
      }

      // SRID coercion — server must always tag the geometry as EPSG:4326.
      expect(Number(row.srid)).toBe(4326);
    } finally {
      // TEMP tables die with the session, but explicit DROP keeps the
      // connection clean if pg recycles it back into the pool.
      try {
        await client.query('DROP TABLE IF EXISTS geom_roundtrip_test');
      } finally {
        client.release();
      }
    }
  });
});
