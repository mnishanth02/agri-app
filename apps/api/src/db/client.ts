import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { env } from '../env.js';

export type Db = NodePgDatabase;

export interface DbClient {
  pool: Pool;
  db: Db;
}

/**
 * Build a fresh `{ pool, db }` pair against `env.DATABASE_URL`.
 *
 * Each call returns its own `pg.Pool`, so tests that spin up multiple Fastify
 * apps don't share a pool whose lifecycle would be tied to whichever app
 * happens to close first.
 */
export function createDbClient(): DbClient {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
  });
  const db: Db = drizzle(pool);
  return { pool, db };
}

/**
 * Process-wide shared client for ad-hoc scripts, REPL sessions, and any
 * caller that owns the process lifecycle. Inside Fastify routes prefer
 * `app.db`, which is decorated by `dbPlugin` and tied to the app's lifecycle.
 */
const shared = createDbClient();
export const pool: Pool = shared.pool;
export const db: Db = shared.db;
