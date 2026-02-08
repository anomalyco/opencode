# Docs i18n Closeout Master Plan

## Context and current state

- Specs `09` through `16` delivered the Starlight i18n rollout in `packages/web` (locale routing, dictionaries, locale docs trees, and base i18n checks).
- Current validation state:
  - `bun run --cwd=packages/web i18n:check` passes.
  - `bun --cwd packages/web build` passes.
  - `bun --cwd packages/web astro check` fails on `src/components/Footer.astro` translation key typing for `app.footer.issueLink` and `app.footer.discordLink`.
- This closeout plan only covers remaining defects and missing enforcement gates. It does not reopen completed rollout work.

## Remaining gaps

1. Typecheck gap in docs app.
   - `astro check` is currently red due to Footer translation key typing.
2. Localized content integrity defects.
   - Full-width admonition openers (`：：：`) appear in `ja` and `zh-cn` locale docs.
   - Placeholder artifacts (`___W0___`, `___T1___`, etc.) appear in `zh-cn` locale docs.
   - Malformed markdown link artifacts (for example extra `]` in `...)]`) appear heavily in `ja` and `ru`, with smaller counts elsewhere.
   - Residual untranslated English prose appears in some locale pages (for example `de`, `tr`, `da` index content).
3. Guardrail coverage gaps.
   - `i18n-check-links.ts` blocks absolute `/docs/` links but does not detect malformed markdown links.
   - `i18n-check-ui-strings.ts` currently omits `src/components/Footer.astro`.
4. CI gate coverage gaps.
   - `.github/workflows/typecheck.yml` runs i18n checks, but not `packages/web astro check` or `packages/web build`.
5. Optional compatibility item unresolved.
   - Spec `09` compatibility redirects for `/docs/br/...`, `/docs/no/...`, `/docs/zh/...`, `/docs/zht/...` are not fully implemented for path-level alias prefixes.

## Spec breakdown

- `specs/18-docs-i18n-content-integrity-remediation.md`
- `specs/19-docs-i18n-runtime-routing-and-ci-gates.md`
- `specs/20-docs-i18n-guardrails-v2.md`

## Parallel execution plan

| Phase | Specs  | Parallelism                               |
| ----- | ------ | ----------------------------------------- |
| A     | 18, 19 | Fully parallel (content vs runtime/gates) |
| B     | 20     | Sequential after 18 and 19                |
| C     | 19     | Optional alias routing subtask            |

Parallel agent capacity:

- Phase A: 2 agents.
- Phase B: 1 agent.

## Definition of done

- `bun --cwd packages/web astro check` passes.
- `bun --cwd packages/web build` passes.
- `bun run --cwd=packages/web i18n:check` passes with strengthened checks.
- Known content integrity defects are remediated across required locales.
- CI enforces docs i18n checks plus docs type/build checks on pull requests to `dev`.
- Alias routing compatibility is either implemented or explicitly deferred with rationale.

## Validation commands

```bash
bun run --cwd=packages/web i18n:check
bun --cwd packages/web astro check
bun --cwd packages/web build
```
