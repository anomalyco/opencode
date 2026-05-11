/**
 * Strip git history past base_commit so the agent can't reach future commits.
 *
 * Port of nv-OpenHands' `_deep_reset_to_base_commit`
 * (evaluation/benchmarks/swe_bench/run_infer.py:774). Two-pass design:
 *
 *   - Careful pass: per-ref iteration with `git for-each-ref`. Preserves
 *     local branches that don't descend from base, resets branches that do,
 *     deletes tags/remote-tracking/stash/notes refs past base.
 *   - Nuclear fallback: batch-delete every tag/remote/stash/notes ref + every
 *     local branch in two `git update-ref --stdin` calls. Microseconds
 *     regardless of ref count — handles monorepos with thousands of refs
 *     where the careful pass times out.
 *
 * `|| true` at the very end so a busted git state can't kill the agent run.
 */

import { spawn } from "node:child_process"

function carefulPass(baseCommit: string): string {
  return (
    `BASE=$(git rev-parse --verify ${baseCommit}^{commit}) && ` +
    `ORIG_BRANCH=$(git symbolic-ref --short -q HEAD || echo main) && ` +
    `git checkout --detach "$BASE" && ` +
    `git for-each-ref --format="%(refname)" refs/heads | while read -r ref; do ` +
    `  tip=$(git rev-parse -q --verify "$ref^{commit}" 2>/dev/null || true); ` +
    `  [ -z "$tip" ] && continue; ` +
    `  if [ "$tip" != "$BASE" ] && git merge-base --is-ancestor "$BASE" "$tip"; then ` +
    `    git update-ref "$ref" "$BASE"; ` +
    `  fi; ` +
    `done && ` +
    `git for-each-ref --format="%(refname)" refs | while read -r ref; do ` +
    `  case "$ref" in refs/heads/*) continue ;; esac; ` +
    `  if git symbolic-ref -q "$ref" >/dev/null 2>&1; then continue; fi; ` +
    `  tip=$(git rev-parse -q --verify "$ref^{commit}" 2>/dev/null || true); ` +
    `  [ -z "$tip" ] && continue; ` +
    `  if [ "$tip" != "$BASE" ] && git merge-base --is-ancestor "$BASE" "$tip"; then ` +
    `    git update-ref -d "$ref"; ` +
    `  fi; ` +
    `done && ` +
    `for r in $(git remote); do git remote remove "$r"; done; ` +
    `gd=$(git rev-parse --git-dir) && ` +
    `rm -f "$gd"/FETCH_HEAD "$gd"/ORIG_HEAD "$gd"/MERGE_HEAD "$gd"/CHERRY_PICK_HEAD ` +
    `"$gd"/REVERT_HEAD "$gd"/BISECT_HEAD "$gd"/AUTO_MERGE && ` +
    `git reflog expire --expire=now --expire-unreachable=now --all && ` +
    `git repack -ad && git prune --expire=now && git gc --prune=now && ` +
    `git checkout -B "$ORIG_BRANCH" "$BASE"`
  )
}

function nuclearPass(baseCommit: string): string {
  return (
    `BASE=$(git rev-parse --verify ${baseCommit}^{commit}) && ` +
    `ORIG_BRANCH=$(git symbolic-ref --short -q HEAD || echo main) && ` +
    `git checkout --detach "$BASE" && ` +
    `for r in $(git remote); do git remote remove "$r"; done; ` +
    `git for-each-ref --format="delete %(refname)" refs/tags refs/remotes refs/stash refs/notes 2>/dev/null ` +
    `| git update-ref --stdin; ` +
    `git for-each-ref --format="delete %(refname)" refs/heads | git update-ref --stdin; ` +
    `gd=$(git rev-parse --git-dir) && ` +
    `rm -f "$gd"/FETCH_HEAD "$gd"/ORIG_HEAD "$gd"/MERGE_HEAD "$gd"/CHERRY_PICK_HEAD ` +
    `"$gd"/REVERT_HEAD "$gd"/BISECT_HEAD "$gd"/AUTO_MERGE && ` +
    `git reflog expire --expire=now --expire-unreachable=now --all && ` +
    `git repack -ad && git prune --expire=now && git gc --prune=now && ` +
    `git checkout -B "$ORIG_BRANCH" "$BASE"`
  )
}

export function buildDeepResetCmd(baseCommit: string): string {
  return `( ${carefulPass(baseCommit)} ) || ( ${nuclearPass(baseCommit)} ) || true`
}

export async function runDeepReset(workspaceRoot: string, baseCommit: string): Promise<void> {
  if (!baseCommit) return
  const cmd = buildDeepResetCmd(baseCommit)
  console.log(`[bench] deep_reset workspace=${workspaceRoot} base=${baseCommit}`)
  await new Promise<void>((resolve) => {
    const child = spawn("bash", ["-c", cmd], {
      cwd: workspaceRoot,
      stdio: ["ignore", "inherit", "inherit"],
    })
    child.on("close", (code) => {
      console.log(`[bench] deep_reset exit=${code ?? 0}`)
      resolve()
    })
    child.on("error", (err) => {
      console.warn(`[bench] deep_reset spawn error: ${err}`)
      resolve()
    })
  })
}
