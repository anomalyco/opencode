import { simpleGit } from "simple-git"
import { tmpdir } from "os"
import path from "path"

export namespace Worktree {
  export type Info = {
    path: string
    branch: string
    head: string
  }

  /**
   * Generate a worktree path in the system temp directory
   */
  export function generatePath(branchName: string): string {
    return path.join(tmpdir(), `opencode-worktree-${branchName}`)
  }

  /**
   * Create a new git worktree
   */
  export async function create(
    repoPath: string,
    branchName: string,
    isNewBranch: boolean,
  ): Promise<string> {
    const git = simpleGit(repoPath)
    const worktreePath = generatePath(branchName)

    try {
      if (isNewBranch) {
        // Create new branch and worktree
        await git.raw(["worktree", "add", "-b", branchName, worktreePath])
      } else {
        // Use existing branch
        await git.raw(["worktree", "add", worktreePath, branchName])
      }
      return worktreePath
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("already exists")) {
          throw new Error(
            `Worktree already exists at ${worktreePath}. Clean it up with: git worktree remove ${worktreePath}`,
          )
        }
        throw new Error(`Failed to create worktree: ${error.message}`)
      }
      throw error
    }
  }

  /**
   * Remove a git worktree
   */
  export async function remove(repoPath: string, worktreePath: string): Promise<void> {
    const git = simpleGit(repoPath)
    try {
      await git.raw(["worktree", "remove", worktreePath, "--force"])
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to remove worktree: ${error.message}`)
      }
      throw error
    }
  }

  /**
   * List all git worktrees
   */
  export async function list(repoPath: string): Promise<Info[]> {
    const git = simpleGit(repoPath)
    try {
      const output = await git.raw(["worktree", "list", "--porcelain"])
      return parseWorktreeList(output)
    } catch {
      return []
    }
  }

  /**
   * Parse git worktree list --porcelain output
   */
  function parseWorktreeList(output: string): Info[] {
    const worktrees: Info[] = []
    const lines = output.split("\n")
    let current: Partial<Info> = {}

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        current.path = line.slice(9)
      } else if (line.startsWith("branch ")) {
        current.branch = line.slice(7).replace("refs/heads/", "")
      } else if (line.startsWith("HEAD ")) {
        current.head = line.slice(5)
      } else if (line === "") {
        if (current.path && current.branch && current.head) {
          worktrees.push(current as Info)
        }
        current = {}
      }
    }

    // Handle last entry if no trailing newline
    if (current.path && current.branch && current.head) {
      worktrees.push(current as Info)
    }

    return worktrees
  }

  /**
   * Check if a worktree exists at the given path
   */
  export async function exists(repoPath: string, worktreePath: string): Promise<boolean> {
    const worktrees = await list(repoPath)
    return worktrees.some((w) => w.path === worktreePath)
  }
}
