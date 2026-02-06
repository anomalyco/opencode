# Docs i18n Guardrails and CI

## Objective

Prevent regressions by enforcing key parity, docs slug parity, locale-safe links, and no hardcoded English UI strings in docs shell components.

## Primary targets

- `packages/web/scripts/i18n-verify.ts` (new)
- `packages/web/scripts/i18n-check-keys.ts` (new)
- `packages/web/scripts/i18n-check-pages.ts` (new)
- `packages/web/scripts/i18n-check-links.ts` (new)
- `packages/web/scripts/i18n-check-ui-strings.ts` (new)
- `packages/web/package.json`
- `.github/workflows/typecheck.yml` (or a dedicated workflow)

## Implementation plan

1. Key parity check
   - Compare locale JSON keysets against English baseline.
   - Fail on missing keys or unexpected extra keys (unless explicitly allowlisted).
2. Page parity check
   - Compare locale docs slug sets against root English slug set.
   - Fail on missing locale pages.
3. Link safety check
   - Fail on internal absolute markdown links that start with `/docs/`.
4. UI string check
   - Scan targeted UI shell files for hardcoded English literals.
   - Keep an explicit allowlist for technical literals and command snippets.
5. Aggregate command
   - Add `i18n:check` script that runs all checks and is CI-ready.
6. CI integration
   - Add `packages/web` i18n checks to existing CI gate.

## Dependencies

- Depends on specs 14 and 15 completion.

## Acceptance criteria

- `bun --cwd packages/web run i18n:check` exists and fails on regression.
- CI runs i18n checks on pull requests to `dev`.
- Missing keys/pages and locale-breaking links are blocked automatically.

## Validation commands

```bash
bun --cwd packages/web run i18n:check
bun --cwd packages/web run i18n:check:keys
bun --cwd packages/web run i18n:check:pages
bun --cwd packages/web run i18n:check:links
bun --cwd packages/web run i18n:check:ui
bun --cwd packages/web build
```
