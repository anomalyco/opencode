# Gotchas — 20260926-v2018-bump

## 2026-09-26 — commit-split granularity unresolved
- Gray area: how to split pending work into commits (single vs. per-scope) not yet decided.
- Impact: blocks clean commit-work-first execution; decide before committing.
- Source: researcher output.

## 2026-09-26 — bump strategy: rebase vs new branch unresolved
- Gray area: whether v2.0.18 bump proceeds via rebase of existing branch or new branch off `v2.0.18`.
- Impact: affects conflict risk and review scope; decide before bump.
- Source: researcher output.

## 2026-09-26 — untracked scope unknown
- Gray area: untracked files scope not inventoried; may expand commit set.
- Action: inventory `git status` untracked entries before commit split.
- Source: researcher output.

## 2026-09-26 — remote-auth obsolete vs retry-config at-risk
- Decision risk: `remote-auth` deemed obsolete, `retry-config` flagged at-risk — confirm before dropping/retrying.
- Avoid assuming retry will succeed; verify auth path first.
- Source: architectural decisions.

## 2026-09-26 — commit message variance: use prefix match
- Exact-match on implementer commit message is brittle; variance in prefix/suffix expected.
- Verify via prefix match as acceptable; Wave1 t0 accepted on prefix match.
- Source: Wave1 t0-gitignore-hygiene completion.

## 2026-09-26T00:00Z — generated-types delta may bundle unrelated stale fixes
- t1 generated types +5 included stale `discover` fix alongside retry lines; review generated diff line-by-line.
- Do not assume generated delta is single-purpose even when `generate` exit is 0 pure regen.
- Source: Wave1 t1-retry-schedule completion.

## 2026-09-26 — t2 upstream-TUI-never-staged + t3-pathspec-required
- Upstream TUI never staged in t2; do not expect it in t2 commit scope.
- Worktree holds unstaged t3 scaffolding while staged is empty post-t2 — t3 must commit via explicit pathspec, never `git add -A`.
- Source: t2-server-auth completion.

## 2026-09-26 — t3 triple-site must stay in sync (mirrors check)
- Channel fix spans service+effect+promise mirrors; partial update breaks desktop attach / debian templates.
- `generate` clean is not sufficient — verify mirrors sync + channel test 5/5 pass before commit.
- Source: t3-service-channel completion.

## 2026-09-26 — t4a sidecar deletion deferred to t4c, no electron-builder
- Do not delete sidecar in t4a; deletion belongs to t4c scope.
- Do not assume electron-builder packaging in t4a; out of scope.
- Impact: keeps t4a commit to 6 files (3 source + 3 tests) without scope bleed.
- Source: t4a-desktop-attach completion.

## 2026-09-26 — t4b single-file waiver, no electron-builder
- Plan estimated max 3 files / ~150L; actual is 1 file 885L (+183/-702 rewrite) — accept single-file waiver, do not split artificially.
- Do not touch attach wiring, CI lane, triple-site, or electron-builder.config.ts in t4b.
- Source: t4b-bench-rewrite completion (`aa84a32f3f`, 24/24 pass, typecheck clean).

## 2026-09-26 — t4c sidecar deletion closes t4a debt, no electron-builder
- Sidecar deletion belongs to t4c, not t4a; t4c `692a603eb1` (3 files, +9/-38) closes t4a deferred debt.
- Gate on typecheck 0 + yaml clean; do not assume electron-builder packaging in t4c.
- Source: t4c-desktop-ci-lane completion.

## 2026-09-26 — t5a sole electron-builder owner, build-deb-all reserved t5b
- t5a (`4ed8f3c4d5`, 3 files, 216L) is sole electron-builder owner in this wave; do not duplicate packaging scope in t4a/t4b/t4c.
- `build-deb-all` orchestration reserved for t5b; t5a covers debian scripts only with `OPENCODE_PKG=packages/cli`.
- Gate on `bash -n` exit 0 for all scripts; shell syntax failure blocks commit.
- Source: t5a-debian-scripts completion.

## 2026-09-26 — t5b electron-builder untouched, UI launcher deferred untracked
- Do not touch electron-builder.config.ts in t5b (owned by t5a); t5b covers templates only (lib path + dash-prefix).
- UI launcher deferred as untracked follow-up — do not force into t5b commit; leave untracked.
- Env vars consumed from t5a convention; verify `bash -n` exit 0 before commit (`451115d861`, 2 files, 167L).
- Source: t5b-debian-templates completion.

## 2026-09-26 — t6 docs bulk exclusion, stale dirs untracked, deny clean
- Use explicit pathspec allowlist, never `docs/` glob; docs bulk excluded.
- Stale dirs remain untracked — do not force into t6 commit; leave untracked.
- Gate on deny check clean (zero staged outside allowlist, `a84e7f5d66`, 7 files, 403L docs-only).
- Source: t6-docs-findings completion.

## 2026-09-26 — t7 scope-unchanged gate + t8 pending forward-port
- t7 must leave scope unchanged (5 cherry-picks only, no t0-t6 content); verify via diff stat before handoff.
- Do not forward-port in t7; t8 ports t0-t6 SHAs in strict order with `git cherry-pick -x`, abort on first conflict.
- Never force-push or rebase series history; preserve `series/v2.0.16` worktree untouched.
- Source: t7-bump-v2018 completion (tip `32237d2788`, t8 pending).

## 2026-09-26 — t8 t2 conflict-aborted, t3/t4 independent, -x footers absent
- t2 (`process.ts` unauthorized→unauthorizedResponse + pairing guard) conflict-aborts; run `git cherry-pick --abort` to preserve clean abort, do not resolve inline.
- t3/t4 are independent of t2 — proceed to land them; t2 needs manual rebase follow-up, not a blocker.
- Cherry-pick `-x` footers absent on landed commits — do not assume provenance trailers; verify via SHA order, not footer grep.
- Source: t8-forward-port completion (tip `6c02774ef6`, 9/10 SHAs).

## 2026-09-26 — follow-up A/B/C: docs/ + packages/opencode/ never staged
- `docs/` bulk and `packages/opencode/` stray test never staged in A/B/C; use explicit pathspec allowlist, never `git add -A`.
- Gate each follow-up on deny check (zero staged outside allowlist) + 4/4 pass + typecheck clean before commit.
- Source: follow-up A/B/C completion (c6adeec9, e4f671cb, 54c82bd0).

## 2026-09-26 — continuation: stray packages/opencode/ delete not ported
- Stray `packages/opencode/` delete is not ported in continuation forward-port to v2.0.18; provenance unverified — never staged.
- Base stays `series/v2.0.18` single-PR; t2 (`77d1413320`) needs manual rebase + verification, not cherry-pick -x.
- Source: researcher continuation scope, plan 20260926-v2018-bump.

## 2026-09-26 — t9 ABC forward-port gates: patch-id + disjoint + no-t2 + bash-n
- Verify patch-ids identical (not SHA match) to confirm faithful `-x` forward-port; SHAs differ by design.
- Verify pathspecs disjoint across A/B/C; overlap means scope bleed — abort and re-check allowlist.
- Verify no t2 content in A/B/C diff; t2 needs manual rebase, never cherry-pick `-x`.
- Gate on porcelain clean + `bash -n` 2/2; shell syntax failure blocks handoff.
- Source: t9 ABC forward-port completion (tip `a8cb43094e`).
## 2026-09-26 — t10 OPENCODE_DISABLE_AUTH trusted-LAN caveat + ServerAuth wrapping
- `OPENCODE_DISABLE_AUTH` bypass is trusted-LAN only; never assume safe for untrusted network — document caveat.
- `ServerAuth.required` must wrap `unauthorizedResponse`; pairing guard must stay intact; password stays optional; authorizationLayer is passthrough — partial port breaks auth.
- Verify 5/5 pass + stacked on `a8cb43094e` (6 files, 177L, `1013396000`); do not cherry-pick -x t2 (t8 conflict path).
- Source: t10 t2-manual-rebase completion.
