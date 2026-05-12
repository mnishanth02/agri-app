/**
 * Module 7.1 — Unit tests for `runMtStats` and `buildReferenceId`.
 *
 * Done-when contract from `docs/implementation.md` §7.1:
 *   - Create-task body has the right `bm_type`, `geometry`, `reference`,
 *     `sensors`, `cloud_masking_level`.
 *   - Polling cycles every 2s and times out at 60s with `StatsTimeoutError`.
 *   - Response shape `{ result: [{ view_id, date, cloud, indexes: { NDVI: ...} }] }`
 *     is normalised to one row per `(viewId, indexName)`.
 *   - `average` → `mean` rename.
 *   - `std`/`variance`/`q1`/`q3` are intentionally discarded.
 *   - Unknown index keys (e.g. EOSDA returns `MSAVI` we don't handle) are skipped.
 *   - `errors` array with no result throws; `errors` alongside a result
 *     are surfaced as warnings while the successful scenes are returned.
 *
 * Style — matches `eosda-search.test.ts`:
 *   - `vi.stubGlobal('fetch', spy)` exercises the real `eosdaRequest`.
 *   - Manual `afterEach` cleanup (vitest 4 doesn't auto-restore globals).
 *   - `vi.useFakeTimers({ shouldAdvanceTime: true })` for the timeout test;
 *     `shouldAdvanceTime` lets `setTimeout`-based sleep resolve when we
 *     `vi.advanceTimersByTimeAsync`.
 */
import type { PolygonGeoJson } from '@viz-crop/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EOSDA_BASE } from './eosda-client.js';
import { buildReferenceId, runMtStats, StatsTimeoutError } from './eosda-stats.js';

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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setupSequentialFetch(responses: Response[]): {
  spy: ReturnType<typeof vi.fn>;
  calls: { url: string; init: RequestInit | undefined }[];
} {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  let i = 0;
  const spy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses[i++];
    if (!next) {
      throw new Error(`fetch called more times than mocked (i=${i}, mocked=${responses.length})`);
    }
    return next;
  });
  vi.stubGlobal('fetch', spy);
  return { spy, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('buildReferenceId', () => {
  it('produces vizcrop-<12-hex>-<unix-ms> for known input', () => {
    const ref = buildReferenceId({
      fieldId: '00000000-0000-0000-0000-000000000001',
      indexes: ['NDVI'],
      dateRange: { from: '2026-02-01', to: '2026-05-01' },
      now: 1_700_000_000_000,
    });
    expect(ref).toMatch(/^vizcrop-[0-9a-f]{12}-1700000000000$/);
  });

  it('is stable for identical input', () => {
    const a = buildReferenceId({
      fieldId: 'abc',
      indexes: ['NDVI', 'EVI'],
      dateRange: { from: '2026-01-01', to: '2026-02-01' },
      now: 123,
    });
    const b = buildReferenceId({
      fieldId: 'abc',
      indexes: ['EVI', 'NDVI'], // order should not matter
      dateRange: { from: '2026-01-01', to: '2026-02-01' },
      now: 123,
    });
    expect(a).toBe(b);
  });

  it('changes when timestamp differs (uniqueness guarantee)', () => {
    const base = {
      fieldId: 'abc',
      indexes: ['NDVI'] as const,
      dateRange: { from: '2026-01-01', to: '2026-02-01' },
    };
    const a = buildReferenceId({ ...base, indexes: [...base.indexes], now: 1 });
    const b = buildReferenceId({ ...base, indexes: [...base.indexes], now: 2 });
    expect(a).not.toBe(b);
    // Same hash prefix though
    expect(a.split('-')[1]).toBe(b.split('-')[1]);
  });
});

describe('runMtStats — request body', () => {
  it('POSTs the create-task contract to /api/gdw/api with bm_type/geometry/reference', async () => {
    const { calls } = setupSequentialFetch([
      jsonResponse(200, { status: 'created', task_id: 'task-1', task_timeout: 172_800 }),
      jsonResponse(200, { result: [], errors: [] }),
    ]);

    await runMtStats({
      fieldId: 'field-1',
      geometry: VALID_POLYGON,
      indexes: ['NDVI', 'EVI'],
      dateRange: { from: '2026-02-01', to: '2026-05-01' },
    });

    expect(calls.length).toBeGreaterThanOrEqual(1);
    const create = calls[0];
    if (!create) throw new Error('create call missing');
    expect(create.url).toBe(`${EOSDA_BASE}/api/gdw/api`);
    expect(create.init?.method).toBe('POST');
    const body = JSON.parse(String(create.init?.body ?? '{}'));
    expect(body.type).toBe('mt_stats');
    expect(body.params.bm_type).toEqual(['NDVI', 'EVI']);
    expect(body.params.date_start).toBe('2026-02-01');
    expect(body.params.date_end).toBe('2026-05-01');
    expect(body.params.geometry).toEqual(VALID_POLYGON);
    expect(body.params.sensors).toEqual(['sentinel2']);
    expect(body.params.cloud_masking_level).toBe(1);
    expect(body.params.reference).toMatch(/^vizcrop-[0-9a-f]{12}-\d+$/);
    // mt_stats uses geometry, NOT cropper_ref (review-findings.md §3.7).
    expect(body.params).not.toHaveProperty('cropper_ref');
  });

  it('GETs /api/gdw/api/<task_id> for poll', async () => {
    const { calls } = setupSequentialFetch([
      jsonResponse(200, { task_id: 'my-task', task_timeout: 60 }),
      jsonResponse(200, { result: [], errors: [] }),
    ]);

    await runMtStats({
      fieldId: 'f',
      geometry: VALID_POLYGON,
      indexes: ['NDVI'],
      dateRange: { from: '2026-02-01', to: '2026-05-01' },
    });

    const poll = calls[1];
    if (!poll) throw new Error('poll call missing');
    expect(poll.url).toBe(`${EOSDA_BASE}/api/gdw/api/my-task`);
    expect(poll.init?.method).toBe('GET');
  });
});

describe('runMtStats — response normalisation', () => {
  it('flattens result[*].indexes into one NdviStatsRow per (viewId, indexName)', async () => {
    setupSequentialFetch([
      jsonResponse(200, { task_id: 't', task_timeout: 60 }),
      jsonResponse(200, {
        errors: [],
        result: [
          {
            scene_id: 'S2B_tile_20200609_16TEL_0',
            view_id: 'S2/16/T/EL/2020/6/9/0',
            date: '2020-06-09',
            cloud: 0.0,
            indexes: {
              NDVI: {
                average: 0.106,
                median: 0.108,
                min: -0.112,
                max: 0.282,
                std: 0.063,
                variance: 0.004,
                q1: 0.062,
                q3: 0.156,
                p10: 0.026,
                p90: 0.185,
              },
              EVI: {
                average: 0.21,
                median: 0.205,
                min: -0.05,
                max: 0.4,
                p10: 0.1,
                p90: 0.35,
              },
            },
          },
        ],
      }),
    ]);

    const rows = await runMtStats({
      fieldId: 'f',
      geometry: VALID_POLYGON,
      indexes: ['NDVI', 'EVI'],
      dateRange: { from: '2020-06-01', to: '2020-06-30' },
    });

    expect(rows).toHaveLength(2);
    const ndvi = rows.find((r) => r.indexName === 'NDVI');
    if (!ndvi) throw new Error('NDVI row missing');
    expect(ndvi).toMatchObject({
      viewId: 'S2/16/T/EL/2020/6/9/0',
      indexName: 'NDVI',
      sceneDate: '2020-06-09',
      cloudPercent: 0,
      mean: 0.106,
      median: 0.108,
      min: -0.112,
      max: 0.282,
      p10: 0.026,
      p90: 0.185,
    });
    // Discarded fields per Module 7.1 deviation note.
    expect(ndvi).not.toHaveProperty('std');
    expect(ndvi).not.toHaveProperty('variance');
    expect(ndvi).not.toHaveProperty('q1');
    expect(ndvi).not.toHaveProperty('q3');

    const evi = rows.find((r) => r.indexName === 'EVI');
    if (!evi) throw new Error('EVI row missing');
    expect(evi.mean).toBe(0.21);
  });

  it('skips unknown index keys (forward compatibility)', async () => {
    setupSequentialFetch([
      jsonResponse(200, { task_id: 't', task_timeout: 60 }),
      jsonResponse(200, {
        errors: [],
        result: [
          {
            view_id: 'v1',
            date: '2024-01-01',
            cloud: 5,
            indexes: {
              NDVI: { average: 0.5 },
              MSAVI: { average: 0.4 }, // not in our enum
            },
          },
        ],
      }),
    ]);

    const rows = await runMtStats({
      fieldId: 'f',
      geometry: VALID_POLYGON,
      indexes: ['NDVI'],
      dateRange: { from: '2024-01-01', to: '2024-01-31' },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexName).toBe('NDVI');
  });

  it('coerces null/missing stats fields to null (no NaN propagation)', async () => {
    setupSequentialFetch([
      jsonResponse(200, { task_id: 't', task_timeout: 60 }),
      jsonResponse(200, {
        errors: [],
        result: [
          {
            view_id: 'v1',
            date: '2024-01-01',
            cloud: null,
            indexes: {
              NDVI: { average: null, min: 'nope' },
            },
          },
        ],
      }),
    ]);

    const rows = await runMtStats({
      fieldId: 'f',
      geometry: VALID_POLYGON,
      indexes: ['NDVI'],
      dateRange: { from: '2024-01-01', to: '2024-01-31' },
    });

    expect(rows[0]?.cloudPercent).toBeNull();
    expect(rows[0]?.mean).toBeNull();
    expect(rows[0]?.min).toBeNull();
  });

  it('coerces numeric strings (defensive — EOSDA may return either)', async () => {
    setupSequentialFetch([
      jsonResponse(200, { task_id: 't', task_timeout: 60 }),
      jsonResponse(200, {
        errors: [],
        result: [
          {
            view_id: 'v1',
            date: '2024-01-01',
            cloud: '12.5',
            indexes: { NDVI: { average: '0.42' } },
          },
        ],
      }),
    ]);

    const rows = await runMtStats({
      fieldId: 'f',
      geometry: VALID_POLYGON,
      indexes: ['NDVI'],
      dateRange: { from: '2024-01-01', to: '2024-01-31' },
    });

    expect(rows[0]?.cloudPercent).toBe(12.5);
    expect(rows[0]?.mean).toBe(0.42);
  });
});

describe('runMtStats — errors and timeout', () => {
  it('throws when poll response has errors[] and no result', async () => {
    setupSequentialFetch([
      jsonResponse(200, { task_id: 't', task_timeout: 60 }),
      jsonResponse(200, { errors: ['boom'] }),
    ]);

    await expect(
      runMtStats({
        fieldId: 'f',
        geometry: VALID_POLYGON,
        indexes: ['NDVI'],
        dateRange: { from: '2024-01-01', to: '2024-01-31' },
      }),
    ).rejects.toThrow(/failed with 1 error/);
  });

  it('returns successful rows when poll has both errors[] and result[] (per-scene errors)', async () => {
    // Real-world EOSDA behaviour: one scene fully clouded → reported in
    // `errors[]`, but the other scenes still produce usable rows in
    // `result[]`. The wrapper must not let a per-scene error nuke the
    // entire task.
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    setupSequentialFetch([
      jsonResponse(200, { task_id: 't', task_timeout: 60 }),
      jsonResponse(200, {
        errors: [
          {
            scene_id: 'S2B_clouded',
            view_id: 'S2/43/P/ET/2026/3/6/1',
            date: '2026-03-06',
            error: 'AOI contains clouds only',
          },
        ],
        result: [
          {
            scene_id: 'S2B_good',
            view_id: 'S2/43/P/ET/2026/4/30/0',
            date: '2026-04-30',
            cloud: 5,
            indexes: { NDVI: { average: 0.42, median: 0.4, min: 0.1, max: 0.7 } },
          },
        ],
      }),
    ]);

    const rows = await runMtStats({
      fieldId: 'f',
      geometry: VALID_POLYGON,
      indexes: ['NDVI'],
      dateRange: { from: '2026-02-01', to: '2026-05-01' },
      log,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.viewId).toBe('S2/43/P/ET/2026/4/30/0');
    expect(rows[0]?.mean).toBe(0.42);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]?.[1]).toMatch(/per-scene error/);
  });

  it('returns empty rows when poll has errors[] and an empty result[]', async () => {
    // A complete task whose only outcome is that every requested scene
    // failed (e.g. all dates clouded) should not 502 — return [] and let
    // the route surface "no stats for this window" to the client.
    setupSequentialFetch([
      jsonResponse(200, { task_id: 't', task_timeout: 60 }),
      jsonResponse(200, { errors: ['only-clouds'], result: [] }),
    ]);

    const rows = await runMtStats({
      fieldId: 'f',
      geometry: VALID_POLYGON,
      indexes: ['NDVI'],
      dateRange: { from: '2024-01-01', to: '2024-01-31' },
    });

    expect(rows).toEqual([]);
  });

  it('throws StatsTimeoutError when polling exceeds 60s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Create returns immediately; every poll has no `result` (still
    // computing). After ~30 polls (60s) we should hit the cap.
    const responses: Response[] = [jsonResponse(200, { task_id: 'slow', task_timeout: 600 })];
    for (let i = 0; i < 60; i++) {
      responses.push(jsonResponse(200, { errors: [], status: 'pending' }));
    }
    setupSequentialFetch(responses);

    const promise = runMtStats({
      fieldId: 'f',
      geometry: VALID_POLYGON,
      indexes: ['NDVI'],
      dateRange: { from: '2024-01-01', to: '2024-01-31' },
    });

    // Catch handler attached now to avoid unhandled-rejection warnings
    // while the loop is still running.
    const settled = expect(promise).rejects.toBeInstanceOf(StatsTimeoutError);

    // Advance virtual time past the 60s cap. shouldAdvanceTime keeps
    // setTimeout based sleeps resolving; we still need to nudge the
    // event loop so the promise can settle.
    await vi.advanceTimersByTimeAsync(70_000);

    await settled;
  });

  it('respects the upstream task_timeout when shorter than the 60s cap', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const responses: Response[] = [
      jsonResponse(200, { task_id: 'fast-cap', task_timeout: 4 }), // 4 seconds
    ];
    for (let i = 0; i < 10; i++) {
      responses.push(jsonResponse(200, { errors: [], status: 'pending' }));
    }
    setupSequentialFetch(responses);

    const promise = runMtStats({
      fieldId: 'f',
      geometry: VALID_POLYGON,
      indexes: ['NDVI'],
      dateRange: { from: '2024-01-01', to: '2024-01-31' },
    });

    const settled = expect(promise).rejects.toBeInstanceOf(StatsTimeoutError);
    await vi.advanceTimersByTimeAsync(10_000);
    await settled;
  });
});
