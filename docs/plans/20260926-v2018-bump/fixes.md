# Fixes — 20260926-v2018-bump

## 2026-09-26 — pin base to v2.0.18 lineage
- Fix: anchor continued work to base `v2.0.18` (76 commits ahead of `3a103fe0af`), not `3a103fe0af` directly.
- Prevents lineage drift when reusing `20260926-missing-upstream` findings.
- Source: researcher output.

## 2026-09-26 — treat remote-auth as obsolete, gate retry-config
- Fix: do not retry `remote-auth`; gate `retry-config` behind verification (at-risk).
- Source: architectural decisions.

## 2026-09-26T00:00Z — t1 generated types +5 bundle stale discover fix + retry lines
- Fix: generated types delta (+5) bundles stale `discover` fix with retry-schedule lines; not retry-only.
- Commit `cef7f36c04` (8 files, 199L); `generate` exit 0 confirms regen consistency.
- Source: Wave1 t1-retry-schedule completion.

## 2026-09-26 — t2-server-auth stacked after t1
- Fix: land t2-server-auth stacked after t1 as `77d1413320` (6 files, 187L, 5/5 pass); staged empty post-commit.
- Prevents scope bleed: upstream TUI stays unstaged, t3 scaffolding stays unstaged for pathspec-only t3 commit.
- Source: t2-server-auth completion.

## 2026-09-26 — t3-service-channel stacked after t2
- Fix: land t3-service-channel stacked after t2 as `720c0d32` (4 files, 199L, 5/5 pass, generate clean, mirrors sync).
- Preserves triple-site contract (service+effect+promise) for t4a/t4c/t5b read-only consumption.
- Source: t3-service-channel completion.

## 2026-09-26 — t4a-desktop-attach stacked after t3
- Fix: land t4a-desktop-attach stacked after t3 as `21f0da6f` (6 files = 3 source + 3 tests, 456L, 34/34 pass, typecheck clean).
- Sidecar deletion deferred to t4c; no electron-builder in t4a.
- Source: t4a-desktop-attach completion.

## 2026-09-26 — t4b-bench-rewrite stacked after t3
- Fix: land t4b-bench-rewrite stacked after t3 as `aa84a32f3f` (1 file, 885L, +183/-702, 24/24 pass, typecheck clean).
- Single-file waiver vs plan estimate (max 3 files / ~150L); no electron-builder in t4b.
- Source: t4b-bench-rewrite completion.

## 2026-09-26 — t4c-desktop-ci-lane stacked, closes t4a sidecar debt
- Fix: land t4c-desktop-ci-lane as `692a603eb1` (3 files, +9/-38, typecheck 0, yaml clean).
- Sidecar deletion closes t4a deferred debt; no electron-builder in t4c.
- Source: t4c-desktop-ci-lane completion.

## 2026-09-26 — t5a-debian-scripts stacked after t4c
- Fix: land t5a-debian-scripts stacked after t4c as `4ed8f3c4d5` (3 files, 216L, bash -n exit 0).
- `OPENCODE_PKG=packages/cli` convention; sole electron-builder owner; build-deb-all reserved t5b.
- Source: t5a-debian-scripts completion.

## 2026-09-26 — t5b-debian-templates stacked after t4c
- Fix: land t5b-debian-templates stacked after t4c as `451115d861` (2 files, 167L, bash -n exit 0).
- Lib path + dash-prefix convention; env vars consumed; electron-builder untouched.
- UI launcher deferred as untracked follow-up, not in t5b commit.
- Source: t5b-debian-templates completion.

## 2026-09-26 — t6-docs-findings stacked after t4c/t5a/t5b
- Fix: land t6-docs-findings as `a84e7f5d66` (7 files, 403L docs-only, explicit pathspecs, deny clean).
- Stale dirs left untracked; docs bulk excluded.
- Source: t6-docs-findings completion.

## 2026-09-26 — t7-bump-v2018 stacked via strategy B
- Fix: create `series/v2.0.18` at `32237d2788` from `cd9a14a6` + 5 clean cherry-picks (0 conflicts).
- Gates: typecheck exit 0, webfetch 88 pass, scope unchanged, main worktree untouched.
- Next: t8 forward-port t0-t6 SHAs onto `series/v2.0.18` pending.
- Source: t7-bump-v2018 completion.

## 2026-09-26 — t8-forward-port 9/10 onto series/v2.0.18, t2 deferred
- Fix: land 9/10 t0-t6 SHAs onto `series/v2.0.18` at `6c02774ef6`; t2 conflict-aborted (`process.ts` unauthorized→unauthorizedResponse + pairing guard), abort preserved.
- Gates: typecheck 0, 35/35 pass, porcelain clean; t3/t4 independent so t2 deferral unblocks.
- Follow-up: t2 manual rebase; note cherry-pick `-x` footers absent on landed commits.
- Source: t8-forward-port completion.

## 2026-09-26 — follow-up A fix(tui) stacked after t8
- Fix: land `c6adeec9` fix(tui) stacked after `6c02774ef6`; gate on 4/4 pass + typecheck clean + deny check (docs/ + packages/opencode/ never staged).
- Source: follow-up A completion.

## 2026-09-26 — follow-up B chore(cli) stacked after A
- Fix: land `e4f671cb` chore(cli) stacked after `c6adeec9`; gate on 4/4 pass + typecheck clean + deny check.
- Source: follow-up B completion.

## 2026-09-26 — follow-up C chore(debian) 497 ins stacked after B
- Fix: land `54c82bd0` chore(debian) 497 ins stacked after `e4f671cb`; gate on 4/4 pass + typecheck clean + deny check.
- Source: follow-up C completion.

## 2026-09-26 — continuation forward-port A/B/C + t2 manual rebase onto series/v2.0.18
- Fix: forward-port A (`c6adeec9`) / B (`e4f671cb`) / C (`54c82bd0`) onto `series/v2.0.18` plus t2 (`77d1413320`) manual rebase + verification; single-PR outcome.
- Stray `packages/opencode/` delete not ported; verify typecheck + tests + porcelain clean before handoff.
- Source: researcher continuation scope, plan 20260926-v2018-bump.

## 2026-09-26 — t9 ABC forward-port 3/3 landed onto series/v2.0.18
- Fix: land A/B/C onto `series/v2.0.18` at `a8cb43094e` via `cherry-pick -x` 3/3 clean; patch-ids identical, disjoint pathspecs, no t2 content.
- Gates: porcelain clean + `bash -n` 2/2 pass.
- Source: t9 ABC forward-port completion.
## 2026-09-26 — t10 t2-manual-rebase landed, closes t8 deferred debt
- Fix: land t2 manual rebase as `1013396000` (6 files, 177L, 5/5 pass) stacked on `a8cb43094e`; preserves ServerAuth.required + pairing guard + password-optional + authorizationLayer passthrough.
- Closes t8 deferred t2 debt; manual rebase by design (cherry-pick -x conflict path from t8, not reused).
- Source: t10 t2-manual-rebase completion.
