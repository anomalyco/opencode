import { git } from "@/util/git"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { PlanStore } from "./plan"
import type { Plan, PlanID } from "./schema"
import z from "zod"

export namespace Integration {
  const log = Log.create({ service: "integration" })

  export type PublishMode = "new-branch" | "unstaged" | "direct"

  export type IntegrationResult = {
    branch: string
    error?: string
  }

  export type PublishResult = {
    success: boolean
    branch?: string
    error?: string
  }

  /**
   * Integration phase: Creates an integration branch with all merged worker changes.
   * This is always called after workers complete and before publishing.
   */
  export async function integrate(plan: Plan): Promise<IntegrationResult> {
    const cwd = Instance.worktree
    const integrationBranch = `integration/${plan.id.slice(0, 12)}`

    log.info("starting integration", { planID: plan.id, branch: integrationBranch })

    try {
      // Create integration branch from current HEAD
      const createResult = await git(["checkout", "-b", integrationBranch], { cwd })
      if (createResult.exitCode !== 0) {
        throw new Error(`Failed to create integration branch: ${createResult.stderr}`)
      }

      // All worker branches have already been merged during the merging phase
      // The integration branch now contains all merged changes

      log.info("integration complete", { planID: plan.id, branch: integrationBranch })
      return { branch: integrationBranch }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error("integration failed", { planID: plan.id, error: message })
      return { branch: integrationBranch, error: message }
    }
  }

  /**
   * Publish phase: Publishes changes based on the configured mode.
   * - new-branch: Creates a new branch with the changes (integration branch is kept)
   * - unstaged: Resets to original branch, leaves changes unstaged in working directory
   * - direct: Commits changes directly to the original branch
   */
  export async function publish(plan: Plan, mode: PublishMode, integrationBranch: string): Promise<PublishResult> {
    const cwd = Instance.worktree

    log.info("starting publish", { planID: plan.id, mode, integrationBranch })

    try {
      switch (mode) {
        case "new-branch":
          return await publishNewBranch(plan, integrationBranch, cwd)

        case "unstaged":
          return await publishUnstaged(plan, integrationBranch, cwd)

        case "direct":
          return await publishDirect(plan, integrationBranch, cwd)

        default:
          throw new Error(`Unknown publish mode: ${mode}`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error("publish failed", { planID: plan.id, mode, error: message })
      return { success: false, error: message }
    }
  }

  async function publishNewBranch(plan: Plan, integrationBranch: string, cwd: string): Promise<PublishResult> {
    const publishBranch = `parallel/${plan.id.slice(0, 12)}`

    log.info("publishing to new branch", { planID: plan.id, branch: publishBranch })

    // Create publish branch from integration branch
    const createResult = await git(["checkout", "-b", publishBranch], { cwd })
    if (createResult.exitCode !== 0) {
      throw new Error(`Failed to create publish branch: ${createResult.stderr}`)
    }

    log.info("publish complete (new-branch)", { planID: plan.id, branch: publishBranch })
    return { success: true, branch: publishBranch }
  }

  async function publishUnstaged(plan: Plan, integrationBranch: string, cwd: string): Promise<PublishResult> {
    log.info("publishing as unstaged changes", { planID: plan.id })

    // Get the original branch before integration
    const originalBranchResult = await git(["rev-parse", "--abbrev-ref", "HEAD@{1}"], { cwd })
    const originalBranch = originalBranchResult.stdout?.toString().trim() || "HEAD"

    // Soft reset to original branch to unstage all changes
    const resetResult = await git(["reset", "--soft", originalBranch], { cwd })
    if (resetResult.exitCode !== 0) {
      throw new Error(`Failed to reset to original branch: ${resetResult.stderr}`)
    }

    // Delete integration branch (cleanup)
    await git(["branch", "-D", integrationBranch], { cwd }).catch(() => {
      // Ignore cleanup errors
    })

    log.info("publish complete (unstaged)", { planID: plan.id })
    return { success: true }
  }

  async function publishDirect(plan: Plan, integrationBranch: string, cwd: string): Promise<PublishResult> {
    log.info("publishing directly to current branch", { planID: plan.id })

    // Get the original branch before integration
    const originalBranchResult = await git(["rev-parse", "--abbrev-ref", "HEAD@{1}"], { cwd })
    const originalBranch = originalBranchResult.stdout?.toString().trim() || "HEAD"

    // Commit the changes to the integration branch
    const commitResult = await git(["commit", "-m", `Parallel execution: ${plan.task.slice(0, 60)}`], { cwd })
    if (commitResult.exitCode !== 0) {
      throw new Error(`Failed to commit changes: ${commitResult.stderr}`)
    }

    // Checkout original branch and merge integration branch
    const checkoutResult = await git(["checkout", originalBranch], { cwd })
    if (checkoutResult.exitCode !== 0) {
      throw new Error(`Failed to checkout original branch: ${checkoutResult.stderr}`)
    }

    const mergeResult = await git(
      ["merge", "--no-ff", "-m", `Merge parallel execution: ${plan.task.slice(0, 60)}`, integrationBranch],
      { cwd },
    )
    if (mergeResult.exitCode !== 0) {
      throw new Error(`Failed to merge integration branch: ${mergeResult.stderr}`)
    }

    // Delete integration branch (cleanup)
    await git(["branch", "-d", integrationBranch], { cwd }).catch(() => {
      // Ignore cleanup errors
    })

    log.info("publish complete (direct)", { planID: plan.id })
    return { success: true, branch: originalBranch }
  }
}
