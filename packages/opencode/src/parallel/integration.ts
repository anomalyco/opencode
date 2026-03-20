import path from "path"
import { unlink } from "fs/promises"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import { git } from "@/util/git"
import { Instance } from "@/project/instance"
import { PlanStore } from "./plan"
import { Log } from "@/util/log"
import { MergePipeline } from "./merge"
import type { PlanID, Plan } from "./schema"

export const PublishMode = z.enum(["new-branch", "unstaged", "direct"])
export type PublishMode = z.infer<typeof PublishMode>

export const IntegrationError = NamedError.create(
  "IntegrationError",
  z.object({
    code: z.string(),
    message: z.string(),
    planID: z.string().optional(),
  }),
)

export const DirtyWorktreeError = NamedError.create(
  "DirtyWorktreeError",
  z.object({
    message: z.string(),
  }),
)

export const MergeError = NamedError.create(
  "MergeError",
  z.object({
    branch: z.string(),
    message: z.string(),
  }),
)

export namespace Integration {
  const log = Log.create({ service: "integration" })

  export interface IntegrationResult {
    branch: string
    merged: string[]
    failed: string[]
    error?: string
    success: boolean
  }

  export interface PublishResult {
    mode: PublishMode
    branch?: string
    applied?: boolean
    merged?: boolean
    error?: string
    success: boolean
  }

  function outputText(input: Uint8Array | undefined): string {
    if (!input?.length) return ""
    return new TextDecoder().decode(input).trim()
  }

  async function getCurrentBranch(cwd: string): Promise<string> {
    const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd })
    if (result.exitCode !== 0) {
      throw new IntegrationError({
        code: "git_error",
        message: "Failed to get current branch",
      })
    }
    return outputText(result.stdout)
  }

  async function branchExists(branch: string, cwd: string): Promise<boolean> {
    const result = await git(["show-ref", "--verify", `--refs/heads/${branch}`], { cwd })
    return result.exitCode === 0
  }

  async function isWorktreeDirty(cwd: string): Promise<boolean> {
    const status = await git(["status", "--porcelain"], { cwd })
    if (status.exitCode !== 0) {
      throw new IntegrationError({
        code: "git_error",
        message: "Failed to check worktree status",
      })
    }
    return outputText(status.stdout).length > 0
  }

  async function createBranch(branch: string, base: string, cwd: string): Promise<void> {
    const result = await git(["checkout", "-b", branch, base], { cwd })
    if (result.exitCode !== 0) {
      throw new IntegrationError({
        code: "branch_create_failed",
        message: `Failed to create branch ${branch}: ${outputText(result.stderr)}`,
      })
    }
  }

  async function checkoutBranch(branch: string, cwd: string): Promise<void> {
    const result = await git(["checkout", branch], { cwd })
    if (result.exitCode !== 0) {
      throw new IntegrationError({
        code: "checkout_failed",
        message: `Failed to checkout branch ${branch}: ${outputText(result.stderr)}`,
      })
    }
  }

  async function mergeBranch(branch: string, message: string, cwd: string): Promise<boolean> {
    const result = await git(["merge", "--no-ff", "-m", message, branch], { cwd })
    if (result.exitCode === 0) return true

    await git(["merge", "--abort"], { cwd })
    return false
  }

  async function getWorkerBranches(plan: Plan): Promise<string[]> {
    return plan.workers
      .filter((w) => w.status === "done" || w.status === "merged")
      .map((w) => w.branch)
      .filter((b): b is string => !!b)
  }

  export async function integrate(planID: PlanID): Promise<IntegrationResult> {
    const plan = await PlanStore.get(planID)
    const cwd = Instance.worktree
    const integrationBranch = `parallel/${planID}`

    log.info("starting integration", { planID, branch: integrationBranch })

    const originalBranch = await getCurrentBranch(cwd)
    const workerBranches = await getWorkerBranches(plan)
    if (workerBranches.length === 0) {
      throw new IntegrationError({
        code: "no_workers",
        message: "No completed workers to integrate",
        planID,
      })
    }

    await PlanStore.update({ id: planID, integrationBranch })

    try {
      if (await branchExists(integrationBranch, cwd)) {
        log.info("removing existing integration branch", { planID, branch: integrationBranch })
        await checkoutBranch(originalBranch, cwd)
        await git(["branch", "-D", integrationBranch], { cwd })
      }

      await createBranch(integrationBranch, originalBranch, cwd)
      log.info("created integration branch", { planID, branch: integrationBranch, base: originalBranch })

      const result = await MergePipeline.run(planID)
      const merged = result.workers.filter((w) => w.resolutionMode !== "failed").map((w) => w.branch)
      const failed = result.workers.filter((w) => w.resolutionMode === "failed").map((w) => w.branch)

      log.info("integration complete", {
        planID,
        branch: integrationBranch,
        merged: merged.length,
        failed: failed.length,
      })

      return {
        branch: integrationBranch,
        merged,
        failed,
        success: result.success && failed.length === 0,
        error: failed.length > 0 && merged.length === 0 ? "No worker branches could be integrated" : undefined,
      }
    } finally {
      await checkoutBranch(originalBranch, cwd).catch(() => {})
    }
  }

  export async function publish(planID: PlanID, mode: PublishMode): Promise<PublishResult> {
    const cwd = Instance.worktree
    const integrationBranch = `parallel/${planID}`

    log.info("starting publish", { planID, mode, branch: integrationBranch })

    if (!(await branchExists(integrationBranch, cwd))) {
      throw new IntegrationError({
        code: "no_integration_branch",
        message: `Integration branch ${integrationBranch} does not exist. Run integrate first.`,
        planID,
      })
    }

    if (mode === "new-branch") {
      log.info("publish complete - leaving on integration branch", { planID, branch: integrationBranch })
      return { mode, branch: integrationBranch, success: true }
    }

    const currentBranch = await getCurrentBranch(cwd)
    if (currentBranch === integrationBranch) {
      throw new IntegrationError({
        code: "wrong_branch",
        message: `Current branch is ${integrationBranch}. Checkout the target branch before publishing in ${mode} mode.`,
        planID,
      })
    }

    if (await isWorktreeDirty(cwd)) {
      throw new DirtyWorktreeError({
        message: `Worktree has uncommitted changes. Please commit or stash before using ${mode} mode.`,
      })
    }

    if (mode === "unstaged") {
      const diffResult = await git(["diff", "--binary", `${currentBranch}..${integrationBranch}`], { cwd })
      const diff = outputText(diffResult.stdout)

      if (diff) {
        const patch = path.join(process.env.TMPDIR ?? "/tmp", `opencode-${planID}-${Date.now()}.patch`)
        await Bun.write(patch, diff)
        const apply = await git(["apply", "--whitespace=nowarn", patch], { cwd })
        await unlink(patch).catch(() => {})
        if (apply.exitCode !== 0) {
          throw new IntegrationError({
            code: "apply_failed",
            message: `Failed to apply changes to working tree: ${outputText(apply.stderr)}`,
            planID,
          })
        }
      }

      log.info("publish complete - applied to working tree", { planID })
      return { mode, applied: true, success: true }
    }

    if (mode === "direct") {
      const message = `merge: parallel plan ${planID.slice(0, 12)}\n\nIntegration branch: ${integrationBranch}`
      const success = await mergeBranch(integrationBranch, message, cwd)

      if (!success) {
        throw new MergeError({
          branch: integrationBranch,
          message: `Failed to merge integration branch ${integrationBranch} into ${currentBranch}`,
        })
      }

      await git(["branch", "-D", integrationBranch], { cwd })

      log.info("publish complete - merged to current branch", { planID, branch: currentBranch })
      return { mode, branch: currentBranch, merged: true, success: true }
    }

    throw new IntegrationError({
      code: "invalid_mode",
      message: `Invalid publish mode: ${mode}`,
      planID,
    })
  }

  export async function run(
    planID: PlanID,
    mode: PublishMode,
  ): Promise<{ integration: IntegrationResult; publish: PublishResult }> {
    const integration = await integrate(planID)

    if (integration.failed.length > 0 && integration.merged.length === 0) {
      throw new IntegrationError({
        code: "integration_failed",
        message: `All worker branches failed to integrate: ${integration.failed.join(", ")}`,
        planID,
      })
    }

    const publish = await Integration.publish(planID, mode)

    return { integration, publish }
  }

  export async function cleanup(planID: PlanID): Promise<void> {
    const cwd = Instance.worktree
    const integrationBranch = `parallel/${planID}`

    log.info("cleaning up integration", { planID, branch: integrationBranch })

    const currentBranch = await getCurrentBranch(cwd)

    if (currentBranch === integrationBranch) {
      const mainCheck = await git(["show-ref", "--verify", "--quiet", "refs/heads/main"], { cwd })
      const masterCheck = await git(["show-ref", "--verify", "--quiet", "refs/heads/master"], { cwd })
      const fallback = mainCheck.exitCode === 0 ? "main" : masterCheck.exitCode === 0 ? "master" : undefined

      if (fallback) {
        await checkoutBranch(fallback, cwd)
      } else {
        throw new IntegrationError({
          code: "no_fallback_branch",
          message: "Cannot determine fallback branch to checkout",
          planID,
        })
      }
    }

    if (await branchExists(integrationBranch, cwd)) {
      await git(["branch", "-D", integrationBranch], { cwd })
      log.info("integration branch deleted", { planID, branch: integrationBranch })
    }

    log.info("cleanup complete", { planID })
  }

  export async function getStatus(planID: PlanID): Promise<{
    exists: boolean
    merged: string[]
    pending: string[]
  }> {
    const plan = await PlanStore.get(planID)
    const cwd = Instance.worktree
    const integrationBranch = `parallel/${planID}`

    const exists = await branchExists(integrationBranch, cwd)
    const workerBranches = await getWorkerBranches(plan)

    const merged: string[] = []
    const pending: string[] = []

    for (const branch of workerBranches) {
      const ancestor = await git(["merge-base", "--is-ancestor", branch, integrationBranch], { cwd })
      if (ancestor.exitCode === 0) {
        merged.push(branch)
      } else {
        pending.push(branch)
      }
    }

    return { exists, merged, pending }
  }
}
