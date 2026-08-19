# Tasks: Sustainable Upstream Sync Strategy

## Phase 1 — Custom Change Catalog

- [ ] **Catalog every custom change** in `FORK_WORKFLOW.md` — for each, record: source file, purpose, upstream commit hash where divergence began, and current diff context. Add to `docs/UPSTREAM_SYNC.md` under a "Custom Change Catalog" section. **Validation:** `grep -c "^###" docs/UPSTREAM_SYNC.md` ≥ 4

- [ ] **Document token cache_write patch** — record exact file (`src/config/config.ts` or wherever it lives), the upstream line range, the local modification, and the re-application steps. Add to `docs/UPSTREAM_SYNC.md` as a subsection with a `git apply`-able patch block. **Validation:** `grep -q "cache_write" docs/UPSTREAM_SYNC.md`

- [ ] **Document SSE usage injection patch** — record the file, purpose, and re-application procedure. **Validation:** `grep -q "SSE" docs/UPSTREAM_SYNC.md`

- [ ] **Document HTTP/1.1 upstream patch** — record the file, purpose, and re-application procedure. **Validation:** `grep -q "HTTP/1.1" docs/UPSTREAM_SYNC.md`

- [ ] **Document llama-skein mDNS service registration** — record the service name, port, and how the fork's `src/local/mdns.ts` discovers it. **Validation:** `grep -q "mdns" docs/UPSTREAM_SYNC.md`

## Phase 2 — Enhanced Sync Script

- [ ] **Add conflict-preanalysis to `script/sync-upstream.ts`** — before the merge, run `git diff --name-only upstream/dev...HEAD` against the last known sync point to identify files that have diverged; log them as "likely conflict files". **Validation:** `bun script/sync-upstream.ts --dry-run` exits 0 and prints "likely conflict files"

- [ ] **Add `--validate` flag to `script/sync-upstream.ts`** — after merge, run typecheck, build, and smoke-test in the worktree; exit non-zero on failure. **Validation:** `bun script/sync-upstream.ts --validate --dry-run` exits 0

- [ ] **Add custom-change re-application hooks** — after merge, the script detects which custom changes are still needed and applies them in order, logging each as "re-applied" or "already present". **Validation:** `bun script/sync-upstream.ts --dry-run --apply-customs` prints re-application status for each cataloged change

- [ ] **Add post-sync summary** — output a markdown summary of what changed: upstream commits merged, custom changes re-applied, validation results, remaining conflicts. **Validation:** `bun script/sync-upstream.ts --dry-run` outputs a "--- Sync Summary ---" block

## Phase 3 — Validation Script

- [ ] **Create `script/sync-validate.ts`** — standalone script that runs the full validation suite: `bun typecheck`, `bun run build`, and a smoke test (e.g., `opencode run --help` exits 0). Accepts a `--worktree` flag pointing to the sync worktree. **Validation:** `bun script/sync-validate.ts --worktree .` exits 0

- [ ] **Add build check to validation** — ensure `bun run build` succeeds in the worktree. **Validation:** `bun script/sync-validate.ts --worktree . --check build` exits 0

- [ ] **Add smoke test to validation** — run `opencode run --help` and verify exit code 0 and output contains "Usage". **Validation:** `bun script/sync-validate.ts --worktree . --check smoke` exits 0

## Phase 4 — Tagging Discipline

- [ ] **Document the upstream → fork → tagged snapshot → skein port chain** in `docs/UPSTREAM_SYNC.md` with a diagram and step-by-step procedure. **Validation:** `grep -q "tagged snapshot" docs/UPSTREAM_SYNC.md`

- [ ] **Add `script/tag-upstream.sh`** — helper that creates a semver-tagged snapshot of the fork at the current upstream merge point, prints the tag name, and logs it. **Validation:** `bash script/tag-upstream.sh` creates a tag and prints it

- [ ] **Document skein port update procedure** — steps to update `skein`'s dependency on the fork to point to the new tagged snapshot. **Validation:** `grep -q "skein" docs/UPSTREAM_SYNC.md`

## Phase 5 — Automation & CI

- [ ] **Add GitHub Action for sync readiness** — `./.github/workflows/sync-readiness.yml` that runs `script/sync-validate.ts` on every PR to `dev`. **Validation:** `cat .github/workflows/sync-readiness.yml | grep -q "sync-validate"`

- [ ] **Add pre-commit hook for sync readiness** — `./script/pre-commit-sync` that runs a lightweight check (typecheck + build) before commits to `dev`. **Validation:** `test -x ./script/pre-commit-sync`

- [ ] **Document when to use the GitHub Action vs. pre-commit hook** in `docs/UPSTREAM_SYNC.md`. **Validation:** `grep -q "pre-commit" docs/UPSTREAM_SYNC.md`

## Phase 6 — Consolidation

- [ ] **Rewrite `FORK_WORKFLOW.md`** — consolidate all sync procedures into a single authoritative reference, cross-referencing `docs/UPSTREAM_SYNC.md` for the custom change catalog. **Validation:** `cat FORK_WORKFLOW.md | grep -q "UPSTREAM_SYNC.md"`

- [ ] **Create `docs/UPSTREAM_SYNC.md`** — the master document containing: custom change catalog, sync procedure, validation checklist, tagging discipline, and Skein port update steps. **Validation:** `wc -l docs/UPSTREAM_SYNC.md` ≥ 50

- [ ] **Add a CHANGELOG entry** for the sync strategy changes. **Validation:** `grep -q "sync" CHANGELOG.md` || `grep -q "Sync" CHANGELOG.md`
