# Patterns — 20260926-v2018-bump

## 2026-09-26 — commit-work-first then version-bump sequence
- Intent: continue plan `20260926-v2018-bump`; commit pending work first, then perform v2.0.18 bump.
- Reuse findings from `20260926-missing-upstream` for upstream/base context.
- Source: researcher output, plan 20260926-v2018-bump.

## 2026-09-26 — v2 lineage, no changesets
- Base: `v2.0.18`, 76 commits ahead of `3a103fe0af`.
- Stay on `v2` lineage; repo does not use Changesets — follow existing release workflow.
- Source: researcher output / architectural decisions.

## 2026-09-26 — conventional commits
- Use conventional commit-style messages (`type(scope): summary`) for commit split.
- Source: architectural decisions, plan 20260926-v2018-bump.

## 2026-09-26 — Wave1 t0 gitignore hygiene verified
- `.gitignore` covers geany/workbuddy/catcheer; `.gitignore`-only +10L, `check-ignore` exit 0, commit `e8596ed840`.
- Source: Wave1 t0-gitignore-hygiene completion.

## 2026-09-26 — contract t0->t1 satisfied
- Handoff contract t0->t1 satisfied; proceed to t1 on clean hygiene baseline.
- Source: Wave1 persistence.

## 2026-09-26T00:00Z — t1-retry-schedule pure-regen verification pattern
- Verify retry-schedule via `generate` exit 0 pure regen (no manual edits to generated output).
- Gate on pathspec clean + full test suite 6/6 pass (not subset).
- Commit `cef7f36c04`: 8 files, 199L.
- Source: Wave1 t1-retry-schedule completion.

## 2026-09-26 — t2-server-auth stacked verification pattern
- Stack after t1 (`cef7f36c04`); verify full suite 5/5 pass before commit.
- Commit `77d1413320`: 6 files, 187L; staged empty post-commit confirms clean landing.
- Source: t2-server-auth completion.

## 2026-09-26 — t3-service-channel triple-site contract pattern
- Stack after t2 (`77d1413320`); verify `generate` clean + mirrors sync + full suite 5/5 pass before commit.
- Commit `720c0d32`: 4 files, 199L; triple-site contract (service+effect+promise) consistent.
- Downstream t4a/t4c/t5b consume contract read-only; re-run channel test before committing.
- Source: t3-service-channel completion.

## 2026-09-26 — t4a-desktop-attach stacked verification pattern
- Stack after t3 (`720c0d32`); verify full suite 34/34 pass + typecheck clean before commit.
- Commit `21f0da6f`: 6 files (3 source + 3 tests), 456L.
- Sidecar deletion deferred to t4c; no electron-builder in t4a scope.
- Source: t4a-desktop-attach completion.

## 2026-09-26 — t4b-bench-rewrite single-file consolidation pattern
- Stack after t3 (`720c0d32`); verify bench suite 24/24 pass + typecheck clean before commit.
- Commit `aa84a32f3f`: 1 file, 885L (+183/-702 net rewrite, not additive growth).
- Single-file waiver vs plan estimate (max 3 files / ~150L); no electron-builder in t4b scope.
- Source: t4b-bench-rewrite completion.

## 2026-09-26 — t4c-desktop-ci-lane net-deletion verification pattern
- Stack after t3/t4a lineage; verify typecheck 0 + yaml clean before commit.
- Commit `692a603eb1`: 3 files, +9/-38 net deletion; sidecar deletion closes t4a debt.
- No electron-builder in t4c scope.
- Source: t4c-desktop-ci-lane completion.

## 2026-09-26 — t5a-debian-scripts stacked verification pattern
- Stack after t4c (`692a603eb1`); verify `bash -n` exit 0 on all scripts before commit.
- Commit `4ed8f3c4d5`: 3 files, 216L; `OPENCODE_PKG=packages/cli` convention.
- Sole electron-builder owner in this wave; `build-deb-all` reserved for t5b.
- Source: t5a-debian-scripts completion.

## 2026-09-26 — t5b-debian-templates stacked verification pattern
- Stack after t4c; verify `bash -n` exit 0 on templates/scripts before commit.
- Commit `451115d861`: 2 files, 167L; lib path + dash-prefix convention.
- Env vars consumed (t5a `OPENCODE_PKG` convention); electron-builder untouched.
- UI launcher deferred as untracked follow-up, not in t5b scope.
- Source: t5b-debian-templates completion.
