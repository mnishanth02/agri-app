/**
 * Module 1.9 — Auth & ownership smoke tests for the field routes.
 *
 * What these tests exercise:
 *   1. `/api/health` is reachable without auth (proves the public route is
 *      not gated by the global Clerk plugin).
 *   2. `/api/fields` rejects unauthenticated callers with 401 (proves the
 *      `requireUser` preHandler actually fires).
 *   3. A fake authed user can run the full POST → GET (one) → GET (list) →
 *      PATCH → DELETE → GET (404) lifecycle.
 *   4. A second fake user receives 404 on every shape of access to the
 *      first user's row, and their list view excludes it. The first user's
 *      row is unaffected by the second user's failed attempts.
 *
 * How Clerk is faked:
 *   `vi.mock('@clerk/fastify', …)` replaces the package at module-load time
 *   for this file only. `getAuth(request)` reads the `x-test-user-id` header
 *   instead of verifying a JWT — set it to act as a given user, omit it to
 *   act as an anonymous caller. The mocked `clerkPlugin` is a no-op since
 *   no production code reads any Clerk-decorated request property today.
 *
 * Why the dev PostGIS container instead of pg-mem or a fresh DB:
 *   - pg-mem cannot run PostGIS (`geometry` column type, `ST_*` functions,
 *     `area_hectares` STORED generated column, `fields_geometry_valid`
 *     check constraint all require the real extension).
 *   - Spinning a second container per test run would slow CI without
 *     adding signal — `geometry.test.ts` already proved the live-PostGIS
 *     pattern works.
 *   - Instead, every test row uses a synthetic `user_id` namespaced with a
 *     fresh `crypto.randomUUID()` so collision with any pre-existing row
 *     is effectively impossible. `beforeAll` AND `afterAll` delete those
 *     namespaced rows so a crash mid-suite doesn't strand data.
 *
 * Preconditions:
 *   - Drizzle migrations must already be applied (`pnpm --filter @viz-crop/api
 *     db:migrate`). The suite assumes the `fields` table exists; if it does
 *     not, the first POST will surface a clear "relation fields does not
 *     exist" Postgres error which is self-explanatory.
 *   - `apps/api/.env` must define `DATABASE_URL` and `CLERK_SECRET_KEY`
 *     (the latter only because `env.ts` validates it at import time — the
 *     mock means the value is never actually used to verify a token).
 */

import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// vi.mock is hoisted by Vitest above the static imports below, so the mock
// is in place by the time `server.ts` resolves `import … from '@clerk/fastify'`.
// Keep this as the very first non-import statement in the file.
vi.mock('@clerk/fastify', () => ({
  // No-op plugin — Fastify accepts any async function as a plugin. We don't
  // need fastify-plugin here because we don't decorate anything that needs
  // to escape encapsulation; the production code only calls `getAuth` and
  // never reads a Clerk-managed request property.
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

// Stub the Module 4.6 warm-up so the CRUD smoke tests don't trigger real
// EOSDA Cropper/Search calls on every POST. The wire-up itself is exercised
// by `fields.warmup.test.ts`; here we just need the route to behave as if
// warm-up succeeded immediately and synchronously.
vi.mock('../src/services/field-warmup.js', () => ({
  warmField: vi.fn(async () => {}),
}));

import { fields } from '../src/db/schema.js';
import { buildServer } from '../src/server.js';

const USER_A = `test-user-A-${randomUUID()}`;
const USER_B = `test-user-B-${randomUUID()}`;

// ~1 ha plot near Mandya, Karnataka — same shape used by `geometry.test.ts`.
// Well inside the India bbox refinement enforced by `polygonGeoJsonSchema`.
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

  // Defensive cleanup in case a prior crashed run left rows behind. The
  // synthetic UUIDs are fresh per process, so this is a no-op on a clean
  // DB but guards against developers re-running by hand without restarting.
  await app.db.delete(fields).where(inArray(fields.userId, [USER_A, USER_B]));
});

afterAll(async () => {
  // Wrap cleanup in try/finally so a failed DELETE (e.g., the migration was
  // never applied, fields table is missing) still tears down the pg pool —
  // otherwise vitest hangs waiting for the open connection.
  try {
    if (app) {
      await app.db.delete(fields).where(inArray(fields.userId, [USER_A, USER_B]));
    }
  } finally {
    if (app) await app.close();
  }
});

describe('fields routes — auth + ownership smoke', () => {
  describe('public surface', () => {
    it('GET /api/health → 200 unauthenticated', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });
  });

  describe('GET /api/fields auth gate', () => {
    it('returns 401 when no x-test-user-id header is set', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/fields' });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 even when an Authorization header is present but no userId resolves', async () => {
      // Guards against accidentally writing test logic in the future that
      // treats the mere presence of an Authorization header as proof of
      // authentication. With our mock, only `x-test-user-id` matters.
      const res = await app.inject({
        method: 'GET',
        url: '/api/fields',
        headers: { authorization: 'Bearer not-a-real-token' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('CRUD lifecycle as USER_A', () => {
    let createdId: string;
    let createdAt: string;

    it('POST /api/fields → 201 with new id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/fields',
        headers: { 'x-test-user-id': USER_A },
        payload: {
          name: 'Smoke field',
          cropType: 'Rice',
          season: 'Kharif',
          geometry: polygon,
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string };
      // UUID v4-ish — the route's `defaultRandom()` is uuid_generate_v4().
      expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      createdId = body.id;
    });

    it('GET /api/fields/:id → 200 with USER_A as owner and round-tripped geometry', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/fields/${createdId}`,
        headers: { 'x-test-user-id': USER_A },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        id: string;
        userId: string;
        name: string;
        cropType: string;
        season: string;
        geometry: { type: string; coordinates: number[][][] };
        createdAt: string;
        areaHectares: number | null;
      };
      expect(body.id).toBe(createdId);
      expect(body.userId).toBe(USER_A);
      expect(body.name).toBe('Smoke field');
      expect(body.cropType).toBe('Rice');
      expect(body.season).toBe('Kharif');
      expect(body.geometry.type).toBe('Polygon');
      const ring = body.geometry.coordinates[0];
      const expectedRing = polygon.coordinates[0];
      expect(ring).toBeDefined();
      expect(expectedRing).toBeDefined();
      if (!ring || !expectedRing) throw new Error('unreachable');
      expect(ring).toHaveLength(expectedRing.length);
      // areaHectares is computed by the STORED generated column from
      // ST_Area(geometry::geography) / 10000. ~1 ha plot.
      expect(typeof body.areaHectares).toBe('number');
      createdAt = body.createdAt;
    });

    it('GET /api/fields → list contains the new row', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/fields',
        headers: { 'x-test-user-id': USER_A },
      });
      expect(res.statusCode).toBe(200);
      const { fields: list } = res.json() as { fields: Array<{ id: string }> };
      expect(list.some((f) => f.id === createdId)).toBe(true);
    });

    it('PATCH /api/fields/:id renames and bumps updatedAt', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/fields/${createdId}`,
        headers: { 'x-test-user-id': USER_A },
        payload: { name: 'Renamed field' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { name: string; updatedAt: string };
      expect(body.name).toBe('Renamed field');
      // Use >= rather than > because POST and PATCH happen in different
      // transactions but on extremely fast hardware their JSON-serialized
      // millisecond representations could conceivably be equal. The real
      // signal that the PATCH took effect is the renamed `name` above.
      expect(new Date(body.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(createdAt).getTime(),
      );
    });

    it('DELETE /api/fields/:id → 204, then GET → 404', async () => {
      const del = await app.inject({
        method: 'DELETE',
        url: `/api/fields/${createdId}`,
        headers: { 'x-test-user-id': USER_A },
      });
      expect(del.statusCode).toBe(204);

      const get = await app.inject({
        method: 'GET',
        url: `/api/fields/${createdId}`,
        headers: { 'x-test-user-id': USER_A },
      });
      expect(get.statusCode).toBe(404);
    });
  });

  describe('cross-user isolation: USER_B cannot touch USER_A rows', () => {
    let userAFieldId: string;

    beforeAll(async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/fields',
        headers: { 'x-test-user-id': USER_A },
        payload: {
          name: 'USER_A private',
          cropType: 'Wheat',
          season: 'Rabi',
          geometry: polygon,
        },
      });
      expect(res.statusCode).toBe(201);
      userAFieldId = (res.json() as { id: string }).id;
    });

    it('USER_B GET /:id → 404 (no id enumeration)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/fields/${userAFieldId}`,
        headers: { 'x-test-user-id': USER_B },
      });
      expect(res.statusCode).toBe(404);
    });

    it('USER_B PATCH /:id → 404', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/fields/${userAFieldId}`,
        headers: { 'x-test-user-id': USER_B },
        payload: { name: 'hijacked' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('USER_B DELETE /:id → 404', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/fields/${userAFieldId}`,
        headers: { 'x-test-user-id': USER_B },
      });
      expect(res.statusCode).toBe(404);
    });

    it("USER_B GET /api/fields → list does NOT include USER_A's row", async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/fields',
        headers: { 'x-test-user-id': USER_B },
      });
      expect(res.statusCode).toBe(200);
      const { fields: list } = res.json() as { fields: Array<{ id: string }> };
      expect(list.find((f) => f.id === userAFieldId)).toBeUndefined();
    });

    it("USER_A GET /:id → still 200 (USER_B's failed attempts didn't damage USER_A's row)", async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/fields/${userAFieldId}`,
        headers: { 'x-test-user-id': USER_A },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { name: string };
      expect(body.name).toBe('USER_A private');
    });

    it('POST with `userId` in the body is rejected by strictObject (no ownership spoofing)', async () => {
      // `createFieldDto` is a `z.strictObject` and the route always uses the
      // authenticated userId, never `body.userId`. Sending an extra key
      // proves the schema layer refuses ownership-spoofing attempts before
      // the row is ever inserted.
      const res = await app.inject({
        method: 'POST',
        url: '/api/fields',
        headers: { 'x-test-user-id': USER_B },
        payload: {
          name: 'spoofed',
          cropType: 'Rice',
          season: 'Kharif',
          userId: USER_A,
          geometry: polygon,
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
