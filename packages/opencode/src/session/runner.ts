import z from "zod"
import { Identifier } from "../id/id"
import { Log } from "../util/log"
import { SessionPrompt } from "./prompt"
import { MessageV2 } from "./message-v2"
import { Instance } from "../project/instance"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { Config } from "../config/config"
import { fn } from "@/util/fn"
import { ulid } from "ulid"

export namespace SessionRunner {
  const log = Log.create({ service: "session.runner" })

  const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
  const DEFAULT_MAX_CONCURRENT = 2

  export const JobKind = z.enum(["session.loop", "session.prompt_async", "task.child_session"]).meta({
    ref: "SessionRunnerJobKind",
  })
  export type JobKind = z.infer<typeof JobKind>

  export const JobStatus = z.enum(["queued", "running", "completed", "failed", "canceled", "timed_out"]).meta({
    ref: "SessionRunnerJobStatus",
  })
  export type JobStatus = z.infer<typeof JobStatus>

  export const JobError = z
    .object({
      name: z.string().optional(),
      message: z.string(),
    })
    .meta({ ref: "SessionRunnerJobError" })
  export type JobError = z.infer<typeof JobError>

  export const Job = z
    .object({
      id: z.string(),
      kind: JobKind,
      targetSessionID: z.string(),
      parentSessionID: z.string().optional(),
      toolCallID: z.string().optional(),
      createdAt: z.number(),
      startedAt: z.number().optional(),
      finishedAt: z.number().optional(),
      timeoutMs: z.number().optional(),
      status: JobStatus,
      error: JobError.optional(),
    })
    .meta({ ref: "SessionRunnerJob" })
  export type Job = z.infer<typeof Job>

  export const EnqueueOptions = z
    .object({
      timeoutMs: z.number().optional(),
      parentSessionID: z.string().optional(),
      toolCallID: z.string().optional(),
      dedupeKey: z.string().optional(),
    })
    .meta({ ref: "SessionRunnerEnqueueOptions" })
  export type EnqueueOptions = z.infer<typeof EnqueueOptions>

  export const Event = {
    Queued: BusEvent.define(
      "session.background.queued",
      z.object({
        job: Job,
      }),
    ),
    Started: BusEvent.define(
      "session.background.started",
      z.object({
        job: Job,
      }),
    ),
    Completed: BusEvent.define(
      "session.background.completed",
      z.object({
        job: Job,
      }),
    ),
    Failed: BusEvent.define(
      "session.background.failed",
      z.object({
        job: Job,
      }),
    ),
    Canceled: BusEvent.define(
      "session.background.canceled",
      z.object({
        job: Job,
      }),
    ),
    TimedOut: BusEvent.define(
      "session.background.timed_out",
      z.object({
        job: Job,
      }),
    ),
  }

  export const Options = z
    .object({
      model: z.object({
        providerID: z.string(),
        modelID: z.string(),
      }),
      agent: z.string(),
      tools: z.record(z.string(), z.boolean()).optional(),
      origin: z
        .object({
          parentSessionID: Identifier.schema("session").optional(),
          parentMessageID: Identifier.schema("message").optional(),
          description: z.string().optional(),
          command: z.string().optional(),
        })
        .optional(),
      timeoutMs: z.number().optional(),
      maxSteps: z.number().optional(),
    })
    .meta({ ref: "SessionRunnerOptions" })
  export type Options = z.infer<typeof Options>

  export const RunResult = z
    .object({
      sessionID: Identifier.schema("session"),
      message: MessageV2.WithParts,
      success: z.boolean(),
      error: z.string().optional(),
    })
    .meta({ ref: "SessionRunnerResult" })
  export type RunResult = z.infer<typeof RunResult>

  interface QueuedJob {
    job: Job
    run: (abort: AbortSignal) => Promise<void>
    resolve: (job: Job) => void
  }

  const MAX_HISTORY = 100

  const state = Instance.state(
    () => ({
      queue: [] as QueuedJob[],
      jobsById: {} as Record<string, Job>,
      abortById: {} as Record<string, AbortController>,
      dedupeKeys: {} as Record<string, string>,
      completionPromises: {} as Record<string, Promise<Job>>,
      running: 0,
    }),
    async (s) => {
      for (const queued of s.queue) {
        queued.job.status = "canceled"
        queued.job.finishedAt = Date.now()
        queued.job.error = { message: "Instance disposed" }
        queued.resolve(queued.job)
      }
      s.queue = []
      for (const id of Object.keys(s.abortById)) {
        s.abortById[id].abort(new Error("disposed"))
      }
    },
  )

  async function getConfig() {
    const cfg = await Config.get()
    return {
      timeoutMs: cfg.experimental?.backgroundTasks?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxConcurrent: cfg.experimental?.backgroundTasks?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
    }
  }

  async function processQueue() {
    const s = state()
    const config = await getConfig()

    while (s.queue.length > 0 && s.running < config.maxConcurrent) {
      const next = s.queue.shift()
      if (!next) break

      s.running++
      runJob(next).finally(() => {
        s.running--
        processQueue()
      })
    }
  }

  async function runJob(queued: QueuedJob) {
    const s = state()
    const config = await getConfig()
    const job = queued.job
    const timeout = job.timeoutMs ?? config.timeoutMs

    const abort = new AbortController()
    s.abortById[job.id] = abort

    job.status = "running"
    job.startedAt = Date.now()
    s.jobsById[job.id] = job
    Bus.publish(Event.Started, { job })
    log.info("job started", { id: job.id, kind: job.kind })

    let timer: ReturnType<typeof setTimeout> | undefined

    try {
      await Promise.race([
        queued.run(abort.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            abort.abort(new Error("timeout"))
            reject(new Error("timeout"))
          }, timeout)
        }),
      ])
      job.status = "completed"
      job.finishedAt = Date.now()
      Bus.publish(Event.Completed, { job })
      log.info("job completed", { id: job.id })
    } catch (err) {
      job.finishedAt = Date.now()
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === "timeout" || abort.signal.reason?.message === "timeout") {
        job.status = "timed_out"
        job.error = { message: "Job timed out" }
        Bus.publish(Event.TimedOut, { job })
        log.warn("job timed out", { id: job.id })
      } else if (abort.signal.aborted) {
        job.status = "canceled"
        job.error = { message: "Job canceled" }
        Bus.publish(Event.Canceled, { job })
        log.info("job canceled", { id: job.id })
      } else {
        job.status = "failed"
        job.error = {
          name: err instanceof Error ? err.name : undefined,
          message: msg,
        }
        Bus.publish(Event.Failed, { job })
        log.error("job failed", { id: job.id, error: job.error })
      }
    } finally {
      if (timer) clearTimeout(timer)
      delete s.abortById[job.id]
      s.jobsById[job.id] = job
      pruneHistory(s)
      queued.resolve(job)
    }
  }

  function pruneHistory(s: ReturnType<typeof state>) {
    const ids = Object.keys(s.jobsById)
    if (ids.length <= MAX_HISTORY) return

    const completed = ids
      .filter((id) => {
        const status = s.jobsById[id].status
        return status !== "queued" && status !== "running"
      })
      .sort((a, b) => (s.jobsById[a].finishedAt ?? 0) - (s.jobsById[b].finishedAt ?? 0))

    const toRemove = completed.slice(0, ids.length - MAX_HISTORY)
    for (const id of toRemove) {
      delete s.jobsById[id]
      delete s.completionPromises[id]
    }

    for (const [key, jobId] of Object.entries(s.dedupeKeys)) {
      if (!s.jobsById[jobId]) delete s.dedupeKeys[key]
    }
  }

  export async function enqueue(
    kind: JobKind,
    targetSessionID: string,
    run: (abort: AbortSignal) => Promise<void>,
    opts?: EnqueueOptions,
  ): Promise<Job> {
    const s = state()

    if (opts?.dedupeKey) {
      const existing = s.dedupeKeys[opts.dedupeKey]
      if (existing && s.jobsById[existing]) {
        const job = s.jobsById[existing]
        if (job.status === "queued" || job.status === "running") {
          log.info("dedupe hit", { key: opts.dedupeKey, id: existing })
          return s.completionPromises[existing]
        }
      }
    }

    const job: Job = {
      id: `job_${ulid()}`,
      kind,
      targetSessionID,
      parentSessionID: opts?.parentSessionID,
      toolCallID: opts?.toolCallID,
      createdAt: Date.now(),
      timeoutMs: opts?.timeoutMs,
      status: "queued",
    }

    s.jobsById[job.id] = job
    if (opts?.dedupeKey) {
      s.dedupeKeys[opts.dedupeKey] = job.id
    }

    Bus.publish(Event.Queued, { job })
    log.info("job queued", { id: job.id, kind, targetSessionID })

    const completionPromise = new Promise<Job>((resolve) => {
      s.queue.push({ job, run, resolve })
      processQueue()
    })
    s.completionPromises[job.id] = completionPromise

    return completionPromise
  }

  export function cancel(id: string): boolean {
    const s = state()
    const job = s.jobsById[id]
    if (!job) return false

    if (job.status === "queued") {
      const idx = s.queue.findIndex((q) => q.job.id === id)
      if (idx !== -1) {
        const removed = s.queue.splice(idx, 1)[0]
        job.status = "canceled"
        job.finishedAt = Date.now()
        job.error = { message: "Job canceled" }
        s.jobsById[id] = job
        Bus.publish(Event.Canceled, { job })
        removed.resolve(job)
        log.info("job canceled (queued)", { id })
        return true
      }
    }

    if (job.status === "running") {
      const abort = s.abortById[id]
      if (abort) {
        abort.abort(new Error("canceled"))
        log.info("job cancel requested", { id })
        return true
      }
    }

    return false
  }

  export function get(id: string): Job | undefined {
    return state().jobsById[id]
  }

  export function list(): Job[] {
    return Object.values(state().jobsById)
  }

  export function listQueued(): Job[] {
    return state().queue.map((q) => q.job)
  }

  export function listRunning(): Job[] {
    return Object.values(state().jobsById).filter((j) => j.status === "running")
  }

  export function isRunning(id: string): boolean {
    return id in state().abortById
  }

  export function listActive(): string[] {
    return Object.keys(state().abortById)
  }

  export const runOnce = fn(SessionPrompt.PromptInput, async (input): Promise<MessageV2.WithParts> => {
    log.info("runOnce", { sessionID: input.sessionID, agent: input.agent })
    return SessionPrompt.prompt(input)
  })

  export function runBackground(_id: string, _options: Options): void {
    throw new Error("SessionRunner.runBackground not yet implemented")
  }

  export function cancelBackground(_id: string): boolean {
    throw new Error("SessionRunner.cancelBackground not yet implemented")
  }

  export async function waitFor(_id: string): Promise<RunResult> {
    throw new Error("SessionRunner.waitFor not yet implemented")
  }
}
