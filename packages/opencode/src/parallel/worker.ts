import { Worktree } from "../worktree"
import { Session } from "../session"
import { Instance } from "../project/instance"
import { InstanceBootstrap } from "../project/bootstrap"
import { Bus } from "@/bus"
import { ParallelEvent } from "./events"
import { PlanStore } from "./plan"
import { Log } from "@/util/log"
import type { Plan, PlanID, SubtaskID, Subtask } from "./schema"
import { SessionStatus } from "../session/status"

export namespace WorkerManager {
  const log = Log.create({ service: "worker" })

  export async function spawnAll(plan: Plan, abort: AbortSignal): Promise<void> {
    log.info("spawning workers", { planID: plan.id, count: plan.subtasks.length })

    const results = await Promise.allSettled(
      plan.subtasks.map(async (subtask) => {
        if (abort.aborted) throw new Error("Aborted")

        await updateWorker(plan.id, subtask.id, { status: "spawning" })

        const info = await Worktree.makeWorktreeInfo(`parallel-${plan.id.slice(0, 8)}-${subtask.id.slice(0, 8)}`)
        const bootstrap = await Worktree.createFromInfo(info)

        await bootstrap()

        const session = await Instance.provide({
          directory: info.directory,
          init: InstanceBootstrap,
          fn: async () => {
            return Session.createNext({
              parentID: plan.sessionID,
              directory: info.directory,
              title: `[parallel] ${subtask.title}`,
            })
          },
        })

        await updateWorker(plan.id, subtask.id, {
          status: "running",
          sessionID: session.id,
          worktreeName: info.name,
          worktreeDir: info.directory,
          branch: info.branch,
        })

        await Instance.provide({
          directory: info.directory,
          init: InstanceBootstrap,
          fn: async () => {
            const prompt = buildWorkerPrompt(plan.task, subtask)
            const { SessionPrompt } = await import("../session/prompt")
            await SessionPrompt.append({
              sessionID: session.id,
              parts: [
                {
                  type: "text",
                  text: prompt,
                },
              ],
            })
          },
        })

        return { subtaskID: subtask.id, sessionID: session.id }
      }),
    )

    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status === "rejected") {
        const error = result.reason instanceof Error ? result.reason.message : "Spawn failed"
        await updateWorker(plan.id, plan.subtasks[i].id, {
          status: "failed",
          error,
        })
        log.error("worker spawn failed", { subtaskID: plan.subtasks[i].id, error })
      }
    }

    const allFailed = results.every((r) => r.status === "rejected")
    if (allFailed) {
      throw new Error("All workers failed to spawn")
    }

    log.info("workers spawned", { planID: plan.id })
  }

  export async function waitAll(planID: PlanID, abort: AbortSignal): Promise<void> {
    const plan = await PlanStore.get(planID)
    const running = plan.workers.filter((w) => w.status === "running")

    if (running.length === 0) {
      log.info("no running workers to wait for", { planID })
      return
    }

    log.info("waiting for workers", { planID, count: running.length })

    await Promise.allSettled(running.map((worker) => waitForWorker(planID, worker, abort)))

    log.info("all workers complete", { planID })
  }

  async function waitForWorker(
    planID: PlanID,
    worker: { subtaskID: SubtaskID; sessionID?: string; worktreeDir?: string },
    abort: AbortSignal,
  ): Promise<void> {
    if (!worker.sessionID || !worker.worktreeDir) return

    return new Promise<void>((resolve) => {
      const checkInterval = setInterval(async () => {
        if (abort.aborted) {
          clearInterval(checkInterval)
          resolve()
          return
        }

        try {
          await Instance.provide({
            directory: worker.worktreeDir!,
            init: InstanceBootstrap,
            fn: async () => {
              const status = SessionStatus.get(worker.sessionID!)
              if (status.type === "idle") {
                await updateWorker(planID, worker.subtaskID, { status: "done" })
                clearInterval(checkInterval)
                resolve()
              }
            },
          })
        } catch {
          await updateWorker(planID, worker.subtaskID, {
            status: "failed",
            error: "Worker session errored",
          })
          clearInterval(checkInterval)
          resolve()
        }
      }, 2000)
    })
  }

  function buildWorkerPrompt(globalTask: string, subtask: Subtask): string {
    return `# Parallel Task Execution

## Global Context
${globalTask}

## Your Specific Subtask
**${subtask.title}**

${subtask.description}

## File Scope
You should primarily modify these files:
${subtask.fileScope.map((f) => `- ${f}`).join("\n")}

## Important
- You are one of several agents working in parallel on different parts of this task.
- Your changes will be merged with other agents' work automatically.
- Stay within your file scope to minimize merge conflicts.
- Commit your changes when you're done.
- Do NOT modify files outside your scope unless absolutely necessary.`
  }

  async function updateWorker(
    planID: PlanID,
    subtaskID: SubtaskID,
    update: {
      status?: "pending" | "spawning" | "running" | "done" | "failed" | "merged" | "conflict"
      error?: string
      sessionID?: string
      worktreeName?: string
      worktreeDir?: string
      branch?: string
    },
  ) {
    await PlanStore.updateWorker(planID, subtaskID, update)
    const plan = await PlanStore.get(planID)
    const worker = plan.workers.find((w) => w.subtaskID === subtaskID)!
    Bus.publish(ParallelEvent.WorkerUpdated, { planID, worker })
  }
}
