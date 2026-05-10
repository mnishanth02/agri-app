/**
 * Module 4.6 — Tests for the `warmField` wire-up in `POST /api/fields`.
 *
 * Done-when contract from `docs/implementation.md` §4.6:
 *   - After insert returns the new id, `warmField(id, …)` is invoked
 *     fire-and-forget so the route reply is never blocked on EOSDA.
 *   - Any rejection that escapes `warmField`'s internal handlers
 *     (per §4.5: `loadField` / `upsertScenes`) is caught by the
 *     route-level `.catch(...)` and logged with `{ err, fieldId }`.
 *     It must never become a Node `unhandledRejection`.
 *
 * Test design:
 *   - `warmField` is mocked at the module boundary so we never touch
 *     real EOSDA. Each test reconfigures the mock per scenario:
 *     immediate resolve, never resolve, immediate reject.
 *   - Clerk is mocked the same way as `fields.routes.test.ts` — the
 *     `x-test-user-id` header impersonates an authed user.
 *   - The dev PostGIS container is the real DB. Every test uses a
 *     unique synthetic user-id so rows don't collide; `afterAll`
 *     cleans up.
 *   - Latency assertion uses real wall-clock (`Date.now()` deltas)
 *     against `app.inject`. No fake timers — fake timers would hide
 *     a regression where the real microtask flush blocked the reply.
 */

import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
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

// Replace the M4.5 orchestrator with a controllable spy. Each test sets
// the implementation it needs via `vi.mocked(warmField).mockImplementation(...)`.
vi.mock('../src/services/field-warmup.js', () => ({
  warmField: vi.fn(async () => {}),
}));

import { fields } from '../src/db/schema.js';
import { buildServer } from '../src/server.js';
import { warmField } from '../src/services/field-warmup.js';

const USER_ID = `test-user-m46-${randomUUID()}`;

// ~1 ha plot near Mandya, Karnataka — same shape used by `geometry.test.ts`
// and `fields.routes.test.ts`. Comfortably inside the India bbox refinement
// enforced by `polygonGeoJsonSchema`.
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

// A self-intersecting (bowtie) ring inside the India bbox: the two diagonal
// edges cross. `polygonGeoJsonSchema` does NOT check `ST_IsValid` (see the
// JSDoc on `polygonGeoJsonSchema` in `packages/shared/src/common.ts`), so
// this body passes zod validation and is rejected only by the PostGIS
// `fields_geometry_valid` CHECK constraint (SQLSTATE 23514) inside the
// route's try/catch. That is the exact path Module 1.4 wires up to a 400.
const selfIntersectingPolygon = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [76.9, 12.5],
      [76.9009, 12.5009],
      [76.9009, 12.5],
      [76.9, 12.5009],
      [76.9, 12.5],
    ],
  ],
};

let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  await app.db.delete(fields).where(inArray(fields.userId, [USER_ID]));
});

afterAll(async () => {
  try {
    if (app) {
      await app.db.delete(fields).where(inArray(fields.userId, [USER_ID]));
    }
  } finally {
    if (app) await app.close();
  }
});

beforeEach(() => {
  vi.mocked(warmField).mockReset();
  // Default to immediate resolve so any test that doesn't reconfigure
  // gets a quiet, non-throwing warm-up.
  vi.mocked(warmField).mockImplementation(async () => {});
});

afterEach(() => {
  vi.mocked(warmField).mockReset();
});

async function createField(payloadOverride?: Partial<{ name: string; geometry: unknown }>) {
  return app.inject({
    method: 'POST',
    url: '/api/fields',
    headers: { 'x-test-user-id': USER_ID },
    payload: {
      name: payloadOverride?.name ?? 'Warm-up wiring field',
      cropType: 'Rice',
      season: 'Kharif',
      geometry: payloadOverride?.geometry ?? polygon,
    },
  });
}

describe('POST /api/fields — Module 4.6 warmField wire-up', () => {
  it('invokes warmField with the new field id, app.db, and request.log', async () => {
    const res = await createField();

    expect(res.statusCode).toBe(201);
    const { id } = res.json() as { id: string };

    expect(warmField).toHaveBeenCalledTimes(1);
    const [calledFieldId, calledOpts] = vi.mocked(warmField).mock.calls[0] ?? [];
    expect(calledFieldId).toBe(id);
    expect(calledOpts).toBeDefined();
    // Per the M4.5 contract we forward both `db` and `log` so warm-up uses
    // the same per-app pg.Pool as the route (test-pool isolation) and the
    // request-correlated pino child logger (so warm-up log lines carry the
    // originating reqId).
    expect(calledOpts?.db).toBeDefined();
    expect(typeof calledOpts?.db?.select).toBe('function');
    expect(calledOpts?.log).toBeDefined();
    expect(typeof calledOpts?.log?.error).toBe('function');
    expect(typeof calledOpts?.log?.info).toBe('function');
    expect(typeof calledOpts?.log?.warn).toBe('function');
  });

  it('returns 201 within the latency bound while warmField never resolves', async () => {
    // A promise that never settles — proves the response path is genuinely
    // not awaiting warm-up. No timer is scheduled, so the test process can
    // still exit cleanly even though this promise is forever pending.
    vi.mocked(warmField).mockImplementation(() => new Promise<void>(() => {}));

    const start = Date.now();
    const res = await createField({ name: 'Non-blocking field' });
    const elapsedMs = Date.now() - start;

    expect(res.statusCode).toBe(201);
    expect(warmField).toHaveBeenCalledTimes(1);
    // Spec target is ~100 ms. Allow 500 ms headroom for the real PostGIS
    // INSERT round-trip on the dev container under load. If this assertion
    // ever starts flaking, investigate whether warm-up is accidentally
    // being awaited rather than relaxing the bound.
    expect(elapsedMs).toBeLessThan(500);
  });

  it('a rejected warmField is caught by the route, never reaches unhandledRejection', async () => {
    const unhandledSpy = vi.fn();
    process.on('unhandledRejection', unhandledSpy);

    const boom = new Error('warmField boom');
    let capturedLog: { error: (...args: unknown[]) => void } | undefined;
    vi.mocked(warmField).mockImplementation(async (_id, opts) => {
      // The route passes `request.log` here AND uses the same `request.log`
      // inside its `.catch(...)`. Spying on `.error` of this object lets us
      // verify the catch handler ran with the structured payload.
      capturedLog = opts?.log as typeof capturedLog;
      if (capturedLog) vi.spyOn(capturedLog, 'error');
      throw boom;
    });

    try {
      const res = await createField({ name: 'Rejecting warmField field' });

      expect(res.statusCode).toBe(201);
      const { id } = res.json() as { id: string };

      // Drain microtasks + a macrotask tick so the promise rejection has
      // had every chance to surface to the unhandledRejection handler if
      // the `.catch(...)` were missing.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      await Promise.resolve();

      expect(unhandledSpy).not.toHaveBeenCalled();

      // The route's `.catch(...)` logs the failure on `request.log` with
      // the same `{ err, fieldId }` payload required by the §4.6 spec.
      expect(capturedLog).toBeDefined();
      expect(capturedLog?.error).toHaveBeenCalledTimes(1);
      expect(capturedLog?.error).toHaveBeenCalledWith({ err: boom, fieldId: id }, 'warm failed');
    } finally {
      process.off('unhandledRejection', unhandledSpy);
    }
  });

  it('does not call warmField when the insert is rejected by the geometry CHECK (400)', async () => {
    // Self-intersecting polygon → PostGIS `fields_geometry_valid` CHECK
    // throws `pg.DatabaseError` with code 23514, which the route maps to
    // a 400. The `void warmField(...)` call is placed AFTER both the
    // `try/catch` mapping AND the "insert returned no row" guard, so it
    // must not fire on the failure path.
    const res = await createField({
      name: 'Bowtie field',
      geometry: selfIntersectingPolygon,
    });

    expect(res.statusCode).toBe(400);
    expect(warmField).not.toHaveBeenCalled();
  });
});
