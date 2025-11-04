import { simpleGit } from "simple-git"
import { Branch } from "./branch"
import { Worktree } from "./worktree"
import { Log } from "../util/log"
import { UI } from "../cli/ui"

export namespace Parallel {
  export type Config = {
    enabled: boolean
    existingBranch?: string
    prompt: string
    workspace: string
  }

  export type Result = {
    worktreePath: string
    branchName: string
    originalBranch: string
    repoPath: string
    cleanup: () => Promise<void>
  }

  /**
   * Validate that the given path is a git repository
   */
  export async function validateGitRepo(repoPath: string): Promise<boolean> {
    const git = simpleGit(repoPath)
    try {
      await git.status()
      return true
    } catch {
      return false
    }
  }

  /**
   * Setup parallel mode: create worktree and branch
   */
  export async function setup(config: Config): Promise<Result> {
    const { workspace, existingBranch, prompt } = config

    // Validate git repository
    const isGitRepo = await validateGitRepo(workspace)
    if (!isGitRepo) {
      throw new Error("Current directory is not a git repository")
    }

    // Get original branch for later reference
    const originalBranch = await Branch.getCurrentBranch(workspace)

    // Determine branch name and strategy
    const branchName = existingBranch || Branch.generateName(prompt)
    const isNewBranch = !existingBranch

    // Validate existing branch if specified
    if (existingBranch) {
      await Branch.validate(existingBranch, workspace)
    }

    // Create worktree
    Log.Default.info("parallel:setup:start", {
      branchName,
      isNewBranch,
      originalBranch,
    })

    const worktreePath = await Worktree.create(workspace, branchName, isNewBranch)

    Log.Default.info("parallel:setup:complete", {
      branchName,
      worktreePath,
    })

    // Create cleanup function
    const cleanup = async () => {
      try {
        await Worktree.remove(workspace, worktreePath)
        Log.Default.info("parallel:cleanup:success", { worktreePath })
      } catch (error) {
        Log.Default.error("parallel:cleanup:failed", {
          worktreePath,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    }

    return {
      worktreePath,
      branchName,
      originalBranch,
      repoPath: workspace,
      cleanup,
    }
  }

  /**
   * Teardown parallel mode: commit changes, cleanup worktree, print merge instructions
   */
  export async function teardown(result: Result, autoCommit: boolean): Promise<void> {
    const { worktreePath, branchName, originalBranch } = result

    try {
      // Auto-commit changes if enabled
      if (autoCommit) {
        await commitChanges(worktreePath, branchName)
      }

      // Print merge instructions
      printMergeInstructions(branchName, originalBranch)

      // Cleanup worktree
      await result.cleanup()
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓ Worktree cleaned up")
    } catch (error) {
      if (error instanceof Error && error.message.includes("Failed to remove worktree")) {
        UI.println(UI.Style.TEXT_WARNING_BOLD + "⚠ Worktree cleanup failed")
        UI.println(`  Manually remove: git worktree remove ${worktreePath}`)
      } else {
        throw error
      }
    }
  }

  /**
   * Commit all changes in the worktree
   */
  async function commitChanges(worktreePath: string, branchName: string): Promise<void> {
    const git = simpleGit(worktreePath)

    // Check for changes
    const status = await git.status()
    if (status.files.length === 0) {
      UI.println(UI.Style.TEXT_DIM + "  No changes to commit")
      return
    }

    // Stage all changes
    await git.add(".")

    // Generate commit message
    const commitMsg = `OpenCode parallel mode: ${branchName}\n\nAutomatically committed by OpenCode parallel mode`

    // Commit
    await git.commit(commitMsg)
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓ Changes committed to " + branchName)

    Log.Default.info("parallel:commit", {
      branchName,
      filesChanged: status.files.length,
    })
  }

  /**
   * Print merge instructions to the user
   */
  function printMergeInstructions(branchName: string, originalBranch: string): void {
    UI.println()
    UI.println(UI.Style.TEXT_INFO_BOLD + "📋 Merge Instructions:")
    UI.println(UI.Style.TEXT_DIM + "  1. Review changes:")
    UI.println(UI.Style.TEXT_NORMAL + `     git log ${originalBranch}..${branchName}`)
    UI.println(UI.Style.TEXT_DIM + "  2. Merge to main branch:")
    UI.println(UI.Style.TEXT_NORMAL + `     git checkout ${originalBranch}`)
    UI.println(UI.Style.TEXT_NORMAL + `     git merge ${branchName}`)
    UI.println(UI.Style.TEXT_DIM + "  3. Delete branch (optional):")
    UI.println(UI.Style.TEXT_NORMAL + `     git branch -d ${branchName}`)
    UI.println()
  }
}
