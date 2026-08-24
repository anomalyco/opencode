// Worktree-per-change isolation for opencode-skein's own /loop and Task-tool
// build agents. Concurrent agents in one checkout will switch branches out
// from under each other — the external `skein` orchestrator already avoids
// this by giving every change its own worktree at
// `../opencode-worktrees/<slug>` (confirmed live: this repo's own
// `openspec/changes/*/.skein/coder-context.md` handoffs). This module brings
// the same convention — same sibling-directory layout, so the two systems
// never collide over the same path — into opencode-skein itself.
import path from "path"
import fs from "fs/promises"
import { Process } from "@/util/process"

export interface WorktreeInfo {
  readonly slug: string
  readonly path: string
  readonly branch: string
}

export class WorktreeError extends Error {
  readonly slug: string
  constructor(slug: string, message: string) {
    super(message)
    this.name = "WorktreeError"
    this.slug = slug
  }
}

export function branchName(slug: string): string {
  return `loop/${slug}`
}

export function worktreePath(repoRoot: string, slug: string): string {
  return path.resolve(repoRoot, "..", "opencode-worktrees", slug)
}

async function exists(dir: string): Promise<boolean> {
  try {
    await fs.stat(dir)
    return true
  } catch {
    return false
  }
}

async function isGitWorktree(dir: string): Promise<boolean> {
  const result = await Process.run(["git", "rev-parse", "--git-dir"], { cwd: dir, nothrow: true })
  return result.code === 0
}

/**
 * Reuse the worktree at `../opencode-worktrees/<slug>` if it already exists —
 * created by a previous run, or by the external `skein` orchestrator using
 * the same convention — otherwise create it fresh off `base`.
 */
export async function ensure(repoRoot: string, slug: string, base = "HEAD"): Promise<WorktreeInfo> {
  const dir = worktreePath(repoRoot, slug)
  const branch = branchName(slug)

  if (await exists(dir)) {
    if (!(await isGitWorktree(dir))) {
      throw new WorktreeError(slug, `${dir} exists but is not a git worktree — refusing to reuse or overwrite it`)
    }
    return { slug, path: dir, branch }
  }

  await Process.run(["git", "worktree", "add", "-b", branch, dir, base], { cwd: repoRoot })
  return { slug, path: dir, branch }
}

/**
 * Merge the worktree's branch into the main checkout's current branch.
 * Never runs `git push` — matches loop-spec-queue's authority boundary
 * (edit/test/verify/commit locally, stop before push).
 */
export async function merge(repoRoot: string, slug: string): Promise<void> {
  await Process.run(["git", "merge", "--no-ff", branchName(slug)], { cwd: repoRoot })
}

/**
 * Remove the worktree. Call only after a successful merge — a halted or
 * failed run must leave its worktree in place for inspection or manual
 * resumption, never silently discarded.
 */
export async function cleanup(repoRoot: string, slug: string): Promise<void> {
  const dir = worktreePath(repoRoot, slug)
  if (!(await exists(dir))) return
  await Process.run(["git", "worktree", "remove", dir], { cwd: repoRoot })
}

export * as Worktree from "./worktree"
