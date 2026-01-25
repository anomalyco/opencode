import { $ } from "bun"
import { Log } from "../util/log"

export namespace Git {
  const log = Log.create({ service: "workspace-git" })

  export interface WorktreeInfo {
    path: string
    head: string
    branch: string | null
  }

  /**
   * Get the root path of the git repository
   */
  export async function getRepoRoot(cwd: string): Promise<string | null> {
    const result = await $`git rev-parse --show-toplevel`.cwd(cwd).quiet().nothrow()
    if (result.exitCode !== 0) {
      return null
    }
    return result.text().trim()
  }

  /**
   * Get the current branch name
   */
  export async function getCurrentBranch(cwd: string): Promise<string | null> {
    const result = await $`git rev-parse --abbrev-ref HEAD`.cwd(cwd).quiet().nothrow()
    if (result.exitCode !== 0) {
      return null
    }
    return result.text().trim()
  }

  /**
   * Get a unique ID for the repository (first root commit hash)
   */
  export async function getRepoID(cwd: string): Promise<string | null> {
    const result = await $`git rev-list --max-parents=0 --all`.cwd(cwd).quiet().nothrow()
    if (result.exitCode !== 0) {
      return null
    }
    const text = result.text()
    const roots = text
      .split("\n")
      .filter(Boolean)
      .map((x) => x.trim())
      .toSorted()
    return roots[0] ?? null
  }

  /**
   * Create a new git worktree with a new branch
   */
  export async function createWorktree(repoRoot: string, worktreePath: string, branchName: string): Promise<void> {
    log.info("creating worktree", { repoRoot, worktreePath, branchName })
    const result = await $`git worktree add ${worktreePath} -b ${branchName}`.cwd(repoRoot).quiet().nothrow()
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString()
      throw new Error(`Failed to create worktree: ${stderr}`)
    }
  }

  /**
   * Remove a git worktree
   */
  export async function removeWorktree(repoRoot: string, worktreePath: string): Promise<void> {
    log.info("removing worktree", { repoRoot, worktreePath })
    const result = await $`git worktree remove ${worktreePath} --force`.cwd(repoRoot).quiet().nothrow()
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString()
      log.warn("failed to remove worktree", { stderr })
    }
  }

  const WORKTREE_PREFIX = "worktree "
  const HEAD_PREFIX = "HEAD "
  const BRANCH_PREFIX = "branch "
  const REFS_HEADS_PREFIX = "refs/heads/"

  /**
   * Parse git worktree list --porcelain output
   * Exported for testing
   */
  export function parseWorktreeOutput(output: string): WorktreeInfo[] {
    const worktrees: WorktreeInfo[] = []
    let current: Partial<WorktreeInfo> = {}

    for (const line of output.split("\n")) {
      if (line.startsWith(WORKTREE_PREFIX)) {
        if (current.path) {
          worktrees.push(current as WorktreeInfo)
        }
        current = { path: line.slice(WORKTREE_PREFIX.length) }
      } else if (line.startsWith(HEAD_PREFIX)) {
        current.head = line.slice(HEAD_PREFIX.length)
      } else if (line.startsWith(BRANCH_PREFIX)) {
        const ref = line.slice(BRANCH_PREFIX.length)
        current.branch = ref.startsWith(REFS_HEADS_PREFIX) ? ref.slice(REFS_HEADS_PREFIX.length) : ref
      } else if (line === "detached") {
        current.branch = null
      } else if (line === "" && current.path) {
        worktrees.push(current as WorktreeInfo)
        current = {}
      }
    }

    if (current.path) {
      worktrees.push(current as WorktreeInfo)
    }

    return worktrees
  }

  /**
   * List all worktrees for a repository
   */
  export async function listWorktrees(repoRoot: string): Promise<WorktreeInfo[]> {
    const result = await $`git worktree list --porcelain`.cwd(repoRoot).quiet().nothrow()
    if (result.exitCode !== 0) {
      return []
    }
    return parseWorktreeOutput(result.text())
  }

  /**
   * Delete a branch
   */
  export async function deleteBranch(repoRoot: string, branchName: string): Promise<void> {
    log.info("deleting branch", { repoRoot, branchName })
    const result = await $`git branch -D ${branchName}`.cwd(repoRoot).quiet().nothrow()
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString()
      log.warn("failed to delete branch", { stderr })
    }
  }
}
