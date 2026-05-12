/**
 * Module 6.1 — `POST /api/eosda/scenes` route tests.
 *
 * What this exercises:
 *   1. Auth gate: 401 without `x-test-user-id`.
 *   2. Validation: 400 for malformed `fieldId`, missing body, etc.
 *   3. Ownership: 404 when the field belongs to another user.
 *   4. Cache-fresh path: scenes seeded directly into `cached_scenes` with
 *      a recent `last_seen_at` come back newest-first, no Search call.
 *   5. Empty-cache path: triggers `searchScenes` and persists what it
 *      returned, then re-reads.
 *   6. `forceRefresh: true` triggers Search even when cache is fresh.
 *   7. Stale cache (`last_seen_at` 25h ago) triggers Search.
 *   8. Search transport error degrades gracefully (cache returned, log
 *      records the failure, status still 200).
 *
 * Mocking:
 *   - `@clerk/fastify` is replaced with the same `x-test-user-id` mock
 *     used by `fields.routes.test.ts`.
 *   - `searchScenes` is mocked at the module boundary so EOSDA is never
 *     touched. Each test reconfigures the mock as needed via
 *     `vi.mocked(searchScenes).mockImplementation(...)`. This mirrors the
 *     pattern in `fields.warmup.test.ts` (which mocks `warmField`) and
 *     keeps the test suite air-gapped from real EOSDA endpoints.
 *   - `warmField` is also mocked to a no-op so the `POST /api/fields`
 *     calls used by some setup paths don't trigger real EOSDA traffic.
 *
 * DB isolation:
 *   - Live PostGIS dev container, same as `fields.routes.test.ts` and
 *     `scene-cache.test.ts`. Each test seeds its own field row keyed by
 *     a synthetic `user_id` (`USER_*-<randomUUID()>`) so collisions with
 *     pre-existing data are effectively impossible. `afterAll` cleans up
 *     by user-id.
 *
 * `fileParallelism: false` (vitest config) keeps the suite serial so the
 * shared `pg.Pool` does not contend across files.
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

// Mock the EOSDA Search wrapper so the route never reaches the network.
// Each test reconfigures the spy as needed.
vi.mock('../src/services/eosda-search.js', () => ({
  searchScenes: vi.fn(async () => []),
}));

// Stub the warm-up so seeding fields via `POST /api/fields` doesn't
// trigger real EOSDA calls. `fields.warmup.test.ts` covers the wire-up
// itself; here we just need the route to behave as if warm-up succeeded
// instantly and synchronously.
vi.mock('../src/services/field-warmup.js', () => ({
  warmField: vi.fn(async () => {}),
}));

import { fields } from '../src/db/schema.js';
import { buildServer } from '../src/server.js';
import { searchScenes } from '../src/services/eosda-search.js';

const USER_A = `test-user-eosda-A-${randomUUID()}`;
const USER_B = `test-user-eosda-B-${randomUUID()}`;

// ~1 ha plot near Mandya, Karnataka — same shape used by
// `fields.routes.test.ts`. Comfortably inside the India bbox refinement.
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
      // ON DELETE CASCADE on cached_scenes.field_id wipes seeded scenes.
      await app.db.delete(fields).where(inArray(fields.userId, [USER_A, USER_B]));
    }
  } finally {
    if (app) await app.close();
  }
});

beforeEach(() => {
  vi.mocked(searchScenes).mockReset();
  vi.mocked(searchScenes).mockImplementation(async () => []);
});

afterEach(() => {
  vi.mocked(searchScenes).mockReset();
});

/** Seed a `fields` row owned by `userId` and return the new id. */
async function seedField(userId: string, name = 'Eosda scenes test field'): Promise<string> {
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
  /** Override `last_seen_at`; defaults to now() in SQL. */
  lastSeenAt?: Date;
}

/**
 * Insert a row into `cached_scenes` directly (not via `upsertScenes`) so
 * tests can pin `last_seen_at` to an arbitrary instant — the only way to
 * exercise the staleness branch deterministically.
 */
async function seedCachedScene(input: SeedSceneInput): Promise<void> {
  const lastSeenSql = input.lastSeenAt
    ? sql`${input.lastSeenAt.toISOString()}::timestamptz`
    : sql`now()`;
  await app.db.execute(sql`
    INSERT INTO cached_scenes (
      field_id, view_id, scene_id, scene_date,
      cloud_percent, data_coverage_percent, tms_template, last_seen_at
    ) VALUES (
      ${input.fieldId},
      ${input.viewId},
      ${input.sceneId ?? `S2B_${input.viewId}`},
      ${input.sceneDate}::date,
      ${input.cloudPercent ?? 10}::numeric,
      ${input.dataCoveragePercent ?? 95}::numeric,
      ${input.tmsTemplate ?? `https://render.eosda.com/tile/${input.viewId}/{z}/{x}/{y}.png`},
      ${lastSeenSql}
    )
  `);
}

describe('POST /api/eosda/scenes — Module 6.1', () => {
  describe('auth + validation', () => {
    it('returns 401 when no x-test-user-id header is set', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/scenes',
        payload: { fieldId: randomUUID() },
      });
      expect(res.statusCode).toBe(401);
      expect(searchScenes).not.toHaveBeenCalled();
    });

    it('returns 400 when fieldId is not a UUID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/scenes',
        headers: { 'x-test-user-id': USER_A },
        payload: { fieldId: 'not-a-uuid' },
      });
      expect(res.statusCode).toBe(400);
      expect(searchScenes).not.toHaveBeenCalled();
    });

    it('returns 400 when body is missing fieldId entirely', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/scenes',
        headers: { 'x-test-user-id': USER_A },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('ownership', () => {
    it('returns 404 when fieldId belongs to another user (no enumeration)', async () => {
      const fieldId = await seedField(USER_A, 'Owned by A');
      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/scenes',
        headers: { 'x-test-user-id': USER_B },
        payload: { fieldId },
      });
      expect(res.statusCode).toBe(404);
      expect(searchScenes).not.toHaveBeenCalled();
    });

    it('returns 404 when fieldId does not exist at all', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/scenes',
        headers: { 'x-test-user-id': USER_A },
        payload: { fieldId: randomUUID() },
      });
      expect(res.statusCode).toBe(404);
      expect(searchScenes).not.toHaveBeenCalled();
    });
  });

  describe('cache-fresh path', () => {
    it('returns cached scenes newest-first without calling Search', async () => {
      const fieldId = await seedField(USER_A, 'Cache fresh field');
      // Three scenes spanning a week — second one should sort newest.
      await seedCachedScene({ fieldId, viewId: 'view/old', sceneDate: '2026-04-01' });
      await seedCachedScene({ fieldId, viewId: 'view/middle', sceneDate: '2026-04-08' });
      await seedCachedScene({ fieldId, viewId: 'view/new', sceneDate: '2026-04-15' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/scenes',
        headers: { 'x-test-user-id': USER_A },
        payload: { fieldId },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { scenes: Array<{ viewId: string; sceneDate: string }> };
      expect(body.scenes.map((s) => s.viewId)).toEqual(['view/new', 'view/middle', 'view/old']);
      expect(body.scenes[0]?.sceneDate).toBe('2026-04-15');
      expect(searchScenes).not.toHaveBeenCalled();
    });

    it('respects an explicit dateRange filter', async () => {
      const fieldId = await seedField(USER_A, 'Cache range field');
      await seedCachedScene({ fieldId, viewId: 'view/r-old', sceneDate: '2026-03-01' });
      await seedCachedScene({ fieldId, viewId: 'view/r-mid', sceneDate: '2026-04-08' });
      await seedCachedScene({ fieldId, viewId: 'view/r-new', sceneDate: '2026-05-15' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/scenes',
        headers: { 'x-test-user-id': USER_A },
        payload: {
          fieldId,
          dateRange: { from: '2026-04-01', to: '2026-04-30' },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { scenes: Array<{ viewId: string }> };
      expect(body.scenes.map((s) => s.viewId)).toEqual(['view/r-mid']);
      expect(searchScenes).not.toHaveBeenCalled();
    });
  });

  describe('refresh paths', () => {
    it('triggers Search when cache is empty, persists results, and re-reads', async () => {
      const fieldId = await seedField(USER_A, 'Empty cache field');

      vi.mocked(searchScenes).mockImplementation(async () => [
        {
          sceneId: 'S2B_search_a',
          viewId: 'search/view/a',
          sceneDate: '2026-04-20',
          cloudPercent: 4.5,
          dataCoveragePercent: 99.0,
          tmsTemplate: 'https://render.eosda.com/tile/search-a/{z}/{x}/{y}.png',
        },
        {
          sceneId: 'S2B_search_b',
          viewId: 'search/view/b',
          sceneDate: '2026-04-15',
          cloudPercent: 12.0,
          dataCoveragePercent: 87.5,
          tmsTemplate: 'https://render.eosda.com/tile/search-b/{z}/{x}/{y}.png',
        },
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/scenes',
        headers: { 'x-test-user-id': USER_A },
        payload: { fieldId },
      });

      expect(res.statusCode).toBe(200);
      expect(searchScenes).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(searchScenes).mock.calls[0]?.[0];
      expect(callArgs?.geometry?.type).toBe('Polygon');
      expect(callArgs?.limit).toBe(30);

      const body = res.json() as {
        scenes: Array<{ viewId: string; sceneDate: string; cloudPercent: string | number }>;
      };
      // Newest first: 2026-04-20 → 2026-04-15.
      expect(body.scenes.map((s) => s.viewId)).toEqual(['search/view/a', 'search/view/b']);
      // pg returns `numeric` as a string; the wire shape preserves it and
      // the shared `sceneDto` zod (`z.coerce.number()`) widens it to
      // `number` on the *client* side. The route deliberately does not
      // re-parse so error envelopes surface where they're actionable.
      expect(Number(body.scenes[0]?.cloudPercent)).toBeCloseTo(4.5, 2);

      // Search results were upserted into cache.
      const persisted = await app.db.execute<{ count: string }>(
        sql`SELECT COUNT(*)::text AS count FROM cached_scenes WHERE field_id = ${fieldId}`,
      );
      expect(persisted.rows[0]?.count).toBe('2');
    });

    it('forceRefresh: true triggers Search even when cache is fresh', async () => {
      const fieldId = await seedField(USER_A, 'Force refresh field');
      await seedCachedScene({ fieldId, viewId: 'view/cached', sceneDate: '2026-04-15' });

      vi.mocked(searchScenes).mockImplementation(async () => [
        {
          sceneId: 'S2B_force_refresh',
          viewId: 'view/cached', // same key to exercise idempotent upsert
          sceneDate: '2026-04-15',
          cloudPercent: 8.0,
          dataCoveragePercent: 95.0,
          tmsTemplate: 'https://render.eosda.com/tile/forced/{z}/{x}/{y}.png',
        },
        {
          sceneId: 'S2B_force_new',
          viewId: 'view/forced-new',
          sceneDate: '2026-04-22',
          cloudPercent: 3.0,
          dataCoveragePercent: 98.0,
          tmsTemplate: 'https://render.eosda.com/tile/forced-new/{z}/{x}/{y}.png',
        },
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/scenes',
        headers: { 'x-test-user-id': USER_A },
        payload: { fieldId, forceRefresh: true },
      });

      expect(res.statusCode).toBe(200);
      expect(searchScenes).toHaveBeenCalledTimes(1);

      const body = res.json() as { scenes: Array<{ viewId: string }> };
      expect(body.scenes.map((s) => s.viewId)).toEqual(['view/forced-new', 'view/cached']);
    });

    it('triggers Search when cache is stale (newest last_seen_at older than TTL)', async () => {
      const fieldId = await seedField(USER_A, 'Stale cache field');
      // 25h ago — beyond the 24h TTL the route enforces.
      const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
      await seedCachedScene({
        fieldId,
        viewId: 'view/stale',
        sceneDate: '2026-04-10',
        lastSeenAt: stale,
      });

      vi.mocked(searchScenes).mockImplementation(async () => [
        {
          sceneId: 'S2B_refreshed',
          viewId: 'view/refreshed',
          sceneDate: '2026-04-25',
          cloudPercent: 6.0,
          dataCoveragePercent: 96.0,
          tmsTemplate: 'https://render.eosda.com/tile/refreshed/{z}/{x}/{y}.png',
        },
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/scenes',
        headers: { 'x-test-user-id': USER_A },
        payload: { fieldId },
      });

      expect(res.statusCode).toBe(200);
      expect(searchScenes).toHaveBeenCalledTimes(1);

      const body = res.json() as { scenes: Array<{ viewId: string }> };
      // Both rows present after refresh; newest first.
      expect(body.scenes.map((s) => s.viewId)).toEqual(['view/refreshed', 'view/stale']);
    });

    it('does NOT call Search when cache is just below the TTL boundary', async () => {
      const fieldId = await seedField(USER_A, 'Just-fresh cache field');
      // 23h ago — well inside the 24h TTL.
      const fresh = new Date(Date.now() - 23 * 60 * 60 * 1000);
      await seedCachedScene({
        fieldId,
        viewId: 'view/just-fresh',
        sceneDate: '2026-04-12',
        lastSeenAt: fresh,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/scenes',
        headers: { 'x-test-user-id': USER_A },
        payload: { fieldId },
      });

      expect(res.statusCode).toBe(200);
      expect(searchScenes).not.toHaveBeenCalled();
      const body = res.json() as { scenes: Array<{ viewId: string }> };
      expect(body.scenes.map((s) => s.viewId)).toEqual(['view/just-fresh']);
    });

    it('anchors the default `from` window on the resolved `to`, not on `now`', async () => {
      const fieldId = await seedField(USER_A, 'Custom-to default-from field');

      vi.mocked(searchScenes).mockImplementation(async () => []);

      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/scenes',
        headers: { 'x-test-user-id': USER_A },
        // Caller passes only `to` — `from` must default to T-90d
        // anchored on this `to`, NOT on today.
        payload: { fieldId, dateRange: { to: '2024-01-01' } },
      });

      expect(res.statusCode).toBe(200);
      // Empty cache for the requested range triggers Search.
      expect(searchScenes).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(searchScenes).mock.calls[0]?.[0];
      // Window: 2024-01-01 minus 90 days = 2023-10-03.
      expect(callArgs?.to).toBe('2024-01-01');
      expect(callArgs?.from).toBe('2023-10-03');
    });

    it('falls back to cache when Search throws (graceful degradation)', async () => {
      const fieldId = await seedField(USER_A, 'Search failure field');
      const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
      await seedCachedScene({
        fieldId,
        viewId: 'view/keep-on-failure',
        sceneDate: '2026-04-05',
        lastSeenAt: stale,
      });

      vi.mocked(searchScenes).mockImplementation(async () => {
        throw new Error('eosda transport boom');
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/scenes',
        headers: { 'x-test-user-id': USER_A },
        payload: { fieldId },
      });

      // The route must not surface the Search failure as a 5xx — the user
      // still sees the previously-cached timeline.
      expect(res.statusCode).toBe(200);
      expect(searchScenes).toHaveBeenCalledTimes(1);

      const body = res.json() as { scenes: Array<{ viewId: string }> };
      expect(body.scenes.map((s) => s.viewId)).toEqual(['view/keep-on-failure']);

      // No new rows were written.
      const persisted = await app.db.execute<{ count: string }>(
        sql`SELECT COUNT(*)::text AS count FROM cached_scenes WHERE field_id = ${fieldId}`,
      );
      expect(persisted.rows[0]?.count).toBe('1');
    });
  });

  describe('response shape', () => {
    it('returned rows include id, fieldId, source, createdAt and the wire DTO fields', async () => {
      const fieldId = await seedField(USER_A, 'Response shape field');
      await seedCachedScene({
        fieldId,
        viewId: 'view/shape',
        sceneDate: '2026-04-18',
        cloudPercent: 22.5,
        dataCoveragePercent: 91.25,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/eosda/scenes',
        headers: { 'x-test-user-id': USER_A },
        payload: { fieldId },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        scenes: Array<{
          id: string;
          fieldId: string;
          viewId: string;
          source: string;
          sceneDate: string;
          cloudPercent: string | null;
          dataCoveragePercent: string | null;
          tmsTemplate: string | null;
          createdAt: string;
        }>;
      };
      expect(body.scenes).toHaveLength(1);
      const scene = body.scenes[0];
      if (!scene) throw new Error('unreachable');
      expect(scene.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(scene.fieldId).toBe(fieldId);
      expect(scene.viewId).toBe('view/shape');
      expect(scene.source).toBe('sentinel-2');
      expect(scene.sceneDate).toBe('2026-04-18');
      // pg returns numerics as strings; the wire payload preserves them
      // (the shared `sceneDto` zod coerces to number on the client).
      expect(Number(scene.cloudPercent)).toBeCloseTo(22.5, 2);
      expect(Number(scene.dataCoveragePercent)).toBeCloseTo(91.25, 2);
      expect(typeof scene.tmsTemplate).toBe('string');
      expect(Number.isFinite(Date.parse(scene.createdAt as unknown as string))).toBe(true);
    });
  });
});
