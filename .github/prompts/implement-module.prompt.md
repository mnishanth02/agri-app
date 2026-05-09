---
agent: anvil
description: Implement a single module from docs/implementation.md, following the project's tracking rules.
---

# Implement Module ${input:moduleId:e.g. 2.1} — ${input:moduleTitle:e.g. MapLibre installation + base styles}

Implement **Module ${input:moduleId} — ${input:moduleTitle}** from [docs/implementation.md](../../docs/implementation.md).

## Ground rules

1. Read the module section in [docs/implementation.md](../../docs/implementation.md) in full **before** writing any code. Also read every prerequisite listed in the module's `Depends on:` line, plus any `plan.md §N` sections it references in [docs/plan.md](../../docs/plan.md).
2. Follow [.github/copilot-instructions.md](../copilot-instructions.md): Biome only (no ESLint/Prettier), package names `@viz-crop/web` / `@viz-crop/api` / `@viz-crop/shared`, strict TS, env vars validated with zod, never commit `.env` files.
3. Do **not** jump ahead. Implement only the tasks inside this module — no work that belongs to a later module, even if it looks small. If a task explicitly says "leave a `// TODO Phase X` marker", leave the marker and stop.
4. Honor existing `> ⚠️ PENDING` and `> ⚠️ DEVIATION` notes on prior modules — don't undo them silently.
5. Do the steps in the listed order; later steps may assume earlier ones are done.

## Workflow

1. State a short plan: list the module's numbered tasks and which files you'll touch.
2. Use a todo list if the module has 3+ tasks.
3. Implement. Edit existing files instead of creating new ones where possible. Default to no comments unless the *why* is non-obvious.
4. After edits, run the relevant verification locally:
   - `pnpm --filter <package> typecheck`
   - `pnpm run ci` (Biome — never `pnpm ci`, that errors with `ERR_PNPM_CI_NOT_IMPLEMENTED`)
   - `pnpm --filter <package> test` if the module adds or touches tests
   - Whatever **Done when** criteria the module specifies (curl probes, dev-server smoke, build check, etc.)
5. Fix anything that fails before declaring done.

## When the module is complete

Per [.github/copilot-instructions.md](../copilot-instructions.md):

1. Mark the module heading with `✅ (completed YYYY-MM-DD)` in [docs/implementation.md](../../docs/implementation.md) using today's date.
2. If any task was deferred, add a `> ⚠️ PENDING:` blockquote directly below it explaining what remains and which future module will resolve it. Add a corresponding row to the `## Pending Items` table at the bottom of the file.
3. If any task was intentionally skipped or done differently, add a `> ⚠️ DEVIATION:` blockquote with the rationale.
4. If this module satisfies a previously open `PENDING` item, remove that row from the `## Pending Items` table and update the original blockquote with a resolution note.
5. If this is the last module in its phase, verify every **Phase exit criterion** and mark the phase heading `✅` as well.

## Reporting back

End with a 2–3 sentence summary: what shipped, what verifications passed, and any pending/deviation notes added. Reference touched files as markdown links.

## Stop conditions — ask before proceeding if:

- A prerequisite module isn't ✅ in [docs/implementation.md](../../docs/implementation.md).
- The module needs an env var or external account that isn't set up yet (check Pre-flight P.1 / P.2 / P.3).
- You'd need to make a destructive or hard-to-reverse change (force-push, drop tables, delete migrations, etc.).
- The module's instructions conflict with current code in a way that requires a real decision.
