/**
 * Module 4.4 — Integration tests for the scene cache service.
 *
 * Done-when contract from `docs/implementation.md` §4.4:
 *   - "Inserts and re-inserts of the same `view_id` are idempotent."
 *
 * What we cover beyond the headline requirement (the bug-finding stuff
 * Module 4.5/4.6 will inherit):
 *   - First INSERT writes every column from the `SceneDto`.
 *   - Re-INSERTing the same `(field_id, view_id)` does NOT add a row,
 *     refreshes the mutable columns from the new payload, advances
 *     `last_seen_at`, and preserves `created_at`.
 *   - `listScenes` orders newest-first; `dateRange.from`/`to` are
 *     inclusive bounds against `scene_date`.
 *   - `getMostRecentScene` returns the latest-by-date row (NOT the
 *     latest-by-insert-order) and `null` for a field with no cache.
 *   - The numeric → number coercion in `rowToSceneDto` round-trips
 *     `cloudPercent` / `dataCoveragePercent` cleanly through the
 *     `numeric(5, 2)` PostgreSQL type.
 *   - Empty `scenes` array on `upsertScenes` is a no-op (no DB call,
 *     no error).
 *
 * Why integration tests instead of mocking Drizzle:
 *   - The whole point of this service is the `INSERT ... ON CONFLICT
 *     DO UPDATE` SQL. Mocking Drizzle would just assert that we built
 *     the call we built; running it against PostgreSQL proves the
 *     unique constraint actually fires the upsert path and that
 *     `excluded.<col>` resolves to the new payload.
 *   - We already have the dev PostGIS container up for `geometry.test.ts`
 *     and `fields.routes.test.ts`; reusing it is free.
 *
 * Isolation:
 *   - Each test inserts its own `fields` row with a unique `user_id`
 *     namespaced via `crypto.randomUUID()`, then deletes it (and via
 *     `ON DELETE CASCADE`, all its `cached_scenes` rows) in a
 *     `try/finally`. Failures mid-test still clean up.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { type Db, pool } from '../db/client.js';
import { geometryFromGeoJson } from '../db/geometry.js';
import { fields } from '../db/schema.js';
import type { SceneDto } from './eosda-search.js';
import { getMostRecentScene, listScenes, upsertScenes } from './scene-cache.js';

// Pool is shared across describes in this file; close it once at the very
// end so the second `describe` block doesn't try to acquire from a
// `pool.end()`-ed pool. Vitest's per-file isolation means other test files
// keep their own pool.
afterAll(async () => {
  await pool.end();
});

// ~1 ha plot near Mandya, Karnataka. Same shape used by geometry.test.ts /
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

function sceneFixture(overrides: Partial<SceneDto> = {}): SceneDto {
  return {
    sceneId: 'S2B_test_default',
    viewId: 'S2B/MSI/L2A/2026/05/01/T43PFR/0/B04',
    sceneDate: '2026-05-01',
    cloudPercent: 12.5,
    dataCoveragePercent: 99.42,
    tmsTemplate: 'https://render.eosda.com/tile/S2B_test_default/{z}/{x}/{y}.png',
    ...overrides,
  };
}

/**
 * Seed a `fields` row using a pinned connection and return both the
 * field id and a teardown closure. The closure deletes the field
 * (cascading any `cached_scenes` rows) and releases the connection.
 *
 * We use a single `PoolClient` per test rather than the shared pool
 * directly so a) every test owns its own DB session and b) the
 * cascading delete in `cleanup` is observed by the same session that
 * inserted the rows (no replication-lag flakiness in case the dev
 * container is ever swapped for a HA setup).
 */
async function seedField(): Promise<{
  fieldId: string;
  db: Db;
  cleanup: () => Promise<void>;
}> {
  const client = await pool.connect();
  const db: Db = drizzle(client);
  const userId = `test-scene-cache-${randomUUID()}`;
  const inserted = await db
    .insert(fields)
    .values({
      userId,
      name: 'Scene cache test field',
      cropType: 'wheat',
      season: 'rabi-2025-26',
      geometry: geometryFromGeoJson(POLYGON),
    })
    .returning({ id: fields.id });
  const row = inserted[0];
  if (!row) throw new Error('seed insert returned no row');
  const fieldId = row.id;

  return {
    fieldId,
    db,
    cleanup: async () => {
      try {
        // ON DELETE CASCADE on cached_scenes.field_id wipes the cache rows.
        await client.query('DELETE FROM fields WHERE id = $1', [fieldId]);
      } finally {
        client.release();
      }
    },
  };
}

describe('scene-cache — upsertScenes', () => {
  it('writes every column on first insert and round-trips numerics cleanly', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      const scene = sceneFixture({
        sceneId: 'S2B_first',
        viewId: 'view/first',
        sceneDate: '2026-04-15',
        cloudPercent: 7.25,
        dataCoveragePercent: 88.5,
      });

      await upsertScenes(fieldId, [scene], { db });

      const result = await db.execute<{
        scene_id: string;
        view_id: string;
        scene_date: string;
        cloud_percent: string;
        data_coverage_percent: string;
        tms_template: string;
        created_at: string;
        last_seen_at: string;
      }>(
        sql`SELECT scene_id, view_id, scene_date::text AS scene_date,
                   cloud_percent::text AS cloud_percent,
                   data_coverage_percent::text AS data_coverage_percent,
                   tms_template,
                   created_at::text AS created_at,
                   last_seen_at::text AS last_seen_at
            FROM cached_scenes WHERE field_id = ${fieldId}`,
      );
      expect(result.rows).toHaveLength(1);
      const row = result.rows[0];
      if (!row) throw new Error('unreachable');
      expect(row.scene_id).toBe('S2B_first');
      expect(row.view_id).toBe('view/first');
      expect(row.scene_date).toBe('2026-04-15');
      // numeric(5, 2) preserves to 2 decimal places; pg returns string.
      expect(Number(row.cloud_percent)).toBeCloseTo(7.25, 2);
      expect(Number(row.data_coverage_percent)).toBeCloseTo(88.5, 2);
      expect(row.tms_template).toBe(scene.tmsTemplate);
      // timestamptz columns return as ISO-with-tz strings via the ::text cast;
      // both should parse to a finite epoch and last_seen_at should be >=
      // created_at on a fresh insert (defaults to now() for both).
      expect(Number.isFinite(Date.parse(row.created_at))).toBe(true);
      expect(Date.parse(row.last_seen_at)).toBeGreaterThanOrEqual(Date.parse(row.created_at));
    } finally {
      await cleanup();
    }
  });

  it('is idempotent: re-inserting the same view_id keeps row count at 1', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      const scene = sceneFixture({ viewId: 'view/idempotent' });

      await upsertScenes(fieldId, [scene], { db });
      await upsertScenes(fieldId, [scene], { db });
      await upsertScenes(fieldId, [scene], { db });

      const result = await db.execute<{ count: string }>(
        sql`SELECT COUNT(*)::text AS count FROM cached_scenes WHERE field_id = ${fieldId}`,
      );
      expect(result.rows[0]?.count).toBe('1');
    } finally {
      await cleanup();
    }
  });

  it('refreshes mutable columns and advances last_seen_at; preserves created_at', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      const initial = sceneFixture({
        sceneId: 'S2B_v1',
        viewId: 'view/refresh',
        sceneDate: '2026-04-10',
        cloudPercent: 30.0,
        dataCoveragePercent: 50.0,
        tmsTemplate: 'https://render.eosda.com/tile/v1/{z}/{x}/{y}.png',
      });
      await upsertScenes(fieldId, [initial], { db });

      const before = await db.execute<{ created_at: string; last_seen_at: string }>(
        sql`SELECT created_at::text AS created_at, last_seen_at::text AS last_seen_at
            FROM cached_scenes
            WHERE field_id = ${fieldId} AND view_id = 'view/refresh'`,
      );
      const beforeRow = before.rows[0];
      if (!beforeRow) throw new Error('unreachable');
      const initialCreatedAt = beforeRow.created_at;
      const initialLastSeenAt = beforeRow.last_seen_at;

      // Force at least one millisecond gap so `last_seen_at` definitively
      // moves forward. PostgreSQL `now()` returns transaction time at
      // statement granularity but separate statements should tick.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const refreshed = sceneFixture({
        sceneId: 'S2B_v2',
        viewId: 'view/refresh',
        sceneDate: '2026-04-11',
        cloudPercent: 5.5,
        dataCoveragePercent: 99.0,
        tmsTemplate: 'https://render.eosda.com/tile/v2/{z}/{x}/{y}.png',
      });
      await upsertScenes(fieldId, [refreshed], { db });

      const after = await db.execute<{
        scene_id: string;
        scene_date: string;
        cloud_percent: string;
        data_coverage_percent: string;
        tms_template: string;
        created_at: string;
        last_seen_at: string;
      }>(
        sql`SELECT scene_id, scene_date::text AS scene_date,
                   cloud_percent::text AS cloud_percent,
                   data_coverage_percent::text AS data_coverage_percent,
                   tms_template,
                   created_at::text AS created_at,
                   last_seen_at::text AS last_seen_at
            FROM cached_scenes
            WHERE field_id = ${fieldId} AND view_id = 'view/refresh'`,
      );
      const afterRow = after.rows[0];
      if (!afterRow) throw new Error('unreachable');

      // All mutable columns refreshed.
      expect(afterRow.scene_id).toBe('S2B_v2');
      expect(afterRow.scene_date).toBe('2026-04-11');
      expect(Number(afterRow.cloud_percent)).toBeCloseTo(5.5, 2);
      expect(Number(afterRow.data_coverage_percent)).toBeCloseTo(99.0, 2);
      expect(afterRow.tms_template).toBe(refreshed.tmsTemplate);
      // created_at is immutable: same text representation before vs after.
      expect(afterRow.created_at).toBe(initialCreatedAt);
      // last_seen_at advanced. Compare as instants via Date.parse since
      // PostgreSQL emits ISO-with-tz which Date can parse losslessly.
      expect(Date.parse(afterRow.last_seen_at)).toBeGreaterThan(Date.parse(initialLastSeenAt));
    } finally {
      await cleanup();
    }
  });

  it('handles a batch insert of multiple scenes for the same field', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      const scenes = [
        sceneFixture({ viewId: 'view/a', sceneDate: '2026-04-01' }),
        sceneFixture({ viewId: 'view/b', sceneDate: '2026-04-08' }),
        sceneFixture({ viewId: 'view/c', sceneDate: '2026-04-15' }),
      ];
      await upsertScenes(fieldId, scenes, { db });

      const result = await db.execute<{ count: string }>(
        sql`SELECT COUNT(*)::text AS count FROM cached_scenes WHERE field_id = ${fieldId}`,
      );
      expect(result.rows[0]?.count).toBe('3');
    } finally {
      await cleanup();
    }
  });

  it('is a no-op (no error, no DB call) for an empty scenes array', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      await upsertScenes(fieldId, [], { db });
      const result = await db.execute<{ count: string }>(
        sql`SELECT COUNT(*)::text AS count FROM cached_scenes WHERE field_id = ${fieldId}`,
      );
      expect(result.rows[0]?.count).toBe('0');
    } finally {
      await cleanup();
    }
  });

  it('refuses to write a scene with non-finite cloudPercent (defends against poisoned cache)', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      const bad = sceneFixture({ viewId: 'view/nan', cloudPercent: Number.NaN });
      await expect(upsertScenes(fieldId, [bad], { db })).rejects.toThrow(/non-finite cloudPercent/);
      // Nothing written.
      const result = await db.execute<{ count: string }>(
        sql`SELECT COUNT(*)::text AS count FROM cached_scenes WHERE field_id = ${fieldId}`,
      );
      expect(result.rows[0]?.count).toBe('0');
    } finally {
      await cleanup();
    }
  });

  it('refuses to write a scene with non-finite dataCoveragePercent', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      const bad = sceneFixture({
        viewId: 'view/inf',
        dataCoveragePercent: Number.POSITIVE_INFINITY,
      });
      await expect(upsertScenes(fieldId, [bad], { db })).rejects.toThrow(
        /non-finite dataCoveragePercent/,
      );
    } finally {
      await cleanup();
    }
  });
});

describe('scene-cache — read paths skip incomplete legacy rows', () => {
  it('listScenes filters out rows with NULL scene_id (pre-Module-4.4 backfill gap)', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      // Seed a complete row via the service.
      await upsertScenes(
        fieldId,
        [sceneFixture({ viewId: 'view/good', sceneDate: '2026-04-01' })],
        { db },
      );
      // Seed a legacy-shaped row (NULL scene_id) directly via SQL — this
      // is what an existing pre-migration row would look like after the
      // ALTER TABLE. The DTO mapper would throw on it, so the service
      // must filter it out at the SQL layer.
      await db.execute(
        sql`INSERT INTO cached_scenes (field_id, view_id, scene_date, cloud_percent, data_coverage_percent, tms_template)
            VALUES (${fieldId}, 'view/legacy', '2026-04-15', 10.0, 99.0, 'https://example/{z}/{x}/{y}.png')`,
      );

      const list = await listScenes(fieldId, { db });
      // Legacy row is silently filtered; only the complete row is returned.
      expect(list.map((s) => s.viewId)).toEqual(['view/good']);
    } finally {
      await cleanup();
    }
  });

  it('getMostRecentScene skips a legacy NULL-scene_id row even if it has the newest scene_date', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      // Older complete row.
      await upsertScenes(
        fieldId,
        [sceneFixture({ viewId: 'view/good', sceneDate: '2026-03-01' })],
        { db },
      );
      // Newer legacy row (NULL scene_id) — without the IS NOT NULL filter,
      // ORDER BY scene_date DESC would return this and rowToSceneDto would
      // throw, breaking Module 4.5's smoke check.
      await db.execute(
        sql`INSERT INTO cached_scenes (field_id, view_id, scene_date, cloud_percent, data_coverage_percent, tms_template)
            VALUES (${fieldId}, 'view/legacy', '2026-05-01', 5.0, 99.0, 'https://example/{z}/{x}/{y}.png')`,
      );

      const most = await getMostRecentScene(fieldId, { db });
      expect(most?.viewId).toBe('view/good');
      expect(most?.sceneDate).toBe('2026-03-01');
    } finally {
      await cleanup();
    }
  });
});

describe('scene-cache — listScenes', () => {
  it('returns scenes ordered newest-first by scene_date', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      // Insert OUT of date order so the ORDER BY is doing real work.
      await upsertScenes(
        fieldId,
        [
          sceneFixture({ viewId: 'view/old', sceneDate: '2026-03-01' }),
          sceneFixture({ viewId: 'view/new', sceneDate: '2026-05-01' }),
          sceneFixture({ viewId: 'view/mid', sceneDate: '2026-04-01' }),
        ],
        { db },
      );

      const list = await listScenes(fieldId, { db });
      expect(list.map((s) => s.sceneDate)).toEqual(['2026-05-01', '2026-04-01', '2026-03-01']);
      // SceneDto numerics are coerced back to numbers (not strings).
      expect(typeof list[0]?.cloudPercent).toBe('number');
      expect(typeof list[0]?.dataCoveragePercent).toBe('number');
    } finally {
      await cleanup();
    }
  });

  it('applies inclusive dateRange.from / dateRange.to filters', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      await upsertScenes(
        fieldId,
        [
          sceneFixture({ viewId: 'view/jan', sceneDate: '2026-01-15' }),
          sceneFixture({ viewId: 'view/feb', sceneDate: '2026-02-15' }),
          sceneFixture({ viewId: 'view/mar', sceneDate: '2026-03-15' }),
          sceneFixture({ viewId: 'view/apr', sceneDate: '2026-04-15' }),
        ],
        { db },
      );

      // Both bounds — inclusive on both ends.
      const both = await listScenes(fieldId, {
        db,
        dateRange: { from: '2026-02-15', to: '2026-03-15' },
      });
      expect(both.map((s) => s.sceneDate)).toEqual(['2026-03-15', '2026-02-15']);

      // from-only.
      const fromOnly = await listScenes(fieldId, { db, dateRange: { from: '2026-03-01' } });
      expect(fromOnly.map((s) => s.sceneDate)).toEqual(['2026-04-15', '2026-03-15']);

      // to-only.
      const toOnly = await listScenes(fieldId, { db, dateRange: { to: '2026-02-15' } });
      expect(toOnly.map((s) => s.sceneDate)).toEqual(['2026-02-15', '2026-01-15']);

      // Empty window.
      const empty = await listScenes(fieldId, {
        db,
        dateRange: { from: '2026-06-01', to: '2026-06-30' },
      });
      expect(empty).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('returns [] for a field with no cached scenes', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      const list = await listScenes(fieldId, { db });
      expect(list).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('isolates results to the requested field (no cross-field leak)', async () => {
    const a = await seedField();
    const b = await seedField();
    try {
      await upsertScenes(a.fieldId, [sceneFixture({ viewId: 'view/A' })], { db: a.db });
      await upsertScenes(b.fieldId, [sceneFixture({ viewId: 'view/B' })], { db: b.db });

      const aList = await listScenes(a.fieldId, { db: a.db });
      const bList = await listScenes(b.fieldId, { db: b.db });
      expect(aList.map((s) => s.viewId)).toEqual(['view/A']);
      expect(bList.map((s) => s.viewId)).toEqual(['view/B']);
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  });
});

describe('scene-cache — getMostRecentScene', () => {
  it('returns the newest-by-scene_date row', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      // Insert OUT of date order, including a clearly-older scene LAST,
      // so a "newest by insert order" implementation would fail.
      await upsertScenes(fieldId, [sceneFixture({ viewId: 'view/new', sceneDate: '2026-05-01' })], {
        db,
      });
      await upsertScenes(fieldId, [sceneFixture({ viewId: 'view/old', sceneDate: '2025-01-01' })], {
        db,
      });

      const most = await getMostRecentScene(fieldId, { db });
      expect(most?.sceneDate).toBe('2026-05-01');
      expect(most?.viewId).toBe('view/new');
    } finally {
      await cleanup();
    }
  });

  it('returns null for a field with no cached scenes', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      const most = await getMostRecentScene(fieldId, { db });
      expect(most).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('breaks ties by data_coverage_percent DESC, then cloud_percent ASC, then view_id ASC', async () => {
    const { fieldId, db, cleanup } = await seedField();
    try {
      // Three scenes with the same scene_date. Row B has the highest data
      // coverage so should win regardless of insert order.
      await upsertScenes(
        fieldId,
        [
          sceneFixture({
            viewId: 'view/A',
            sceneDate: '2026-05-10',
            dataCoveragePercent: 50,
            cloudPercent: 5,
          }),
          sceneFixture({
            viewId: 'view/B',
            sceneDate: '2026-05-10',
            dataCoveragePercent: 99,
            cloudPercent: 30,
          }),
          sceneFixture({
            viewId: 'view/C',
            sceneDate: '2026-05-10',
            dataCoveragePercent: 99,
            cloudPercent: 1,
          }),
        ],
        { db },
      );

      // Expected: among {B (99, 30), C (99, 1)} the lower cloudPercent
      // wins ⇒ C.
      const most = await getMostRecentScene(fieldId, { db });
      expect(most?.viewId).toBe('view/C');
    } finally {
      await cleanup();
    }
  });
});
