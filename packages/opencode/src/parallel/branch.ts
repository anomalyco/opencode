import { simpleGit } from "simple-git"

export namespace Branch {
  /**
   * Generate a branch name from a prompt string
   * Format: {sanitized-prompt}-{timestamp}
   */
  export function generateName(prompt: string): string {
    const sanitized = prompt
      .slice(0, 50)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-+/g, "-")

    const timestamp = Date.now()
    return `${sanitized || "opencode"}-${timestamp}`
  }

  /**
   * Check if a branch exists locally
   */
  export async function exists(branchName: string, repoPath: string): Promise<boolean> {
    const git = simpleGit(repoPath)
    try {
      const branches = await git.branchLocal()
      return branches.all.includes(branchName)
    } catch {
      return false
    }
  }

  /**
   * Get the current branch name
   */
  export async function getCurrentBranch(repoPath: string): Promise<string> {
    const git = simpleGit(repoPath)
    const branch = await git.branch()
    return branch.current
  }

  /**
   * Validate that a branch exists, throw error if not
   */
  export async function validate(branchName: string, repoPath: string): Promise<void> {
    const branchExists = await exists(branchName, repoPath)
    if (!branchExists) {
      throw new Error(`Branch "${branchName}" does not exist`)
    }
  }
}
