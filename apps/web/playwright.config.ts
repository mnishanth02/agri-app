import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for `apps/web` smoke tests.
 *
 * - We do NOT spawn dev servers via Playwright's `webServer` because the API
 *   side needs `pnpm --filter @viz-crop/api dev` running too. Run
 *   `pnpm dev` at the repo root in a separate terminal before invoking these
 *   specs.
 * - Chromium only — Phase 1 is a single-target smoke pass. Add Firefox /
 *   WebKit later if the team starts cross-browser testing.
 * - Sequential workers (workers: 1) because the smoke spec mutates shared
 *   account state (creates/renames/deletes fields). Parallelism would race.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
