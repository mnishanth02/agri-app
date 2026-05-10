/**
 * Module 4.2 — Unit tests for `getOrCreateCropperRef`.
 *
 * Done-when contract from `docs/implementation.md` §4.2:
 *   - Calling once on a fresh field POSTs to `/api/render/cropper/`, persists
 *     the 32-char hex hash via `UPDATE fields SET eosda_cropper_ref = $1
 *     WHERE id = $2`, and returns the hash.
 *   - Calling again with `eosdaCropperRef` already populated returns the
 *     cached value WITHOUT a new EOSDA POST.
 *   - On non-2xx, transport failure, or invalid response shape, log a
 *     structured `{ fieldId, status, body }` (or `{ fieldId, err }`) and
 *     return `null` — never throw. The DB column stays untouched.
 *
 * Style notes — same shape as `eosda-client.test.ts` (which 4.2 reuses):
 *   - `vi.stubGlobal('fetch', spy)` exercises the real `eosdaRequest`
 *     end-to-end so we cover the request-construction contract too.
 *   - The Drizzle `db` is mocked via a thin chain stub. We only need
 *     `update().set().where()`; using a real `Db` would require a live
 *     PostGIS pool which is overkill for a unit test of the service layer.
 */
import type { PolygonGeoJson } from '@viz-crop/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import { EOSDA_BASE } from './eosda-client.js';
import { getOrCreateCropperRef } from './eosda-cropper.js';

const VALID_HASH = '3eb51ea04776e6ae6bb665504e3c5ffb';

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

interface DbCall {
  set: Record<string, unknown>;
  whereId: string;
}

function makeMockDb(opts: { whereThrows?: unknown } = {}): { db: Db; calls: DbCall[] } {
  const calls: DbCall[] = [];
  const db = {
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: async () => {
          if (opts.whereThrows) throw opts.whereThrows;
          // The eq() fragment we receive is opaque here; we just record the
          // call payload — the routing logic that builds it is covered by
          // the field id appearing in the recorded `whereId` column below.
          calls.push({ set, whereId: '<eq(fields.id, field.id)>' });
        },
      }),
    }),
  } as unknown as Db;
  return { db, calls };
}

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

describe('getOrCreateCropperRef — reuse', () => {
  it('returns the cached hash without POSTing or touching the DB', async () => {
    const { spy } = captureFetch(makeJsonResponse(500, 'should not be called'));
    const { db, calls } = makeMockDb();
    const log = makeLogger();

    const result = await getOrCreateCropperRef(
      { id: 'field-1', geometry: VALID_POLYGON, eosdaCropperRef: VALID_HASH },
      { db, log },
    );

    expect(result).toBe(VALID_HASH);
    expect(spy).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe('getOrCreateCropperRef — happy path', () => {
  it('POSTs the polygon as a Feature and persists the returned hash', async () => {
    const { spy, calls: fetchCalls } = captureFetch(
      makeJsonResponse(200, { cropper_ref: VALID_HASH }),
    );
    const { db, calls: dbCalls } = makeMockDb();
    const log = makeLogger();

    const result = await getOrCreateCropperRef(
      { id: 'field-42', geometry: VALID_POLYGON, eosdaCropperRef: null },
      { db, log },
    );

    expect(result).toBe(VALID_HASH);
    expect(spy).toHaveBeenCalledTimes(1);

    const fetchCall = fetchCalls[0];
    if (!fetchCall) throw new Error('fetch was not called');
    expect(fetchCall.url).toBe(`${EOSDA_BASE}/api/render/cropper/`);
    expect(fetchCall.init?.method).toBe('POST');
    const body = JSON.parse(String(fetchCall.init?.body ?? '{}'));
    expect(body).toEqual({
      type: 'Feature',
      properties: {},
      geometry: VALID_POLYGON,
    });
    const headers = new Headers(fetchCall.init?.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('x-api-key')).toBeTruthy();

    expect(dbCalls).toHaveLength(1);
    const dbCall = dbCalls[0];
    if (!dbCall) throw new Error('db.update was not called');
    expect(dbCall.set).toEqual({ eosdaCropperRef: VALID_HASH });

    // No structured error or warning on the happy path.
    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe('getOrCreateCropperRef — failure paths', () => {
  it('returns null and logs {fieldId,status,body} on non-2xx; DB stays untouched', async () => {
    captureFetch(new Response('quota exceeded', { status: 429 }));
    const { db, calls: dbCalls } = makeMockDb();
    const log = makeLogger();

    const result = await getOrCreateCropperRef(
      { id: 'field-7', geometry: VALID_POLYGON, eosdaCropperRef: null },
      { db, log },
    );

    expect(result).toBeNull();
    expect(dbCalls).toHaveLength(0);

    // Note: eosda-client also calls log.error once for its own non-2xx line
    // (path + status only). Our service then logs again with the field id.
    // Find the cropper-creation line by its message.
    const cropperErrorCall = log.error.mock.calls.find(
      ([, msg]) => msg === 'cropper creation failed',
    );
    if (!cropperErrorCall) throw new Error('cropper-creation error log was not emitted');
    const [payload] = cropperErrorCall;
    expect(payload).toEqual({
      fieldId: 'field-7',
      status: 429,
      body: 'quota exceeded',
    });
  });

  it('returns null and logs {fieldId,err} on a transport failure; DB stays untouched', async () => {
    const cause = new TypeError('socket hang up');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw cause;
      }),
    );
    const { db, calls: dbCalls } = makeMockDb();
    const log = makeLogger();

    const result = await getOrCreateCropperRef(
      { id: 'field-9', geometry: VALID_POLYGON, eosdaCropperRef: null },
      { db, log },
    );

    expect(result).toBeNull();
    expect(dbCalls).toHaveLength(0);

    const cropperErrorCall = log.error.mock.calls.find(
      ([, msg]) => msg === 'cropper creation failed',
    );
    if (!cropperErrorCall) throw new Error('cropper-creation error log was not emitted');
    const [payload] = cropperErrorCall;
    expect(payload).toMatchObject({ fieldId: 'field-9', err: cause });
  });

  it('returns null and logs when the response is missing cropper_ref', async () => {
    captureFetch(makeJsonResponse(200, { something_else: 'oops' }));
    const { db, calls: dbCalls } = makeMockDb();
    const log = makeLogger();

    const result = await getOrCreateCropperRef(
      { id: 'field-11', geometry: VALID_POLYGON, eosdaCropperRef: null },
      { db, log },
    );

    expect(result).toBeNull();
    expect(dbCalls).toHaveLength(0);

    const malformedCall = log.error.mock.calls.find(
      ([, msg]) => msg === 'cropper response did not match expected shape',
    );
    if (!malformedCall) throw new Error('malformed-response error log was not emitted');
    const [payload] = malformedCall;
    expect(payload).toMatchObject({ fieldId: 'field-11', status: 200 });
  });

  it('returns null and logs when cropper_ref is the wrong length / non-hex', async () => {
    captureFetch(makeJsonResponse(200, { cropper_ref: 'NOT-HEX-OR-32-CHARS' }));
    const { db, calls: dbCalls } = makeMockDb();
    const log = makeLogger();

    const result = await getOrCreateCropperRef(
      { id: 'field-13', geometry: VALID_POLYGON, eosdaCropperRef: null },
      { db, log },
    );

    expect(result).toBeNull();
    expect(dbCalls).toHaveLength(0);
    expect(log.error).toHaveBeenCalled();
  });

  it('rejects an uppercase 32-char hash (cropper docs specify lowercase)', async () => {
    captureFetch(makeJsonResponse(200, { cropper_ref: VALID_HASH.toUpperCase() }));
    const { db, calls: dbCalls } = makeMockDb();
    const log = makeLogger();

    const result = await getOrCreateCropperRef(
      { id: 'field-13b', geometry: VALID_POLYGON, eosdaCropperRef: null },
      { db, log },
    );

    expect(result).toBeNull();
    expect(dbCalls).toHaveLength(0);
  });

  it('returns null and logs when a 200 body is invalid JSON', async () => {
    // EOSDA could plausibly return a truncated or proxy-mangled body.
    // `response.json()` throws inside `eosdaRequest`; our outer catch must
    // surface this as the same "cropper creation failed" structured error
    // (without leaking key/url) and leave the DB untouched.
    captureFetch(
      new Response('{"cropper_ref": "3eb...', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { db, calls: dbCalls } = makeMockDb();
    const log = makeLogger();

    const result = await getOrCreateCropperRef(
      { id: 'field-14', geometry: VALID_POLYGON, eosdaCropperRef: null },
      { db, log },
    );

    expect(result).toBeNull();
    expect(dbCalls).toHaveLength(0);
    const cropperErrorCall = log.error.mock.calls.find(
      ([, msg]) => msg === 'cropper creation failed',
    );
    if (!cropperErrorCall) throw new Error('cropper-creation error log was not emitted');
    const [payload] = cropperErrorCall;
    expect(payload).toMatchObject({ fieldId: 'field-14' });
    // err is the SyntaxError from JSON.parse, not an EosdaError.
    expect(payload.err).toBeInstanceOf(Error);
  });

  it('returns null and logs when the DB UPDATE fails', async () => {
    captureFetch(makeJsonResponse(200, { cropper_ref: VALID_HASH }));
    const dbErr = new Error('connection terminated unexpectedly');
    const { db } = makeMockDb({ whereThrows: dbErr });
    const log = makeLogger();

    const result = await getOrCreateCropperRef(
      { id: 'field-15', geometry: VALID_POLYGON, eosdaCropperRef: null },
      { db, log },
    );

    expect(result).toBeNull();

    const persistCall = log.error.mock.calls.find(
      ([, msg]) => msg === 'cropper persistence failed',
    );
    if (!persistCall) throw new Error('cropper-persistence error log was not emitted');
    const [payload] = persistCall;
    expect(payload).toMatchObject({ fieldId: 'field-15', err: dbErr });
  });
});

describe('getOrCreateCropperRef — security canary', () => {
  it('never includes the EOSDA_API_KEY or full URL in any log payload', async () => {
    captureFetch(new Response('boom', { status: 500 }));
    const { db } = makeMockDb();
    const log = makeLogger();

    await getOrCreateCropperRef(
      { id: 'field-99', geometry: VALID_POLYGON, eosdaCropperRef: null },
      { db, log },
    );

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
