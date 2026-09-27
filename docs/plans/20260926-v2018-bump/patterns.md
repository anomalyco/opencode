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

## 2026-09-26 — t6-docs-findings scoped allowlist verification pattern
- Stack after t4c/t5a/t5b; verify explicit pathspec allowlist + deny check (zero staged outside allowlist) before commit.
- Commit `a84e7f5d66`: 7 files, 403L docs-only.
- Source: t6-docs-findings completion.

## 2026-09-26 — t7-bump-v2018 strategy-B verification pattern
- New branch `series/v2.0.18` from `cd9a14a6` (v2.0.18), then `git cherry-pick -x` 5 fork patches in order, zero conflicts.
- Tip `32237d2788`; verify `bun typecheck` exit 0 + webfetch 88 pass + scope unchanged before handoff.
- Keep main worktree on `series/v2.0.16` untouched; t7/t8 use fresh worktree/branch.
- Source: t7-bump-v2018 completion.

## 2026-09-26 — t8-forward-port 9/10 stacked verification pattern
- Forward-port t0-t6 SHAs onto `series/v2.0.18` in strict order with `git cherry-pick -x`, abort on first conflict.
- Tip `6c02774ef6` (9/10 SHAs; t2 conflict-aborted, abort preserved); verify `bun typecheck` exit 0 + full suite 35/35 pass + porcelain clean before handoff.
- Source: t8-forward-port completion.

## 2026-09-26 — follow-up A/B/C stacked verification pattern
- Stack after t8 tip (`6c02774ef6`) on `series/v2.0.18`; land in order A→B→C with explicit pathspec + deny check before each commit.
- A `c6adeec9` fix(tui), B `e4f671cb` chore(cli), C `54c82bd0` chore(debian) 497 ins; gate each on 4/4 pass + typecheck clean.
- Source: follow-up A/B/C completion.

## 2026-09-26 — continuation forward-port A/B/C + t2 manual rebase to v2.0.18 single-PR
- Intent: continuation scope forward-ports A (`c6adeec9`) / B (`e4f671cb`) / C (`54c82bd0`) onto `series/v2.0.18` plus t2 (`77d1413320`) manual rebase + verification.
- Base: `series/v2.0.18` single-PR outcome; keep `series/v2.0.16` worktree untouched.
- Source: researcher continuation scope, plan 20260926-v2018-bump.

## 2026-09-26 — t9 ABC forward-port series/v2.0.18 verification pattern
- Forward-port A/B/C onto `series/v2.0.18` with `git cherry-pick -x` 3/3 clean, zero conflicts; tip `a8cb43094e`.
- Verify patch-ids identical + pathspecs disjoint + no t2 content + porcelain clean + `bash -n` 2/2 before handoff.
- Source: t9 ABC forward-port completion.
## 2026-09-26 — t10 t2-manual-rebase stacked verification pattern
- Manual rebase t2 (`77d1413320`) onto `a8cb43094e` (`series/v2.0.18`); `ServerAuth.required` wraps `unauthorizedResponse` + pairing guard intact, password optional, authorizationLayer passthrough.
- Commit `1013396000`: 6 files, 177L; verify full suite 5/5 pass before commit.
- Source: t10 t2-manual-rebase completion.
