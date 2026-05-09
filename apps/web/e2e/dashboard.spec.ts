import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * Phase 0 + Phase 1 UI/UX smoke spec.
 *
 * Drives the custom Clerk-Core-3 sign-in form (apps/web/src/routes/sign-in.tsx),
 * exercises the dashboard chrome (header, logo, UserButton), the empty-state OR
 * field-list render path, and the placeholder routes that Phase 2/3 will replace.
 *
 * Credentials come from env vars so they aren't hardcoded; defaults match what
 * the user provided. Override with PW_USER_EMAIL / PW_USER_PASSWORD.
 */

const EMAIL = process.env.PW_USER_EMAIL ?? 'admin@gmail.com';
const PASSWORD = process.env.PW_USER_PASSWORD ?? 'Admin@123';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOTS_DIR = path.resolve(__dirname, 'screenshots');

test.describe('Phase 0/1 UI smoke', () => {
  test.beforeEach(async ({ page }) => {
    // Capture browser-console errors and unhandled rejections per-test so we
    // can assert at the end. Filter out Clerk dev-mode warnings that aren't
    // actual product bugs.
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Clerk in dev logs benign warnings about being on a development
        // instance; these aren't bugs. Suppress.
        if (text.includes('Clerk has been loaded with development keys')) return;
        // React-router devtools sometimes warns about HMR — also benign.
        if (text.includes('[vite]')) return;
        // Browser-level 404 chatter from the test's idempotent best-effort
        // cleanup fetch in `finally`. The DELETE happens twice on purpose
        // (UI delete + finally-block defensive delete) and the second one
        // returns 404 — that's expected, not a regression. Note: Chrome's
        // console message text does NOT include the URL, so we filter on
        // the exact wording.
        if (
          text === 'Failed to load resource: the server responded with a status of 404 (Not Found)'
        ) {
          return;
        }
        errors.push(text);
      }
    });
    page.on('pageerror', (err) => {
      errors.push(`pageerror: ${err.message}`);
    });
    // Stash on the page so the afterEach hook can read it.
    // biome-ignore lint/suspicious/noExplicitAny: test-only stash
    (page as any)._collectedErrors = errors;
  });

  test.afterEach(async ({ page }, testInfo) => {
    // biome-ignore lint/suspicious/noExplicitAny: test-only stash
    const errors: string[] = (page as any)._collectedErrors ?? [];
    if (errors.length > 0) {
      await testInfo.attach('console-errors.txt', {
        body: errors.join('\n'),
        contentType: 'text/plain',
      });
    }
    expect(errors, `Console errors during ${testInfo.title}`).toEqual([]);
  });

  test('signed-out / redirects to /sign-in', async ({ page }) => {
    // First page load can race with Vite's dev-mode dependency optimizer on
    // a cold server, so use `networkidle` and a generous URL-match timeout.
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '01-sign-in.png'),
      fullPage: true,
    });
  });

  test('sign-in form has all expected affordances', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByLabel(/^email$/i)).toBeVisible();
    await expect(page.getByLabel(/^password$/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /forgot password/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /^sign up$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
  });

  test('full signed-in flow: sign-in → dashboard → placeholders → sign-out', async ({ page }) => {
    test.setTimeout(90_000);

    // --- Sign in ---
    await page.goto('/sign-in');
    await page.getByLabel(/^email$/i).fill(EMAIL);
    await page.getByLabel(/^password$/i).fill(PASSWORD);
    await page.getByRole('button', { name: /^sign in$/i }).click();

    // After sign-in we land on `/` (the gated dashboard).
    await expect(page).toHaveURL(/^http:\/\/localhost:5173\/?(\?.*)?$/, {
      timeout: 30_000,
    });

    // --- Dashboard chrome ---
    await expect(page.getByRole('heading', { name: /your fields/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('link', { name: /viz-crop/i })).toBeVisible();
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '02-dashboard.png'),
      fullPage: true,
    });

    // Either EmptyState OR FieldList must be visible.
    const empty = page.getByRole('heading', { name: /add your first plot/i });
    const list = page.locator('[data-slot="dashboard-field-list"]');
    await expect(empty.or(list)).toBeVisible({ timeout: 10_000 });

    const isEmpty = await empty.isVisible();
    const fieldCards = page.locator('[data-slot="field-card"]');
    const cardCount = isEmpty ? 0 : await fieldCards.count();
    test.info().annotations.push({
      type: 'state',
      description: `dashboard ${isEmpty ? 'empty' : `populated (${cardCount} cards)`}`,
    });

    // --- /fields/new placeholder ---
    await page
      .getByRole('link', { name: /add field/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/fields\/new$/);
    await expect(page.getByRole('heading', { name: /new field placeholder/i })).toBeVisible();
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '03-fields-new.png'),
      fullPage: true,
    });

    // --- Back to dashboard via logo ---
    await page.getByRole('link', { name: /viz-crop/i }).click();
    await expect(page.getByRole('heading', { name: /your fields/i })).toBeVisible();

    // --- /fields/$id placeholder (only if a card exists) ---
    if (cardCount > 0) {
      const firstCardOpenLink = fieldCards.first().getByRole('link', { name: /^open field/i });
      await firstCardOpenLink.click();
      await expect(page).toHaveURL(/\/fields\/[0-9a-f-]{36}$/);
      await expect(page.getByRole('heading', { name: /field detail placeholder/i })).toBeVisible();
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, '04-fields-detail.png'),
        fullPage: true,
      });
      await page.goBack();
      await expect(page.getByRole('heading', { name: /your fields/i })).toBeVisible();
    }

    // --- Sign out via Clerk UserButton ---
    // The UserButton is a Clerk-controlled iframe-ish widget; click it then
    // wait for the menu, then the "Sign out" item.
    await page.locator('header').getByRole('button').last().click();
    await page
      .getByRole('menuitem', { name: /sign out/i })
      .or(page.getByRole('button', { name: /sign out/i }))
      .first()
      .click();

    // After sign-out we go back to /sign-in.
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 15_000 });
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '05-after-sign-out.png'),
      fullPage: true,
    });
  });

  test('rename + delete dialog round-trip (seeds + cleans up its own field)', async ({ page }) => {
    test.setTimeout(120_000);

    // Sign in (re-used flow).
    await page.goto('/sign-in');
    await page.getByLabel(/^email$/i).fill(EMAIL);
    await page.getByLabel(/^password$/i).fill(PASSWORD);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.getByRole('heading', { name: /your fields/i })).toBeVisible({
      timeout: 30_000,
    });

    // Seed a field directly via the API using the live Clerk session token.
    // This keeps the test independent of whether the user already has fields
    // and means we never touch real user data — every field this test creates
    // is named with a known prefix and removed in `finally`.
    const seedName = `e2e-seed-${Date.now()}`;
    const seededId = await page.evaluate(async (name) => {
      // biome-ignore lint/suspicious/noExplicitAny: Clerk global injected at runtime
      const w = window as any;
      const token = await w.Clerk?.session?.getToken();
      if (!token) throw new Error('No Clerk session token available');
      const res = await fetch('http://localhost:8080/api/fields', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name,
          cropType: 'Rice',
          season: 'Kharif',
          // ~1 ha polygon near Bengaluru (well inside the India bbox)
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [77.5946, 12.9716],
                [77.5956, 12.9716],
                [77.5956, 12.9726],
                [77.5946, 12.9726],
                [77.5946, 12.9716],
              ],
            ],
          },
        }),
      });
      if (!res.ok) throw new Error(`seed failed: ${res.status} ${await res.text()}`);
      const body = (await res.json()) as { id: string };
      return body.id;
    }, seedName);

    try {
      // Refresh so the new card shows up — staleTime is 5 min so we need to
      // explicitly invalidate by reloading.
      await page.reload();
      await expect(page.getByRole('heading', { name: /your fields/i })).toBeVisible({
        timeout: 15_000,
      });

      const seededCard = page.locator('[data-slot="field-card"]', { hasText: seedName }).first();
      await expect(seededCard).toBeVisible({ timeout: 10_000 });

      // --- Rename ---
      await seededCard.getByRole('button', { name: /^field actions/i }).click();
      await page.getByRole('menuitem', { name: /^rename$/i }).click();

      const dialog = page.getByRole('dialog', { name: /rename field/i });
      await expect(dialog).toBeVisible();
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, '06-rename-dialog.png'),
        fullPage: true,
      });

      const renamed = `${seedName}-renamed`;
      const input = dialog.getByLabel(/field name/i);
      await input.fill(renamed);
      await dialog.getByRole('button', { name: /^save$/i }).click();
      await expect(dialog).not.toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(renamed, { exact: true })).toBeVisible();

      // --- Delete (open + cancel + reopen + confirm) ---
      const renamedCard = page.locator('[data-slot="field-card"]', { hasText: renamed }).first();

      // Open + cancel
      await renamedCard.getByRole('button', { name: /^field actions/i }).click();
      await page.getByRole('menuitem', { name: /^delete$/i }).click();
      const alert = page.getByRole('alertdialog');
      await expect(alert).toBeVisible();
      await expect(alert.getByText(/permanently removes/i)).toBeVisible();
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, '07-delete-alert.png'),
        fullPage: true,
      });
      await alert.getByRole('button', { name: /^cancel$/i }).click();
      await expect(alert).not.toBeVisible();
      await expect(renamedCard).toBeVisible();

      // Reopen + confirm — this consumes our seeded field, so no manual
      // cleanup needed in the `finally` block when this branch wins.
      await renamedCard.getByRole('button', { name: /^field actions/i }).click();
      await page.getByRole('menuitem', { name: /^delete$/i }).click();
      const alert2 = page.getByRole('alertdialog');
      await expect(alert2).toBeVisible();
      await alert2.getByRole('button', { name: /^delete$/i }).click();
      await expect(alert2).not.toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(renamed, { exact: true })).not.toBeVisible();
    } finally {
      // Defensive cleanup — if any assertion above failed mid-flow the
      // seeded row might still be in the DB. Best-effort delete; ignore
      // errors so we don't mask the original failure.
      await page
        .evaluate(async (id) => {
          // biome-ignore lint/suspicious/noExplicitAny: Clerk global injected at runtime
          const w = window as any;
          const token = await w.Clerk?.session?.getToken();
          if (!token) return;
          await fetch(`http://localhost:8080/api/fields/${id}`, {
            method: 'DELETE',
            headers: { authorization: `Bearer ${token}` },
          }).catch(() => {});
        }, seededId)
        .catch(() => {});
    }
  });

  test('forgot-password page renders without errors', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByRole('link', { name: /forgot password/i }).click();
    await expect(page).toHaveURL(/\/forgot-password/);
    await expect(page.getByRole('heading', { name: /forgot password/i })).toBeVisible();
    await expect(page.getByLabel(/^email$/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /send reset code/i })).toBeVisible();
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '08-forgot-password.png'),
      fullPage: true,
    });
  });

  test('sign-up page renders without errors', async ({ page }) => {
    await page.goto('/sign-up');
    await expect(page.getByRole('heading', { name: /create an account/i })).toBeVisible();
    await expect(page.getByLabel(/first name/i)).toBeVisible();
    await expect(page.getByLabel(/last name/i)).toBeVisible();
    await expect(page.getByLabel(/^email$/i)).toBeVisible();
    await expect(page.getByLabel(/^password$/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '09-sign-up.png'),
      fullPage: true,
    });
  });
});
