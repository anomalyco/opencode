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
    /** Estimated work lost in terms of incomplete subtasks */
    estimatedWorkLost: number
    /** Recommended action: "resume" or "abandon" */
    recommendedAction: "resume" | "abandon"
    /** Time since interruption in milliseconds, if available */
    timeSinceInterruption?: number
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
      const timeSinceInterruption = plan.time.approved ? Date.now() - plan.time.approved : undefined

      // Build actionable summary with specific commands and recovery suggestions
      const lines = [
        `Plan "${plan.task}" (${plan.id})`,
        `Status: ${plan.status}`,
        `Progress: ${completedWorkers.length}/${plan.workers.length} workers completed (${incompleteWorkers.length} incomplete)`,
        `Worktrees: ${existingWorktrees.length} found on disk`,
      ]

      if (incompleteWorkers.length > 0) {
        const withWorktree = incompleteWorkers.filter((w) => w.worktreeDir && fs.existsSync(w.worktreeDir)).length
        const withoutWorktree = incompleteWorkers.length - withWorktree

        if (withWorktree > 0) {
          lines.push(`  - ${withWorktree} worker(s) have worktrees that may contain uncommitted work`)
        }
        if (withoutWorktree > 0) {
          lines.push(`  - ${withoutWorktree} worker(s) lost their worktrees and need restart`)
        }
      }

      if (timeSinceInterruption) {
        const minutes = Math.floor(timeSinceInterruption / 60000)
        const hours = Math.floor(minutes / 60)
        if (hours > 0) {
          lines.push(`Interrupted: ${hours}h ${minutes % 60}m ago`)
        } else {
          lines.push(`Interrupted: ${minutes}m ago`)
        }
      }

      // Determine recommended action and add actionable commands
      const recommendedAction = canResume ? "resume" : "abandon"

      if (canResume) {
        lines.push("")
        lines.push("Recommended action: RESUME")
        lines.push(`  Run: opencode parallel resume ${plan.id}`)
        if (incompleteWorkers.some((w) => w.worktreeDir && fs.existsSync(w.worktreeDir))) {
          lines.push("  Some workers have worktrees with potential commits - these will be recovered")
        }
        if (incompleteWorkers.some((w) => !w.worktreeDir || !fs.existsSync(w.worktreeDir))) {
          lines.push("  Some workers need restart - they will be respawned automatically")
        }
      } else {
        lines.push("")
        lines.push("Recommended action: ABANDON")
        lines.push(`  Run: opencode parallel abandon ${plan.id}`)
        lines.push("  This will clean up any remaining worktrees and mark the plan as failed")
      }

      const summary = lines.join("\n")

      results.push({
        plan,
        completedWorkers,
        incompleteWorkers,
        existingWorktrees,
        canResume,
        needsCleanup: false,
        summary,
        estimatedWorkLost: incompleteWorkers.length,
        recommendedAction,
        timeSinceInterruption,
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

      const lines = [
        `Plan "${plan.task}" (${plan.id})`,
        `Status: failed (cleanup needed)`,
        `Orphaned worktrees: ${existingWorktrees.length}`,
        `Incomplete subtasks: ${plan.workers.length}`,
        "",
        "Action required: Clean up orphaned resources",
        `  Run: opencode parallel abandon ${plan.id}`,
        "  This will remove worktrees and mark workers as failed",
      ]

      const summary = lines.join("\n")

      results.push({
        plan,
        completedWorkers: [],
        incompleteWorkers: plan.workers,
        existingWorktrees,
        canResume: false,
        needsCleanup: true,
        summary,
        estimatedWorkLost: plan.workers.length,
        recommendedAction: "abandon",
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
      const allowedStatuses = INTERRUPTED_STATUSES.join(", ")
      throw new Error(
        `Cannot resume plan ${planID}: invalid status "${plan.status}".\n\n` +
          `Resume is only available for plans in these states: ${allowedStatuses}.\n` +
          `Current plan status indicates it's ${plan.status === "done" ? "already completed" : plan.status === "failed" ? "marked as failed" : "in a state that doesn't support resume"}.\n\n` +
          `If you need to restart this plan, create a new parallel execution instead.`,
      )
    }

    log.info("resuming interrupted plan", { planID, status: plan.status })

    // Phase 1: Assess each worker's actual state
    let recoveredCount = 0
    let failedCount = 0
    let lostWorktreeCount = 0

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
          recoveredCount++
          log.info("recovered completed worker", {
            planID,
            subtaskID: worker.subtaskID,
            details: "Worktree has commits - worker completed but status wasn't saved",
            nextStep: "Worker marked as done, will be included in merge",
          })
        } else {
          // Worktree exists but no commits — worker didn't finish
          await PlanStore.updateWorker({
            id: planID,
            subtaskID: worker.subtaskID,
            status: "failed",
            error: "Interrupted during execution - worktree exists but no commits found. Worker will be respawned.",
          } as any)
          failedCount++
          log.info("worker incomplete - will respawn", {
            planID,
            subtaskID: worker.subtaskID,
            details: "Worktree exists but has no commits - worker was interrupted before completing",
            nextStep: "Worker marked as failed, will be automatically respawned",
          })
        }
      } else {
        // No worktree — worker lost entirely
        lostWorktreeCount++
        await PlanStore.updateWorker({
          id: planID,
          subtaskID: worker.subtaskID,
          status: "failed",
          error: "Interrupted - worktree directory not found. Worker needs to be restarted from scratch.",
        } as any)
        log.info("worktree missing - worker lost", {
          planID,
          subtaskID: worker.subtaskID,
          expectedPath: worker.worktreeDir,
          details: "Worktree directory no longer exists - all progress lost",
          nextStep: "Worker marked as failed, will be respawned with fresh worktree",
        })
      }
    }

    if (recoveredCount > 0 || failedCount > 0 || lostWorktreeCount > 0) {
      log.info("worker recovery summary", {
        planID,
        recovered: recoveredCount,
        needsRespawn: failedCount,
        lost: lostWorktreeCount,
      })
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
      log.info("resume failed - all workers unsuccessful", {
        planID,
        details: "All workers failed during recovery - no work to merge",
        action:
          "Plan marked as failed. You may abandon it to clean up resources or review the errors and try a new plan.",
      })
      return PlanStore.get(planID)
    }

    if (allDone && anyDone) {
      // All workers done — transition to merging and run merge
      await forceStatus(planID, "merging")
      log.info("all workers recovered - starting merge", {
        planID,
        recoveredCount: updatedPlan.workers.filter((w) => w.status === "done").length,
        details: "All workers successfully recovered with commits",
        nextStep: "Starting merge pipeline to combine all changes",
      })

      const { MergePipeline } = await import("./merge")
      const success = await MergePipeline.run(planID)
      await forceStatus(planID, success ? "done" : "failed")

      if (!success) {
        log.info("merge failed during resume", {
          planID,
          details: "Merge pipeline encountered conflicts or errors",
          action: "Plan marked as failed. Review conflicts and consider creating a new plan.",
        })
      }

      return PlanStore.get(planID)
    }

    // Some workers done, some failed — let user decide via orchestrator chat
    // Set plan back to "running" so the status view shows correctly
    if (updatedPlan.status === "merging" || updatedPlan.status === "approved" || updatedPlan.status === "spawning") {
      await forceStatus(planID, "running")
    }

    const doneCount = updatedPlan.workers.filter((w) => w.status === "done").length
    const failedWorkersCount = updatedPlan.workers.filter((w) => w.status === "failed").length
    const stillPending = updatedPlan.workers.filter((w) => w.status === "pending").length

    log.info("plan partially recovered", {
      planID,
      done: doneCount,
      failed: failedWorkersCount,
      pending: stillPending,
      details: `${doneCount} workers recovered, ${failedWorkersCount} need respawn`,
      nextStep: "Workers will be respawned automatically. Check orchestrator chat for status updates.",
    })

    return PlanStore.get(planID)
  }

  /**
   * Abandon an interrupted or failed plan — clean up worktrees and ensure failed status.
   */
  export async function abandon(planID: PlanID): Promise<Plan> {
    const plan = await PlanStore.get(planID)

    log.info("abandoning plan", { planID, status: plan.status })

    // Count what will be cleaned up for the confirmation message
    const worktreesToClean = plan.workers.filter((w) => w.worktreeDir && fs.existsSync(w.worktreeDir)).length
    const incompleteCount = plan.workers.filter((w) => INTERRUPTED_WORKER_STATUSES.includes(w.status)).length

    // Mark all incomplete workers as failed (for interrupted plans)
    for (const worker of plan.workers) {
      if (INTERRUPTED_WORKER_STATUSES.includes(worker.status)) {
        await PlanStore.updateWorker({
          id: planID,
          subtaskID: worker.subtaskID,
          status: "failed",
          error: "Abandoned by user - plan cleanup requested",
        } as any)
      }
    }

    // Clean up worktrees
    await cleanupWorktrees(plan)

    // Mark plan as failed
    await forceStatus(planID, "failed")

    const cleanedWorktrees = plan.workers.filter((w) => w.worktreeDir).length

    log.info("plan abandoned and cleaned up", {
      planID,
      workersMarkedFailed: incompleteCount,
      worktreesRemoved: cleanedWorktrees,
      branchesRemoved: plan.workers.filter((w) => w.branch).length,
      confirmation: `Plan ${plan.id} has been abandoned. ${cleanedWorktrees} worktree(s) cleaned up, ${incompleteCount} incomplete worker(s) marked as failed.`,
    })

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
