/**
 * Module 4.1 — Unit tests for the EOSDA HTTP client.
 *
 * Goals (per the module's "Done when"):
 *   1. Prove request CONSTRUCTION — base URL, header injection, JSON
 *      content-type default, body pass-through, optional `?api_key=` fallback.
 *   2. Prove ERROR MAPPING — non-2xx ⇒ `EosdaError(status, path, body)`.
 *   3. Prove the LOGGING CONTRACT — `path + status` only; the full URL
 *      (which may carry the API key when the query fallback is on) is never
 *      written to any logger field. This is the security gate for the whole
 *      Phase 4 surface, so we assert it explicitly rather than trust review.
 *
 * Notes:
 *   - We `vi.stubGlobal('fetch', …)` rather than mocking the module so the
 *     test exercises the real `eosdaRequest` implementation top-to-bottom,
 *     including the `Headers` construction and URL composition. Each test
 *     restores the global in `afterEach`.
 *   - `apps/api/.env` already provides a real `EOSDA_API_KEY` (zod parses
 *     it at import time via `env.ts`). We use a fixed sentinel value in the
 *     "no-leak" assertion below; the actual key value doesn't matter so
 *     long as it is non-empty.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../env.js';
import { EOSDA_BASE, EosdaError, eosda, eosdaRequest } from './eosda-client.js';

interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

function captureFetch(response: Response): {
  calls: CapturedRequest[];
  spy: ReturnType<typeof vi.fn>;
} {
  const calls: CapturedRequest[] = [];
  const spy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return response;
  });
  vi.stubGlobal('fetch', spy);
  return { calls, spy };
}

function makeJsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

describe('eosdaRequest — request construction', () => {
  it('hits EOSDA_BASE + path with the x-api-key header by default', async () => {
    const { calls } = captureFetch(makeJsonResponse(200, { ok: true }));

    const body = await eosdaRequest<{ ok: boolean }>('/api/render/cropper/', {
      method: 'POST',
      body: JSON.stringify({ type: 'Feature' }),
    });

    expect(body).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error('fetch was not called');
    const { url, init } = call;
    expect(url).toBe(`${EOSDA_BASE}/api/render/cropper/`);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ type: 'Feature' }));

    const headers = new Headers(init?.headers);
    expect(headers.get('x-api-key')).toBe(env.EOSDA_API_KEY);
    expect(headers.get('Content-Type')).toBe('application/json');
    // Header-auth path must NOT smuggle the key into the URL.
    expect(url).not.toContain('api_key=');
  });

  it('respects a caller-supplied Content-Type override', async () => {
    const { calls } = captureFetch(makeJsonResponse(200, {}));

    await eosdaRequest('/api/whatever', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'raw',
    });

    const call = calls[0];
    if (!call) throw new Error('fetch was not called');
    const headers = new Headers(call.init?.headers);
    expect(headers.get('Content-Type')).toBe('text/plain');
    // …but auth header is still injected automatically.
    expect(headers.get('x-api-key')).toBe(env.EOSDA_API_KEY);
  });

  it('exposes the same function via the `eosda.request` namespace', async () => {
    captureFetch(makeJsonResponse(200, { ok: 1 }));
    const r = await eosda.request<{ ok: number }>('/api/x');
    expect(r).toEqual({ ok: 1 });
  });
});

describe('eosdaRequest — query-auth fallback', () => {
  it('moves the key to ?api_key=… and removes the x-api-key header when useQueryAuth=true', async () => {
    const { calls } = captureFetch(makeJsonResponse(200, {}));

    await eosdaRequest('/api/render/something', { useQueryAuth: true });

    const call = calls[0];
    if (!call) throw new Error('fetch was not called');
    const expectedKey = encodeURIComponent(env.EOSDA_API_KEY);
    expect(call.url).toBe(`${EOSDA_BASE}/api/render/something?api_key=${expectedKey}`);
    const headers = new Headers(call.init?.headers);
    expect(headers.has('x-api-key')).toBe(false);
  });

  it('appends api_key with `&` when the path already has a query string', async () => {
    const { calls } = captureFetch(makeJsonResponse(200, {}));

    await eosdaRequest('/api/render/foo?z=1&x=2', { useQueryAuth: true });

    const call = calls[0];
    if (!call) throw new Error('fetch was not called');
    expect(call.url.startsWith(`${EOSDA_BASE}/api/render/foo?z=1&x=2&api_key=`)).toBe(true);
    expect(call.url.split('?')).toHaveLength(2);
  });
});

describe('eosdaRequest — error mapping', () => {
  it('wraps non-2xx responses in an EosdaError carrying status, path, and body', async () => {
    captureFetch(new Response('rate limited', { status: 429 }));

    await expect(
      eosdaRequest('/api/lms/search/v2/sentinel2', { method: 'POST' }),
    ).rejects.toMatchObject({
      name: 'EosdaError',
      status: 429,
      path: '/api/lms/search/v2/sentinel2',
      body: 'rate limited',
    });
  });

  it('still produces an EosdaError when the body cannot be read as text', async () => {
    // Stub a Response whose .text() rejects to prove the `.catch(() => "")`
    // safety net actually runs and does not mask the original status.
    const broken = new Response(null, { status: 502 });
    Object.defineProperty(broken, 'text', {
      value: () => Promise.reject(new Error('socket reset')),
    });
    captureFetch(broken);

    const err = await eosdaRequest('/api/render/cropper/').catch((e) => e);
    expect(err).toBeInstanceOf(EosdaError);
    expect((err as EosdaError).status).toBe(502);
    expect((err as EosdaError).body).toBe('');
  });

  it('lets transport-layer fetch failures bubble up unchanged', async () => {
    const cause = new TypeError('network down');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw cause;
      }),
    );

    await expect(eosdaRequest('/api/x')).rejects.toBe(cause);
  });
});

describe('eosdaRequest — caller cannot smuggle the key into the path', () => {
  it('refuses a path that already contains an `api_key` query param (header-auth mode)', async () => {
    const { calls } = captureFetch(makeJsonResponse(200, {}));

    await expect(eosdaRequest(`/api/render/cropper/?api_key=${env.EOSDA_API_KEY}`)).rejects.toThrow(
      /do not put `api_key`/,
    );
    expect(calls).toHaveLength(0);
  });

  it('refuses a path that contains `api_key` mid-query', async () => {
    const { calls } = captureFetch(makeJsonResponse(200, {}));

    await expect(eosdaRequest('/api/x?foo=1&api_key=leak')).rejects.toThrow(/do not put `api_key`/);
    expect(calls).toHaveLength(0);
  });

  it('still rejects when the caller asked for `useQueryAuth` (no double-keying)', async () => {
    const { calls } = captureFetch(makeJsonResponse(200, {}));

    await expect(eosdaRequest('/api/x?api_key=leak', { useQueryAuth: true })).rejects.toThrow(
      /do not put `api_key`/,
    );
    expect(calls).toHaveLength(0);
  });

  it('logs only the pathname (no caller-supplied query params) on success', async () => {
    captureFetch(makeJsonResponse(200, {}));
    const log = makeLogger();

    await eosdaRequest('/api/lms/search/v2/sentinel2?fields=date&secret=xyz', { log });

    const infoCall = log.info.mock.calls[0];
    if (!infoCall) throw new Error('log.info was not called');
    const [payload] = infoCall;
    expect(payload).toEqual({
      path: '/api/lms/search/v2/sentinel2',
      status: 200,
    });

    const serialised = JSON.stringify(log.info.mock.calls);
    expect(serialised).not.toContain('secret=xyz');
    expect(serialised).not.toContain('fields=date');
  });

  it('refuses a path containing a URL fragment', async () => {
    const { calls } = captureFetch(makeJsonResponse(200, {}));

    await expect(eosdaRequest('/api/x#api_key=leak')).rejects.toThrow(
      /URL fragments are not allowed/,
    );
    await expect(eosdaRequest('/api/x#anything')).rejects.toThrow(/URL fragments are not allowed/);
    expect(calls).toHaveLength(0);
  });

  it('refuses an unparseable URL with a clean error that does not leak the API key', async () => {
    const { calls } = captureFetch(makeJsonResponse(200, {}));

    // The leading-slash guard fires first for `%` alone (no leading slash),
    // so we use it through the no-leak iteration test below. This test
    // pins the contract that *any* rejection — whatever the path shape —
    // must have a clean message. The error type itself proves we never
    // reached the inner fetch call (which would have appended the key).
    const err = await eosdaRequest('%', { useQueryAuth: true }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).not.toContain(env.EOSDA_API_KEY);
    expect(message).not.toContain('api_key');
    expect(calls).toHaveLength(0);
  });

  it('strips the query string from EosdaError.path on failure', async () => {
    captureFetch(new Response('boom', { status: 500 }));

    const err = await eosdaRequest('/api/x?cropper_ref=abc123').catch((e) => e);

    expect(err).toBeInstanceOf(EosdaError);
    expect((err as EosdaError).path).toBe('/api/x');
  });

  it('refuses paths that resolve off-origin (host-injection guard)', async () => {
    const { calls } = captureFetch(makeJsonResponse(200, {}));

    // Without a leading slash, string-concat would rewrite the host.
    await expect(eosdaRequest('.evil.com/x')).rejects.toThrow(/must start with a single/);
    await expect(eosdaRequest('@evil.com/x')).rejects.toThrow(/must start with a single/);
    // Even a path that starts with '/' but parses to a foreign origin must
    // be rejected. Protocol-relative URLs ('//evil.com/x') are caught by
    // the leading-`//` check.
    await expect(eosdaRequest('//evil.com/x')).rejects.toThrow(/must start with a single/);
    expect(calls).toHaveLength(0);
  });

  it('does not mention EOSDA_API_KEY in any of its rejection messages', async () => {
    const messages: string[] = [];
    for (const bad of [
      '/api/x?api_key=leak',
      '/api/x#frag',
      '%',
      '.evil.com/x',
      '@evil.com/x',
      '//evil.com/x',
    ]) {
      const err = await eosdaRequest(bad, { useQueryAuth: true }).catch((e: unknown) => e);
      messages.push((err as Error).message);
    }
    const blob = messages.join('|');
    expect(blob).not.toContain(env.EOSDA_API_KEY);
  });
});

describe('eosdaRequest — logging contract', () => {
  it('logs only path + status on success (never the full URL)', async () => {
    captureFetch(makeJsonResponse(200, { ok: true }));
    const log = makeLogger();

    await eosdaRequest('/api/render/cropper/', { log });

    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
    const infoCall = log.info.mock.calls[0];
    if (!infoCall) throw new Error('log.info was not called');
    const [payload] = infoCall;
    expect(payload).toEqual({ path: '/api/render/cropper/', status: 200 });
  });

  it('logs only path + status on non-2xx (the full URL with api_key must not leak)', async () => {
    captureFetch(new Response('nope', { status: 401 }));
    const log = makeLogger();

    await eosdaRequest('/api/render/cropper/', { useQueryAuth: true, log }).catch(() => {});

    expect(log.error).toHaveBeenCalledTimes(1);
    const errorCall = log.error.mock.calls[0];
    if (!errorCall) throw new Error('log.error was not called');
    const [payload, msg] = errorCall;
    expect(payload).toEqual({ path: '/api/render/cropper/', status: 401 });

    // Defense in depth: walk every value the logger ever saw and assert no
    // call serialised the full URL or the api_key. If the implementation
    // ever regresses and passes `url` through, this test fails loudly.
    const allLogPayloads = [
      ...log.info.mock.calls,
      ...log.warn.mock.calls,
      ...log.error.mock.calls,
    ];
    const serialised = JSON.stringify(allLogPayloads) + String(msg ?? '');
    expect(serialised).not.toContain('api_key');
    expect(serialised).not.toContain(env.EOSDA_API_KEY);
    expect(serialised).not.toContain(EOSDA_BASE);
  });

  it('logs at error level when the underlying fetch rejects', async () => {
    const cause = new TypeError('econnreset');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw cause;
      }),
    );
    const log = makeLogger();

    await eosdaRequest('/api/render/cropper/', { log }).catch(() => {});

    expect(log.error).toHaveBeenCalledTimes(1);
    const errorCall = log.error.mock.calls[0];
    if (!errorCall) throw new Error('log.error was not called');
    const [payload] = errorCall;
    expect(payload.path).toBe('/api/render/cropper/');
    expect(payload.err).toBe(cause);
  });
});
