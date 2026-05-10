import { getAuth } from '@clerk/fastify';
import { createFieldDto, type FieldDto, fieldDto, updateFieldDto } from '@viz-crop/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DatabaseError } from 'pg';
import { type ZodError, z } from 'zod';
import { geometryFromGeoJson, geometryToGeoJson } from '../db/geometry.js';
import { fields } from '../db/schema.js';
import { requireUser } from '../plugins/auth.js';
import { warmField } from '../services/field-warmup.js';

/**
 * Reusable projection that mirrors the columns of `fieldDto` exactly, with
 * `geometry` reprojected from the PostGIS column to a GeoJSON object via
 * `geometryToGeoJson`. Use the same projection for every read path
 * (GET list, GET one, PATCH `.returning(...)`) so the response shape stays
 * uniform and `fieldDto.parse(row)` always sees a parsed geometry object.
 */
const fieldSelect = {
  id: fields.id,
  userId: fields.userId,
  name: fields.name,
  cropType: fields.cropType,
  season: fields.season,
  farmerName: fields.farmerName,
  village: fields.village,
  district: fields.district,
  state: fields.state,
  geometry: geometryToGeoJson(fields.geometry),
  areaHectares: fields.areaHectares,
  eosdaCropperRef: fields.eosdaCropperRef,
  sowingDate: fields.sowingDate,
  createdAt: fields.createdAt,
  updatedAt: fields.updatedAt,
};

/** Path-param schema — `:id` must always be a UUID. */
const idParamSchema = z.object({ id: z.uuid() });

/**
 * Translate a zod validation failure into a 400 with a compact
 * `{ field: [messages] }` map (`z.flattenError`). Throws via
 * `app.httpErrors.badRequest` so Fastify renders the standard error envelope.
 */
function rejectInvalidRequest(
  app: FastifyInstance,
  error: ZodError,
  message = 'Invalid request',
): never {
  const flat = z.flattenError(error);
  throw app.httpErrors.badRequest(
    `${message}: ${JSON.stringify({
      formErrors: flat.formErrors,
      fieldErrors: flat.fieldErrors,
    })}`,
  );
}

/**
 * Map a `pg.DatabaseError` raised by the geometry CHECK constraints into a
 * 400 instead of letting it surface as a 500. `polygonGeoJsonSchema` already
 * rejects bbox/closure issues, but it does not catch self-intersections —
 * those only fail at the database via `fields_geometry_valid` (SQLSTATE
 * `23514`). Re-throw anything else so unrelated DB errors keep their 500.
 */
function rejectGeometryConstraintError(app: FastifyInstance, error: unknown): never {
  if (error instanceof DatabaseError && error.code === '23514') {
    if (error.constraint === 'fields_geometry_valid') {
      throw app.httpErrors.badRequest(
        'Invalid field geometry: polygon is self-intersecting or otherwise not OGC-valid',
      );
    }
    if (error.constraint === 'fields_geometry_srid') {
      throw app.httpErrors.badRequest('Invalid field geometry: SRID must be EPSG:4326');
    }
  }
  throw error;
}

/** Return the authenticated `userId` (`requireUser` guarantees presence). */
function authedUserId(request: FastifyRequest): string {
  const { userId } = getAuth(request);
  if (!userId) {
    // Defensive: requireUser should have rejected this already.
    throw request.server.httpErrors.unauthorized('Authentication required');
  }
  return userId;
}

export async function fieldRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/fields — list all fields owned by the authenticated user,
   * newest first. Geometry is projected to GeoJSON via `fieldSelect`.
   */
  app.get('/fields', { preHandler: requireUser }, async (request) => {
    const userId = authedUserId(request);

    const rows = await app.db
      .select(fieldSelect)
      .from(fields)
      .where(eq(fields.userId, userId))
      .orderBy(desc(fields.createdAt));

    const list: FieldDto[] = rows.map((row) => fieldDto.parse(row));
    return { fields: list };
  });

  /**
   * POST /api/fields — create a new field. Body is parsed by
   * `createFieldDto`; geometry is built via `geometryFromGeoJson` so the
   * server-side SRID/typing remains authoritative.
   */
  app.post('/fields', { preHandler: requireUser }, async (request, reply: FastifyReply) => {
    const userId = authedUserId(request);

    const parsed = createFieldDto.safeParse(request.body);
    if (!parsed.success) rejectInvalidRequest(app, parsed.error, 'Invalid request body');

    const dto = parsed.data;

    let inserted: { id: string }[];
    try {
      inserted = await app.db
        .insert(fields)
        .values({
          userId,
          name: dto.name,
          cropType: dto.cropType,
          season: dto.season,
          farmerName: dto.farmerName ?? null,
          village: dto.village ?? null,
          district: dto.district ?? null,
          state: dto.state ?? null,
          sowingDate: dto.sowingDate ?? null,
          geometry: geometryFromGeoJson(dto.geometry),
        })
        .returning({ id: fields.id });
    } catch (error) {
      rejectGeometryConstraintError(app, error);
    }

    const row = inserted[0];
    if (!row) {
      // Should be unreachable: INSERT ... RETURNING always returns the row
      // unless the statement raised. Treat as 500 so the bug is loud.
      throw app.httpErrors.internalServerError('Insert returned no row');
    }

    // Module 4.6: kick off EOSDA cropper task + initial scene/NDVI cache
    // warm-up. Fire-and-forget; the .catch ensures any rejection that escapes
    // warmField's internal handlers is logged with `{ fieldId, err }` rather
    // than becoming an unhandledRejection that crashes the server.
    void warmField(row.id, { db: app.db, log: request.log }).catch((err) => {
      request.log.error({ err, fieldId: row.id }, 'warm failed');
    });

    reply.code(201);
    return { id: row.id };
  });

  /**
   * GET /api/fields/:id — fetch a single field. 404 if it does not exist
   * OR is owned by a different user (we deliberately do not distinguish so
   * other users' UUIDs can't be enumerated).
   */
  app.get('/fields/:id', { preHandler: requireUser }, async (request) => {
    const userId = authedUserId(request);

    const params = idParamSchema.safeParse(request.params);
    if (!params.success) rejectInvalidRequest(app, params.error, 'Invalid path parameters');

    const rows = await app.db
      .select(fieldSelect)
      .from(fields)
      .where(and(eq(fields.id, params.data.id), eq(fields.userId, userId)))
      .limit(1);

    const row = rows[0];
    if (!row) throw app.httpErrors.notFound('Field not found');

    return fieldDto.parse(row);
  });

  /**
   * PATCH /api/fields/:id — update metadata fields only. Geometry is
   * immutable (see `updateFieldDto` JSDoc). Ownership is checked inside the
   * `WHERE` of the UPDATE so there is no TOCTOU window between a separate
   * SELECT and the mutation.
   */
  app.patch('/fields/:id', { preHandler: requireUser }, async (request) => {
    const userId = authedUserId(request);

    const params = idParamSchema.safeParse(request.params);
    if (!params.success) rejectInvalidRequest(app, params.error, 'Invalid path parameters');

    const parsed = updateFieldDto.safeParse(request.body);
    if (!parsed.success) rejectInvalidRequest(app, parsed.error, 'Invalid request body');

    const dto = parsed.data;

    // Build the SET payload only from keys actually present in the parsed
    // DTO so we don't accidentally null-out columns the user didn't touch.
    // `updateFieldDto` already guarantees at least one key is present.
    const setPayload: Record<string, unknown> = { updatedAt: sql`now()` };
    if (dto.name !== undefined) setPayload.name = dto.name;
    if (dto.cropType !== undefined) setPayload.cropType = dto.cropType;
    if (dto.season !== undefined) setPayload.season = dto.season;
    if (dto.farmerName !== undefined) setPayload.farmerName = dto.farmerName;
    if (dto.village !== undefined) setPayload.village = dto.village;
    if (dto.district !== undefined) setPayload.district = dto.district;
    if (dto.state !== undefined) setPayload.state = dto.state;
    if (dto.sowingDate !== undefined) setPayload.sowingDate = dto.sowingDate;

    const updated = await app.db
      .update(fields)
      .set(setPayload)
      .where(and(eq(fields.id, params.data.id), eq(fields.userId, userId)))
      .returning(fieldSelect);

    const row = updated[0];
    if (!row) throw app.httpErrors.notFound('Field not found');

    return fieldDto.parse(row);
  });

  /**
   * DELETE /api/fields/:id — hard delete. ON DELETE CASCADE on
   * `cached_scenes.field_id` / `cached_ndvi_stats.field_id` cleans up
   * derived rows automatically.
   */
  app.delete('/fields/:id', { preHandler: requireUser }, async (request, reply: FastifyReply) => {
    const userId = authedUserId(request);

    const params = idParamSchema.safeParse(request.params);
    if (!params.success) rejectInvalidRequest(app, params.error, 'Invalid path parameters');

    const deleted = await app.db
      .delete(fields)
      .where(and(eq(fields.id, params.data.id), eq(fields.userId, userId)))
      .returning({ id: fields.id });

    if (deleted.length === 0) throw app.httpErrors.notFound('Field not found');

    reply.code(204);
    return null;
  });
}
