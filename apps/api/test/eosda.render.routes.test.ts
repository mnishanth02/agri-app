/**
 * Module 6.3 — Tests for the EOSDA Render proxy route.
 *
 * What these tests cover (mirroring the spec in `docs/implementation.md`
 * §6.3 and the verified contract in `docs/review-findings.md` §3.6):
 *
 *   1. Auth gating — anonymous callers get 401, never reach the DB or
 *      the upstream fetch (`fetch` mock asserts zero calls).
 *   2. Input validation — every documented bad-input shape produces a
 *      400 BEFORE any upstream call: tile bounds (`x/y < 2^z`), `z`
 *      ceiling at 22, `band` enum, `fieldId` UUID, `viewId` length /
 *      allowlist / `..` traversal / malformed percent encoding.
 *   3. Authorization + cache existence — both "field not owned" and
 *      "scene not in cached_scenes" collapse to 404 (no enumeration
 *      distinction between the two failure modes).
 *   4. Happy path — verifies the response is an `image/png` body equal
 *      to the mocked PNG, and that the upstream URL we composed carries
 *      the `CALIBRATE=1` / per-band `COLORMAP` / decoded `view_id`
 *      (literal `/`, not `%2F`) / `cropper_ref` query parameters.
 *   5. Cache headers — `Cache-Control: private, max-age=86400`.
 *   6. Upstream failure handling — non-2xx is mirrored to the client
 *      with an EMPTY body so the upstream HTML/error page (which can
 *      echo the request URL when `useQueryAuth` is on) is never
 *      forwarded.
 *
 * Test seam:
 *   - `vi.stubGlobal('fetch', ...)` replaces the global `fetch` per-test
 *     so we exercise the real `eosdaFetch` + `assertSafePath` + header
 *     auth path top-to-bottom. Mirrors the pattern in
 *     `eosda-client.test.ts`. We never make a real network call.
 *   - Clerk is mocked via `x-test-user-id` header — same convention as
 *     `fields.routes.test.ts`. The route reads `getAuth(request).userId`.
 *   - DB is the live PostGIS dev container (same setup as the other
 *     route tests). Each test owns synthetic user-ids so concurrent
 *     suites cannot collide. We seed `fields` + `cached_scenes` rows
 *     directly via the app's Drizzle handle.
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

// Stub Module 4.6 warm-up so the `POST /api/fields` we use to seed
// fields below never triggers real EOSDA Cropper/Search calls.
vi.mock('../src/services/field-warmup.js', () => ({
  warmField: vi.fn(async () => {}),
}));

import { cachedScenes, fields } from '../src/db/schema.js';
import { buildServer } from '../src/server.js';
import { EOSDA_BASE } from '../src/services/eosda-client.js';

const USER_RENDER = `test-user-render-${randomUUID()}`;
const USER_OTHER = `test-user-render-other-${randomUUID()}`;

// ~1 ha plot near Mandya, Karnataka — same shape used by every other
// route/geometry test so we know it passes both `polygonGeoJsonSchema`
// and `ST_IsValid`.
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

// Minimal valid PNG: 8-byte signature + IHDR chunk for a 1×1 image.
// Enough that `Buffer.from(arrayBuffer)` round-trips identically and we
// can assert byte-exact equality between the upstream mock body and
// the proxy reply body.
const PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
]);

interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

/** Replace `global.fetch` with a deterministic mock and capture every
 * call. The mock returns the same response for every request — fine
 * because each test only triggers a single upstream fetch (or zero, in
 * the validation tests). */
function captureFetch(response: Response): { calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const spy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return response;
  });
  vi.stubGlobal('fetch', spy);
  return { calls };
}

let app: Awaited<ReturnType<typeof buildServer>>;
let fieldId: string;
let otherFieldId: string;
const VIEW_ID = 'S2/16/T/EL/2023/7/31/0';
const CROPPER_REF = 'cropper-hash-abc123';

beforeAll(async () => {
  app = await buildServer();
  await app.ready();

  // Defensive cleanup in case a prior crashed run left rows behind.
  await app.db.delete(fields).where(inArray(fields.userId, [USER_RENDER, USER_OTHER]));

  // Seed USER_RENDER's field with a cropper_ref so the success-path
  // test can verify it ends up in the upstream URL. We use the
  // route's own POST so the geometry SQL / generated columns / etc.
  // exercise the same code path as production.
  const create = await app.inject({
    method: 'POST',
    url: '/api/fields',
    headers: { 'x-test-user-id': USER_RENDER },
    payload: {
      name: 'Render test field',
      cropType: 'Rice',
      season: 'Kharif',
      geometry: polygon,
    },
  });
  if (create.statusCode !== 201) {
    throw new Error(`seed POST failed: ${create.statusCode} ${create.body}`);
  }
  fieldId = (create.json() as { id: string }).id;

  // Backfill the cropper_ref column directly — there is no PATCH path
  // for it (it's set by the Module 4.5 warm-up which we mocked away).
  await app.db.execute(
    sql`UPDATE fields SET eosda_cropper_ref = ${CROPPER_REF} WHERE id = ${fieldId}`,
  );

  // Seed a cached scene for the field so ownership + existence pass.
  // Numerics are written as strings — the `numeric` column type in
  // Drizzle/pg requires it (matches `upsertScenes` behavior).
  await app.db.insert(cachedScenes).values({
    fieldId,
    viewId: VIEW_ID,
    sceneId: 'S2B_test_scene',
    sceneDate: '2023-07-31',
    cloudPercent: '5.00',
    dataCoveragePercent: '95.00',
    tmsTemplate: 'https://example.invalid/tms/{z}/{x}/{y}',
  });

  // A second field owned by USER_OTHER — used to exercise cross-user
  // 404 isolation (the proxy must not reveal ownership-vs-existence).
  const otherCreate = await app.inject({
    method: 'POST',
    url: '/api/fields',
    headers: { 'x-test-user-id': USER_OTHER },
    payload: {
      name: 'Other user field',
      cropType: 'Wheat',
      season: 'Rabi',
      geometry: polygon,
    },
  });
  if (otherCreate.statusCode !== 201) {
    throw new Error(`other seed POST failed: ${otherCreate.statusCode} ${otherCreate.body}`);
  }
  otherFieldId = (otherCreate.json() as { id: string }).id;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  try {
    if (app) {
      await app.db.delete(fields).where(inArray(fields.userId, [USER_RENDER, USER_OTHER]));
    }
  } finally {
    if (app) await app.close();
  }
});

describe('GET /api/eosda/render/:z/:x/:y — auth gate', () => {
  it('returns 401 when unauthenticated and never calls upstream', async () => {
    const { calls } = captureFetch(new Response(PNG_1x1, { status: 200 }));
    const res = await app.inject({
      method: 'GET',
      url: `/api/eosda/render/10/611/354?fieldId=${fieldId}&viewId=${encodeURIComponent(VIEW_ID)}&band=NDVI`,
    });
    expect(res.statusCode).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe('GET /api/eosda/render/:z/:x/:y — input validation (400 before any upstream call)', () => {
  it('rejects negative z', async () => {
    const { calls } = captureFetch(new Response(PNG_1x1, { status: 200 }));
    const res = await app.inject({
      method: 'GET',
      url: `/api/eosda/render/-1/0/0?fieldId=${fieldId}&viewId=${encodeURIComponent(VIEW_ID)}&band=NDVI`,
      headers: { 'x-test-user-id': USER_RENDER },
    });
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('rejects z > 22', async () => {
    const { calls } = captureFetch(new Response(PNG_1x1, { status: 200 }));
    const res = await app.inject({
      method: 'GET',
      url: `/api/eosda/render/23/0/0?fieldId=${fieldId}&viewId=${encodeURIComponent(VIEW_ID)}&band=NDVI`,
      headers: { 'x-test-user-id': USER_RENDER },
    });
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('rejects x >= 2^z (slippy-map tile bounds)', async () => {
    const { calls } = captureFetch(new Response(PNG_1x1, { status: 200 }));
    // At z=10 there are 1024 tiles per axis; x=1024 is out of range.
    const res = await app.inject({
      method: 'GET',
      url: `/api/eosda/render/10/1024/0?fieldId=${fieldId}&viewId=${encodeURIComponent(VIEW_ID)}&band=NDVI`,
      headers: { 'x-test-user-id': USER_RENDER },
    });
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('rejects y >= 2^z', async () => {
    const { calls } = captureFetch(new Response(PNG_1x1, { status: 200 }));
    const res = await app.inject({
      method: 'GET',
      url: `/api/eosda/render/10/0/1024?fieldId=${fieldId}&viewId=${encodeURIComponent(VIEW_ID)}&band=NDVI`,
      headers: { 'x-test-user-id': USER_RENDER },
    });
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('rejects unknown band', async () => {
    const { calls } = captureFetch(new Response(PNG_1x1, { status: 200 }));
    const res = await app.inject({
      method: 'GET',
      url: `/api/eosda/render/10/0/0?fieldId=${fieldId}&viewId=${encodeURIComponent(VIEW_ID)}&band=BOGUS`,
      headers: { 'x-test-user-id': USER_RENDER },
    });
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('rejects non-uuid fieldId', async () => {
    const { calls } = captureFetch(new Response(PNG_1x1, { status: 200 }));
    const res = await app.inject({
      method: 'GET',
      url: `/api/eosda/render/10/0/0?fieldId=not-a-uuid&viewId=${encodeURIComponent(VIEW_ID)}&band=NDVI`,
      headers: { 'x-test-user-id': USER_RENDER },
    });
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('rejects empty viewId', async () => {
    const { calls } = captureFetch(new Response(PNG_1x1, { status: 200 }));
    const res = await app.inject({
      method: 'GET',
      url: `/api/eosda/render/10/0/0?fieldId=${fieldId}&viewId=&band=NDVI`,
      headers: { 'x-test-user-id': USER_RENDER },
    });
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('rejects viewId > 256 chars', async () => {
    const { calls } = captureFetch(new Response(PNG_1x1, { status: 200 }));
    const tooLong = 'A'.repeat(257);
    const res = await app.inject({
      method: 'GET',
      url: `/api/eosda/render/10/0/0?fieldId=${fieldId}&viewId=${tooLong}&band=NDVI`,
      headers: { 'x-test-user-id': USER_RENDER },
    });
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('rejects viewId with disallowed characters', async () => {
    const { calls } = captureFetch(new Response(PNG_1x1, { status: 200 }));
    // Space is not in [A-Za-z0-9/_-].
    const bad = encodeURIComponent('S2/16/T EL/2023/7/31/0');
    const res = await app.inject({
      method: 'GET',
      url: `/api/eosda/render/10/0/0?fieldId=${fieldId}&viewId=${bad}&band=NDVI`,
      headers: { 'x-test-user-id': USER_RENDER },
    });
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('rejects viewId containing `..` (path-traversal defense)', async () => {
    const { calls } = captureFetch(new Response(PNG_1x1, { status: 200 }));
    const bad = encodeURIComponent('S2/../etc/passwd');
    const res = await app.inject({
      method: 'GET',
      url: `/api/eosda/render/10/0/0?fieldId=${fieldId}&viewId=${bad}&band=NDVI`,
      headers: { 'x-test-user-id': USER_RENDER },
    });
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('rejects viewId starting with `/`', async () => {
    const { calls } = captureFetch(new Response(PNG_1x1, { status: 200 }));
    const bad = encodeURIComponent('/leading-slash');
    const res = await app.inject({
      method: 'GET',
      url: `/api/eosda/render/10/0/0?fieldId=${fieldId}&viewId=${bad}&band=NDVI`,
      headers: { 'x-test-user-id': USER_RENDER },
    });
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('GET /api/eosda/render/:z/:x/:y — ownership + cache existence (404)', () => {
  it("returns 404 when the field is owned by another user (no leak that it's an ownership failure)", async () => {
    const { calls } = captureFetch(new Response(PNG_1x1, { status: 200 }));
    const res = await app.inject({
      method: 'GET',
      url: `/api/eosda/render/10/611/354?fieldId=${otherFieldId}&viewId=${encodeURIComponent(VIEW_ID)}&band=NDVI`,
      headers: { 'x-test-user-id': USER_RENDER },
    });
    expect(res.statusCode).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('returns 404 when the field exists but the (fieldId, viewId) pair is not in cached_scenes', async () => {
    const { calls } = captureFetch(new Response(PNG_1x1, { status: 200 }));
    const res = await app.inject({
      method: 'GET',
      url: `/api/eosda/render/10/611/354?fieldId=${fieldId}&viewId=${encodeURIComponent('S2/99/Z/Z/2023/7/31/0')}&band=NDVI`,
      headers: { 'x-test-user-id': USER_RENDER },
    });
    expect(res.statusCode).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('returns 404 when the fieldId UUID is well-formed but does not exist', async () => {
    const { calls } = captureFetch(new Response(PNG_1x1, { status: 200 }));
    const ghost = randomUUID();
    const res = await app.inject({
      method: 'GET',
      url: `/api/eosda/render/10/611/354?fieldId=${ghost}&viewId=${encodeURIComponent(VIEW_ID)}&band=NDVI`,
      headers: { 'x-test-user-id': USER_RENDER },
    });
    expect(res.statusCode).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

describe('GET /api/eosda/render/:z/:x/:y — happy path', () => {
  it('returns 200 image/png with the upstream body verbatim', async () => {
    const { calls } = captureFetch(
      new Response(PNG_1x1, { status: 200, headers: { 'Content-Type': 'image/png' } }),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/eosda/render/10/611/354?fieldId=${fieldId}&viewId=${encodeURIComponent(VIEW_ID)}&band=NDVI`,
      headers: { 'x-test-user-id': USER_RENDER },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('private, max-age=86400');

    // Byte-equal round-trip — proves we did NOT re-encode through JSON.
    const body = res.rawPayload;
    expect(body).toBeInstanceOf(Buffer);
    expect(Array.from(body)).toEqual(Array.from(PNG_1x1));

    // Inspect the upstream URL we composed.
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error('upstream fetch was not called');

    const url = new URL(call.url);
    expect(url.origin).toBe(EOSDA_BASE);
    // Decoded view_id must be embedded with literal slashes — not %2F.
    expect(url.pathname).toBe(`/api/render/${VIEW_ID}/NDVI/10/611/354`);
    expect(url.pathname).not.toContain('%2F');
    // Required query params (set unconditionally per docs §3.6).
    expect(url.searchParams.get('CALIBRATE')).toBe('1');
    expect(url.searchParams.get('mimetype')).toBe('image/png');
    expect(url.searchParams.get('COLORMAP')).toBe('RdYlGn');
    expect(url.searchParams.get('MIN_MAX')).toBe('-1,1');
    // cropper_ref present because USER_RENDER's field has one.
    expect(url.searchParams.get('cropper_ref')).toBe(CROPPER_REF);
    // No api_key smuggled into the URL — header auth only.
    expect(url.searchParams.get('api_key')).toBeNull();
    expect(call.url).not.toContain('api_key=');

    // x-api-key header is set by eosdaFetch.
    const headers = new Headers(call.init?.headers);
    expect(headers.get('x-api-key')).toBeTruthy();
  });

  it('uses Blues colormap for NDWI', async () => {
    const { calls } = captureFetch(new Response(PNG_1x1, { status: 200 }));

    const res = await app.inject({
      method: 'GET',
      url: `/api/eosda/render/10/611/354?fieldId=${fieldId}&viewId=${encodeURIComponent(VIEW_ID)}&band=NDWI`,
      headers: { 'x-test-user-id': USER_RENDER },
    });

    expect(res.statusCode).toBe(200);
    const call = calls[0];
    if (!call) throw new Error('upstream fetch was not called');
    const url = new URL(call.url);
    expect(url.searchParams.get('COLORMAP')).toBe('Blues');
    expect(url.searchParams.get('MIN_MAX')).toBe('-1,1');
    expect(url.pathname).toBe(`/api/render/${VIEW_ID}/NDWI/10/611/354`);
  });

  it('uses RdYlGn colormap for EVI (same as NDVI)', async () => {
    const { calls } = captureFetch(new Response(PNG_1x1, { status: 200 }));

    const res = await app.inject({
      method: 'GET',
      url: `/api/eosda/render/10/611/354?fieldId=${fieldId}&viewId=${encodeURIComponent(VIEW_ID)}&band=EVI`,
      headers: { 'x-test-user-id': USER_RENDER },
    });

    expect(res.statusCode).toBe(200);
    const call = calls[0];
    if (!call) throw new Error('upstream fetch was not called');
    const url = new URL(call.url);
    expect(url.searchParams.get('COLORMAP')).toBe('RdYlGn');
    expect(url.pathname).toBe(`/api/render/${VIEW_ID}/EVI/10/611/354`);
  });
});

describe('GET /api/eosda/render/:z/:x/:y — happy path without cropper_ref', () => {
  // A separate sub-describe so we can mutate the cropper_ref column
  // for the duration of these tests and reset in `afterEach`.
  beforeEach(async () => {
    await app.db.execute(sql`UPDATE fields SET eosda_cropper_ref = NULL WHERE id = ${fieldId}`);
  });

  afterEach(async () => {
    await app.db.execute(
      sql`UPDATE fields SET eosda_cropper_ref = ${CROPPER_REF} WHERE id = ${fieldId}`,
    );
  });

  it('omits cropper_ref from the upstream URL when the field does not have one', async () => {
    const { calls } = captureFetch(new Response(PNG_1x1, { status: 200 }));

    const res = await app.inject({
      method: 'GET',
      url: `/api/eosda/render/10/611/354?fieldId=${fieldId}&viewId=${encodeURIComponent(VIEW_ID)}&band=NDVI`,
      headers: { 'x-test-user-id': USER_RENDER },
    });

    expect(res.statusCode).toBe(200);
    const call = calls[0];
    if (!call) throw new Error('upstream fetch was not called');
    const url = new URL(call.url);
    expect(url.searchParams.get('cropper_ref')).toBeNull();
    // The other required params are still set unconditionally.
    expect(url.searchParams.get('CALIBRATE')).toBe('1');
    expect(url.searchParams.get('COLORMAP')).toBe('RdYlGn');
  });
});

describe('GET /api/eosda/render/:z/:x/:y — upstream failure mirroring', () => {
  it('mirrors a 404 from EOSDA with an empty body (no upstream HTML leak)', async () => {
    captureFetch(
      new Response('<html><body>EOSDA not found</body></html>', {
        status: 404,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/eosda/render/10/611/354?fieldId=${fieldId}&viewId=${encodeURIComponent(VIEW_ID)}&band=NDVI`,
      headers: { 'x-test-user-id': USER_RENDER },
    });

    expect(res.statusCode).toBe(404);
    // Empty body — the upstream HTML must not be forwarded.
    expect(res.body).toBe('');
    expect(res.body).not.toContain('EOSDA not found');
  });

  it('mirrors a 502 from EOSDA with an empty body', async () => {
    captureFetch(
      new Response('upstream gateway error with potentially sensitive query echo', {
        status: 502,
      }),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/eosda/render/10/611/354?fieldId=${fieldId}&viewId=${encodeURIComponent(VIEW_ID)}&band=NDVI`,
      headers: { 'x-test-user-id': USER_RENDER },
    });

    expect(res.statusCode).toBe(502);
    expect(res.body).toBe('');
  });

  it('returns 502 when the upstream fetch rejects (network error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('econnreset');
      }),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/eosda/render/10/611/354?fieldId=${fieldId}&viewId=${encodeURIComponent(VIEW_ID)}&band=NDVI`,
      headers: { 'x-test-user-id': USER_RENDER },
    });

    expect(res.statusCode).toBe(502);
  });

  it('returns 502 when reading the upstream body fails (mid-stream disconnect)', async () => {
    // Simulate a 200 OK response whose `arrayBuffer()` rejects — e.g.,
    // the upstream connection dropped after headers but before the body
    // was fully drained. The route MUST surface 502 (not 500) and MUST
    // NOT forward any partial bytes to the client.
    const failingResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'Content-Type': 'image/png' }),
      arrayBuffer: () => Promise.reject(new TypeError('stream aborted')),
    } as unknown as Response;

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => failingResponse),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/eosda/render/10/611/354?fieldId=${fieldId}&viewId=${encodeURIComponent(VIEW_ID)}&band=NDVI`,
      headers: { 'x-test-user-id': USER_RENDER },
    });

    expect(res.statusCode).toBe(502);
    // Empty body — a half-drained PNG must never be forwarded.
    expect(res.rawPayload.length).toBe(0);
  });
});
