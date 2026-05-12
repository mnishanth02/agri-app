/**
 * Module 7.1 — `POST /api/eosda/stats` route tests.
 *
 * What this exercises:
 *   1. Auth gate: 401 without `x-test-user-id`.
 *   2. Validation: 400 for malformed `fieldId`/indexes.
 *   3. Ownership: 404 for foreign / non-existent fields.
 *   4. NO_SCENES_FOR_RANGE: empty scene cache short-circuits with HTTP
 *      200, no `runMtStats` call.
 *   5. All cached: returns rows immediately, no `runMtStats` call.
 *   6. Missing pair triggers ONE `runMtStats` call with the right
 *      (geometry, indexes, dateRange).
 *   7. STATS_TIMEOUT maps to HTTP 504 with `{ error, taskId }`.
 *   8. EOSDA non-timeout error degrades to stale cache (200) when cache
 *      has rows, or 502 when cache is empty after the failed refresh.
 *   9. Response shape mirrors `NdviStatsApiRow[]` (numeric strings, etc).
 *
 * Mocking:
 *   - `@clerk/fastify` replaced with `x-test-user-id` mock (same as
 *     fields/scenes routes).
 *   - `runMtStats` is mocked at the module boundary so EOSDA is never
 *     touched.
 *   - `searchScenes` and `warmField` are mocked too — pre-existing scene
 *     rows are seeded directly and create-time warm-up isn't relevant.
 *
 * DB isolation:
 *   - Live PostGIS dev container. Each test seeds its own field row
 *     keyed by a synthetic `user_id`. `afterAll` deletes by user-id.
 */

import { randomUUID } from 'node:crypto';
import { inArray, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/fastify', () => ({
  clerkPlugin: async () => {},
  getAuth: (request: FastifyRequest) => {
    const header = request.headers['x-test-user-id'];
    const userId = typeof header === 'string' ? header : undefined;
    if (userId && userId.length > 0) {
      return { isAuthenticated: true, userId, sessionId: 'test-session' };
    }
    return { isAuthenticated: false, userId: null, sessionId: null };
  },
}));

vi.mock('../src/services/eosda-search.js', () => ({
  searchScenes: vi.fn(async () => []),
}));

vi.mock('../src/services/field-warmup.js', () => ({
  warmField: vi.fn(async () => {}),
}));

// We mock at the module path used by the route. The StatsTimeoutError
// class needs to be a proper constructor for `instanceof` to work, so we
// re-export the real class (vi.importActual) and only mock `runMtStats`.
vi.mock('../src/services/eosda-stats.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/eosda-stats.js')>();
  return {
    ...actual,
    runMtStats: vi.fn(actual.runMtStats),
  };
});

import { fields } from '../src/db/schema.js';
import { buildServer } from '../src/server.js';
import { runMtStats, StatsTimeoutError } from '../src/services/eosda-stats.js';

const USER_A = `test-user-stats-A-${randomUUID()}`;
const USER_B = `test-user-stats-B-${randomUUID()}`;

const polygon = {
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

let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  await app.db.delete(fields).where(inArray(fields.userId, [USER_A, USER_B]));
});

afterAll(async () => {
  try {
    if (app) {
      await app.db.delete(fields).where(inArray(fields.userId, [USER_A, USER_B]));
    }
  } finally {
    if (app) await app.close();
  }
});

beforeEach(() => {
  vi.mocked(runMtStats).mockReset();
  vi.mocked(runMtStats).mockImplementation(async () => []);
});

afterEach(() => {
  vi.mocked(runMtStats).mockReset();
});

async function seedField(userId: string, name = 'Stats route test field'): Promise<string> {
  const inserted = await app.db.execute<{ id: string }>(sql`
    INSERT INTO fields (user_id, name, crop_type, season, geometry)
    VALUES (
      ${userId},
      ${name},
      'Rice',
      'Kharif',
      ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(polygon)}), 4326)
    )
    RETURNING id
  `);
  const row = inserted.rows[0];
  if (!row) throw new Error('seed insert returned no row');
  return row.id;
}

interface SeedSceneInput {
  fieldId: string;
  viewId: string;
  sceneId?: string;
  sceneDate: string;
  cloudPercent?: number;
  dataCoveragePercent?: number;
  tmsTemplate?: string;
}

async function seedCachedScene(input: SeedSceneInput): Promise<void> {
  await app.db.execute(sql`
    INSERT INTO cached_scenes (
      field_id, view_id, scene_id, scene_date,
      cloud_percent, data_coverage_percent, tms_template
    ) VALUES (
      ${input.fieldId},
      ${input.viewId},
      ${input.sceneId ?? `S2B_${input.viewId}`},
      ${input.sceneDate}::date,
      ${input.cloudPercent ?? 10}::numeric,
      ${input.dataCoveragePercent ?? 95}::numeric,
      ${input.tmsTemplate ?? `https://render.eosda.com/tile/${input.viewId}/{z}/{x}/{y}.png`}
    )
  `);
}

interface SeedStatsInput {
  fieldId: string;
  viewId: string;
  indexName?: string;
  sceneDate: string;
  mean?: number;
  cloudPercent?: number;
}

async function seedCachedStats(input: SeedStatsInput): Promise<void> {
  await app.db.execute(sql`
    INSERT INTO cached_ndvi_stats (
      field_id, view_id, index_name, scene_date,
      cloud_percent, data_coverage_percent,
      mean, min, max, p10, p90, median
    ) VALUES (
      ${input.fieldId},
      ${input.viewId},
      ${input.indexName ?? 'NDVI'},
      ${input.sceneDate}::date,
      ${input.cloudPercent ?? 10}::numeric,
      95::numeric,
      ${input.mean ?? 0.5}::numeric,
      0.0::numeric,
      0.9::numeric,
      0.2::numeric,
      0.8::numeric,
      ${input.mean ?? 0.5}::numeric
    )
  `);
}

describe('POST /api/eosda/stats — Module 7.1', () => {
  describe('auth + validation', () => {
    it('returns 401 without x-test-user-id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/stats',
        payload: { fieldId: randomUUID() },
      });
      expect(res.statusCode).toBe(401);
      expect(runMtStats).not.toHaveBeenCalled();
    });

    it('returns 400 for non-UUID fieldId', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/stats',
        headers: { 'x-test-user-id': USER_A },
        payload: { fieldId: 'not-a-uuid' },
      });
      expect(res.statusCode).toBe(400);
      expect(runMtStats).not.toHaveBeenCalled();
    });

    it('returns 400 when indexes contains an unknown value', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/stats',
        headers: { 'x-test-user-id': USER_A },
        payload: { fieldId: randomUUID(), indexes: ['BOGUS'] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when more than 3 indexes are requested', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/stats',
        headers: { 'x-test-user-id': USER_A },
        payload: {
          fieldId: randomUUID(),
          indexes: ['NDVI', 'EVI', 'NDWI', 'NDVI'],
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('ownership', () => {
    it('returns 404 when fieldId belongs to another user (no enumeration)', async () => {
      const fieldId = await seedField(USER_A, 'Owned by A');
      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/stats',
        headers: { 'x-test-user-id': USER_B },
        payload: { fieldId },
      });
      expect(res.statusCode).toBe(404);
      expect(runMtStats).not.toHaveBeenCalled();
    });

    it('returns 404 when fieldId does not exist', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/stats',
        headers: { 'x-test-user-id': USER_A },
        payload: { fieldId: randomUUID() },
      });
      expect(res.statusCode).toBe(404);
      expect(runMtStats).not.toHaveBeenCalled();
    });
  });

  describe('NO_SCENES_FOR_RANGE short-circuit', () => {
    it('returns 200 with NO_SCENES_FOR_RANGE when no scenes are cached', async () => {
      const fieldId = await seedField(USER_A, 'Empty scenes field');

      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/stats',
        headers: { 'x-test-user-id': USER_A },
        payload: { fieldId },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { stats: unknown[]; error?: string };
      expect(body.stats).toEqual([]);
      expect(body.error).toBe('NO_SCENES_FOR_RANGE');
      expect(runMtStats).not.toHaveBeenCalled();
    });

    it('returns NO_SCENES_FOR_RANGE when scenes exist but outside the requested dateRange', async () => {
      const fieldId = await seedField(USER_A, 'Scenes outside range field');
      await seedCachedScene({ fieldId, viewId: 'view/distant', sceneDate: '2020-01-01' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/stats',
        headers: { 'x-test-user-id': USER_A },
        payload: { fieldId, dateRange: { from: '2026-04-01', to: '2026-04-30' } },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { stats: unknown[]; error?: string };
      expect(body.stats).toEqual([]);
      expect(body.error).toBe('NO_SCENES_FOR_RANGE');
      expect(runMtStats).not.toHaveBeenCalled();
    });
  });

  describe('cache-hit path', () => {
    it('returns cached rows without calling runMtStats when all pairs are cached', async () => {
      const fieldId = await seedField(USER_A, 'All cached field');
      await seedCachedScene({ fieldId, viewId: 'view/cached', sceneDate: '2026-04-15' });
      await seedCachedStats({
        fieldId,
        viewId: 'view/cached',
        indexName: 'NDVI',
        sceneDate: '2026-04-15',
        mean: 0.642,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/stats',
        headers: { 'x-test-user-id': USER_A },
        payload: { fieldId },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { stats: Array<{ viewId: string; mean: string | number }> };
      expect(body.stats).toHaveLength(1);
      expect(body.stats[0]?.viewId).toBe('view/cached');
      expect(Number(body.stats[0]?.mean)).toBeCloseTo(0.642, 4);
      expect(runMtStats).not.toHaveBeenCalled();
    });
  });

  describe('cache-miss path', () => {
    it('calls runMtStats once with full geometry/indexes/dateRange and persists the result', async () => {
      const fieldId = await seedField(USER_A, 'Cache miss field');
      await seedCachedScene({
        fieldId,
        viewId: 'view/missing',
        sceneDate: '2026-04-15',
        dataCoveragePercent: 92.5,
      });

      vi.mocked(runMtStats).mockImplementation(async () => [
        {
          viewId: 'view/missing',
          indexName: 'NDVI',
          sceneDate: '2026-04-15',
          cloudPercent: 8.0,
          mean: 0.71,
          min: -0.05,
          max: 0.92,
          p10: 0.3,
          p90: 0.85,
          median: 0.7,
        },
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/stats',
        headers: { 'x-test-user-id': USER_A },
        payload: { fieldId },
      });

      expect(res.statusCode).toBe(200);
      expect(runMtStats).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(runMtStats).mock.calls[0]?.[0];
      expect(callArgs?.fieldId).toBe(fieldId);
      expect(callArgs?.indexes).toEqual(['NDVI']);
      expect(callArgs?.geometry?.type).toBe('Polygon');
      expect(callArgs?.dateRange.from).toBeTruthy();
      expect(callArgs?.dateRange.to).toBeTruthy();

      const body = res.json() as { stats: Array<{ viewId: string; mean: string }> };
      expect(body.stats).toHaveLength(1);
      expect(body.stats[0]?.viewId).toBe('view/missing');
      expect(Number(body.stats[0]?.mean)).toBeCloseTo(0.71, 4);

      // Persisted to cache with the data_coverage_percent joined from cached_scenes.
      const persisted = await app.db.execute<{
        count: string;
        data_coverage_percent: string | null;
      }>(
        sql`SELECT COUNT(*)::text AS count,
                   MAX(data_coverage_percent)::text AS data_coverage_percent
            FROM cached_ndvi_stats WHERE field_id = ${fieldId}`,
      );
      expect(persisted.rows[0]?.count).toBe('1');
      expect(Number(persisted.rows[0]?.data_coverage_percent)).toBeCloseTo(92.5, 2);
    });

    it('honours the requested indexes (NDVI + EVI), one task covers both', async () => {
      const fieldId = await seedField(USER_A, 'Multi-index field');
      await seedCachedScene({ fieldId, viewId: 'view/multi', sceneDate: '2026-04-10' });

      vi.mocked(runMtStats).mockImplementation(async () => [
        {
          viewId: 'view/multi',
          indexName: 'NDVI',
          sceneDate: '2026-04-10',
          cloudPercent: 5,
          mean: 0.5,
          min: 0,
          max: 1,
          p10: 0.3,
          p90: 0.8,
          median: 0.5,
        },
        {
          viewId: 'view/multi',
          indexName: 'EVI',
          sceneDate: '2026-04-10',
          cloudPercent: 5,
          mean: 0.3,
          min: 0,
          max: 0.6,
          p10: 0.1,
          p90: 0.5,
          median: 0.3,
        },
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/stats',
        headers: { 'x-test-user-id': USER_A },
        payload: { fieldId, indexes: ['NDVI', 'EVI'] },
      });

      expect(res.statusCode).toBe(200);
      expect(runMtStats).toHaveBeenCalledTimes(1);
      expect(vi.mocked(runMtStats).mock.calls[0]?.[0]?.indexes).toEqual(['NDVI', 'EVI']);
      const body = res.json() as { stats: Array<{ indexName: string }> };
      expect(body.stats.map((r) => r.indexName).sort()).toEqual(['EVI', 'NDVI']);
    });

    it('writes tombstones for (viewId, index) pairs absent from the mt_stats response so subsequent calls do not re-spend quota', async () => {
      const fieldId = await seedField(USER_A, 'Partial mt_stats result');
      // Two cached scenes; we will request NDVI for both but EOSDA will
      // only return data for one (e.g. the other was 100% cloud).
      await seedCachedScene({
        fieldId,
        viewId: 'view/has-data',
        sceneDate: '2026-05-01',
        cloudPercent: 5,
        dataCoveragePercent: 90,
      });
      await seedCachedScene({
        fieldId,
        viewId: 'view/no-data',
        sceneDate: '2026-05-02',
        cloudPercent: 100,
        dataCoveragePercent: 0,
      });

      vi.mocked(runMtStats).mockImplementation(async () => [
        {
          viewId: 'view/has-data',
          indexName: 'NDVI',
          sceneDate: '2026-05-01',
          cloudPercent: 5,
          mean: 0.65,
          min: 0.1,
          max: 0.9,
          p10: 0.3,
          p90: 0.85,
          median: 0.6,
        },
      ]);

      const first = await app.inject({
        method: 'POST',
        url: '/api/eosda/stats',
        headers: { 'x-test-user-id': USER_A },
        payload: { fieldId },
      });
      expect(first.statusCode).toBe(200);
      expect(runMtStats).toHaveBeenCalledTimes(1);

      // Persisted: the real row PLUS one tombstone for view/no-data.
      const persisted = await app.db.execute<{
        view_id: string;
        mean: string | null;
        cloud_percent: string | null;
      }>(
        sql`SELECT view_id, mean::text AS mean, cloud_percent::text AS cloud_percent
            FROM cached_ndvi_stats
            WHERE field_id = ${fieldId}
            ORDER BY view_id`,
      );
      expect(persisted.rows).toHaveLength(2);
      // Tombstone row first by alphabetical sort of view_id.
      const tombstone = persisted.rows.find((r) => r.view_id === 'view/no-data');
      const real = persisted.rows.find((r) => r.view_id === 'view/has-data');
      expect(tombstone).toBeDefined();
      expect(tombstone?.mean).toBeNull();
      expect(Number(tombstone?.cloud_percent)).toBeCloseTo(100, 2);
      expect(real?.mean).not.toBeNull();

      // Second call MUST NOT trigger another runMtStats — the tombstone
      // makes findMissingPairs return an empty list.
      vi.mocked(runMtStats).mockClear();
      const second = await app.inject({
        method: 'POST',
        url: '/api/eosda/stats',
        headers: { 'x-test-user-id': USER_A },
        payload: { fieldId },
      });
      expect(second.statusCode).toBe(200);
      expect(runMtStats).not.toHaveBeenCalled();

      const secondBody = second.json() as { stats: Array<{ viewId: string; mean: number | null }> };
      expect(secondBody.stats).toHaveLength(2);
      const secondTombstone = secondBody.stats.find((r) => r.viewId === 'view/no-data');
      expect(secondTombstone?.mean).toBeNull();
    });
  });

  describe('error handling', () => {
    it('maps StatsTimeoutError to HTTP 504 with { error, taskId }', async () => {
      const fieldId = await seedField(USER_A, 'Timeout field');
      await seedCachedScene({ fieldId, viewId: 'view/timeout', sceneDate: '2026-04-15' });

      vi.mocked(runMtStats).mockImplementation(async () => {
        throw new StatsTimeoutError('task-abc');
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/stats',
        headers: { 'x-test-user-id': USER_A },
        payload: { fieldId },
      });

      expect(res.statusCode).toBe(504);
      const body = res.json() as { error: string; taskId: string };
      expect(body.error).toBe('STATS_TIMEOUT');
      expect(body.taskId).toBe('task-abc');
    });

    it('falls back to stale cache when runMtStats throws a non-timeout error', async () => {
      const fieldId = await seedField(USER_A, 'Degrade to cache field');
      await seedCachedScene({ fieldId, viewId: 'view/cached', sceneDate: '2026-04-15' });
      await seedCachedScene({ fieldId, viewId: 'view/missing', sceneDate: '2026-04-20' });
      // Only one of the two scene's NDVI is in the stats cache.
      await seedCachedStats({
        fieldId,
        viewId: 'view/cached',
        sceneDate: '2026-04-15',
        mean: 0.6,
      });

      vi.mocked(runMtStats).mockImplementation(async () => {
        throw new Error('eosda boom');
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/stats',
        headers: { 'x-test-user-id': USER_A },
        payload: { fieldId },
      });

      // 200, returns whatever was cached.
      expect(res.statusCode).toBe(200);
      const body = res.json() as { stats: Array<{ viewId: string }> };
      expect(body.stats.map((r) => r.viewId)).toEqual(['view/cached']);
    });

    it('returns 502 when runMtStats fails AND nothing is cached for these pairs', async () => {
      const fieldId = await seedField(USER_A, 'Empty stats failure field');
      await seedCachedScene({ fieldId, viewId: 'view/none', sceneDate: '2026-04-15' });

      vi.mocked(runMtStats).mockImplementation(async () => {
        throw new Error('eosda boom');
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/stats',
        headers: { 'x-test-user-id': USER_A },
        payload: { fieldId },
      });

      expect(res.statusCode).toBe(502);
    });
  });

  describe('response shape', () => {
    it('returns rows including id, fieldId, indexName, createdAt, and numeric-string columns', async () => {
      const fieldId = await seedField(USER_A, 'Shape field');
      await seedCachedScene({ fieldId, viewId: 'view/shape', sceneDate: '2026-04-15' });
      await seedCachedStats({
        fieldId,
        viewId: 'view/shape',
        sceneDate: '2026-04-15',
        mean: 0.5234,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/stats',
        headers: { 'x-test-user-id': USER_A },
        payload: { fieldId },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        stats: Array<{
          id: string;
          fieldId: string;
          viewId: string;
          indexName: string;
          sceneDate: string;
          mean: string;
          createdAt: string;
        }>;
      };
      expect(body.stats).toHaveLength(1);
      const row = body.stats[0];
      if (!row) throw new Error('unreachable');
      expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(row.fieldId).toBe(fieldId);
      expect(row.viewId).toBe('view/shape');
      expect(row.indexName).toBe('NDVI');
      expect(row.sceneDate).toBe('2026-04-15');
      expect(Number(row.mean)).toBeCloseTo(0.5234, 4);
      expect(Number.isFinite(Date.parse(row.createdAt))).toBe(true);
    });
  });
});
