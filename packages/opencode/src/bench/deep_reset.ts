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
import { existsSync } from "node:fs"

// Some SIFs are minimal and ship without `bash` on PATH, or Bun's posix_spawn
// doesn't fall back to PATH lookup the way `execvp` does — either way,
// spawn("bash", ...) ENOENTs. Probe absolute paths up front; the deep-reset
// script uses only POSIX features, so /bin/sh is a safe fallback if bash is
// absent.
function detectShell(): string | null {
  for (const p of ["/bin/bash", "/usr/bin/bash", "/bin/sh", "/usr/bin/sh"]) {
    if (existsSync(p)) return p
  }
  return null
}

function carefulPass(baseCommit: string): string {
  return (
    `echo "[deep_reset:careful] start" && ` +
    `BASE=$(git rev-parse --verify ${baseCommit}^{commit}) && ` +
    `ORIG_BRANCH=$(git symbolic-ref --short -q HEAD || echo main) && ` +
    `echo "[deep_reset:careful] base=$BASE orig_branch=$ORIG_BRANCH" && ` +
    `git checkout --detach "$BASE" && ` +
    `echo "[deep_reset:careful] resetting local branches descending from base..." && ` +
    `git for-each-ref --format="%(refname)" refs/heads | while read -r ref; do ` +
    `  tip=$(git rev-parse -q --verify "$ref^{commit}" 2>/dev/null || true); ` +
    `  [ -z "$tip" ] && continue; ` +
    `  if [ "$tip" != "$BASE" ] && git merge-base --is-ancestor "$BASE" "$tip"; then ` +
    `    echo "[deep_reset:careful]   reset $ref -> $BASE"; ` +
    `    git update-ref "$ref" "$BASE"; ` +
    `  fi; ` +
    `done && ` +
    `echo "[deep_reset:careful] deleting tags/remotes/stash/notes past base..." && ` +
    `git for-each-ref --format="%(refname)" refs | while read -r ref; do ` +
    `  case "$ref" in refs/heads/*) continue ;; esac; ` +
    `  if git symbolic-ref -q "$ref" >/dev/null 2>&1; then continue; fi; ` +
    `  tip=$(git rev-parse -q --verify "$ref^{commit}" 2>/dev/null || true); ` +
    `  [ -z "$tip" ] && continue; ` +
    `  if [ "$tip" != "$BASE" ] && git merge-base --is-ancestor "$BASE" "$tip"; then ` +
    `    echo "[deep_reset:careful]   delete $ref"; ` +
    `    git update-ref -d "$ref"; ` +
    `  fi; ` +
    `done && ` +
    `echo "[deep_reset:careful] removing remotes + transient refs..." && ` +
    `for r in $(git remote); do echo "[deep_reset:careful]   rm remote $r"; git remote remove "$r"; done; ` +
    `gd=$(git rev-parse --git-dir) && ` +
    `rm -f "$gd"/FETCH_HEAD "$gd"/ORIG_HEAD "$gd"/MERGE_HEAD "$gd"/CHERRY_PICK_HEAD ` +
    `"$gd"/REVERT_HEAD "$gd"/BISECT_HEAD "$gd"/AUTO_MERGE && ` +
    `echo "[deep_reset:careful] expiring reflog + gc..." && ` +
    `git reflog expire --expire=now --expire-unreachable=now --all && ` +
    `git repack -ad && git prune --expire=now && git gc --prune=now && ` +
    `git checkout -B "$ORIG_BRANCH" "$BASE" && ` +
    `echo "[deep_reset:careful] done; HEAD=$ORIG_BRANCH at $BASE"`
  )
}

function nuclearPass(baseCommit: string): string {
  return (
    `echo "[deep_reset:nuclear] careful pass failed; running batch-delete fallback" && ` +
    `BASE=$(git rev-parse --verify ${baseCommit}^{commit}) && ` +
    `ORIG_BRANCH=$(git symbolic-ref --short -q HEAD || echo main) && ` +
    `echo "[deep_reset:nuclear] base=$BASE orig_branch=$ORIG_BRANCH" && ` +
    `git checkout --detach "$BASE" && ` +
    `for r in $(git remote); do echo "[deep_reset:nuclear]   rm remote $r"; git remote remove "$r"; done; ` +
    `echo "[deep_reset:nuclear] batch-delete tags/remotes/stash/notes..." && ` +
    `git for-each-ref --format="delete %(refname)" refs/tags refs/remotes refs/stash refs/notes 2>/dev/null ` +
    `| git update-ref --stdin; ` +
    `echo "[deep_reset:nuclear] batch-delete local branches..." && ` +
    `git for-each-ref --format="delete %(refname)" refs/heads | git update-ref --stdin; ` +
    `gd=$(git rev-parse --git-dir) && ` +
    `rm -f "$gd"/FETCH_HEAD "$gd"/ORIG_HEAD "$gd"/MERGE_HEAD "$gd"/CHERRY_PICK_HEAD ` +
    `"$gd"/REVERT_HEAD "$gd"/BISECT_HEAD "$gd"/AUTO_MERGE && ` +
    `echo "[deep_reset:nuclear] expiring reflog + gc..." && ` +
    `git reflog expire --expire=now --expire-unreachable=now --all && ` +
    `git repack -ad && git prune --expire=now && git gc --prune=now && ` +
    `git checkout -B "$ORIG_BRANCH" "$BASE" && ` +
    `echo "[deep_reset:nuclear] done; HEAD=$ORIG_BRANCH at $BASE"`
  )
}

export function buildDeepResetCmd(baseCommit: string): string {
  return `( ${carefulPass(baseCommit)} ) || ( ${nuclearPass(baseCommit)} ) || true`
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export async function runDeepReset(workspaceRoot: string, baseCommit: string): Promise<void> {
  if (!baseCommit) return
  const shell = detectShell()
  if (!shell) {
    console.warn(`[bench] deep_reset skipped: no shell found at /bin/{bash,sh} or /usr/bin/{bash,sh}`)
    return
  }
  // Bake `cd <workspace>` into the shell script instead of passing the `cwd`
  // option to spawn(). On some minimal apptainer images Bun's posix_spawn
  // ENOENTs whenever a `cwd` is set (libc lacks addchdir_np extension); routing
  // the chdir through the shell sidesteps that entirely.
  const cmd = `cd ${shellQuote(workspaceRoot)} && ` + buildDeepResetCmd(baseCommit)
  console.log(`[bench] deep_reset workspace=${workspaceRoot} base=${baseCommit} shell=${shell}`)
  await new Promise<void>((resolve) => {
    const child = spawn(shell, ["-c", cmd], {
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
