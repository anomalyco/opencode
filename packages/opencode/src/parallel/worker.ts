import { Worktree } from "../worktree"
import { Session } from "../session"
import { Instance } from "../project/instance"
import { ParallelBootstrap } from "../project/bootstrap"
import { Project } from "../project/project"
import { PlanStore } from "./plan"
import { Config } from "@/config/config"
import { Log } from "@/util/log"
import { GlobalBus } from "@/bus/global"
import { Bus } from "@/bus"
import { SessionStatus } from "../session/status"
import { SharedContext } from "./shared-context"
import { git } from "../util/git"
import { SessionID } from "@/session/schema"
import { SubtaskID } from "./schema"
import type { Plan, PlanID, Subtask, SubtaskKind, WorkerState, SharedContract, ProjectConventions } from "./schema"
import { ParallelEvent } from "./events"
import { Metrics } from "./metrics"
import { buildWaves, rebuildWaves } from "./scheduler"
import { selectExecutionMode } from "./strategy"
import { outputText } from "./util"
import { FileLock } from "./filelock"

export namespace WorkerManager {
  const log = Log.create({ service: "worker" })
  const RETRY_LIMIT = 3
  const STALL_POLL_MS = 5_000
  const STALL_RETRY_LIMIT = 1
  const CANCEL_POLL_MS = 250
  const CANCEL_GRACE_MS = 10_000
  const TOKEN_NO_FILE_MS_SEMANTIC = 300_000
  const TOKEN_NO_FILE_MS_STRUCTURAL = 150_000
  const NUDGE_AT_RATIO = 0.5
  const NUDGE_STRONG_AT_RATIO = 0.8

  type Retry = {
    type: "retry"
    attempt: number
    reason: string
  }

  type Progress = {
    fingerprint: string
    files: number
    additions: number
    deletions: number
    score: number
  }

  function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
  }

  function complexity(subtask: Subtask): number {
    const fileCount = subtask.fileScope.length
    const hasDeps = subtask.dependencies.length > 0
    const isSemantic = subtask.kind !== "structural"
    let score = fileCount
    if (hasDeps) score += 2
    if (isSemantic) score *= 1.5
    return score
  }

  function stallLimit(input: {
    kind?: SubtaskKind
    phase: "initial" | "stalled"
    fileCount?: number
    timeoutMs: number
    fanout?: number
  }): { progressMs: number; stallMs: number } {
    const structural = input.kind === "structural" || (input.fanout ?? 0) >= 3
    const count = input.fileCount ?? 1
    const scale = Math.max(0.5, Math.min(2.0, count / 5))
    const strict = input.phase === "stalled" ? 0.6 : 1.0
    const foundationScale = (input.fanout ?? 0) >= 3 ? 0.7 : 1.0
    return {
      progressMs: Math.min(input.timeoutMs / 2, (structural ? 75_000 : 180_000) * scale * strict * foundationScale),
      stallMs: Math.min(input.timeoutMs / 3, (structural ? 45_000 : 120_000) * scale * strict * foundationScale),
    }
  }

  export function detectStalledProgress(input: {
    kind?: Subtask["kind"]
    elapsedMs: number
    changedMs: number
    baseline: Progress
    current?: Progress
    timeoutMs: number
    fileCount?: number
    fanout?: number
  }) {
    if (input.current === undefined) return
    const limits = stallLimit({
      kind: input.kind,
      phase: "initial",
      fileCount: input.fileCount,
      timeoutMs: input.timeoutMs,
      fanout: input.fanout,
    })
    if (input.current.fingerprint === input.baseline.fingerprint) {
      if (input.elapsedMs < limits.progressMs) return
      const seconds = Math.round(limits.progressMs / 1000)
      return `Worker made no meaningful filesystem changes after ${seconds}s; retrying with a stricter execution prompt`
    }

    const stalledLimits = stallLimit({
      kind: input.kind,
      phase: "stalled",
      fileCount: input.fileCount,
      timeoutMs: input.timeoutMs,
      fanout: input.fanout,
    })
    if (input.changedMs < stalledLimits.stallMs) return
    const seconds = Math.round(stalledLimits.stallMs / 1000)
    return `Worker filesystem changes stopped progressing for ${seconds}s; retrying with a stricter execution prompt`
  }

  function parseProgress(status: string, diff: string): Progress {
    const lines = status.split("\n").filter(Boolean)
    let files = 0
    let additions = 0
    let deletions = 0

    const rows = diff.split("\n").filter(Boolean)
    for (const line of rows) {
      const [add, del] = line.split("\t")
      additions += add === "-" ? 0 : parseInt(add ?? "0", 10) || 0
      deletions += del === "-" ? 0 : parseInt(del ?? "0", 10) || 0
    }

    files = Math.max(lines.length, rows.length)
    const score = additions + deletions + files * 20
    return {
      fingerprint: [status, files, additions, deletions].join("|"),
      files,
      additions,
      deletions,
      score,
    }
  }

  function changed(a: Progress, b: Progress) {
    return a.fingerprint !== b.fingerprint || a.score !== b.score
  }

  async function progress(dir: string) {
    try {
      const status = await git(["status", "--porcelain"], { cwd: dir })
      if (status.exitCode !== 0) return
      const diff = await git(["diff", "--numstat", "HEAD"], { cwd: dir })
      if (diff.exitCode !== 0) return
      return parseProgress(outputText(status.stdout), outputText(diff.stdout))
    } catch {
      return
    }
  }

  async function run<T>(input: {
    dir: string
    fn: () => Promise<T> | T
    mode: "task-agent" | "worktree"
    project: Project.Info
  }) {
    if (input.mode === "worktree") {
      // Capture the original project root before switching context so config
      // resolution can still find project-level opencode.json (which may be
      // gitignored and therefore absent from the worktree checkout).
      const configBoundary = Instance.worktree
      return Instance.provide({
        directory: input.dir,
        init: ParallelBootstrap,
        fn: input.fn,
        project: input.project,
        worktree: input.dir,
        configBoundary,
      })
    }
    return Instance.provide({
      directory: input.dir,
      init: ParallelBootstrap,
      fn: input.fn,
    })
  }

  async function cancelSession(input: {
    dir: string
    mode: "task-agent" | "worktree"
    project: Project.Info
    sessionID: SessionID
  }) {
    return run({
      dir: input.dir,
      mode: input.mode,
      project: input.project,
      fn: async () => {
        const { SessionPrompt } = await import("../session/prompt")
        await SessionPrompt.cancel(input.sessionID)
      },
    })
  }

  async function sessionStatus(input: {
    dir: string
    mode: "task-agent" | "worktree"
    project: Project.Info
    sessionID: SessionID
  }) {
    return run({
      dir: input.dir,
      mode: input.mode,
      project: input.project,
      fn: async () => SessionStatus.get(input.sessionID),
    }).catch(() => undefined)
  }

  async function waitForIdle(input: {
    dir: string
    mode: "task-agent" | "worktree"
    project: Project.Info
    sessionID: SessionID
    timeoutMs: number
  }) {
    const started = Date.now()
    while (Date.now() - started < input.timeoutMs) {
      const status = await sessionStatus(input)
      if (!status || status.type === "idle") return true
      await sleep(CANCEL_POLL_MS)
    }
    return false
  }

  async function stopSession(input: {
    sessionID: SessionID
    dir: string
    mode: "task-agent" | "worktree"
    project: Project.Info
    reason: "abort" | "stall"
  }) {
    await cancelSession(input).catch(() => {})
    const idle = await waitForIdle({
      dir: input.dir,
      mode: input.mode,
      project: input.project,
      sessionID: input.sessionID,
      timeoutMs: CANCEL_GRACE_MS,
    })
    if (idle) return
    const action = input.reason === "stall" ? "stall cancellation" : "abort"
    throw new Error(`Worker session did not become idle within ${CANCEL_GRACE_MS}ms after ${action}`)
  }

  async function createWorkerSession(input: {
    plan: Plan
    subtask: Subtask
    project: Project.Info
    dir: string
    mode: "task-agent" | "worktree"
    retry?: Retry
  }) {
    return run({
      dir: input.dir,
      mode: input.mode,
      project: input.project,
      fn: async () => {
        const suffix = input.retry ? ` [retry ${input.retry.attempt}]` : ""
        return Session.createNext({
          parentID: input.plan.sessionID,
          directory: input.dir,
          title: `[parallel] ${input.subtask.title}${suffix}`,
        })
      },
    })
  }

  async function promptWorker(input: {
    plan: Plan
    subtask: Subtask
    project: Project.Info
    dir: string
    mode: "task-agent" | "worktree"
    sessionID: SessionID
    abort: AbortSignal
    timeoutMs: number
    retry?: Retry
    sharedContext?: string
  }): Promise<{ type: "done" } | Retry> {
    const baseline =
      input.mode === "worktree" ? ((await progress(input.dir)) ?? parseProgress("", "")) : parseProgress("", "")
    const started = Date.now()
    let fileAdvanced = started
    let lastCheckpoint = started
    let latest = baseline
    let lastTokenActivity = Date.now()
    let nudged = false
    let strongNudged = false
    let failed: unknown = undefined
    let finished = false

    const fanout = input.plan.subtasks.filter((st) => st.dependencies.includes(input.subtask.id)).length
    const tokenNoFileMs = input.subtask.kind === "structural" ? TOKEN_NO_FILE_MS_STRUCTURAL : TOKEN_NO_FILE_MS_SEMANTIC

    const dependencyOutputs = await collectDependencyOutputs(input.subtask, input.plan.subtasks, input.plan.workers)

    let promptTokens = 0
    let completionTokens = 0

    const task = run({
      dir: input.dir,
      mode: input.mode,
      project: input.project,
      fn: async () => {
        const promptText = buildWorkerPrompt(input.plan.task, input.subtask, input.plan.subtasks, {
          sharedContext: input.sharedContext,
          sharedContracts: input.plan.sharedContracts,
          conventions: input.plan.conventions,
          retry: input.retry,
          dependencyOutputs: dependencyOutputs || undefined,
          mode: input.mode,
        })
        const model = input.subtask.model ?? input.plan.workerModel
        const { SessionPrompt } = await import("../session/prompt")
        const res: any = await SessionPrompt.prompt({
          sessionID: input.sessionID,
          model,
          parts: [
            {
              type: "text" as const,
              text: promptText,
            },
          ],
        })
        if (res?.info?.tokens) {
          promptTokens = res.info.tokens.input ?? 0
          completionTokens = res.info.tokens.output ?? 0
        }
      },
    })
      .catch((err) => {
        failed = err
      })
      .finally(() => {
        finished = true
      })

    const activityHandler = Instance.bind((ev: { directory?: string; payload: any }) => {
      const p = ev.payload
      if (!p) return
      const sid = p.properties?.sessionID ?? p.properties?.part?.sessionID
      if (sid === input.sessionID && (p.type === "message.part.delta" || p.type === "message.part.updated")) {
        lastTokenActivity = Date.now()
      }
    })
    GlobalBus.on("event", activityHandler)

    while (!finished) {
      await sleep(STALL_POLL_MS)
      if (finished) break
      if (input.abort.aborted) {
        await stopSession({
          sessionID: input.sessionID,
          dir: input.dir,
          mode: input.mode,
          project: input.project,
          reason: "abort",
        })
        throw new Error("Aborted")
      }

      const status = await sessionStatus(input)
      if (!status || status.type === "idle" || status.type === "retry") continue

      if (Date.now() - started > input.timeoutMs) {
        const retry: Retry = {
          type: "retry",
          attempt: (input.retry?.attempt ?? 0) + 1,
          reason: `Worker exceeded timeout (${Math.round(input.timeoutMs / 60000)} minutes)`,
        }
        await stopSession({
          sessionID: input.sessionID,
          dir: input.dir,
          mode: input.mode,
          project: input.project,
          reason: "stall",
        })
        return retry
      }

      const current = input.mode === "worktree" ? await progress(input.dir) : undefined
      const active = Date.now() - lastTokenActivity < STALL_POLL_MS * 3
      const elapsed = Date.now() - started

      if (current && changed(latest, current)) {
        latest = current
        fileAdvanced = Date.now()

        Bus.publish(ParallelEvent.WorkerProgress, {
          planID: input.plan.id,
          subtaskID: input.subtask.id,
          files: current.files,
          additions: current.additions,
          deletions: current.deletions,
          elapsedMs: elapsed,
        })

        if (input.mode === "task-agent") {
          const statusText = await git(["status", "--porcelain"], { cwd: input.dir })
          if (statusText.exitCode === 0) {
            const changedFiles = outputText(statusText.stdout)
              .split("\n")
              .filter(Boolean)
              .map((l) => l.slice(3))
            const wid = String(input.subtask.id)
            for (const file of changedFiles) {
              if (!FileLock.acquire(file, wid)) {
                const existing = FileLock.owner(file)
                Bus.publish(ParallelEvent.ConflictPredicted, {
                  planID: input.plan.id,
                  subtaskA: SubtaskID.make(existing ?? "unknown"),
                  subtaskB: input.subtask.id,
                  overlappingFiles: [file],
                })
              }
            }
          }
        }
      } else if (active) {
        Bus.publish(ParallelEvent.WorkerProgress, {
          planID: input.plan.id,
          subtaskID: input.subtask.id,
          files: latest.files,
          additions: latest.additions,
          deletions: latest.deletions,
          elapsedMs: elapsed,
        })
      }

      if (input.mode === "worktree" && changed(latest, baseline)) {
        const cfg = await Config.get()
        const interval = cfg.parallel?.checkpoint_interval_ms ?? 5 * 60 * 1000
        if (Date.now() - lastCheckpoint >= interval) {
          try {
            const cwd = input.dir
            await git(["add", "-A"], { cwd })
            await git(["commit", "-m", `[parallel-checkpoint] ${input.subtask.title} progress`, "--allow-empty"], {
              cwd,
            })
            lastCheckpoint = Date.now()
            log.info("worker checkpoint committed", {
              planID: input.plan.id,
              subtaskID: input.subtask.id,
              elapsedMs: Date.now() - started,
            })
          } catch (err) {
            log.warn("checkpoint commit failed", {
              planID: input.plan.id,
              subtaskID: input.subtask.id,
              error: String(err),
            })
          }
        }
      }

      const noFilesEver = current ? current.fingerprint === baseline.fingerprint : true

      if (active && noFilesEver && !strongNudged && elapsed > tokenNoFileMs * NUDGE_STRONG_AT_RATIO) {
        strongNudged = true
        log.warn("worker strong nudge: tokens flowing but no files written", {
          subtaskID: input.subtask.id,
          elapsedMs: elapsed,
          files: input.subtask.fileScope,
        })
        Bus.publish(ParallelEvent.WorkerProgress, {
          planID: input.plan.id,
          subtaskID: input.subtask.id,
          files: 0,
          additions: 0,
          deletions: 0,
          elapsedMs: elapsed,
        })
      } else if (active && noFilesEver && !nudged && elapsed > tokenNoFileMs * NUDGE_AT_RATIO) {
        nudged = true
        log.warn("worker nudge: tokens flowing but no files written", {
          subtaskID: input.subtask.id,
          elapsedMs: elapsed,
        })
        Bus.publish(ParallelEvent.WorkerProgress, {
          planID: input.plan.id,
          subtaskID: input.subtask.id,
          files: 0,
          additions: 0,
          deletions: 0,
          elapsedMs: elapsed,
        })
      }

      if (active && noFilesEver && elapsed > tokenNoFileMs) {
        const retry: Retry = {
          type: "retry",
          attempt: (input.retry?.attempt ?? 0) + 1,
          reason: `Worker produced tokens for ${Math.round(elapsed / 1000)}s without writing any files (threshold: ${Math.round(tokenNoFileMs / 1000)}s)`,
        }
        log.warn("worker stalled: token activity without filesystem output", {
          subtaskID: input.subtask.id,
          sessionID: input.sessionID,
          attempt: retry.attempt,
          elapsedMs: elapsed,
        })
        await stopSession({
          sessionID: input.sessionID,
          dir: input.dir,
          mode: input.mode,
          project: input.project,
          reason: "stall",
        })
        return retry
      }

      const reason = detectStalledProgress({
        kind: input.subtask.kind,
        elapsedMs: elapsed,
        changedMs: Date.now() - fileAdvanced,
        baseline,
        current,
        timeoutMs: input.timeoutMs,
        fileCount: input.subtask.fileScope.length,
        fanout,
      })
      if (!reason) continue

      const retry: Retry = {
        type: "retry",
        attempt: (input.retry?.attempt ?? 0) + 1,
        reason,
      }
      log.warn("worker stalled without filesystem changes", {
        subtaskID: input.subtask.id,
        sessionID: input.sessionID,
        attempt: retry.attempt,
        kind: input.subtask.kind ?? "semantic",
        elapsedMs: Date.now() - started,
      })
      await stopSession({
        sessionID: input.sessionID,
        dir: input.dir,
        mode: input.mode,
        project: input.project,
        reason: "stall",
      })
      return retry
    }

    GlobalBus.off("event", activityHandler)

    await task

    if (failed) throw failed

    Metrics.recordTokenUsage({
      planID: input.plan.id,
      role: "worker",
      subtaskID: input.subtask.id,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
    })
    const cost = Metrics.getPlanCost(input.plan.id)
    if (cost) {
      Bus.publish(ParallelEvent.PlanCostUpdate, {
        planID: input.plan.id,
        totalInputTokens: cost.totalInputTokens,
        totalOutputTokens: cost.totalOutputTokens,
        workerCount: cost.workerCount,
      })
    }

    return { type: "done" }
  }

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

  /**
   * Wait for a worktree to become ready or fail.
   * Returns { ready: true } if ready, { ready: false, error: string } if failed or timeout.
   */
  async function waitForWorktreeReady(
    directory: string,
    timeoutMs: number,
  ): Promise<{ ready: boolean; error?: string }> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        cleanup()
        resolve({ ready: false, error: `Timeout waiting for worktree to be ready after ${timeoutMs}ms` })
      }, timeoutMs)

      const handler = (event: { directory?: string; payload: any }) => {
        if (event.directory !== directory) return

        if (event.payload.type === Worktree.Event.Ready.type) {
          cleanup()
          resolve({ ready: true })
        } else if (event.payload.type === Worktree.Event.Failed.type) {
          cleanup()
          const errorMsg = event.payload.properties?.message || "Worktree initialization failed"
          resolve({ ready: false, error: errorMsg })
        }
      }

      const cleanup = () => {
        clearTimeout(timer)
        GlobalBus.off("event", handler)
      }

      GlobalBus.on("event", handler)
    })
  }

  export async function spawnOne(
    plan: Plan,
    subtask: Subtask,
    abort: AbortSignal,
    sharedContext?: string,
  ): Promise<{ subtaskID: SubtaskID; sessionID: string; worktreeDir?: string; branch?: string }> {
    if (abort.aborted) throw new Error("Aborted")

    const shared =
      sharedContext ??
      SharedContext.build({
        task: plan.task,
        subtasks: plan.subtasks,
        sharedContracts: plan.sharedContracts ?? undefined,
        conventions: plan.conventions ?? undefined,
      })

    Metrics.recordSpawnAttempt()
    const spawnStart = Date.now()
    const cfg = await Config.get()
    const baseTimeoutMs = cfg.parallel?.worker_timeout_ms ?? 30 * 60 * 1000
    const score = complexity(subtask)
    const timeoutMultiplier = Math.max(0.5, Math.min(2.0, score / 5))
    const timeoutMs = Math.round(baseTimeoutMs * timeoutMultiplier)
    log.info("worker timeout computed", {
      planID: plan.id,
      subtaskID: subtask.id,
      baseTimeoutMs,
      score,
      multiplier: timeoutMultiplier,
      adaptiveTimeoutMs: timeoutMs,
    })
    const project = Project.get(plan.projectID) ?? (await Project.fromDirectory(Instance.directory)).project
    const mode = selectExecutionMode(plan, project)

    if (mode === "task-agent") {
      const dir = Instance.directory
      const duration = Date.now() - spawnStart
      Metrics.recordSpawnSuccess()
      Metrics.recordWorkerStartup(duration)

      try {
        let retry: Retry | undefined = undefined
        let session = await createWorkerSession({
          plan,
          subtask,
          project,
          dir,
          mode,
        })

        await updateWorker(plan.id, subtask.id, {
          status: "running",
          sessionID: session.id,
          worktreeName: undefined,
          worktreeDir: undefined,
          branch: undefined,
          error: "",
        })

        for (const attempt of Array.from({ length: STALL_RETRY_LIMIT + 1 }, (_, i) => i)) {
          const result = await promptWorker({
            plan,
            subtask,
            project,
            dir,
            mode,
            sessionID: session.id,
            abort,
            timeoutMs,
            retry,
            sharedContext: shared,
          })
          if (result.type === "done") {
            return { subtaskID: subtask.id, sessionID: session.id }
          }
          if (attempt >= STALL_RETRY_LIMIT) {
            throw new Error(result.reason)
          }

          retry = result
          await updateWorker(plan.id, subtask.id, {
            status: "failed",
            sessionID: session.id,
            error: result.reason,
          })
          await updateWorker(plan.id, subtask.id, {
            status: "pending",
            error: "",
          })
          await updateWorker(plan.id, subtask.id, {
            status: "spawning",
            error: "",
          })
          session = await createWorkerSession({
            plan,
            subtask,
            project,
            dir,
            mode,
            retry,
          })
          await updateWorker(plan.id, subtask.id, {
            status: "running",
            sessionID: session.id,
            error: "",
          })
        }

        throw new Error("Worker retry loop exited unexpectedly")
      } finally {
        FileLock.releaseAll(String(subtask.id))
      }
    }

    const info = await Worktree.makeWorktreeInfo(`parallel-${plan.id.slice(0, 12)}-${subtask.id.slice(0, 20)}`)
    const bootstrap = await Worktree.createFromInfo(info, undefined, ParallelBootstrap)

    // Register listener BEFORE starting bootstrap to avoid race condition.
    // bootstrap() emits Event.Ready synchronously before returning,
    // so a listener registered after would miss the event entirely.
    const readyPromise = waitForWorktreeReady(info.directory, 30_000)

    try {
      // Start worktree initialization (emits Event.Ready when done)
      await bootstrap()

      // Wait for the ready event (may already be resolved)
      const worktreeResult = await readyPromise
      if (!worktreeResult.ready) {
        throw new Error(`Worktree failed to become ready: ${worktreeResult.error}`)
      }

      const duration = Date.now() - spawnStart
      Metrics.recordSpawnSuccess()
      Metrics.recordWorkerStartup(duration)

      let retry: Retry | undefined = undefined
      let session = await createWorkerSession({
        plan,
        subtask,
        project,
        dir: info.directory,
        mode,
      })

      await updateWorker(plan.id, subtask.id, {
        status: "running",
        sessionID: session.id,
        worktreeName: info.name,
        worktreeDir: info.directory,
        branch: info.branch,
        error: "",
      })

      for (const attempt of Array.from({ length: STALL_RETRY_LIMIT + 1 }, (_, i) => i)) {
        const result = await promptWorker({
          plan,
          subtask,
          project,
          dir: info.directory,
          mode,
          sessionID: session.id,
          abort,
          timeoutMs,
          retry,
          sharedContext: shared,
        })
        if (result.type === "done") {
          return { subtaskID: subtask.id, sessionID: session.id, worktreeDir: info.directory, branch: info.branch }
        }
        if (attempt >= STALL_RETRY_LIMIT) {
          throw new Error(result.reason)
        }

        retry = result
        await updateWorker(plan.id, subtask.id, {
          status: "failed",
          sessionID: session.id,
          worktreeName: info.name,
          worktreeDir: info.directory,
          branch: info.branch,
          error: result.reason,
        })
        await updateWorker(plan.id, subtask.id, {
          status: "pending",
          error: "",
        })
        await updateWorker(plan.id, subtask.id, {
          status: "spawning",
          error: "",
        })
        session = await createWorkerSession({
          plan,
          subtask,
          project,
          dir: info.directory,
          mode,
          retry,
        })
        await updateWorker(plan.id, subtask.id, {
          status: "running",
          sessionID: session.id,
          worktreeName: info.name,
          worktreeDir: info.directory,
          branch: info.branch,
          error: "",
        })
      }

      throw new Error("Worker retry loop exited unexpectedly")
    } catch (err) {
      Metrics.recordSpawnFailure()
      // Clean up worktree on spawn failure to prevent orphans
      try {
        const { Worktree } = await import("../worktree")
        await Worktree.remove({ directory: info.directory })
      } catch {
        // Best-effort cleanup — worktree may not exist yet or removal may fail
        try {
          const fs = await import("fs")
          if (fs.existsSync(info.directory)) {
            fs.rmSync(info.directory, { recursive: true, force: true })
          }
        } catch {}
      }
      throw err
    }
  }

  export async function spawnAll(plan: Plan, abort: AbortSignal): Promise<void> {
    const cfg = await Config.get()
    const rawMaxWorkers = cfg.parallel?.max_workers
    const maxWorkers =
      typeof rawMaxWorkers === "number" && Number.isInteger(rawMaxWorkers) && rawMaxWorkers > 0
        ? rawMaxWorkers
        : undefined
    const spawnStartTime = Date.now()
    const schedulerMode = cfg.parallel?.scheduler_mode ?? "auto"

    if (rawMaxWorkers !== undefined && maxWorkers === undefined) {
      log.warn("invalid max_workers config, using unlimited", { raw: rawMaxWorkers })
    }

    // Build wave schedule when scheduler is active
    let waveAnalysis = schedulerMode === "auto" ? buildWaves(plan.subtasks) : undefined
    if (waveAnalysis && waveAnalysis.overlaps.length > 0) {
      log.info("using wave scheduling", {
        planID: plan.id,
        waves: waveAnalysis.waves.length,
        parallel: waveAnalysis.parallelizableCount,
        serial: waveAnalysis.serialCount,
      })
    }

    const mods = new Map<SubtaskID, string[]>()

    // Build dependency graph
    const subtaskMap = new Map<SubtaskID, Subtask>()
    const dependencyGraph = new Map<SubtaskID, Set<SubtaskID>>()
    const reverseGraph = new Map<SubtaskID, Set<SubtaskID>>()

    for (const st of plan.subtasks) {
      subtaskMap.set(st.id, st)
      dependencyGraph.set(st.id, new Set(st.dependencies))
      reverseGraph.set(st.id, new Set())
    }

    for (const st of plan.subtasks) {
      for (const dep of st.dependencies) {
        reverseGraph.get(dep)?.add(st.id)
      }
    }

    // Track completion status, preserving prior waves when a phase-gated plan resumes.
    const completed = new Set<SubtaskID>(
      plan.workers
        .filter((worker) => worker.status === "done" || worker.status === "merged")
        .map((worker) => worker.subtaskID),
    )
    const failed = new Set<SubtaskID>(
      plan.workers
        .filter((worker) => worker.status === "failed" || worker.status === "conflict")
        .map((worker) => worker.subtaskID),
    )
    const running = new Set<SubtaskID>()
    const blocked = new Set<SubtaskID>()
    const phaseMode = plan.approvalMode === "phase" || plan.approvalMode === "manual"

    // Wave-aware readiness: in auto mode, respect wave ordering
    // A subtask is ready if all its dependencies are completed AND
    // (if wave scheduling) all subtasks in earlier waves are completed
    const waveIndex = new Map<SubtaskID, number>()
    if (waveAnalysis) {
      for (const wave of waveAnalysis.waves) {
        for (const id of wave.subtasks) {
          waveIndex.set(id, wave.index)
        }
      }
    }
    const activeWave = phaseMode
      ? waveAnalysis?.waves.find((wave) => wave.subtasks.some((id) => !completed.has(id) && !failed.has(id)))
      : undefined
    const allowed = activeWave ? new Set(activeWave.subtasks) : undefined

    function getReadySubtasks(): Subtask[] {
      return plan.subtasks.filter((st) => {
        if (completed.has(st.id) || failed.has(st.id) || running.has(st.id) || blocked.has(st.id)) {
          return false
        }
        if (allowed && !allowed.has(st.id)) return false
        // Check explicit dependencies
        const deps = dependencyGraph.get(st.id) ?? new Set()

        // Check if any dependency has failed - if so, mark this worker as blocked
        const hasFailedDependency = Array.from(deps).some((dep) => failed.has(dep))
        if (hasFailedDependency) {
          // Mark this worker as blocked since a dependency failed
          blocked.add(st.id)
          updateWorker(plan.id, st.id, { status: "blocked" }).catch((err) => {
            log.warn("failed to mark worker as blocked", { subtaskID: st.id, error: err })
          })
          return false
        }

        // Check if any dependency is blocked (deadlock detection for chain dependencies)
        const hasBlockedDependency = Array.from(deps).some((dep) => blocked.has(dep))
        if (hasBlockedDependency) {
          // This subtask is deadlocked - all its dependencies are blocked/failed
          blocked.add(st.id)
          updateWorker(plan.id, st.id, { status: "blocked", error: "Deadlock: dependency chain failed" }).catch((err) => {
            log.warn("failed to mark worker as deadlocked", { subtaskID: st.id, error: err })
          })
          return false
        }

        if (!Array.from(deps).every((dep) => completed.has(dep))) return false

        // In wave mode, also check that all earlier waves are complete
        if (waveAnalysis && waveIndex.has(st.id)) {
          const myWave = waveIndex.get(st.id)!
          for (const wave of waveAnalysis.waves) {
            if (wave.index >= myWave) break
            // All subtasks in earlier waves must be completed or failed
            const allDone = wave.subtasks.every((id) => completed.has(id) || failed.has(id))
            if (!allDone) return false
          }

          // For serial waves, only one subtask from overlapping set runs at a time
          if (waveAnalysis.waves[myWave]?.type === "serial") {
            // If any other subtask in a serial wave at the same index is running, wait
            const myWaveSubtasks = waveAnalysis.waves[myWave].subtasks
            if (myWaveSubtasks.some((id) => running.has(id))) return false
          }
        }

        return true
      })
    }

    log.info("spawning workers with dependencies", {
      planID: plan.id,
      count: plan.subtasks.length,
      maxWorkers: maxWorkers ?? "unlimited",
      schedulerMode,
      waves: waveAnalysis?.waves.length,
    })

    const shared = SharedContext.build({
      task: plan.task,
      subtasks: plan.subtasks,
      sharedContracts: plan.sharedContracts ?? undefined,
      conventions: plan.conventions ?? undefined,
    })

    // Preserve terminal state so paused plans can resume from completed waves.
    const initialWorkers = plan.workers.map((w) =>
      ["done", "merged", "failed", "conflict", "blocked"].includes(w.status) ? w : { ...w, status: "pending" as const },
    )
    await PlanStore.update({ id: plan.id, workers: initialWorkers })

    // Spawn workers respecting dependencies, waves, and concurrency
    const spawnPromises: Promise<{ subtaskID: SubtaskID; status: "fulfilled" | "rejected"; error?: string }>[] = []

    function retryable(msg: string): boolean {
      const text = msg.toLowerCase()
      return (
        text.includes("timeout") ||
        text.includes("tempor") ||
        text.includes("429") ||
        text.includes("503") ||
        text.includes("network") ||
        text.includes("econn") ||
        text.includes("worktree")
      )
    }

    async function spawn(plan: Plan, st: Subtask, abort: AbortSignal) {
      let last = "Spawn failed"
      for (const attempt of Array.from({ length: RETRY_LIMIT }, (_, i) => i + 1)) {
        if (abort.aborted) throw new Error("Aborted")
        try {
          return await spawnOne(plan, st, abort, shared)
        } catch (err) {
          last = err instanceof Error ? err.message : "Spawn failed"
          if (attempt >= RETRY_LIMIT || !retryable(last)) break
          const backoff = 250 * 2 ** attempt
          log.warn("worker spawn retry", {
            subtaskID: st.id,
            attempt,
            backoff,
            error: last,
          })
          await sleep(backoff)
        }
      }
      throw new Error(last)
    }

    // Track consecutive calls with no progress for deadlock detection
    let noProgressCount = 0
    const DEADLOCK_THRESHOLD = 3

    async function spawnNextBatch(): Promise<void> {
      const ready = getReadySubtasks()
      if (ready.length === 0) {
        // Check for deadlock: no ready tasks but there are remaining subtasks
        const remaining = plan.subtasks.filter(
          (st) => !completed.has(st.id) && !failed.has(st.id) && !running.has(st.id) && !blocked.has(st.id),
        )
        if (remaining.length > 0) {
          noProgressCount++
          if (noProgressCount >= DEADLOCK_THRESHOLD) {
            // Deadlock detected: mark all remaining as blocked
            log.warn("deadlock detected: marking remaining subtasks as blocked", {
              planID: plan.id,
              remainingCount: remaining.length,
              subtaskIDs: remaining.map((st) => st.id),
            })
            for (const st of remaining) {
              blocked.add(st.id)
              await updateWorker(plan.id, st.id, { status: "blocked", error: "Deadlock: dependency chain failed" }).catch(
                (err) => {
                  log.warn("failed to mark worker as deadlocked", { subtaskID: st.id, error: err })
                },
              )
            }
          }
        }
        return
      }

      // Reset progress counter when we have ready tasks
      noProgressCount = 0

      const availableSlots = maxWorkers ? maxWorkers - running.size : Infinity
      if (availableSlots <= 0) return

      const toSpawn = ready.slice(0, availableSlots)

      for (const st of toSpawn) {
        running.add(st.id)
        await updateWorker(plan.id, st.id, { status: "spawning" })

        const spawnPromise = spawn(plan, st, abort)
          .then(async (result) => {
            completed.add(result.subtaskID)
            running.delete(result.subtaskID)

            try {
              if (result.worktreeDir) {
                const diffResult = await git(["diff", "--name-only", "HEAD"], { cwd: result.worktreeDir })
                const files = outputText(diffResult.stdout).split("\n").filter(Boolean)
                mods.set(result.subtaskID, files)
              }
            } catch {}

            if (schedulerMode === "auto" && waveAnalysis) {
              try {
                const rebuilt = rebuildWaves(plan.subtasks, completed, mods)
                waveIndex.clear()
                for (const wave of rebuilt) {
                  for (const id of wave.subtasks) {
                    waveIndex.set(id, wave.index)
                  }
                }
                waveAnalysis = {
                  waves: rebuilt,
                  overlaps: [],
                  totalSubtasks: plan.subtasks.length,
                  parallelizableCount: rebuilt
                    .filter((w) => w.type === "parallel")
                    .reduce((s, w) => s + w.subtasks.length, 0),
                  serialCount: rebuilt.filter((w) => w.type === "serial").reduce((s, w) => s + w.subtasks.length, 0),
                }
              } catch {}
            }

            return { subtaskID: result.subtaskID, status: "fulfilled" as const }
          })
          .catch((err) => {
            const error = err instanceof Error ? err.message : "Spawn failed"
            failed.add(st.id)
            running.delete(st.id)
            log.error("worker spawn failed", { subtaskID: st.id, error })
            return { subtaskID: st.id, status: "rejected" as const, error }
          })
          .finally(async () => {
            await spawnNextBatch()
          })

        spawnPromises.push(spawnPromise)
      }
    }

    // Start initial batch
    await spawnNextBatch()

    // Wait for all spawns to complete
    const results = await Promise.all(spawnPromises)

    // Update failed workers
    const failures = results.filter(
      (r): r is typeof r & { status: "rejected"; error: string } => r.status === "rejected",
    )

    if (failures.length > 0) {
      for (const item of failures) {
        await updateWorker(plan.id, item.subtaskID, { status: "failed", error: item.error }).catch((err) => {
          log.warn("failed to mark worker as failed", { subtaskID: item.subtaskID, error: err })
        })
      }

      // Post-spawn retry: re-attempt failed subtasks once before cascading blocks
      const retryableFailures = failures.filter((item) => {
        const st = plan.subtasks.find((s) => s.id === item.subtaskID)
        if (!st) return false
        const hasFailedDep = st.dependencies.some((dep) => failed.has(dep))
        return !hasFailedDep
      })
      if (retryableFailures.length > 0) {
        log.info("post-spawn retry for failed subtasks", {
          planID: plan.id,
          count: retryableFailures.length,
          subtaskIDs: retryableFailures.map((f) => f.subtaskID),
        })
        for (const item of retryableFailures) {
          const st = plan.subtasks.find((s) => s.id === item.subtaskID)
          if (!st) continue
          failed.delete(st.id)
          try {
            const result = await spawnOne(plan, st, abort, shared)
            completed.add(result.subtaskID)
            running.delete(result.subtaskID)
            log.info("post-spawn retry succeeded", { planID: plan.id, subtaskID: st.id })
          } catch (err) {
            failed.add(st.id)
            const retryError = err instanceof Error ? err.message : "Post-spawn retry failed"
            log.warn("post-spawn retry failed", { planID: plan.id, subtaskID: st.id, error: retryError })
            await updateWorker(plan.id, st.id, { status: "failed", error: retryError }).catch(() => {})
          }
        }
      }
    }

    // Check for dependency failures - apply graceful degradation
    const blockedWorkers: { subtaskID: SubtaskID; error: string }[] = []
    for (const st of plan.subtasks) {
      if (!completed.has(st.id) && !failed.has(st.id) && !blocked.has(st.id)) {
        const failedDeps = st.dependencies.filter((dep) => failed.has(dep))
        if (failedDeps.length === 0) continue
        const succeededDeps = st.dependencies.filter((dep) => completed.has(dep))
        if (succeededDeps.length > 0 && failedDeps.length < st.dependencies.length) {
          log.warn("subtask has partial dependency failure — marking degraded", {
            subtaskID: st.id,
            failedDeps: failedDeps.length,
            succeededDeps: succeededDeps.length,
          })
          blockedWorkers.push({
            subtaskID: st.id,
            error: `Degraded: ${failedDeps.length}/${st.dependencies.length} dependency(s) failed (${succeededDeps.length} succeeded)`,
          })
        } else {
          blockedWorkers.push({ subtaskID: st.id, error: "Blocked: dependency failed" })
        }
      }
    }

    if (blockedWorkers.length > 0) {
      for (const item of blockedWorkers) {
        blocked.add(item.subtaskID)
        await updateWorker(plan.id, item.subtaskID, { status: "blocked", error: item.error }).catch((err) => {
          log.warn("failed to mark worker as blocked", { subtaskID: item.subtaskID, error: err })
        })
      }
    }

    const allFailedOrBlocked = plan.subtasks.every(
      (st) => failed.has(st.id) || blocked.has(st.id),
    )
    if (allFailedOrBlocked) {
      throw new Error("All workers failed to spawn or were blocked by failed dependencies")
    }
    if (plan.subtasks.length > 0 && completed.size === 0 && failed.size === 0 && blocked.size === 0) {
      throw new Error("No ready subtasks to spawn. Check dependency graph.")
    }

    log.info("workers spawned", {
      planID: plan.id,
      durationMs: Date.now() - spawnStartTime,
      completed: completed.size,
      failed: failed.size,
      blocked: blocked.size,
    })
  }

  export async function waitAll(planID: PlanID, abort: AbortSignal): Promise<void> {
    const plan = await PlanStore.get(planID)
    const cfg = await Config.get()
    const running = plan.workers.filter((w) => w.status === "running")
    const project = Project.get(plan.projectID) ?? (await Project.fromDirectory(Instance.directory)).project
    const mode = selectExecutionMode(plan, project)

    if (running.length === 0) {
      log.info("no running workers to wait for", { planID })
      return
    }

    const waitStartTime = Date.now()
    log.info("waiting for workers", { planID, count: running.length })

    const defaultTimeoutMs = 30 * 60 * 1000 // 30 minutes
    const timeoutMs = cfg.parallel?.worker_timeout_ms ?? defaultTimeoutMs
    const warningThreshold = timeoutMs * 0.8
    const warned = new Set<string>() // Track workers that have triggered timeout warning

    // Build a map of sessionID -> worker for fast lookup
    const sessionToWorker = new Map<
      string,
      { subtaskID: SubtaskID; dir: string; startTime: number; kind: Subtask["kind"]; mode: "task-agent" | "worktree" }
    >()
    for (const worker of running) {
      if (worker.sessionID) {
        const startTime = Date.now()
        const subtask = plan.subtasks.find((item) => item.id === worker.subtaskID)
        sessionToWorker.set(worker.sessionID, {
          subtaskID: worker.subtaskID,
          dir: mode === "worktree" ? (worker.worktreeDir ?? Instance.directory) : Instance.directory,
          startTime,
          kind: subtask?.kind,
          mode,
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

        for (const [subtaskID, update] of Array.from(uniqueUpdates.entries())) {
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
        }
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
        warned.delete(sessionID)
        log.info("worker completed", { planID, subtaskID: worker.subtaskID })

        try {
          if (worker.mode === "worktree") {
            await snapshot(worker.dir, worker.subtaskID)
            const diffStat = await collectDiffStat(worker.dir)
            pendingUpdates.set(worker.subtaskID, { status: "done", diffStat })
          } else {
            pendingUpdates.set(worker.subtaskID, { status: "done" })
          }

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

      const abortHandler = async () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer)
          await processBatch()
        }
        cleanup()
        resolve()
      }

      const cleanup = () => {
        GlobalBus.off("event", handler)
        if (fallbackTimer) clearInterval(fallbackTimer)
        if (debounceTimer) clearTimeout(debounceTimer)
        warned.clear()
        abort.removeEventListener("abort", abortHandler)
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
          const warnAt = worker.kind === "structural" ? Math.min(warningThreshold, 2 * 60 * 1000) : warningThreshold

          // Check for timeout warning at 80% threshold
          if (elapsed > warnAt && !warned.has(sessionID)) {
            warned.add(sessionID)
            const remainingMs = timeoutMs - elapsed
            log.warn("worker approaching timeout", {
              planID,
              subtaskID: worker.subtaskID,
              elapsedMs: elapsed,
              remainingMs,
              timeoutMs,
              kind: worker.kind ?? "semantic",
            })
            Bus.publish(ParallelEvent.WorkerTimeoutWarning, {
              planID,
              subtaskID: worker.subtaskID,
              elapsedMs: elapsed,
              remainingMs,
              timeoutMs,
            })
          }

          if (elapsed > timeoutMs) {
            const minutes = Math.round(timeoutMs / 60000)
            pending.delete(sessionID)
            warned.delete(sessionID)
            Metrics.recordTimeout(planID, worker.subtaskID)
            // Queue timeout update instead of calling directly
            pendingUpdates.set(worker.subtaskID, {
              status: "failed",
              error: `Worker exceeded timeout (${minutes} minutes)`,
            })
            log.error("worker timed out", { planID, subtaskID: worker.subtaskID, elapsed })
            continue
          }

          try {
            const idle = await run({
              dir: worker.dir,
              mode: worker.mode,
              project,
              fn: async () => {
                const status = await SessionStatus.get(SessionID.make(sessionID))
                return status.type === "idle"
              },
            })

            if (idle) {
              pending.delete(sessionID)
              warned.delete(sessionID)
              if (worker.mode === "worktree") {
                await snapshot(worker.dir, worker.subtaskID)
                const diffStat = await collectDiffStat(worker.dir)
                pendingUpdates.set(worker.subtaskID, { status: "done", diffStat })
              } else {
                pendingUpdates.set(worker.subtaskID, { status: "done" })
              }
            }
          } catch {
            pending.delete(sessionID)
            warned.delete(sessionID)
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

      // Handle abort — uses named handler so cleanup() can remove it
      abort.addEventListener("abort", abortHandler, { once: true })
    })

    log.info("all workers complete", { planID, durationMs: Date.now() - waitStartTime })
  }

  async function collectDiffStat(
    worktreeDir: string,
  ): Promise<{ additions: number; deletions: number; files: number } | undefined> {
    try {
      const dirty = await git(["diff", "--stat", "HEAD"], { cwd: worktreeDir })
      const local = parseStat(outputText(dirty.stdout))
      if (local) return local

      const commit = await git(["show", "--stat", "--format=", "HEAD"], { cwd: worktreeDir })
      return parseStat(outputText(commit.stdout))
    } catch {
      return undefined
    }
  }

  async function snapshot(worktreeDir: string, subtaskID: SubtaskID): Promise<void> {
    const status = await git(["status", "--porcelain"], { cwd: worktreeDir })
    if (status.exitCode !== 0) {
      throw new Error("Failed to read worker git status")
    }
    if (!outputText(status.stdout)) return

    const added = await git(["add", "-A"], { cwd: worktreeDir })
    if (added.exitCode !== 0) {
      throw new Error("Failed to stage worker changes")
    }

    const msg = `parallel: snapshot ${String(subtaskID).slice(0, 10)}`
    const commit = await git(
      ["-c", "user.name=opencode-parallel", "-c", "user.email=parallel@opencode.local", "commit", "-m", msg],
      { cwd: worktreeDir },
    )

    if (commit.exitCode === 0) return

    const stderr = outputText(commit.stderr)
    const stdout = outputText(commit.stdout)
    const text = `${stderr}\n${stdout}`.toLowerCase()
    if (text.includes("nothing to commit")) return
    throw new Error(stderr || stdout || "Failed to commit worker snapshot")
  }

  async function collectDependencyOutputs(
    subtask: Subtask,
    allSubtasks: Subtask[],
    workers: Plan["workers"],
  ): Promise<string> {
    if (subtask.dependencies.length === 0) return ""

    const depOutputs: string[] = []
    for (const depID of subtask.dependencies) {
      const dep = allSubtasks.find((st) => st.id === depID)
      const worker = workers.find((w) => w.subtaskID === depID)
      const title = dep?.title ?? String(depID)

      if (!worker?.worktreeDir) {
        depOutputs.push(`- **${title}**: completed (no diff available)`)
        continue
      }

      try {
        const stat = await git(["diff", "--stat", "HEAD"], { cwd: worker.worktreeDir })
        const statText = outputText(stat.stdout)

        // Also grab a compact name-only list for quick reference
        const nameOnly = await git(["diff", "--name-only", "HEAD"], { cwd: worker.worktreeDir })
        const files = outputText(nameOnly.stdout).split("\n").filter(Boolean).slice(0, 15)

        if (files.length > 0) {
          depOutputs.push(
            `- **${title}**: modified ${files.length} file(s):\n${files.map((f) => `  - ${f}`).join("\n")}`,
          )
        } else {
          // Try committed diff instead
          const commitStat = await git(["show", "--stat", "--format=", "HEAD"], { cwd: worker.worktreeDir })
          const commitText = outputText(commitStat.stdout)
          depOutputs.push(
            commitText ? `- **${title}**: ${commitText.split("\n").pop() ?? "completed"}` : `- **${title}**: completed`,
          )
        }
      } catch {
        depOutputs.push(`- **${title}**: completed (output unavailable)`)
      }
    }

    return `\n## Completed Dependencies (what upstream workers actually produced)\n${depOutputs.join("\n")}`
  }

  function buildWorkerPrompt(
    task: string,
    subtask: Subtask,
    subtasks: Subtask[],
    opts?: {
      sharedContext?: string
      sharedContracts?: SharedContract[]
      conventions?: ProjectConventions
      retry?: Retry
      dependencyOutputs?: string
      mode?: "task-agent" | "worktree"
    },
  ): string {
    const shared =
      opts?.sharedContext ??
      SharedContext.build({
        task,
        subtasks,
        sharedContracts: opts?.sharedContracts,
        conventions: opts?.conventions,
      })

    return SharedContext.workerDirective({
      sharedContext: shared,
      subtaskTitle: subtask.title,
      subtaskDescription: subtask.description,
      fileScope: subtask.fileScope,
      constraints: subtask.constraints,
      dependencyOutputs: opts?.dependencyOutputs,
      retryDirective: opts?.retry
        ? `Previous attempt failed: ${opts.retry.reason}. Try a different approach.`
        : undefined,
      mode: opts?.mode ?? "worktree",
    })
  }

  async function updateWorker(
    planID: PlanID,
    subtaskID: SubtaskID,
    update: {
      status?: "pending" | "spawning" | "running" | "done" | "failed" | "blocked" | "merged" | "conflict"
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

function parseStat(output: string): { additions: number; deletions: number; files: number } | undefined {
  const lines = output.split("\n")
  const lastLine = lines[lines.length - 1] ?? ""
  const files = parseInt(lastLine.match(/(\d+) file/)?.[1] ?? "0")
  const additions = parseInt(lastLine.match(/(\d+) insertion/)?.[1] ?? "0")
  const deletions = parseInt(lastLine.match(/(\d+) deletion/)?.[1] ?? "0")
  if (files === 0 && additions === 0 && deletions === 0) return undefined
  return { additions, deletions, files }
}
