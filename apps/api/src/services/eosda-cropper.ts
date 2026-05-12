/**
 * Module 4.2 — Cropper-ref creation/reuse.
 *
 * `getOrCreateCropperRef(field)` resolves the EOSDA Cropper handle for a
 * field's polygon. The handle is a 32-character hex hash returned by
 * `POST https://api-connect.eos.com/api/render/cropper/`; once created it is
 * reusable for the polygon's lifetime and is later appended as
 * `?cropper_ref=…` to every Render tile request so EOSDA clips imagery to
 * the AOI server-side.
 *
 * Contract — per `docs/implementation.md` Module 4.2 and
 * `docs/review-findings.md` §3.5.3:
 *
 *   1. **Reuse first.** If `field.eosdaCropperRef` is already set, return it
 *      without hitting the network. The Cropper API is idempotent in
 *      practice (same polygon → same hash) but we still avoid the round trip
 *      and the small risk of EOSDA hashing the same polygon to a different
 *      value if floating-point noise enters the JSON serialisation.
 *   2. **POST a Feature, not a bare polygon.** EOSDA's body wants a GeoJSON
 *      `Feature` whose `geometry` is the field polygon and whose
 *      `properties` may be an empty object.
 *   3. **Persist verbatim, validated.** The response shape is
 *      `{ "cropper_ref": "<32-char hex>" }`. We persist the value to
 *      `fields.eosda_cropper_ref` (TEXT) only after the regex check; we do
 *      NOT migrate this column to INTEGER/BIGINT and we do NOT confuse this
 *      identifier with the EOSDA Field-Management `field_id`.
 *   4. **Never throw to the caller.** Warm-up runs in parallel with
 *      Search/Stats and any of those failing must not abort the others. On
 *      any failure (non-2xx, network error, malformed response, DB write
 *      failure) we log a structured error and return `null` so the caller
 *      can continue without a cropper. Render then falls back to scene-wide
 *      tiles drawn under the field outline.
 *   5. **No key in logs.** Every log payload uses `{ fieldId, status, body }`
 *      or `{ fieldId, err }`. The full URL, `EOSDA_BASE`, and
 *      `EOSDA_API_KEY` are NEVER logged. The underlying `eosdaRequest`
 *      enforces this for its own log lines (path + status only); this file
 *      mirrors the contract for its own structured errors.
 *
 * End-to-end "create field → cropper appears" verification waits until
 * Module 4.6, when `warmField` is wired into `POST /api/fields`.
 */
import type { PolygonGeoJson } from '@viz-crop/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { type Db, db as sharedDb } from '../db/client.js';
import { fields } from '../db/schema.js';
import { EosdaError, type EosdaLogger, eosdaRequest } from './eosda-client.js';

/**
 * The minimum field shape `getOrCreateCropperRef` needs. Matches the
 * Drizzle column names (`eosdaCropperRef`, not `eosda_cropper_ref`) so
 * callers can pass the row they already have without a re-mapping step.
 */
export interface CropperFieldInput {
  id: string;
  geometry: PolygonGeoJson;
  eosdaCropperRef: string | null;
}

export interface GetOrCreateCropperRefOptions {
  /**
   * Drizzle handle to use for the `UPDATE`. Defaults to the process-wide
   * `sharedDb` so scratch scripts (the Module 4.2 Done-when smoke) work
   * without ceremony. Inside Fastify route handlers, prefer passing
   * `request.server.db` so the call participates in the app's pool lifecycle
   * (relevant in tests that spin up multiple Fastify instances).
   */
  db?: Db;
  /**
   * Structured logger. Defaults to a thin `console`-backed adapter.
   * Production callers should always pass `request.log` (pino) so failures
   * land alongside the request that triggered warm-up.
   */
  log?: EosdaLogger;
}

/**
 * The EOSDA Cropper response payload.
 *
 * The hex constraint is intentional: the Cropper docs guarantee 32 lowercase
 * hex characters, and persisting any value that fails this check would risk
 * silently corrupting `fields.eosda_cropper_ref` and feeding garbage into the
 * Render tile URL. If EOSDA ever returns something else, we'd rather log and
 * fall back than write it to the database.
 */
const cropperRefHexRegex = /^[0-9a-f]{32}$/;

const cropperResponseSchema = z.object({
  cropper_ref: z
    .string()
    .regex(cropperRefHexRegex, 'cropper_ref must be a 32-character lowercase hex string'),
});

/** A console-backed default logger. Replace in production via `options.log`. */
const consoleLog: EosdaLogger = {
  info: (obj, msg) => console.info(msg ?? '', obj),
  warn: (obj, msg) => console.warn(msg ?? '', obj),
  error: (obj, msg) => console.error(msg ?? '', obj),
};

/**
 * Resolve the EOSDA Cropper hash for `field`.
 *
 * Returns the existing or newly-created 32-char hex hash on success, or
 * `null` if any step (network, DB, validation) fails. Never throws.
 *
 * Side effect on success: `UPDATE fields SET eosda_cropper_ref = $1 WHERE id = $2`.
 */
export async function getOrCreateCropperRef(
  field: CropperFieldInput,
  options: GetOrCreateCropperRefOptions = {},
): Promise<string | null> {
  const { db = sharedDb, log = consoleLog } = options;

  if (field.eosdaCropperRef) {
    return field.eosdaCropperRef;
  }

  let raw: unknown;
  try {
    raw = await eosdaRequest<unknown>('/api/render/cropper/', {
      method: 'POST',
      body: JSON.stringify({
        type: 'Feature',
        properties: {},
        geometry: field.geometry,
      }),
      log,
    });
  } catch (err) {
    if (err instanceof EosdaError) {
      log.error(
        { fieldId: field.id, status: err.status, body: err.body },
        'cropper creation failed',
      );
    } else {
      log.error({ fieldId: field.id, err }, 'cropper creation failed');
    }
    return null;
  }

  const parsed = cropperResponseSchema.safeParse(raw);
  if (!parsed.success) {
    log.error(
      {
        fieldId: field.id,
        status: 200,
        body: z.flattenError(parsed.error),
      },
      'cropper response did not match expected shape',
    );
    return null;
  }

  const cropperRef = parsed.data.cropper_ref;

  try {
    await db.update(fields).set({ eosdaCropperRef: cropperRef }).where(eq(fields.id, field.id));
  } catch (err) {
    log.error({ fieldId: field.id, err }, 'cropper persistence failed');
    return null;
  }

  // Observability: prove the column was written. Without this, a regression
  // in warm-up's lifecycle (e.g. detached promise killed by a dev-server
  // restart) leaves NULL rows behind silently. We log the fieldId only —
  // the hash itself is uninteresting in logs and can be inspected from the DB.
  log.info({ fieldId: field.id }, 'cropper persisted');

  return cropperRef;
}
