/**
 * Module 4.1 — EOSDA HTTP client.
 *
 * Thin wrapper around `fetch` for the EOSDA `api-connect.eos.com` backend.
 * Centralises three concerns shared by Cropper (4.2), Search (4.3), Stats
 * (Phase 7), and any other JSON endpoint we add later:
 *
 *   1. Auth — `EOSDA_API_KEY` is injected as the `x-api-key` header on every
 *      request. EOSDA also accepts `?api_key=…` as a fallback, but only when
 *      a specific endpoint rejects header auth (none observed in the v2
 *      surface). Callers must opt in explicitly via `useQueryAuth` so we
 *      never leak the key in a URL by accident.
 *   2. Error mapping — non-2xx responses become a typed `EosdaError` carrying
 *      `status`, `path`, and the response body (text). Network/transport
 *      failures bubble up as the original `TypeError` from `fetch`.
 *   3. Logging hygiene — when a `log` is supplied, only the path and status
 *      are written. Never log the full URL: the query-string fallback could
 *      be carrying the API key, and even header-auth requests can have
 *      sensitive query params (e.g. cropper hashes) we don't want grepped
 *      out of production logs. See `docs/review-findings.md` §3.5.2.
 *
 * Intentionally does NOT handle:
 *   - Render tile responses (binary, non-JSON) — Module 6.3 uses the sibling
 *     `eosdaFetch` for those; this function would mis-frame the body as JSON.
 *   - Retries / rate-limit back-off — left for a future cross-cutting
 *     concern once we have measured EOSDA's actual quota behaviour.
 */
import { env } from '../env.js';

export const EOSDA_BASE = 'https://api-connect.eos.com';

/**
 * Minimal shape of a structured logger we can satisfy from either a Fastify
 * `req.log`/`app.log` (pino) or a hand-rolled stub in tests. Kept structural
 * so we don't add a runtime dependency on `pino` types in this file.
 */
export interface EosdaLogger {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
}

/**
 * Options layered on top of the standard `RequestInit`:
 *   - `useQueryAuth`: append `?api_key=…` instead of sending the
 *     `x-api-key` header. Off by default. Document why each caller flips
 *     this on (Module 4.1 ships with it off; only flip when a live test
 *     proves header auth is rejected for that endpoint).
 *   - `log`: optional structured logger. When provided, every non-2xx
 *     response is logged at `error` level with `{ path, status }` and
 *     successful requests are logged at `info` level with the same shape.
 *     The full URL is NEVER logged.
 *   - `parseJson`: defaults to `true`. Set to `false` to receive the raw
 *     `Response` (useful for callers that need streaming or want to inspect
 *     headers). Most JSON endpoints should leave this on.
 */
export interface EosdaRequestOptions extends RequestInit {
  useQueryAuth?: boolean;
  log?: EosdaLogger;
}

export class EosdaError extends Error {
  readonly status: number;
  readonly path: string;
  readonly body: string;

  constructor(status: number, path: string, body: string) {
    super(`EOSDA ${status} on ${path}`);
    this.name = 'EosdaError';
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

/**
 * Append `?api_key=…` to a relative path while preserving any existing
 * query parameters. Built without `URL` to avoid having to resolve the
 * path against `EOSDA_BASE` twice (once here, once in the `fetch` call).
 */
function withQueryApiKey(path: string, apiKey: string): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}api_key=${encodeURIComponent(apiKey)}`;
}

/**
 * Strip any query string before logging. The path can carry sensitive data
 * (API keys via the query fallback, cropper hashes, view ids); operators
 * only need the route to grep with, not the params. Log labels stay stable
 * across calls because the pathname is the part that identifies the
 * endpoint.
 */
function sanitisePathForLog(path: string): string {
  const queryIndex = path.indexOf('?');
  return queryIndex === -1 ? path : path.slice(0, queryIndex);
}

/**
 * Defensive check — refuse a caller-supplied `api_key` query parameter
 * (in any encoding), URL fragment, control-character smuggling, host
 * injection, or any path that the `URL` parser cannot handle.
 *
 *   - `api_key` in path (any encoding): would silently bypass our auth
 *     contract and leak the key into any code that touches the URL (logs,
 *     fetch errors, etc.). The literal regex catches the obvious form;
 *     the post-`URL`-parse `searchParams.has('api_key')` check catches
 *     percent-encoded forms like `%61pi_key=` or `api%5fkey=` that
 *     `URLSearchParams` decodes to `api_key` at parse time but would
 *     silently bypass a regex that only inspects the raw string.
 *   - Control characters (`\r`, `\n`, NUL, etc.): undici / fetch will
 *     reject many of these but with messages that may echo the full URL.
 *     Rejecting them up-front keeps the pre-fetch error message clean and
 *     prevents request-smuggling shapes from ever reaching `fetch`.
 *   - `#fragment`: meaningless to backend HTTP (native `fetch` strips it
 *     before sending) but would land verbatim in our log line if we let it
 *     through. Rejecting fragments outright is cheaper than parsing them
 *     out and means "the path you pass is the path we use" stays true.
 *   - Host injection: string concatenation against `EOSDA_BASE` is unsafe
 *     for paths that don't start with `/`. `'.evil.com/x'` rewrites the
 *     host to `api-connect.eos.com.evil.com`; `'@evil.com/x'` parses as
 *     `userinfo@evil.com`. Both would send the API key off-domain. We
 *     reject anything that doesn't begin with exactly one `/`, AND we
 *     re-parse and assert the resolved origin still equals `EOSDA_BASE`.
 *   - Unparseable path: undici's `fetch` throws a `TypeError` whose
 *     `.message` includes the FULL URL (e.g. `Failed to parse URL from
 *     https://api-connect.eos.com/.../?api_key=…`). When `useQueryAuth` is
 *     on, that message would carry the API key into both our log line and
 *     any caller's error handler. By pre-parsing here — BEFORE we append
 *     the key — we either throw our own clean error (no key in message) or
 *     guarantee the subsequent `fetch` URL parse cannot fail.
 */
function assertSafePath(path: string): void {
  if (/[?&]api_key=/.test(path)) {
    throw new Error('eosdaRequest: do not put `api_key` in the path; the client manages auth.');
  }
  // Control / whitespace characters that fetch/undici would either reject
  // with a URL-echoing message or smuggle as a header break. Cheaper to
  // refuse them outright than to harden every downstream log line.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: this regex's entire purpose is to detect control characters in untrusted input.
  if (/[\x00-\x1f\x7f]/.test(path)) {
    throw new Error('eosdaRequest: path contains a control character.');
  }
  if (path.includes('#')) {
    throw new Error('eosdaRequest: URL fragments are not allowed in the path.');
  }
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('eosdaRequest: path must start with a single `/`.');
  }
  let parsed: URL;
  try {
    // The constructed URL must NOT include the API key — if this throws,
    // its message is allowed to be observed by the caller.
    parsed = new URL(`${EOSDA_BASE}${path}`);
  } catch {
    throw new Error(`eosdaRequest: invalid path ${JSON.stringify(sanitisePathForLog(path))}`);
  }
  if (parsed.origin !== EOSDA_BASE) {
    throw new Error(
      `eosdaRequest: path resolved off-origin (got ${parsed.origin}); expected ${EOSDA_BASE}.`,
    );
  }
  // Encoded forms — `%61pi_key=` decodes to `api_key=` only after
  // URLSearchParams parsing, which the literal regex above never sees.
  // `URLSearchParams` decodes percent sequences in BOTH names and values
  // at construction time, so this catches every encoding the regex would
  // have missed without us re-implementing percent decoding by hand.
  if (parsed.searchParams.has('api_key')) {
    throw new Error('eosdaRequest: do not put `api_key` in the path; the client manages auth.');
  }
}

/**
 * Issue a request against `EOSDA_BASE + path`.
 *
 * Generic `T` is the parsed JSON response shape. The function is intentionally
 * unsafe at the type boundary — EOSDA endpoints return loosely-typed objects
 * and each caller is expected to validate the response with a zod schema (or
 * narrow it manually). Keeping the cast in one place means the logger and
 * error-mapping code below can stay thin.
 */
export async function eosdaRequest<T>(path: string, options: EosdaRequestOptions = {}): Promise<T> {
  const { useQueryAuth = false, log, headers: callerHeaders, ...init } = options;

  assertSafePath(path);
  const logPath = sanitisePathForLog(path);

  const headers = new Headers(callerHeaders);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let requestPath = path;
  if (useQueryAuth) {
    headers.delete('x-api-key');
    requestPath = withQueryApiKey(path, env.EOSDA_API_KEY);
  } else {
    headers.set('x-api-key', env.EOSDA_API_KEY);
  }

  const url = `${EOSDA_BASE}${requestPath}`;

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch (cause) {
    log?.error({ path: logPath, err: cause }, 'eosda fetch failed');
    throw cause;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    log?.error({ path: logPath, status: response.status }, 'eosda non-2xx');
    throw new EosdaError(response.status, logPath, body);
  }

  log?.info({ path: logPath, status: response.status }, 'eosda ok');
  return (await response.json()) as T;
}

/**
 * Issue a raw fetch against `EOSDA_BASE + path` and return the `Response`
 * untouched. Use for binary endpoints where the caller needs to stream or
 * forward the body verbatim — chiefly the Render API tile proxy in Module
 * 6.3 — and where `response.json()` would be wrong.
 *
 * Reuses every security guard `eosdaRequest` enforces:
 *   - `assertSafePath` (rejects `api_key=` smuggling, control chars, URL
 *     fragments, off-origin host injection, unparseable paths).
 *   - Header-auth wiring: `x-api-key` is set from `env.EOSDA_API_KEY`
 *     unless `useQueryAuth` flips to the `?api_key=` fallback. Callers
 *     that want a different auth shape are deliberately not supported —
 *     this is the single source of EOSDA auth.
 *   - Sanitised logging: only `path` and `status` reach the logger; the
 *     full URL (which may carry the API key) and the response body are
 *     never written. Non-2xx is logged at `error`, success at `info`.
 *
 * Intentionally does NOT:
 *   - Set a default `Content-Type` (binary requests rarely need one and
 *     blindly setting `application/json` would mis-frame any caller body).
 *   - Read or parse the response body. The caller decides whether to
 *     `.arrayBuffer()`, `.body` stream, or discard the response.
 *   - Map non-2xx to an `EosdaError`. The route-level handler (M6.3)
 *     wants to mirror the upstream status without leaking the upstream
 *     body, so it inspects `response.ok` itself.
 */
export async function eosdaFetch(
  path: string,
  options: EosdaRequestOptions = {},
): Promise<Response> {
  const { useQueryAuth = false, log, headers: callerHeaders, ...init } = options;

  assertSafePath(path);
  const logPath = sanitisePathForLog(path);

  const headers = new Headers(callerHeaders);

  let requestPath = path;
  if (useQueryAuth) {
    headers.delete('x-api-key');
    requestPath = withQueryApiKey(path, env.EOSDA_API_KEY);
  } else {
    headers.set('x-api-key', env.EOSDA_API_KEY);
  }

  const url = `${EOSDA_BASE}${requestPath}`;

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch (cause) {
    log?.error({ path: logPath, err: cause }, 'eosda fetch failed');
    throw cause;
  }

  if (response.ok) {
    log?.info({ path: logPath, status: response.status }, 'eosda ok');
  } else {
    log?.error({ path: logPath, status: response.status }, 'eosda non-2xx');
  }

  return response;
}

/**
 * Object-style alias matching the spec wording in `docs/implementation.md`
 * §4.1 ("`eosda.request(path, init)`"). Re-exports `eosdaRequest` so callers
 * may import either shape without churn. `fetch` is exposed alongside it for
 * the Module 6.3 Render proxy and any future binary endpoints.
 */
export const eosda = {
  request: eosdaRequest,
  fetch: eosdaFetch,
};
