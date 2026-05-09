import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { createDbClient, type Db } from '../db/client.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
}

/**
 * Fastify plugin that decorates `app.db` with a Drizzle client and closes
 * the underlying pg `Pool` on `app.close`.
 *
 * Each registration creates its own `pg.Pool` via `createDbClient()` so
 * tests that build multiple Fastify apps in the same process don't share a
 * pool whose lifecycle is tied to whichever app closes first.
 *
 * Wrapped in `fastify-plugin` so the decorator escapes encapsulation and is
 * visible to every route plugin registered after this one.
 */
export const dbPlugin = fp(
  async (app: FastifyInstance): Promise<void> => {
    const { pool, db } = createDbClient();

    app.decorate('db', db);

    app.addHook('onClose', async () => {
      await pool.end();
    });
  },
  { name: 'db-plugin' },
);
