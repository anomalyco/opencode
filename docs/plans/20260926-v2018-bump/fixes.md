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
