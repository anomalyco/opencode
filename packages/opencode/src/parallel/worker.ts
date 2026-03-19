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

    await Promise.all(Array.from({ length: Math.min(maxConcurrency, items.length) }, () => worker()))
    return results
  }

  export async function spawnOne(
    plan: Plan,
    subtask: Subtask,
    abort: AbortSignal,
  ): Promise<{ subtaskID: SubtaskID; sessionID: string }> {
    if (abort.aborted) throw new Error("Aborted")

    const info = await Worktree.makeWorktreeInfo(`parallel-${plan.id.slice(0, 12)}-${subtask.id.slice(0, 20)}`)
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

  export async function spawnAll(plan: Plan, abort: AbortSignal): Promise<void> {
    const cfg = await Config.get()
    const maxWorkers = cfg.parallel?.max_workers
    const spawnStartTime = Date.now()
    log.info("spawning workers", {
      planID: plan.id,
      count: plan.subtasks.length,
      maxWorkers: maxWorkers ?? "unlimited",
    })

    const initialWorkers = plan.workers.map((w) => ({ ...w, status: "spawning" as const }))
    await PlanStore.update({ id: plan.id, workers: initialWorkers })

    const results = await pooled(plan.subtasks, maxWorkers, (subtask) => spawnOne(plan, subtask, abort))

    const failedUpdates: { subtaskID: SubtaskID; error: string }[] = []
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status === "rejected") {
        const error = result.reason instanceof Error ? result.reason.message : "Spawn failed"
        failedUpdates.push({ subtaskID: plan.subtasks[i].id, error })
        log.error("worker spawn failed", { subtaskID: plan.subtasks[i].id, error })
      }
    }

    if (failedUpdates.length > 0) {
      await Promise.all(
        failedUpdates.map(({ subtaskID, error }) =>
          updateWorker(plan.id, subtaskID, { status: "failed", error }).catch((err) => {
            log.warn("failed to mark worker as failed", { subtaskID, error: err })
          }),
        ),
      )
    }

    const allFailed = results.every((r) => r.status === "rejected")
    if (allFailed) {
      throw new Error("All workers failed to spawn")
    }

    log.info("workers spawned", { planID: plan.id, durationMs: Date.now() - spawnStartTime })
  }

  export async function waitAll(planID: PlanID, abort: AbortSignal): Promise<void> {
    const plan = await PlanStore.get(planID)
    const cfg = await Config.get()
    const running = plan.workers.filter((w) => w.status === "running")

    if (running.length === 0) {
      log.info("no running workers to wait for", { planID })
      return
    }

    const waitStartTime = Date.now()
    log.info("waiting for workers", { planID, count: running.length })

    const defaultTimeoutMs = 30 * 60 * 1000 // 30 minutes
    const timeoutMs = cfg.parallel?.worker_timeout_ms ?? defaultTimeoutMs
    const startTimes = new Map<string, number>()

    // Build a map of sessionID -> worker for fast lookup
    const sessionToWorker = new Map<string, { subtaskID: SubtaskID; worktreeDir: string; startTime: number }>()
    for (const worker of running) {
      if (worker.sessionID && worker.worktreeDir) {
        const startTime = Date.now()
        startTimes.set(worker.sessionID, startTime)
        sessionToWorker.set(worker.sessionID, {
          subtaskID: worker.subtaskID,
          worktreeDir: worker.worktreeDir,
          startTime,
        })
      }
    }

    const pending = new Set(sessionToWorker.keys())
    const debounceMs = 50
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const pendingUpdates = new Map<
      SubtaskID,
      {
        status: "done" | "failed"
        diffStat?: ReturnType<typeof collectDiffStat> extends Promise<infer T> ? T : never
        error?: string
      }
    >()

    await new Promise<void>((resolve) => {
      // Debounced batch update handler
      const processBatch = async () => {
        if (pendingUpdates.size === 0) return

        const updates = Array.from(pendingUpdates.entries())
        pendingUpdates.clear()

        // Deduplicate by keeping only the last update per subtask
        const uniqueUpdates = new Map(updates)

        await Promise.all(
          Array.from(uniqueUpdates.entries()).map(async ([subtaskID, update]) => {
            try {
              if (update.status === "done") {
                await updateWorker(planID, subtaskID, { status: "done", diffStat: update.diffStat })
              } else {
                await updateWorker(planID, subtaskID, { status: "failed", error: update.error })
              }
            } catch (err) {
              // If update fails (e.g., already in target state), log but don't fail
              log.warn("worker update skipped", { planID, subtaskID, error: err })
            }
          }),
        )
      }

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
        startTimes.delete(sessionID)
        log.info("worker completed", { planID, subtaskID: worker.subtaskID })

        try {
          // Collect diff stats
          const diffStat = await collectDiffStat(worker.worktreeDir)
          pendingUpdates.set(worker.subtaskID, { status: "done", diffStat })

          if (debounceTimer) clearTimeout(debounceTimer)
          debounceTimer = setTimeout(() => {
            debounceTimer = null
            processBatch()
          }, debounceMs)
        } catch (e) {
          const error = e instanceof Error ? e.message : "Worker completion handling failed"
          pendingUpdates.set(worker.subtaskID, { status: "failed", error })

          if (debounceTimer) clearTimeout(debounceTimer)
          debounceTimer = setTimeout(() => {
            debounceTimer = null
            processBatch()
          }, debounceMs)
        }

        if (pending.size === 0) {
          if (debounceTimer) {
            clearTimeout(debounceTimer)
            await processBatch()
          }
          cleanup()
          resolve()
        }
      }

      const cleanup = () => {
        GlobalBus.off("event", handler)
        if (fallbackTimer) clearInterval(fallbackTimer)
        if (debounceTimer) clearTimeout(debounceTimer)
        startTimes.clear()
      }

      GlobalBus.on("event", handler)

      // Fallback poll every 5s in case we missed an event (e.g., session was already idle before we subscribed)
      const fallbackTimer = setInterval(async () => {
        if (abort.aborted || pending.size === 0) {
          await processBatch()
          cleanup()
          resolve()
          return
        }

        for (const sessionID of [...pending]) {
          const worker = sessionToWorker.get(sessionID)
          if (!worker) continue

          // Check for timeout
          const elapsed = Date.now() - worker.startTime
          if (elapsed > timeoutMs) {
            const minutes = Math.round(timeoutMs / 60000)
            pending.delete(sessionID)
            startTimes.delete(sessionID)
            // Queue timeout update instead of calling directly
            pendingUpdates.set(worker.subtaskID, {
              status: "failed",
              error: `Worker exceeded timeout (${minutes} minutes)`,
            })
            log.error("worker timed out", { planID, subtaskID: worker.subtaskID, elapsed })
            continue
          }

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
              startTimes.delete(sessionID)
              const diffStat = await collectDiffStat(worker.worktreeDir)
              // Queue completion instead of calling updateWorker directly
              pendingUpdates.set(worker.subtaskID, { status: "done", diffStat })
            }
          } catch {
            pending.delete(sessionID)
            startTimes.delete(sessionID)
            // Queue failure instead of calling directly
            pendingUpdates.set(worker.subtaskID, {
              status: "failed",
              error: "Worker session errored",
            })
          }
        }

        // Process any queued updates
        if (pendingUpdates.size > 0) {
          await processBatch()
        }

        if (pending.size === 0) {
          cleanup()
          resolve()
        }
      }, 5_000)

      // Handle abort
      abort.addEventListener(
        "abort",
        async () => {
          if (debounceTimer) {
            clearTimeout(debounceTimer)
            await processBatch()
          }
          cleanup()
          resolve()
        },
        { once: true },
      )
    })

    log.info("all workers complete", { planID, durationMs: Date.now() - waitStartTime })
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
