# Docs i18n Guardrails v2

## Objective

Upgrade docs i18n checks to catch current defect patterns and prevent recurrence in localized content and shell UI.

## Primary targets

- `packages/web/scripts/i18n-check-links.ts`
- `packages/web/scripts/i18n-check-ui-strings.ts`
- `packages/web/scripts/i18n-verify.ts`
- `packages/web/scripts/i18n-check-content-integrity.ts` (new)
- `packages/web/scripts/i18n-check-allowlist.ts`
- `packages/web/package.json`

## Implementation plan

1. Add content integrity checker.
   - Create `i18n-check-content-integrity.ts` for non-root locale docs.
   - Fail on:
     - Full-width admonition opener patterns (`：：：`).
     - Placeholder artifact patterns (`___[A-Z0-9_]+___`).
     - Known residual untranslated prose patterns (bounded list, allowlist-backed).
2. Strengthen markdown link validation.
   - Keep absolute `/docs/` link protection.
   - Add malformed link detection for unbalanced or extra bracket artifacts.
3. Expand UI shell scan set.
   - Include `src/components/Footer.astro` in `i18n-check-ui-strings.ts` coverage.
   - Keep explicit allowlist behavior for sanctioned literals.
4. Wire checks into aggregate verification.
   - Add new check command(s) to `package.json` and `i18n-verify.ts`.
   - Keep checks runnable independently for targeted debugging.
5. Keep noise low.
   - Validate checker output against remediated baseline from spec 18.
   - Only add allowlist entries for proven false positives.

## Dependencies

- Depends on spec 18 completion (clean content baseline).
- Depends on spec 19 CI/runtime gating.

## Acceptance criteria

- `i18n:check` fails on known content integrity defects and malformed links.
- `i18n:check:ui` includes Footer scan coverage.
- Aggregate checks remain fast enough for local use and CI enforcement.
- `bun run --cwd=packages/web i18n:check` passes on clean baseline and fails on intentional seeded regressions.

## Validation commands

```bash
bun run --cwd=packages/web i18n:check:links
bun run --cwd=packages/web i18n:check:ui
bun run --cwd=packages/web i18n:check
bun --cwd packages/web astro check
bun --cwd packages/web build
```
