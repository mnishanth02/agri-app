/**
 * Module 7.1 — Integration tests for the stats cache service.
 *
 * Done-when contract from `docs/implementation.md` §7.1:
 *   - `upsertNdviStats` is idempotent on `(field_id, view_id, index_name)`.
 *   - `listNdviStats` projects to the wire shape and orders newest-first.
 *   - `findMissingPairs` returns only the absent `(viewId, index)` tuples.
 *
 * Why integration tests instead of mocking Drizzle:
 *   - The whole point of this service is the `INSERT ... ON CONFLICT
 *     DO UPDATE` SQL on a 3-column unique index. Mocking would just
 *     re-assert what we typed; running it against PostgreSQL proves
 *     the unique constraint actually fires the upsert path.
 *
 * Isolation:
 *   - Each test owns its own `fields` row (random `user_id`) and a
 *     pinned `PoolClient`; `try/finally` deletes the field (cascades to
 *     `cached_ndvi_stats`) and releases the connection.
 *
 * Pool lifecycle:
 *   - `pool.end()` runs in `afterAll` so the second describe block can
 *     still acquire connections; vitest per-file isolation means other
 *     test files keep their own pool.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { type Db, pool } from '../db/client.js';
import { geometryFromGeoJson } from '../db/geometry.js';
import { fields } from '../db/schema.js';
import {
  findMissingPairs,
  listNdviStats,
  type NdviStatsWriteRow,
  upsertNdviStats,
} from './stats-cache.js';

afterAll(async () => {
  await pool.end();
});

const POLYGON = {
  type: 'Polygon' as const,
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

function statsFixture(overrides: Partial<NdviStatsWriteRow> = {}): NdviStatsWriteRow {
  return {
    viewId: 'view/default',
    indexName: 'NDVI',
    sceneDate: '2026-05-01',
    cloudPercent: 12.5,
    dataCoveragePercent: 99.42,
    mean: 0.6234,
    min: -0.0512,
    max: 0.8721,
    p10: 0.2134,
    p90: 0.7895,
    median: 0.6101,
    ...overrides,
  };
}

async function seedField(): Promise<{
  fieldId: string;
  db: Db;
  cleanup: () => Promise<void>;
}> {
  const client = await pool.connect();
  const db: Db = drizzle(client);
  const userId = `test-stats-cache-${randomUUID()}`;
  const inserted = await db
    .insert(fields)
    .values({
      userId,
      name: 'Stats cache test field',
      cropType: 'Rice',
      season: 'Kharif',
      geometry: geometryFromGeoJson(POLYGON),
    })
    .returning({ id: fields.id });
  const row = inserted[0];
  if (!row) throw new Error('seed insert returned no row');
  const fieldId = row.id;

  return {
    fieldId,
    db,
    cleanup: async () => {
      try {
        await client.query('DELETE FROM fields WHERE id = $1', [fieldId]);
      } finally {
        client.release();
      }
    },
  };
}

describe('stats-cache — upsertNdviStats', () => {
  it('writes every column on first insert and round-trips numerics cleanly', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      await upsertNdviStats(
        fieldId,
        [
          statsFixture({
            viewId: 'view/first',
            sceneDate: '2026-04-15',
            cloudPercent: 7.25,
            mean: 0.4567,
            p10: 0.1023,
            p90: 0.8101,
          }),
        ],
        { db },
      );

      const result = await db.execute<{
        view_id: string;
        index_name: string;
        scene_date: string;
        cloud_percent: string;
        data_coverage_percent: string;
        mean: string;
        p10: string;
        p90: string;
      }>(
        sql`SELECT view_id, index_name, scene_date::text AS scene_date,
                   cloud_percent::text AS cloud_percent,
                   data_coverage_percent::text AS data_coverage_percent,
                   mean::text AS mean,
                   p10::text AS p10,
                   p90::text AS p90
            FROM cached_ndvi_stats WHERE field_id = ${fieldId}`,
      );
      expect(result.rows).toHaveLength(1);
      const row = result.rows[0];
      if (!row) throw new Error('unreachable');
      expect(row.view_id).toBe('view/first');
      expect(row.index_name).toBe('NDVI');
      expect(row.scene_date).toBe('2026-04-15');
      expect(Number(row.cloud_percent)).toBeCloseTo(7.25, 2);
      expect(Number(row.mean)).toBeCloseTo(0.4567, 4);
      expect(Number(row.p10)).toBeCloseTo(0.1023, 4);
      expect(Number(row.p90)).toBeCloseTo(0.8101, 4);
    } finally {
      await cleanup();
    }
  });

  it('is idempotent on (field_id, view_id, index_name) — re-insert does not duplicate', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      const original = statsFixture({
        viewId: 'view/idempotent',
        mean: 0.5,
      });
      await upsertNdviStats(fieldId, [original], { db });

      // Second upsert with refreshed mean — same key
      await upsertNdviStats(
        fieldId,
        [statsFixture({ viewId: 'view/idempotent', mean: 0.7, cloudPercent: 3.0 })],
        { db },
      );

      const result = await db.execute<{ count: string; mean: string; cloud_percent: string }>(
        sql`SELECT COUNT(*)::text AS count,
                   MAX(mean)::text AS mean,
                   MAX(cloud_percent)::text AS cloud_percent
            FROM cached_ndvi_stats WHERE field_id = ${fieldId}`,
      );
      expect(result.rows[0]?.count).toBe('1');
      expect(Number(result.rows[0]?.mean)).toBeCloseTo(0.7, 4);
      expect(Number(result.rows[0]?.cloud_percent)).toBeCloseTo(3.0, 2);
    } finally {
      await cleanup();
    }
  });

  it('different index_name on same view_id creates a separate row', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      await upsertNdviStats(
        fieldId,
        [
          statsFixture({ viewId: 'view/multi', indexName: 'NDVI', mean: 0.5 }),
          statsFixture({ viewId: 'view/multi', indexName: 'EVI', mean: 0.3 }),
        ],
        { db },
      );

      const result = await db.execute<{ count: string }>(
        sql`SELECT COUNT(*)::text AS count FROM cached_ndvi_stats WHERE field_id = ${fieldId}`,
      );
      expect(result.rows[0]?.count).toBe('2');
    } finally {
      await cleanup();
    }
  });

  it('rejects non-finite cloudPercent before reaching pg', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      await expect(
        upsertNdviStats(fieldId, [statsFixture({ viewId: 'view/nan', cloudPercent: Number.NaN })], {
          db,
        }),
      ).rejects.toThrow(/non-finite cloudPercent/);

      const result = await db.execute<{ count: string }>(
        sql`SELECT COUNT(*)::text AS count FROM cached_ndvi_stats WHERE field_id = ${fieldId}`,
      );
      expect(result.rows[0]?.count).toBe('0');
    } finally {
      await cleanup();
    }
  });

  it('writes null for null stats (preserves DB nullability)', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      await upsertNdviStats(
        fieldId,
        [statsFixture({ viewId: 'view/null', mean: null, p10: null, p90: null })],
        { db },
      );

      const result = await db.execute<{ mean: string | null; p10: string | null }>(
        sql`SELECT mean::text AS mean, p10::text AS p10
            FROM cached_ndvi_stats WHERE field_id = ${fieldId}`,
      );
      expect(result.rows[0]?.mean).toBeNull();
      expect(result.rows[0]?.p10).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('is a no-op on empty rows array', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      await upsertNdviStats(fieldId, [], { db });
      const result = await db.execute<{ count: string }>(
        sql`SELECT COUNT(*)::text AS count FROM cached_ndvi_stats WHERE field_id = ${fieldId}`,
      );
      expect(result.rows[0]?.count).toBe('0');
    } finally {
      await cleanup();
    }
  });
});

describe('stats-cache — listNdviStats', () => {
  it('returns rows ordered newest-first by sceneDate then viewId', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      await upsertNdviStats(
        fieldId,
        [
          statsFixture({ viewId: 'view/old', sceneDate: '2026-04-01', mean: 0.3 }),
          statsFixture({ viewId: 'view/mid', sceneDate: '2026-04-08', mean: 0.5 }),
          statsFixture({ viewId: 'view/new', sceneDate: '2026-04-15', mean: 0.7 }),
        ],
        { db },
      );

      const rows = await listNdviStats(fieldId, { db });
      expect(rows.map((r) => r.viewId)).toEqual(['view/new', 'view/mid', 'view/old']);
      // wire shape: numerics as strings (shared zod coerces on client)
      expect(typeof rows[0]?.mean).toBe('string');
      expect(Number(rows[0]?.mean)).toBeCloseTo(0.7, 4);
    } finally {
      await cleanup();
    }
  });

  it('filters by viewIds and indexes', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      await upsertNdviStats(
        fieldId,
        [
          statsFixture({ viewId: 'view/a', indexName: 'NDVI' }),
          statsFixture({ viewId: 'view/a', indexName: 'EVI' }),
          statsFixture({ viewId: 'view/b', indexName: 'NDVI' }),
        ],
        { db },
      );

      const ndviOnly = await listNdviStats(fieldId, { db, indexes: ['NDVI'] });
      expect(ndviOnly.map((r) => `${r.viewId}/${r.indexName}`).sort()).toEqual([
        'view/a/NDVI',
        'view/b/NDVI',
      ]);

      const aOnly = await listNdviStats(fieldId, { db, viewIds: ['view/a'] });
      expect(aOnly.map((r) => r.indexName).sort()).toEqual(['EVI', 'NDVI']);
    } finally {
      await cleanup();
    }
  });

  it('respects an inclusive dateRange filter', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      await upsertNdviStats(
        fieldId,
        [
          statsFixture({ viewId: 'view/before', sceneDate: '2026-03-01' }),
          statsFixture({ viewId: 'view/inside', sceneDate: '2026-04-15' }),
          statsFixture({ viewId: 'view/after', sceneDate: '2026-05-15' }),
        ],
        { db },
      );

      const rows = await listNdviStats(fieldId, {
        db,
        dateRange: { from: '2026-04-01', to: '2026-04-30' },
      });
      expect(rows.map((r) => r.viewId)).toEqual(['view/inside']);
    } finally {
      await cleanup();
    }
  });
});

describe('stats-cache — findMissingPairs', () => {
  it('returns the cartesian product when cache is empty', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      const missing = await findMissingPairs(fieldId, ['v1', 'v2'], ['NDVI', 'EVI'], { db });
      expect(missing).toHaveLength(4);
      expect(missing.map((p) => `${p.viewId}/${p.indexName}`).sort()).toEqual([
        'v1/EVI',
        'v1/NDVI',
        'v2/EVI',
        'v2/NDVI',
      ]);
    } finally {
      await cleanup();
    }
  });

  it('excludes already-cached (viewId, index) tuples', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      await upsertNdviStats(
        fieldId,
        [
          statsFixture({ viewId: 'v1', indexName: 'NDVI' }),
          statsFixture({ viewId: 'v2', indexName: 'EVI' }),
        ],
        { db },
      );

      const missing = await findMissingPairs(fieldId, ['v1', 'v2'], ['NDVI', 'EVI'], { db });
      expect(missing.map((p) => `${p.viewId}/${p.indexName}`).sort()).toEqual([
        'v1/EVI',
        'v2/NDVI',
      ]);
    } finally {
      await cleanup();
    }
  });

  it('returns empty when all pairs are cached', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      await upsertNdviStats(
        fieldId,
        [
          statsFixture({ viewId: 'v1', indexName: 'NDVI' }),
          statsFixture({ viewId: 'v1', indexName: 'EVI' }),
        ],
        { db },
      );
      const missing = await findMissingPairs(fieldId, ['v1'], ['NDVI', 'EVI'], { db });
      expect(missing).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('returns empty for empty viewIds or indexes (no SQL roundtrip needed)', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      expect(await findMissingPairs(fieldId, [], ['NDVI'], { db })).toEqual([]);
      expect(await findMissingPairs(fieldId, ['v1'], [], { db })).toEqual([]);
    } finally {
      await cleanup();
    }
  });
});
