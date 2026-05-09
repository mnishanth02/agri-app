import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // The geometry round-trip test talks to a live PostGIS container — keep the
    // suite serial so multiple files sharing the same shared `pg.Pool` (from
    // `src/db/client.ts`) don't race on connection acquisition or teardown.
    // Vitest's default per-file isolation still keeps `vi.mock` from leaking
    // between files even with serial execution.
    fileParallelism: false,
  },
});
