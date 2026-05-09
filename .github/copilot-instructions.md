# Copilot Instructions — viz-crop

## Project Context

This is a monorepo (`apps/*`, `packages/*`) for an agricultural field visualization app. The implementation plan lives in `docs/implementation.md` and the architectural decisions in `docs/plan.md`.



## Module Tracking Rules

After completing work on any module from `docs/implementation.md`:

1. **Mark it complete** — Add a `✅` status marker next to the module heading in `docs/implementation.md` (e.g., `### Module 0.1 — Workspace skeleton ✅`).
2. **Record the completion date** — Append `(completed YYYY-MM-DD)` after the status marker.
3. **Pending / deferred items** — If any task within a completed module is intentionally deferred or needs follow-up later, add a `> ⚠️ PENDING:` blockquote directly below the relevant task describing what remains and which future module/phase will address it. Example:
   ```
   > ⚠️ PENDING: `transformRequest` auth branch not wired yet — will be completed in Module 6.4.
   ```
4. **Phase exit** — When all modules in a phase are marked ✅ and all phase exit criteria are verified, mark the phase heading with ✅ as well.

## Pending Items Tracking

Maintain a `## Pending Items` section at the bottom of `docs/implementation.md` (before the Appendix) as a quick-reference list:

```markdown
## Pending Items

| Module | Item | Blocked until | Notes |
|--------|------|---------------|-------|
| 0.8 | Remove `_auth-check` probe route | Phase 1 (Module 1.6) | Temporary route for auth verification |
```

When a pending item is resolved, remove it from the table.

## Code Conventions

- **Formatting & linting**: Biome only (no ESLint/Prettier). Run `pnpm check` locally, `pnpm run ci` in CI.
- **Package names**: `@viz-crop/web`, `@viz-crop/api`, `@viz-crop/shared`.
- **TypeScript**: Strict mode. Shared types/schemas live in `packages/shared`.
- **Env vars**: Validated with zod at startup. Never commit `.env` files.
- **Commits**: Reference the module being implemented (e.g., `feat(0.2): add docker-compose for PostGIS`).

## Implementation Order

Always follow `docs/implementation.md` top-to-bottom. Do not jump phases. Verify "Done when" criteria before moving on. If something is out of order, consult `docs/plan.md`.

## Testing
Use locally provisioned test credentials from secure, untracked sources (for example, a secret manager or local `.env` file). If hard-coded credentials were ever used outside local development, rotate them before reuse; environment variables are validated with zod at startup.
