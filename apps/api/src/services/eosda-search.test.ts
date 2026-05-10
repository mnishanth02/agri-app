/**
 * Module 4.3 — Unit tests for `searchScenes`.
 *
 * Done-when contract from `docs/implementation.md` §4.3:
 *   - A unit test mocks `fetch` and asserts the mapping
 *     (`sceneID→sceneId`, `view_id→viewId`, `date→sceneDate`,
 *     `cloudCoverage→cloudPercent`, `dataCoveragePercentage→dataCoveragePercent`,
 *     `tms→tmsTemplate`).
 *
 * We additionally cover (defensive — small surface, low cost):
 *   - The exact request body shape (`intersection_validation`, `fields`,
 *     `limit`, `page`, `search.{date,cloudCoverage,shape,shapeRelation}`,
 *     `sort.date='desc'`) so EOSDA contract drift surfaces here, not at
 *     runtime when the create-time warm-up silently returns no scenes.
 *   - URL/header construction goes through the real `eosdaRequest`, so we
 *     also implicitly assert the auth/path-validation contract from 4.1.
 *   - Empty-results handling (`results: []` and missing `results` key) so
 *     Module 4.5's `Promise.allSettled` orchestration sees a clean array.
 *   - Error propagation — unlike Cropper, Search must NOT swallow errors;
 *     the orchestrator differentiates "no scenes" from "EOSDA down".
 *   - Security canary — no `EOSDA_API_KEY` or `EOSDA_BASE` in any log
 *     payload (mirrors the Cropper test).
 *
 * Style — matches `eosda-cropper.test.ts`:
 *   - `vi.stubGlobal('fetch', spy)` exercises the real `eosdaRequest`.
 *   - Manual `afterEach` cleanup (vitest 4 doesn't auto-restore globals).
 */
import type { PolygonGeoJson } from '@viz-crop/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EOSDA_BASE, EosdaError } from './eosda-client.js';
import { searchScenes } from './eosda-search.js';

const VALID_POLYGON: PolygonGeoJson = {
  type: 'Polygon',
  coordinates: [
    [
      [76.9, 12.5],
      [76.91, 12.5],
      [76.91, 12.51],
      [76.9, 12.51],
      [76.9, 12.5],
    ],
  ],
};

function makeJsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function captureFetch(response: Response): {
  spy: ReturnType<typeof vi.fn>;
  calls: { url: string; init: RequestInit | undefined }[];
} {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const spy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return response;
  });
  vi.stubGlobal('fetch', spy);
  return { spy, calls };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('searchScenes — request body', () => {
  it('POSTs the full Module 4.3 contract body to /api/lms/search/v2/sentinel2', async () => {
    const { spy, calls } = captureFetch(makeJsonResponse(200, { meta: { found: 0 }, results: [] }));

    await searchScenes({
      geometry: VALID_POLYGON,
      from: '2026-02-09',
      to: '2026-05-10',
      limit: 7,
      page: 2,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const fetchCall = calls[0];
    if (!fetchCall) throw new Error('fetch was not called');

    expect(fetchCall.url).toBe(`${EOSDA_BASE}/api/lms/search/v2/sentinel2`);
    expect(fetchCall.init?.method).toBe('POST');

    const headers = new Headers(fetchCall.init?.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('x-api-key')).toBeTruthy();

    const body = JSON.parse(String(fetchCall.init?.body ?? '{}'));
    expect(body).toEqual({
      intersection_validation: true,
      fields: ['date', 'sceneID', 'view_id', 'cloudCoverage', 'dataCoveragePercentage', 'tms'],
      limit: 7,
      page: 2,
      search: {
        date: { from: '2026-02-09', to: '2026-05-10' },
        cloudCoverage: { from: 0, to: 80 },
        shape: VALID_POLYGON,
        shapeRelation: 'CONTAINS',
      },
      sort: { date: 'desc' },
    });
  });

  it('defaults limit=10 and page=1 when not specified', async () => {
    const { calls } = captureFetch(makeJsonResponse(200, { meta: { found: 0 }, results: [] }));

    await searchScenes({
      geometry: VALID_POLYGON,
      from: '2026-02-09',
      to: '2026-05-10',
    });

    const fetchCall = calls[0];
    if (!fetchCall) throw new Error('fetch was not called');
    const body = JSON.parse(String(fetchCall.init?.body ?? '{}'));
    expect(body.limit).toBe(10);
    expect(body.page).toBe(1);
  });

  it('accepts limit=1 for the create-time warm-up path', async () => {
    const { calls } = captureFetch(makeJsonResponse(200, { meta: { found: 0 }, results: [] }));

    await searchScenes({
      geometry: VALID_POLYGON,
      from: '2026-02-09',
      to: '2026-05-10',
      limit: 1,
    });

    const fetchCall = calls[0];
    if (!fetchCall) throw new Error('fetch was not called');
    const body = JSON.parse(String(fetchCall.init?.body ?? '{}'));
    expect(body.limit).toBe(1);
  });
});

describe('searchScenes — response mapping', () => {
  it('renames every EOSDA field to the SceneDto shape', async () => {
    captureFetch(
      makeJsonResponse(200, {
        meta: { found: 1, page: 1, limit: 10 },
        results: [
          {
            sceneID: 'S2B_tile_20230731_16TEL_0',
            view_id: 'S2/16/T/EL/2023/7/31/0',
            date: '2023-07-31',
            cloudCoverage: 2.0,
            dataCoveragePercentage: 100.0,
            // Realistic — EOSDA returns its own render host here. The app
            // must NOT use this URL directly; it goes through our proxy.
            tms: 'https://render.eosda.com/S2/16/T/EL/2023/7/31/0/{band}/{z}/{x}/{y}',
            // Extra fields EOSDA returns that we drop on the floor — the
            // mapping must not leak them into SceneDto.
            sunElevation: 62.71,
          },
        ],
      }),
    );

    const result = await searchScenes({
      geometry: VALID_POLYGON,
      from: '2023-07-01',
      to: '2023-08-01',
    });

    expect(result).toEqual([
      {
        sceneId: 'S2B_tile_20230731_16TEL_0',
        viewId: 'S2/16/T/EL/2023/7/31/0',
        sceneDate: '2023-07-31',
        cloudPercent: 2.0,
        dataCoveragePercent: 100.0,
        tmsTemplate: 'https://render.eosda.com/S2/16/T/EL/2023/7/31/0/{band}/{z}/{x}/{y}',
      },
    ]);
    // Make sure no stray EOSDA-shaped key leaked through.
    const first = result[0];
    if (!first) throw new Error('expected one scene');
    expect(first).not.toHaveProperty('sceneID');
    expect(first).not.toHaveProperty('view_id');
    expect(first).not.toHaveProperty('cloudCoverage');
    expect(first).not.toHaveProperty('dataCoveragePercentage');
    expect(first).not.toHaveProperty('tms');
    expect(first).not.toHaveProperty('sunElevation');
  });

  it('preserves EOSDA result order (newest-first since sort is desc)', async () => {
    captureFetch(
      makeJsonResponse(200, {
        meta: { found: 2 },
        results: [
          {
            sceneID: 'newer',
            view_id: 'S2/A/2026/5/10/0',
            date: '2026-05-10',
            cloudCoverage: 5,
            dataCoveragePercentage: 100,
            tms: 'https://render.eosda.com/S2/A/2026/5/10/0/{band}/{z}/{x}/{y}',
          },
          {
            sceneID: 'older',
            view_id: 'S2/A/2026/5/05/0',
            date: '2026-05-05',
            cloudCoverage: 10,
            dataCoveragePercentage: 100,
            tms: 'https://render.eosda.com/S2/A/2026/5/05/0/{band}/{z}/{x}/{y}',
          },
        ],
      }),
    );

    const result = await searchScenes({
      geometry: VALID_POLYGON,
      from: '2026-05-01',
      to: '2026-05-31',
    });

    expect(result.map((s) => s.sceneId)).toEqual(['newer', 'older']);
  });
});

describe('searchScenes — empty results', () => {
  it('returns [] when EOSDA returns results: []', async () => {
    captureFetch(makeJsonResponse(200, { meta: { found: 0 }, results: [] }));

    const result = await searchScenes({
      geometry: VALID_POLYGON,
      from: '2026-02-09',
      to: '2026-05-10',
    });

    expect(result).toEqual([]);
  });

  it('returns [] when EOSDA omits the results key entirely (e.g. `{ meta: { found: 0 } }`)', async () => {
    // Per Phase 4 review: EOSDA's no-coverage shape is not contractually
    // pinned to `results: []`. Observed responses for polygons outside
    // Sentinel-2 coverage can come back as `{ meta: { found: 0 } }` with
    // no `results` key at all. Treating that as a thrown failure used to
    // (a) generate false-positive "warm-up: search failed" alerts and
    // (b) block Module 4.5's 180/365-day fallback widening. The new
    // contract coerces missing/null `results` into `[]` so the fallback
    // walk continues normally.
    captureFetch(makeJsonResponse(200, { meta: { found: 0 } }));

    const result = await searchScenes({
      geometry: VALID_POLYGON,
      from: '2026-02-09',
      to: '2026-05-10',
    });

    expect(result).toEqual([]);
  });

  it('returns [] when results is null', async () => {
    captureFetch(makeJsonResponse(200, { meta: { found: 0 }, results: null }));

    const result = await searchScenes({
      geometry: VALID_POLYGON,
      from: '2026-02-09',
      to: '2026-05-10',
    });

    expect(result).toEqual([]);
  });

  it('still throws when results is a non-null object instead of an array', async () => {
    // We DO want to keep the strict check for any *present* but
    // structurally wrong shape — silently coercing a `{ unexpected: ... }`
    // payload to `[]` would let warm-up cache an incorrect no-coverage
    // state from a genuinely garbled upstream response.
    captureFetch(makeJsonResponse(200, { meta: { found: 0 }, results: { unexpected: 'shape' } }));

    await expect(
      searchScenes({
        geometry: VALID_POLYGON,
        from: '2026-02-09',
        to: '2026-05-10',
      }),
    ).rejects.toThrow(/results was present but not an array/);
  });
});

describe('searchScenes — per-element validation', () => {
  it('throws when an element is missing view_id', async () => {
    captureFetch(
      makeJsonResponse(200, {
        meta: { found: 1 },
        results: [
          {
            sceneID: 'S2_x',
            // view_id intentionally absent
            date: '2026-05-10',
            cloudCoverage: 5,
            dataCoveragePercentage: 100,
            tms: 'https://render.eosda.com/x/{band}/{z}/{x}/{y}',
          },
        ],
      }),
    );

    await expect(
      searchScenes({ geometry: VALID_POLYGON, from: '2026-05-01', to: '2026-05-31' }),
    ).rejects.toThrow(/results\[0\]\.view_id missing or non-string/);
  });

  it('throws when cloudCoverage is a string instead of a number', async () => {
    captureFetch(
      makeJsonResponse(200, {
        meta: { found: 1 },
        results: [
          {
            sceneID: 'S2_x',
            view_id: 'S2/A/2026/5/10/0',
            date: '2026-05-10',
            // EOSDA-edge could plausibly stringify this (real-world
            // wire-format drift); we'd rather throw than silently store a
            // string in cached_scenes.cloud_percent (numeric column).
            cloudCoverage: '5',
            dataCoveragePercentage: 100,
            tms: 'https://render.eosda.com/x/{band}/{z}/{x}/{y}',
          },
        ],
      }),
    );

    await expect(
      searchScenes({ geometry: VALID_POLYGON, from: '2026-05-01', to: '2026-05-31' }),
    ).rejects.toThrow(/results\[0\]\.cloudCoverage missing or non-finite/);
  });

  it('throws when dataCoveragePercentage is NaN', async () => {
    captureFetch(
      makeJsonResponse(200, {
        meta: { found: 1 },
        results: [
          {
            sceneID: 'S2_x',
            view_id: 'S2/A/2026/5/10/0',
            date: '2026-05-10',
            cloudCoverage: 5,
            dataCoveragePercentage: Number.NaN,
            tms: 'https://render.eosda.com/x/{band}/{z}/{x}/{y}',
          },
        ],
      }),
    );

    await expect(
      searchScenes({ geometry: VALID_POLYGON, from: '2026-05-01', to: '2026-05-31' }),
    ).rejects.toThrow(/results\[0\]\.dataCoveragePercentage missing or non-finite/);
  });

  it('throws when an element is null', async () => {
    captureFetch(
      makeJsonResponse(200, {
        meta: { found: 1 },
        results: [null],
      }),
    );

    await expect(
      searchScenes({ geometry: VALID_POLYGON, from: '2026-05-01', to: '2026-05-31' }),
    ).rejects.toThrow(/results\[0\] is not an object/);
  });

  it('reports the offending row index when a later element is malformed', async () => {
    captureFetch(
      makeJsonResponse(200, {
        meta: { found: 2 },
        results: [
          {
            sceneID: 'good',
            view_id: 'S2/A/2026/5/10/0',
            date: '2026-05-10',
            cloudCoverage: 5,
            dataCoveragePercentage: 100,
            tms: 'https://render.eosda.com/good/{band}/{z}/{x}/{y}',
          },
          {
            sceneID: 'bad',
            view_id: 'S2/A/2026/5/05/0',
            date: '2026-05-05',
            cloudCoverage: 10,
            dataCoveragePercentage: 100,
            // tms intentionally absent
          },
        ],
      }),
    );

    await expect(
      searchScenes({ geometry: VALID_POLYGON, from: '2026-05-01', to: '2026-05-31' }),
    ).rejects.toThrow(/results\[1\]\.tms missing or non-string/);
  });
});

describe('searchScenes — error propagation', () => {
  it('throws EosdaError on non-2xx so the orchestrator can distinguish failure from "no coverage"', async () => {
    captureFetch(new Response('bad polygon', { status: 422 }));

    await expect(
      searchScenes({
        geometry: VALID_POLYGON,
        from: '2026-02-09',
        to: '2026-05-10',
      }),
    ).rejects.toBeInstanceOf(EosdaError);
  });

  it('propagates transport errors (TypeError from fetch)', async () => {
    const cause = new TypeError('socket hang up');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw cause;
      }),
    );

    await expect(
      searchScenes({
        geometry: VALID_POLYGON,
        from: '2026-02-09',
        to: '2026-05-10',
      }),
    ).rejects.toBe(cause);
  });
});

describe('searchScenes — logging', () => {
  it('forwards the logger to eosdaRequest on success', async () => {
    captureFetch(makeJsonResponse(200, { meta: { found: 0 }, results: [] }));
    const log = makeLogger();

    await searchScenes({
      geometry: VALID_POLYGON,
      from: '2026-02-09',
      to: '2026-05-10',
      log,
    });

    // eosdaRequest emits exactly one info line per successful request:
    // {path, status} — no key, no body, no full URL.
    expect(log.info).toHaveBeenCalledTimes(1);
    const [payload] = log.info.mock.calls[0] ?? [];
    expect(payload).toMatchObject({
      path: '/api/lms/search/v2/sentinel2',
      status: 200,
    });
  });
});

describe('searchScenes — security canary', () => {
  it('never includes the EOSDA_API_KEY or full URL in any log payload', async () => {
    // Force a non-2xx so eosda-client emits an error-level log line we can
    // inspect (info path is also covered by the success test above).
    captureFetch(new Response('boom', { status: 500 }));
    const log = makeLogger();

    await searchScenes({
      geometry: VALID_POLYGON,
      from: '2026-02-09',
      to: '2026-05-10',
      log,
    }).catch(() => {
      /* swallow — we only care about what was logged */
    });

    const { env } = await import('../env.js');
    const blob = JSON.stringify([
      ...log.info.mock.calls,
      ...log.warn.mock.calls,
      ...log.error.mock.calls,
    ]);
    expect(blob).not.toContain(env.EOSDA_API_KEY);
    expect(blob).not.toContain(EOSDA_BASE);
    expect(blob).not.toContain('api_key=');
  });
});
