# Docs i18n Runtime, Routing, and CI Gates

## Objective

Close runtime and pipeline gaps so docs i18n quality is enforced in both local development and CI.

## Primary targets

- `packages/web/src/components/Footer.astro`
- `packages/web/src/content.config.ts` (if type-shape fix is needed)
- `packages/web/src/middleware.ts`
- `packages/web/scripts/i18n-common.ts`
- `.github/workflows/typecheck.yml` (or dedicated docs workflow)
- `packages/web/package.json` (if convenience check script is added)

## Implementation plan

1. Resolve Footer translation typing failure.
   - Fix `Astro.locals.t("app.footer.issueLink")` and `Astro.locals.t("app.footer.discordLink")` failures in `src/components/Footer.astro`.
   - Keep translation keys intact across locale dictionaries.
2. Add docs correctness gates to CI.
   - Ensure pull requests to `dev` run:
     - `bun run --cwd=packages/web i18n:check`
     - `bun --cwd packages/web astro check`
     - `bun --cwd packages/web build`
3. Keep diagnostics actionable.
   - Preserve separate command output so failures are easy to triage.
4. Resolve locale alias routing compatibility decision.
   - Evaluate path-level canonicalization for `/docs/br/...`, `/docs/no/...`, `/docs/zh/...`, `/docs/zht/...`.
   - If implemented, redirect to canonical paths (`pt-br`, `nb`, `zh-cn`, `zh-tw`) for all docs paths, not only `/docs` root negotiation.
   - If deferred, record explicit rationale and follow-up owner.
5. Reduce locale mapping drift risk.
   - Consolidate canonical locale and alias mapping into shared constants used by middleware and scripts.

## Dependencies

- Can run in parallel with spec 18.
- Should complete before spec 20 finalizes stricter guardrails.

## Acceptance criteria

- `bun --cwd packages/web astro check` passes.
- CI enforces docs i18n, docs typecheck, and docs build checks on pull requests to `dev`.
- Locale alias routing behavior is implemented or explicitly deferred with rationale.
- `bun run --cwd=packages/web i18n:check` and `bun --cwd packages/web build` stay green.

## Validation commands

```bash
bun --cwd packages/web astro check
bun run --cwd=packages/web i18n:check
bun --cwd packages/web build
rg -n 'astro check|packages/web build|i18n:check' .github/workflows/typecheck.yml
```
