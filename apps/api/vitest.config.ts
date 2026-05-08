import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The geometry round-trip test talks to a live PostGIS container — keep the
    // suite serial so multiple files sharing the same shared `pg.Pool` (from
    // `src/db/client.ts`) don't race on connection acquisition or teardown.
    fileParallelism: false,
  },
});
