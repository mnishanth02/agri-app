/**
 * Module 4.5 — Tests for the `field-warmup` orchestrator.
 *
 * Done-when contract from `docs/implementation.md` §4.5:
 *   - Calling `warmField(id)` populates the newest available row in
 *     `cached_scenes` when EOSDA has data for the polygon.
 *   - Populates `eosda_cropper_ref` from a successful Cropper POST.
 *   - If either upstream call fails, the failure is logged with
 *     `{ fieldId }` and warm-up exits cleanly without throwing.
 *
 * Test design — hybrid mock:
 *   - Fetch is mocked (`vi.spyOn(globalThis, 'fetch')`) and routed by
 *     URL substring so we can replay arbitrary EOSDA responses without
 *     hitting the live API. Same approach as `eosda-cropper.test.ts`.
 *   - The DB is real (PostGIS, the same dev container `scene-cache.test.ts`
 *     uses): the orchestrator's job is to wire Cropper/Search/Cache
 *     together, and the only meaningful verification of "cached_scenes
 *     ended up with the right row" is to read it back from PostgreSQL.
 *     Mocking Drizzle would just assert we built the call we built.
 *   - Each test seeds its own `fields` row under a unique `user_id` so
 *     concurrent tests can't collide; `ON DELETE CASCADE` on
 *     `cached_scenes.field_id` cleans up scene rows in the same teardown.
 *
 * Cropper-throw injection: the production code in
 * `services/eosda-cropper.ts` swallows every error to `null`, so we
 * can't make it throw via fetch. We use `vi.mock('./eosda-cropper.js', …)`
 * with `vi.fn(actual.getOrCreateCropperRef)` so the function defaults to
 * the real implementation but can be overridden per-test with
 * `mockRejectedValueOnce(…)` to exercise the defensive
 * fire-and-forget `.catch(...)` branch.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { type Db, pool } from '../db/client.js';
import { geometryFromGeoJson } from '../db/geometry.js';
import { fields } from '../db/schema.js';
import { getOrCreateCropperRef } from './eosda-cropper.js';
import {
  DEFAULT_FALLBACK_WINDOWS_DAYS,
  DEFAULT_INITIAL_WINDOW_DAYS,
  dateRangeForWindow,
  toIsoDate,
  warmField,
} from './field-warmup.js';

// vi.mock is hoisted; spread `actual` so every other export resolves
// to the real value, then wrap `getOrCreateCropperRef` so tests can
// override it per-call. The default behaviour is still the real impl.
vi.mock('./eosda-cropper.js', async () => {
  const actual = await vi.importActual<typeof import('./eosda-cropper.js')>('./eosda-cropper.js');
  return {
    ...actual,
    getOrCreateCropperRef: vi.fn(actual.getOrCreateCropperRef),
  };
});

afterAll(async () => {
  await pool.end();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(getOrCreateCropperRef).mockImplementation(async (field, options) => {
    // After restoreAllMocks (which does NOT reset vi.mock implementations
    // but does clear `mockRejectedValueOnce`), reinstate the real impl as
    // the default for the next test.
    const actual = await vi.importActual<typeof import('./eosda-cropper.js')>('./eosda-cropper.js');
    return actual.getOrCreateCropperRef(field, options);
  });
});

// Same ~1 ha plot near Mandya used by scene-cache.test.ts /
// fields.routes.test.ts; comfortably inside the India bbox refinement
// (`[68, 6, 98, 38]`) used by `polygonGeoJsonSchema`.
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

const VALID_HASH = '3eb51ea04776e6ae6bb665504e3c5ffb';

interface SearchScene {
  sceneID: string;
  view_id: string;
  date: string;
  cloudCoverage: number;
  dataCoveragePercentage: number;
  tms: string;
}

function makeSearchScene(overrides: Partial<SearchScene> = {}): SearchScene {
  return {
    sceneID: 'S2B_warmup_default',
    view_id: 'S2B/MSI/L2A/2026/05/01/T43PFR/0/B04',
    date: '2026-05-01',
    cloudCoverage: 12.5,
    dataCoveragePercentage: 99.42,
    tms: 'https://render.eosda.com/tile/S2B_warmup_default/{z}/{x}/{y}.png',
    ...overrides,
  };
}

interface ResponseConfig {
  status?: number;
  body: unknown;
  /** When set, fetch rejects with this error instead of resolving. */
  reject?: unknown;
}

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
  body: unknown;
}

function makeJsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Install a fetch mock that routes calls by URL substring to either the
 * Cropper or Search EOSDA endpoint. `searchResponses` is consumed in
 * order — request N gets `searchResponses[N]`. If a request goes past
 * the array, the test fails loudly (rather than silently re-using the
 * last response).
 */
function mockFetch(opts: { cropper?: ResponseConfig; searchResponses: ResponseConfig[] }): {
  cropperCalls: FetchCall[];
  searchCalls: FetchCall[];
  spy: ReturnType<typeof vi.fn>;
} {
  const cropperCalls: FetchCall[] = [];
  const searchCalls: FetchCall[] = [];
  let searchIdx = 0;

  const handler = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const bodyStr = init?.body == null ? null : String(init.body);
    const parsedBody = bodyStr ? JSON.parse(bodyStr) : null;

    if (url.includes('/api/render/cropper/')) {
      cropperCalls.push({ url, init, body: parsedBody });
      const cfg = opts.cropper ?? { status: 200, body: { cropper_ref: VALID_HASH } };
      if (cfg.reject) throw cfg.reject;
      return makeJsonResponse(cfg.status ?? 200, cfg.body);
    }
    if (url.includes('/api/lms/search/v2/sentinel2')) {
      searchCalls.push({ url, init, body: parsedBody });
      const cfg = opts.searchResponses[searchIdx++];
      if (!cfg) {
        throw new Error(
          `mockFetch: search request #${searchIdx} unexpectedly issued (no response configured)`,
        );
      }
      if (cfg.reject) throw cfg.reject;
      return makeJsonResponse(cfg.status ?? 200, cfg.body);
    }
    throw new Error(`mockFetch: unexpected URL ${url}`);
  });

  vi.spyOn(globalThis, 'fetch').mockImplementation(handler as unknown as typeof globalThis.fetch);
  return { cropperCalls, searchCalls, spy: handler };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/**
 * Seed a `fields` row using a pinned connection (mirrors
 * `scene-cache.test.ts` setup). Returns the field id, a Drizzle handle
 * tied to the same connection, and a teardown closure that cascades
 * the delete and releases the connection.
 */
async function seedField(opts: { withCropperRef?: string | null } = {}): Promise<{
  fieldId: string;
  db: Db;
  cleanup: () => Promise<void>;
}> {
  const client = await pool.connect();
  const db: Db = drizzle(client);
  const userId = `test-warmup-${randomUUID()}`;
  const inserted = await db
    .insert(fields)
    .values({
      userId,
      name: 'Warmup test field',
      cropType: 'wheat',
      season: 'rabi-2025-26',
      geometry: geometryFromGeoJson(POLYGON),
      ...(opts.withCropperRef !== undefined ? { eosdaCropperRef: opts.withCropperRef } : {}),
    })
    .returning({ id: fields.id });
  const row = inserted[0];
  if (!row) throw new Error('seed insert returned no row');

  return {
    fieldId: row.id,
    db,
    cleanup: async () => {
      try {
        await client.query('DELETE FROM fields WHERE id = $1', [row.id]);
      } finally {
        client.release();
      }
    },
  };
}

async function readCachedScenes(
  db: Db,
  fieldId: string,
): Promise<
  {
    scene_id: string;
    view_id: string;
    scene_date: string;
    cloud_percent: string;
    data_coverage_percent: string;
    tms_template: string;
  }[]
> {
  const result = await db.execute<{
    scene_id: string;
    view_id: string;
    scene_date: string;
    cloud_percent: string;
    data_coverage_percent: string;
    tms_template: string;
  }>(
    sql`SELECT scene_id, view_id, scene_date::text AS scene_date,
               cloud_percent::text AS cloud_percent,
               data_coverage_percent::text AS data_coverage_percent,
               tms_template
        FROM cached_scenes WHERE field_id = ${fieldId}`,
  );
  return [...result.rows];
}

async function readCropperRef(db: Db, fieldId: string): Promise<string | null> {
  const result = await db.execute<{ eosda_cropper_ref: string | null }>(
    sql`SELECT eosda_cropper_ref FROM fields WHERE id = ${fieldId}`,
  );
  return result.rows[0]?.eosda_cropper_ref ?? null;
}

describe('warmField — date helpers', () => {
  it('toIsoDate returns UTC YYYY-MM-DD regardless of host timezone', () => {
    // 2026-05-10T00:30:00Z is 2026-05-10 in UTC even if the host TZ is
    // ahead/behind. The slice never depends on local-tz formatting.
    expect(toIsoDate(new Date('2026-05-10T00:30:00Z'))).toBe('2026-05-10');
    expect(toIsoDate(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12-31');
    expect(toIsoDate(new Date('2027-01-01T00:00:00Z'))).toBe('2027-01-01');
  });

  it('dateRangeForWindow subtracts days in UTC milliseconds', () => {
    const now = new Date('2026-05-10T12:00:00Z');
    expect(dateRangeForWindow(now, 90)).toEqual({ from: '2026-02-09', to: '2026-05-10' });
    expect(dateRangeForWindow(now, 180)).toEqual({ from: '2025-11-11', to: '2026-05-10' });
    expect(dateRangeForWindow(now, 365)).toEqual({ from: '2025-05-10', to: '2026-05-10' });
  });
});

describe('warmField — field not found', () => {
  it('logs warn { fieldId } and returns without writing scenes', async () => {
    const { cropperCalls, searchCalls } = mockFetch({ searchResponses: [] });
    const log = makeLogger();
    // Use a freshly-generated UUID that no row will match.
    const orphanId = randomUUID();

    await expect(warmField(orphanId, { log })).resolves.toBeUndefined();

    expect(cropperCalls).toHaveLength(0);
    expect(searchCalls).toHaveLength(0);
    expect(log.warn).toHaveBeenCalledWith({ fieldId: orphanId }, 'warm-up: field not found');
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe('warmField — happy path (cropper + search)', () => {
  it('persists cropper_ref and the latest scene from the 90-day window', async () => {
    const { fieldId, db, cleanup } = await seedField({ withCropperRef: null });
    try {
      const scene = makeSearchScene({
        sceneID: 'S2B_happy',
        view_id: 'view/happy/01',
        date: '2026-05-01',
        cloudCoverage: 8.25,
        dataCoveragePercentage: 95.5,
      });
      const { cropperCalls, searchCalls } = mockFetch({
        cropper: { status: 200, body: { cropper_ref: VALID_HASH } },
        searchResponses: [{ status: 200, body: { results: [scene] } }],
      });
      const log = makeLogger();

      await warmField(fieldId, { db, log });

      await vi.waitFor(() => expect(cropperCalls).toHaveLength(1));
      // Only one Search call — the 90-day window returned a hit, so no
      // fallback expansion.
      expect(searchCalls).toHaveLength(1);

      await vi.waitFor(async () => {
        expect(await readCropperRef(db, fieldId)).toBe(VALID_HASH);
      });
      const rows = await readCachedScenes(db, fieldId);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      if (!row) throw new Error('unreachable');
      expect(row.scene_id).toBe('S2B_happy');
      expect(row.view_id).toBe('view/happy/01');
      expect(row.scene_date).toBe('2026-05-01');
      expect(Number(row.cloud_percent)).toBeCloseTo(8.25, 2);
      expect(Number(row.data_coverage_percent)).toBeCloseTo(95.5, 2);

      expect(log.error).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });
});

describe('warmField — fallback windows', () => {
  it('widens to 180 days when 90 days returns []; caches the scene from the 180-day window', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      const scene = makeSearchScene({
        sceneID: 'S2B_180',
        view_id: 'view/180/01',
        date: '2026-01-15',
      });
      const { searchCalls } = mockFetch({
        searchResponses: [
          { status: 200, body: { results: [] } },
          { status: 200, body: { results: [scene] } },
        ],
      });
      const log = makeLogger();

      await warmField(fieldId, { db, log });

      expect(searchCalls).toHaveLength(2);
      const rows = await readCachedScenes(db, fieldId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.scene_id).toBe('S2B_180');
      expect(log.error).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });

  it('logs info and skips upsert when all three windows return []', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      const { cropperCalls, searchCalls } = mockFetch({
        searchResponses: [
          { status: 200, body: { results: [] } },
          { status: 200, body: { results: [] } },
          { status: 200, body: { results: [] } },
        ],
      });
      const log = makeLogger();

      await warmField(fieldId, { db, log });

      await vi.waitFor(() => expect(cropperCalls).toHaveLength(1));
      expect(searchCalls).toHaveLength(3);
      // Cropper still persisted.
      await vi.waitFor(async () => {
        expect(await readCropperRef(db, fieldId)).toBe(VALID_HASH);
      });
      // No scenes cached.
      const rows = await readCachedScenes(db, fieldId);
      expect(rows).toHaveLength(0);
      // Info log emitted exactly once for the no-coverage path.
      const noCoverageCall = log.info.mock.calls.find(
        ([, msg]) => msg === 'warm-up: no scenes found in any fallback window',
      );
      expect(noCoverageCall?.[0]).toEqual({ fieldId });
      expect(log.error).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });
});

describe('warmField — search failure', () => {
  it('logs error { fieldId, err } and returns cleanly when search throws (transport)', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      const transportErr = new TypeError('socket hang up');
      const { cropperCalls, searchCalls } = mockFetch({
        searchResponses: [{ body: null, reject: transportErr }],
      });
      const log = makeLogger();

      await expect(warmField(fieldId, { db, log })).resolves.toBeUndefined();

      // Cropper was attempted and persisted independently of Search failure.
      await vi.waitFor(() => expect(cropperCalls).toHaveLength(1));
      await vi.waitFor(async () => {
        expect(await readCropperRef(db, fieldId)).toBe(VALID_HASH);
      });
      // Exactly one search call — no fallback expansion on a thrown error.
      expect(searchCalls).toHaveLength(1);
      // No scenes cached.
      expect(await readCachedScenes(db, fieldId)).toHaveLength(0);

      const searchFailCall = log.error.mock.calls.find(
        ([, msg]) => msg === 'warm-up: search failed',
      );
      if (!searchFailCall) throw new Error('search-failed error log was not emitted');
      const [payload] = searchFailCall;
      expect(payload).toMatchObject({ fieldId, err: transportErr });
    } finally {
      await cleanup();
    }
  });

  it('logs error { fieldId, err } and returns cleanly when search returns non-2xx', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      const { searchCalls } = mockFetch({
        searchResponses: [{ status: 503, body: 'service unavailable' }],
      });
      const log = makeLogger();

      await expect(warmField(fieldId, { db, log })).resolves.toBeUndefined();

      expect(searchCalls).toHaveLength(1);
      expect(await readCachedScenes(db, fieldId)).toHaveLength(0);
      const searchFailCall = log.error.mock.calls.find(
        ([, msg]) => msg === 'warm-up: search failed',
      );
      expect(searchFailCall).toBeDefined();
    } finally {
      await cleanup();
    }
  });
});

describe('warmField — cropper failure (internal swallow)', () => {
  it('still upserts the scene when cropper internally returns null on a 500', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      const scene = makeSearchScene({ sceneID: 'S2B_no_cropper', view_id: 'view/no-cropper/01' });
      const { cropperCalls, searchCalls } = mockFetch({
        cropper: { status: 500, body: 'boom' },
        searchResponses: [{ status: 200, body: { results: [scene] } }],
      });
      const log = makeLogger();

      await warmField(fieldId, { db, log });

      await vi.waitFor(() => expect(cropperCalls).toHaveLength(1));
      expect(searchCalls).toHaveLength(1);
      // Cropper write never happened — column stays NULL.
      await vi.waitFor(async () => {
        expect(await readCropperRef(db, fieldId)).toBeNull();
      });
      // Scene was still upserted.
      const rows = await readCachedScenes(db, fieldId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.scene_id).toBe('S2B_no_cropper');
      // The defensive "rejected unexpectedly" log is NOT emitted (cropper
      // resolved with null, it didn't reject).
      const defensive = log.error.mock.calls.find(
        ([, msg]) => msg === 'warm-up: cropper rejected unexpectedly',
      );
      expect(defensive).toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});

describe('warmField — existing cropper ref', () => {
  it('skips the cropper POST when field already has eosda_cropper_ref set', async () => {
    const { fieldId, db, cleanup } = await seedField({ withCropperRef: VALID_HASH });
    try {
      const scene = makeSearchScene({ view_id: 'view/existing/01' });
      const { cropperCalls, searchCalls } = mockFetch({
        searchResponses: [{ status: 200, body: { results: [scene] } }],
      });
      const log = makeLogger();

      await warmField(fieldId, { db, log });

      // No cropper fetch at all — `getOrCreateCropperRef` short-circuits.
      expect(cropperCalls).toHaveLength(0);
      expect(searchCalls).toHaveLength(1);
      // Existing ref preserved.
      expect(await readCropperRef(db, fieldId)).toBe(VALID_HASH);
      // Scene still cached.
      expect(await readCachedScenes(db, fieldId)).toHaveLength(1);
      expect(log.error).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });
});

describe('warmField — defensive cropper rejection branch', () => {
  it('logs error { fieldId, err } when cropper unexpectedly rejects, and still upserts the scene', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      const cropperErr = new Error('cropper leaked an exception');
      vi.mocked(getOrCreateCropperRef).mockRejectedValueOnce(cropperErr);
      const scene = makeSearchScene({ sceneID: 'S2B_def', view_id: 'view/def/01' });
      mockFetch({
        // Cropper fetch should not be issued because the mock rejects
        // before any HTTP call. Provide no cropper config; mockFetch
        // would throw if a cropper URL was hit (signalling a regression
        // in the test setup).
        searchResponses: [{ status: 200, body: { results: [scene] } }],
      });
      const log = makeLogger();

      await expect(warmField(fieldId, { db, log })).resolves.toBeUndefined();

      await vi.waitFor(() => {
        const defensive = log.error.mock.calls.find(
          ([, msg]) => msg === 'warm-up: cropper rejected unexpectedly',
        );
        expect(defensive?.[0]).toMatchObject({ fieldId, err: cropperErr });
      });
      // Scene still upserted — the search branch is independent.
      const rows = await readCachedScenes(db, fieldId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.scene_id).toBe('S2B_def');
    } finally {
      await cleanup();
    }
  });

  it('does not wait for a cropper promise that never settles before upserting the scene', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      // Intentional: a bare pending Promise does not keep Node's event loop alive,
      // and it models a Cropper request that never settles. Under the new
      // bounded-await design (`cropperTimeoutMs`), warm-up still returns
      // — just on the timeout branch instead of fire-and-forget.
      const neverSettlingCropper = new Promise<string | null>(() => {});
      vi.mocked(getOrCreateCropperRef).mockReturnValueOnce(neverSettlingCropper);
      const scene = makeSearchScene({ sceneID: 'S2B_hung_cropper', view_id: 'view/hung/01' });
      mockFetch({
        searchResponses: [{ status: 200, body: { results: [scene] } }],
      });
      const log = makeLogger();

      // 50 ms is plenty for the search-side mock to resolve and the upsert
      // to write; the cropper-pending promise will hit the timeout and warn.
      await expect(warmField(fieldId, { db, log, cropperTimeoutMs: 50 })).resolves.toBeUndefined();

      const rows = await readCachedScenes(db, fieldId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.scene_id).toBe('S2B_hung_cropper');
      expect(
        log.error.mock.calls.find(([, msg]) => msg === 'warm-up: cropper rejected unexpectedly'),
      ).toBeUndefined();
      // Timeout branch produces a structured warn so operators can see
      // when EOSDA Cropper is wedged.
      const timeoutWarn = log.warn.mock.calls.find(
        ([, msg]) => msg === 'warm-up: cropper still pending after timeout; continuing without it',
      );
      expect(timeoutWarn?.[0]).toMatchObject({ fieldId, timeoutMs: 50 });
    } finally {
      await cleanup();
    }
  });
});

describe('warmField — injected now', () => {
  it('uses injected now() to compute from/to dates in the search request body', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      const pinned = new Date('2026-06-15T00:00:00Z');
      const { searchCalls } = mockFetch({
        searchResponses: [{ status: 200, body: { results: [] } }],
      });
      const log = makeLogger();

      await warmField(fieldId, {
        db,
        log,
        now: () => pinned,
        // Force a single window so we only need one search response.
        initialWindowDays: 90,
        fallbackWindowsDays: [],
      });

      expect(searchCalls).toHaveLength(1);
      const body = searchCalls[0]?.body as { search?: { date?: { from?: string; to?: string } } };
      expect(body.search?.date?.to).toBe('2026-06-15');
      expect(body.search?.date?.from).toBe('2026-03-17');
    } finally {
      await cleanup();
    }
  });

  it('uses module-level defaults of 90 / 180 / 365 days when no overrides are given', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      const pinned = new Date('2026-06-15T00:00:00Z');
      const { searchCalls } = mockFetch({
        searchResponses: [
          { status: 200, body: { results: [] } },
          { status: 200, body: { results: [] } },
          { status: 200, body: { results: [] } },
        ],
      });

      await warmField(fieldId, { db, log: makeLogger(), now: () => pinned });

      expect(searchCalls).toHaveLength(3);
      const ranges = searchCalls.map(
        (c) => (c.body as { search: { date: { from: string; to: string } } }).search.date,
      );
      expect(ranges[0]?.from).toBe(dateRangeForWindow(pinned, DEFAULT_INITIAL_WINDOW_DAYS).from);
      expect(ranges[1]?.from).toBe(
        dateRangeForWindow(pinned, DEFAULT_FALLBACK_WINDOWS_DAYS[0] ?? 0).from,
      );
      expect(ranges[2]?.from).toBe(
        dateRangeForWindow(pinned, DEFAULT_FALLBACK_WINDOWS_DAYS[1] ?? 0).from,
      );
    } finally {
      await cleanup();
    }
  });
});

describe('warmField — loadField failure propagates', () => {
  it('rejects when the DB read throws (so Module 4.6 outer catch logs it)', async () => {
    const dbErr = new Error('connection terminated unexpectedly');
    // Build a Db-like proxy whose `.select(...).from(...).where(...).limit(...)`
    // chain throws on `.limit()`. Not exhaustive — only the methods
    // warmField actually calls.
    const failingDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              throw dbErr;
            },
          }),
        }),
      }),
    } as unknown as Db;
    const { cropperCalls, searchCalls } = mockFetch({ searchResponses: [] });
    const log = makeLogger();

    await expect(warmField('any-uuid-shape', { db: failingDb, log })).rejects.toBe(dbErr);

    // No EOSDA call should have fired — we never made it past loadField.
    expect(cropperCalls).toHaveLength(0);
    expect(searchCalls).toHaveLength(0);
  });
});

describe('warmField — delete-after-create race', () => {
  it('treats the upsertScenes FK violation (23503) as benign info, not an error', async () => {
    // Real lifecycle race surfaced by GPT-5.5's Phase 4 review: a user
    // deletes the field they just created while warm-up is still in
    // flight. By the time `upsertScenes` issues its INSERT, the parent
    // row in `fields` has been removed by the DELETE route's hard-
    // delete (and CASCADE has already wiped any earlier scene rows).
    // Postgres raises SQLSTATE `23503` (foreign_key_violation). Without
    // the targeted catch, the rejection bubbles to Module 4.6's
    // `.catch(...)` and gets logged as `'warm failed'` — a false-
    // positive error that pollutes production alerting.
    //
    // Race simulation: seed a field, then have the Search-mock handler
    // DELETE that field row before resolving. warmField's loadField
    // succeeds (row was present at orchestrator entry); Cropper's
    // UPDATE silently affects 0 rows (acceptable — see eosda-cropper.ts
    // line 158); upsertScenes hits 23503 and must be caught + logged
    // at info level so the route's `.catch(...)` never fires.
    const { fieldId, db, cleanup } = await seedField();
    try {
      const log = makeLogger();
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/api/render/cropper/')) {
          return makeJsonResponse(200, { cropper_ref: VALID_HASH });
        }
        if (url.includes('/api/lms/search/v2/sentinel2')) {
          // Drop the parent row before upsertScenes fires.
          await db.execute(sql`DELETE FROM fields WHERE id = ${fieldId}`);
          return makeJsonResponse(200, {
            meta: { found: 1 },
            results: [makeSearchScene()],
          });
        }
        throw new Error(`unexpected URL ${url}`);
      });

      // Must not reject: the FK violation is caught, logged at info,
      // and warmField returns cleanly so the route-level `.catch(...)`
      // never fires.
      await expect(warmField(fieldId, { db, log })).resolves.toBeUndefined();

      // Should be info-level (benign race), NOT error-level.
      expect(log.error).not.toHaveBeenCalled();
      const benignLogged = log.info.mock.calls.some(
        ([payload, msg]) =>
          typeof msg === 'string' &&
          msg.includes('field deleted before scene cache wrote') &&
          (payload as { fieldId: string }).fieldId === fieldId,
      );
      expect(benignLogged).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('still rejects upsertScenes failures that are NOT the delete race (so DB outages still alert)', async () => {
    // Defense check: the FK-23503 special-case must not swallow other
    // DB errors. We construct a real `pg.DatabaseError` with SQLSTATE
    // `08006` (connection_failure) so the `instanceof DatabaseError`
    // arm of the catch is genuinely exercised — the code-path test
    // would silently regress to "any DatabaseError caught" if a
    // future refactor dropped the `&& err.code === '23503'` guard.
    const { DatabaseError } = await import('pg');
    const { fieldId, cleanup } = await seedField();
    try {
      mockFetch({
        cropper: { status: 200, body: { cropper_ref: VALID_HASH } },
        searchResponses: [{ body: { meta: { found: 1 }, results: [makeSearchScene()] } }],
      });
      const log = makeLogger();

      const dbErr = new DatabaseError('connection terminated', 100, 'error');
      // SQLSTATE 08006 = connection_failure, NOT 23503 = foreign_key_violation.
      (dbErr as { code?: string }).code = '08006';

      // Ad-hoc proxy that intercepts the `.insert(...)` chain warmField
      // uses for upsertScenes, throws the pre-built DatabaseError, and
      // delegates everything else (loadField's `.select(...)`, the
      // cropper `.update(...)`) to the real shared db.
      const { db: realDb } = await import('../db/client.js');
      const proxyDb = new Proxy(realDb, {
        get(target, prop, receiver) {
          if (prop === 'insert') {
            return () => {
              throw dbErr;
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as typeof realDb;

      // Non-23503 DatabaseErrors must propagate so Module 4.6's outer
      // `.catch(...)` records the real outage as `'warm failed'`.
      await expect(warmField(fieldId, { db: proxyDb, log })).rejects.toBe(dbErr);
    } finally {
      await cleanup();
    }
  });
});

describe('warmField — security canary', () => {
  it('never includes EOSDA_API_KEY in any log payload', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      mockFetch({
        cropper: { status: 500, body: 'boom' },
        searchResponses: [{ body: null, reject: new TypeError('boom') }],
      });
      const log = makeLogger();

      await warmField(fieldId, { db, log });

      const { env } = await import('../env.js');
      const blob = JSON.stringify([
        ...log.info.mock.calls,
        ...log.warn.mock.calls,
        ...log.error.mock.calls,
      ]);
      expect(blob).not.toContain(env.EOSDA_API_KEY);
      expect(blob).not.toContain('api_key=');
    } finally {
      await cleanup();
    }
  });
});
