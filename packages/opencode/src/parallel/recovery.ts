import { PlanStore } from "./plan"
import { Database, eq } from "../storage/db"
import { PlanTable } from "./plan.sql"
import { Log } from "@/util/log"
import { git } from "../util/git"
import { Instance } from "../project/instance"
import type { Plan, PlanID, PlanStatus, WorkerState } from "./schema"
import type { ProjectID } from "../project/schema"
import * as fs from "fs"
import * as path from "path"

export namespace Recovery {
  const log = Log.create({ service: "parallel-recovery" })

  /** Statuses that indicate an interrupted plan */
  const INTERRUPTED_STATUSES: PlanStatus[] = ["approved", "spawning", "running", "merging"]

  /** Statuses that indicate an in-flight worker */
  const INTERRUPTED_WORKER_STATUSES = ["pending", "spawning", "running"]

  export interface InterruptedPlan {
    plan: Plan
    completedWorkers: WorkerState[]
    incompleteWorkers: WorkerState[]
    existingWorktrees: string[]
    canResume: boolean
    needsCleanup: boolean
    summary: string
  }

  /**
   * Scan for interrupted plans belonging to this project.
   * Called on startup to detect plans that were running when the server died.
   * Also finds failed plans with orphaned worktrees that need cleanup.
   */
  export async function scan(projectID: ProjectID): Promise<InterruptedPlan[]> {
    const plans = await PlanStore.list()
    const interrupted = plans.filter((p) => p.projectID === projectID && INTERRUPTED_STATUSES.includes(p.status))

    log.info("found interrupted plans", { count: interrupted.length })

    const results: InterruptedPlan[] = []

    for (const plan of interrupted) {
      const completedWorkers = plan.workers.filter((w) => w.status === "done" || w.status === "merged")
      const incompleteWorkers = plan.workers.filter((w) => INTERRUPTED_WORKER_STATUSES.includes(w.status))

      // Check which worktrees still exist on disk
      const existingWorktrees: string[] = []
      for (const worker of plan.workers) {
        if (worker.worktreeDir && fs.existsSync(worker.worktreeDir)) {
          existingWorktrees.push(worker.worktreeDir)
        }
      }

      // Check if incomplete workers have commits in their worktrees
      // (they may have finished work but the status wasn't updated)
      for (const worker of incompleteWorkers) {
        if (worker.worktreeDir && fs.existsSync(worker.worktreeDir)) {
          const hasCommits = await worktreeHasCommits(worker.worktreeDir)
          if (hasCommits) {
            // Worker completed but status wasn't updated — mark as recoverable
            log.info("worker has commits despite incomplete status", {
              planID: plan.id,
              subtaskID: worker.subtaskID,
              status: worker.status,
            })
          }
        }
      }

      const canResume = incompleteWorkers.length > 0 || plan.status === "merging"

      const summary = [
        `Plan "${plan.task}" (${plan.id})`,
        `Status: ${plan.status}`,
        `Workers: ${completedWorkers.length}/${plan.workers.length} completed`,
        `Incomplete: ${incompleteWorkers.length} workers`,
        `Worktrees on disk: ${existingWorktrees.length}`,
        canResume ? "Can be resumed" : "Cannot be resumed — mark as failed",
      ].join("\n")

      results.push({
        plan,
        completedWorkers,
        incompleteWorkers,
        existingWorktrees,
        canResume,
        needsCleanup: false,
        summary,
      })
    }

    // Also check for failed plans with orphaned worktrees
    const failed = plans.filter((p) => p.projectID === projectID && p.status === "failed")
    for (const plan of failed) {
      const existingWorktrees: string[] = []
      for (const worker of plan.workers) {
        if (worker.worktreeDir && fs.existsSync(worker.worktreeDir)) {
          existingWorktrees.push(worker.worktreeDir)
        }
      }

      if (existingWorktrees.length === 0) continue

      log.info("found failed plan with orphaned worktrees", { planID: plan.id, worktrees: existingWorktrees.length })

      const summary = [
        `Plan "${plan.task}" (${plan.id})`,
        `Status: ${plan.status}`,
        `Orphaned worktrees: ${existingWorktrees.length}`,
        "Use 'abandon' action to clean up",
      ].join("\n")

      results.push({
        plan,
        completedWorkers: [],
        incompleteWorkers: plan.workers,
        existingWorktrees,
        canResume: false,
        needsCleanup: true,
        summary,
      })
    }

    return results
  }

  /**
   * Resume an interrupted plan.
   * - Workers with existing worktrees + commits → mark as done
   * - Workers still pending/spawning → re-spawn
   * - If plan was merging → restart merge pipeline
   */
  export async function resume(planID: PlanID): Promise<Plan> {
    const plan = await PlanStore.get(planID)

    if (!INTERRUPTED_STATUSES.includes(plan.status)) {
      throw new Error(`Plan ${planID} is not in an interrupted state (status: ${plan.status})`)
    }

    log.info("resuming interrupted plan", { planID, status: plan.status })

    // Phase 1: Assess each worker's actual state
    for (const worker of plan.workers) {
      if (!INTERRUPTED_WORKER_STATUSES.includes(worker.status)) continue

      if (worker.worktreeDir && fs.existsSync(worker.worktreeDir)) {
        const hasCommits = await worktreeHasCommits(worker.worktreeDir)
        if (hasCommits) {
          // Worker finished but status wasn't saved — recover it
          const diffStat = await collectDiffStat(worker.worktreeDir)
          await PlanStore.updateWorker({
            id: planID,
            subtaskID: worker.subtaskID,
            status: "done",
            diffStat,
          } as any)
          log.info("recovered completed worker", { planID, subtaskID: worker.subtaskID })
        } else {
          // Worktree exists but no commits — mark as failed (will need re-spawn)
          await PlanStore.updateWorker({
            id: planID,
            subtaskID: worker.subtaskID,
            status: "failed",
            error: "Interrupted — worktree exists but no commits",
          } as any)
        }
      } else {
        // No worktree — mark as failed
        await PlanStore.updateWorker({
          id: planID,
          subtaskID: worker.subtaskID,
          status: "failed",
          error: "Interrupted — worktree not found",
        } as any)
      }
    }

    // Phase 2: Check if all workers are now in terminal state
    const updatedPlan = await PlanStore.get(planID)
    const allDone = updatedPlan.workers.every(
      (w) => w.status === "done" || w.status === "merged" || w.status === "failed" || w.status === "conflict",
    )
    const anyDone = updatedPlan.workers.some((w) => w.status === "done")
    const allFailed = updatedPlan.workers.every((w) => w.status === "failed")

    if (allFailed) {
      // Nothing to merge — mark plan as failed
      await forceStatus(planID, "failed")
      log.info("all workers failed, plan marked as failed", { planID })
      return PlanStore.get(planID)
    }

    if (allDone && anyDone) {
      // All workers done — transition to merging and run merge
      await forceStatus(planID, "merging")
      log.info("all workers done, starting merge", { planID })

      const { MergePipeline } = await import("./merge")
      const success = await MergePipeline.run(planID)
      await forceStatus(planID, success ? "done" : "failed")
      return PlanStore.get(planID)
    }

    // Some workers done, some failed — let user decide via orchestrator chat
    // Set plan back to "running" so the status view shows correctly
    if (updatedPlan.status === "merging" || updatedPlan.status === "approved" || updatedPlan.status === "spawning") {
      await forceStatus(planID, "running")
    }

    log.info("plan partially recovered", {
      planID,
      done: updatedPlan.workers.filter((w) => w.status === "done").length,
      failed: updatedPlan.workers.filter((w) => w.status === "failed").length,
    })

    return PlanStore.get(planID)
  }

  /**
   * Abandon an interrupted or failed plan — clean up worktrees and ensure failed status.
   */
  export async function abandon(planID: PlanID): Promise<Plan> {
    const plan = await PlanStore.get(planID)

    log.info("abandoning plan", { planID, status: plan.status })

    // Mark all incomplete workers as failed (for interrupted plans)
    for (const worker of plan.workers) {
      if (INTERRUPTED_WORKER_STATUSES.includes(worker.status)) {
        await PlanStore.updateWorker({
          id: planID,
          subtaskID: worker.subtaskID,
          status: "failed",
          error: "Abandoned by user",
        } as any)
      }
    }

    // Clean up worktrees
    await cleanupWorktrees(plan)

    // Mark plan as failed
    await forceStatus(planID, "failed")

    return PlanStore.get(planID)
  }

  /**
   * Clean up orphaned parallel worktrees for a project.
   * Runs `git worktree prune` and removes any parallel-* worktree directories.
   */
  export async function cleanupWorktrees(plan: Plan): Promise<void> {
    // Prune stale worktree references
    try {
      await git(["worktree", "prune"], { cwd: Instance.worktree })
      log.info("pruned stale worktrees")
    } catch (e) {
      log.warn("failed to prune worktrees", { error: e })
    }

    // Remove worktree directories for this plan's workers
    for (const worker of plan.workers) {
      if (worker.worktreeDir && fs.existsSync(worker.worktreeDir)) {
        try {
          await git(["worktree", "remove", "--force", worker.worktreeDir], { cwd: Instance.worktree })
          log.info("removed worktree", { dir: worker.worktreeDir })
        } catch {
          // Try direct removal if git worktree remove fails
          try {
            fs.rmSync(worker.worktreeDir, { recursive: true, force: true })
            log.info("force-removed worktree directory", { dir: worker.worktreeDir })
          } catch (e) {
            log.warn("failed to remove worktree", { dir: worker.worktreeDir, error: e })
          }
        }
      }

      // Remove the branch if it exists
      if (worker.branch) {
        try {
          await git(["branch", "-D", worker.branch], { cwd: Instance.worktree })
        } catch {
          // Branch may already be gone
        }
      }
    }
  }

  /**
   * Force-set plan status, bypassing normal transition validation.
   * Used only during recovery where the state machine may be in an invalid state.
   */
  async function forceStatus(planID: PlanID, status: PlanStatus): Promise<void> {
    Database.use((db) => {
      db.update(PlanTable)
        .set({
          status,
          ...(status === "done" || status === "failed" ? { time_completed: Date.now() } : {}),
        })
        .where(eq(PlanTable.id, planID))
        .run()
    })

    // Re-fetch and publish event
    const plan = await PlanStore.get(planID)
    const { Bus } = await import("@/bus")
    const { ParallelEvent } = await import("./events")
    Bus.publish(ParallelEvent.PlanUpdated, { plan })
  }

  /** Check if a worktree has commits ahead of the main branch */
  async function worktreeHasCommits(worktreeDir: string): Promise<boolean> {
    try {
      const result = await git(["log", "HEAD", "--not", "--remotes", "--oneline", "-1"], {
        cwd: worktreeDir,
      })
      const output = new TextDecoder().decode(result.stdout).trim()
      if (output.length > 0) return true

      // Also check if there are uncommitted changes
      const status = await git(["status", "--porcelain"], { cwd: worktreeDir })
      const statusOutput = new TextDecoder().decode(status.stdout).trim()
      return statusOutput.length > 0
    } catch {
      return false
    }
  }

  /** Collect diff stats from a worktree */
  async function collectDiffStat(
    worktreeDir: string,
  ): Promise<{ additions: number; deletions: number; files: number } | undefined> {
    try {
      const stat = await git(["diff", "--stat", "HEAD~1"], { cwd: worktreeDir })
      const output = new TextDecoder().decode(stat.stdout).trim()
      const lines = output.split("\n")
      const lastLine = lines[lines.length - 1] ?? ""
      const files = parseInt(lastLine.match(/(\d+) file/)?.[1] ?? "0")
      const additions = parseInt(lastLine.match(/(\d+) insertion/)?.[1] ?? "0")
      const deletions = parseInt(lastLine.match(/(\d+) deletion/)?.[1] ?? "0")
      if (files === 0 && additions === 0 && deletions === 0) return undefined
      return { additions, deletions, files }
    } catch {
      return undefined
    }
  }
}
