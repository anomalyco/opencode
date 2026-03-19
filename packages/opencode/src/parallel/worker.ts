import { Worktree } from "../worktree"
import { Session } from "../session"
import { Instance } from "../project/instance"
import { InstanceBootstrap } from "../project/bootstrap"
import { PlanStore } from "./plan"
import { Config } from "@/config/config"
import { Log } from "@/util/log"
import { GlobalBus } from "@/bus/global"
import { SessionStatus } from "../session/status"
import { git } from "../util/git"
import { SessionID } from "@/session/schema"
import type { Plan, PlanID, SubtaskID, Subtask, WorkerState } from "./schema"

export namespace WorkerManager {
  const log = Log.create({ service: "worker" })

  /**
   * Run async tasks with a concurrency limit.
   * If maxConcurrency is undefined, all tasks run in parallel (Promise.allSettled).
   */
  async function pooled<T, R>(
    items: T[],
    maxConcurrency: number | undefined,
    fn: (item: T) => Promise<R>,
  ): Promise<PromiseSettledResult<R>[]> {
    if (!maxConcurrency || maxConcurrency >= items.length) {
      return Promise.allSettled(items.map(fn))
    }

    const results: PromiseSettledResult<R>[] = new Array(items.length)
    let cursor = 0

    async function worker(): Promise<void> {
      while (cursor < items.length) {
        const index = cursor++
        try {
          const value = await fn(items[index])
          results[index] = { status: "fulfilled", value }
        } catch (reason) {
          results[index] = { status: "rejected", reason }
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(maxConcurrency, items.length) }, () => worker()),
    )
    return results
  }

  export async function spawnAll(plan: Plan, abort: AbortSignal): Promise<void> {
    const cfg = await Config.get()
    const maxWorkers = cfg.parallel?.max_workers
    log.info("spawning workers", { planID: plan.id, count: plan.subtasks.length, maxWorkers: maxWorkers ?? "unlimited" })

    const spawnOne = async (subtask: Subtask) => {
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
          const promptText = buildWorkerPrompt(plan.task, subtask)
          const { SessionPrompt } = await import("../session/prompt")
          await SessionPrompt.prompt({
            sessionID: session.id,
            parts: [
              {
                type: "text" as const,
                text: promptText,
              },
            ],
          })
        },
      })

      return { subtaskID: subtask.id, sessionID: session.id }
    }

    const results = await pooled(plan.subtasks, maxWorkers, spawnOne)

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

    // Build a map of sessionID -> worker for fast lookup
    const sessionToWorker = new Map<string, { subtaskID: SubtaskID; worktreeDir: string }>()
    for (const worker of running) {
      if (worker.sessionID && worker.worktreeDir) {
        sessionToWorker.set(worker.sessionID, {
          subtaskID: worker.subtaskID,
          worktreeDir: worker.worktreeDir,
        })
      }
    }

    const pending = new Set(sessionToWorker.keys())

    await new Promise<void>((resolve) => {
      // Listen to GlobalBus for session.idle events from any instance
      const handler = async (event: { directory?: string; payload: any }) => {
        if (abort.aborted) {
          cleanup()
          resolve()
          return
        }

        const { payload } = event
        if (payload.type !== "session.idle" && payload.type !== "session.status") return

        // session.status events have { sessionID, status: { type } }
        // session.idle events have { sessionID }
        const sessionID = payload.properties?.sessionID
        if (!sessionID || !pending.has(sessionID)) return

        const isIdle =
          payload.type === "session.idle" ||
          (payload.type === "session.status" && payload.properties?.status?.type === "idle")

        if (!isIdle) return

        const worker = sessionToWorker.get(sessionID)
        if (!worker) return

        pending.delete(sessionID)
        log.info("worker completed", { planID, subtaskID: worker.subtaskID })

        try {
          // Collect diff stats
          const diffStat = await collectDiffStat(worker.worktreeDir)
          await updateWorker(planID, worker.subtaskID, { status: "done", diffStat })
        } catch (e) {
          const error = e instanceof Error ? e.message : "Worker completion handling failed"
          await updateWorker(planID, worker.subtaskID, { status: "failed", error })
        }

        if (pending.size === 0) {
          cleanup()
          resolve()
        }
      }

      const cleanup = () => {
        GlobalBus.off("event", handler)
        if (fallbackTimer) clearInterval(fallbackTimer)
      }

      GlobalBus.on("event", handler)

      // Fallback poll every 10s in case we missed an event (e.g., session was already idle before we subscribed)
      const fallbackTimer = setInterval(async () => {
        if (abort.aborted || pending.size === 0) {
          cleanup()
          resolve()
          return
        }

        for (const sessionID of [...pending]) {
          const worker = sessionToWorker.get(sessionID)
          if (!worker) continue

          try {
            const idle = await Instance.provide({
              directory: worker.worktreeDir,
              init: InstanceBootstrap,
              fn: async () => {
                const status = SessionStatus.get(SessionID.make(sessionID))
                return status.type === "idle"
              },
            })

            if (idle) {
              pending.delete(sessionID)
              const diffStat = await collectDiffStat(worker.worktreeDir)
              await updateWorker(planID, worker.subtaskID, { status: "done", diffStat })
            }
          } catch {
            pending.delete(sessionID)
            await updateWorker(planID, worker.subtaskID, {
              status: "failed",
              error: "Worker session errored",
            })
          }
        }

        if (pending.size === 0) {
          cleanup()
          resolve()
        }
      }, 10_000)

      // Handle abort
      abort.addEventListener(
        "abort",
        () => {
          cleanup()
          resolve()
        },
        { once: true },
      )
    })

    log.info("all workers complete", { planID })
  }

  async function collectDiffStat(
    worktreeDir: string,
  ): Promise<{ additions: number; deletions: number; files: number } | undefined> {
    try {
      const stat = await git(["diff", "--stat", "HEAD"], { cwd: worktreeDir })
      const output = outputText(stat.stdout)
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
      diffStat?: { additions: number; deletions: number; files: number }
    },
  ) {
    // PlanStore.updateWorker already publishes both PlanUpdated and WorkerUpdated events
    await PlanStore.updateWorker({
      id: planID,
      subtaskID,
      ...update,
      sessionID: update.sessionID ? SessionID.make(update.sessionID) : undefined,
    } as any)
  }
}

function outputText(input: Uint8Array | undefined): string {
  if (!input?.length) return ""
  return new TextDecoder().decode(input).trim()
}
