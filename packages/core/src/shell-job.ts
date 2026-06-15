export * as ShellJob from "./shell-job"

import { Clock, Context, Deferred, Effect, Layer, SynchronizedRef } from "effect"
import type { ChildProcess } from "effect/unstable/process"
import { BackgroundJob } from "./background-job"
import { Identifier } from "./id/id"
import { AppProcess } from "./process"
import type { SessionSchema } from "./session/schema"

export type Status = "running" | "exited" | "timed_out" | "cancelled" | "failed"

export type Snapshot = {
  jobId: string
  status: Status
  command: string
  cwd: string
  startedAt: number
  endedAt?: number
  exitCode?: number
  error?: string
  timedOut?: boolean
  durationMs: number
  outputPreview: string
  stdoutTruncated?: boolean
  stderrTruncated?: boolean
}

type Active = {
  sessionID: SessionSchema.ID
  command: string
  cwd: string
  startedAt: number
  status: Status
  done: Deferred.Deferred<Snapshot>
  chunks: string[]
  bytes: number
  endedAt?: number
  exitCode?: number
  error?: string
  timedOut?: boolean
  stdoutTruncated?: boolean
  stderrTruncated?: boolean
}

type StartInput = {
  sessionID: SessionSchema.ID
  command: string
  cwd: string
  process: ChildProcess.Command
  timeout: number
}

type ObserveInput = {
  sessionID: SessionSchema.ID
  jobId: string
}

type WaitInput = ObserveInput & {
  timeout?: number
}

type LogsInput = ObserveInput & {
  lines?: number
}

export interface Interface {
  readonly start: (input: StartInput) => Effect.Effect<Snapshot>
  readonly status: (input: ObserveInput) => Effect.Effect<Snapshot | undefined>
  readonly wait: (input: WaitInput) => Effect.Effect<Snapshot | undefined>
  readonly logs: (input: LogsInput) => Effect.Effect<string | undefined>
  readonly cancel: (input: ObserveInput) => Effect.Effect<Snapshot | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ShellJob") {}

const MAX_TAIL_BYTES = 1024 * 1024
const DEFAULT_LOG_LINES = 100

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

const trimLines = (text: string, lines: number) => {
  const split = text.split(/\r?\n/)
  return split.length <= lines ? text : split.slice(-lines).join("\n")
}

const snapshot = (job: Active, now: number): Snapshot => {
  const outputPreview = trimLines(job.chunks.join(""), DEFAULT_LOG_LINES)
  return {
    jobId: "",
    status: job.status,
    command: job.command,
    cwd: job.cwd,
    startedAt: job.startedAt,
    durationMs: (job.endedAt ?? now) - job.startedAt,
    outputPreview: outputPreview || "(no output)",
    ...(job.endedAt ? { endedAt: job.endedAt } : {}),
    ...(job.exitCode !== undefined ? { exitCode: job.exitCode } : {}),
    ...(job.error ? { error: job.error } : {}),
    ...(job.timedOut ? { timedOut: true } : {}),
    ...(job.stdoutTruncated ? { stdoutTruncated: true } : {}),
    ...(job.stderrTruncated ? { stderrTruncated: true } : {}),
  }
}

const withJobId = (jobId: string, info: Snapshot): Snapshot => ({ ...info, jobId })

const append = (job: Active, text: string): Active => {
  const size = Buffer.byteLength(text, "utf8")
  const chunks = [...job.chunks, text]
  let bytes = job.bytes + size
  while (bytes > MAX_TAIL_BYTES && chunks.length > 1) {
    const first = chunks.shift()
    if (!first) break
    bytes -= Buffer.byteLength(first, "utf8")
  }
  return { ...job, chunks, bytes }
}

export const make = Effect.gen(function* () {
  const process = yield* AppProcess.Service
  const background = yield* BackgroundJob.Service
  const jobs = yield* SynchronizedRef.make(new Map<string, Active>())

  const read = Effect.fn("ShellJob.read")(function* (input: ObserveInput) {
    const job = (yield* SynchronizedRef.get(jobs)).get(input.jobId)
    if (!job || job.sessionID !== input.sessionID) return
    return job
  })

  const getSnapshot = Effect.fn("ShellJob.snapshot")(function* (input: ObserveInput) {
    const job = yield* read(input)
    if (!job) return
    return withJobId(input.jobId, snapshot(job, yield* Clock.currentTimeMillis))
  })

  const complete = Effect.fn("ShellJob.complete")(function* (
    jobId: string,
    status: Exclude<Status, "running">,
    patch: Partial<Active>,
  ) {
    const endedAt = yield* Clock.currentTimeMillis
    const result = yield* SynchronizedRef.modify(jobs, (current) => {
      const job = current.get(jobId)
      if (!job) return [undefined, current] as const
      if (job.status !== "running") return [withJobId(jobId, snapshot(job, endedAt)), current] as const
      const next = { ...job, ...patch, status, endedAt }
      return [withJobId(jobId, snapshot(next, endedAt)), new Map(current).set(jobId, next)] as const
    })
    const job = (yield* SynchronizedRef.get(jobs)).get(jobId)
    if (result && job) yield* Deferred.succeed(job.done, result).pipe(Effect.ignore)
    return result
  })

  const start: Interface["start"] = Effect.fn("ShellJob.start")(function* (input) {
    const jobId = Identifier.create("shell", "ascending")
    const startedAt = yield* Clock.currentTimeMillis
    const done = yield* Deferred.make<Snapshot>()
    yield* SynchronizedRef.update(jobs, (current) =>
      new Map(current).set(jobId, {
        sessionID: input.sessionID,
        command: input.command,
        cwd: input.cwd,
        startedAt,
        status: "running",
        done,
        chunks: [],
        bytes: 0,
      }),
    )
    yield* background.start({
      id: jobId,
      type: "shell",
      title: input.command,
      metadata: {
        background: true,
        sessionID: input.sessionID,
        command: input.command,
        cwd: input.cwd,
      },
      run: process
        .runObserved(input.process, {
          timeout: input.timeout,
          maxOutputBytes: MAX_TAIL_BYTES,
          maxErrorBytes: MAX_TAIL_BYTES,
          onStdout: (chunk: string) =>
            SynchronizedRef.update(jobs, (current) => {
              const job = current.get(jobId)
              if (!job) return current
              return new Map(current).set(jobId, append(job, chunk))
            }),
          onStderr: (chunk: string) =>
            SynchronizedRef.update(jobs, (current) => {
              const job = current.get(jobId)
              if (!job) return current
              return new Map(current).set(jobId, append(job, chunk))
            }),
        })
        .pipe(
          Effect.flatMap((result) =>
            complete(jobId, result.timedOut ? "timed_out" : "exited", {
              exitCode: result.exitCode,
              timedOut: result.timedOut,
              stdoutTruncated: result.stdoutTruncated,
              stderrTruncated: result.stderrTruncated,
            }),
          ),
          Effect.map((info) => info?.outputPreview ?? ""),
          Effect.catch((error) =>
            complete(jobId, "failed", { error: errorText(error) }).pipe(Effect.map((info) => info?.error ?? "")),
          ),
        ),
    })
    yield* Effect.sleep(500)
    return (yield* getSnapshot({ sessionID: input.sessionID, jobId }))!
  })

  const status: Interface["status"] = getSnapshot

  const wait: Interface["wait"] = Effect.fn("ShellJob.wait")(function* (input) {
    const job = yield* read(input)
    if (!job) return
    if (job.status !== "running") return withJobId(input.jobId, snapshot(job, yield* Clock.currentTimeMillis))
    if (input.timeout === undefined) return yield* Deferred.await(job.done)
    if (input.timeout <= 0) return withJobId(input.jobId, snapshot(job, yield* Clock.currentTimeMillis))
    const waited = yield* Deferred.await(job.done).pipe(Effect.timeoutOption(input.timeout))
    if (waited._tag === "Some") return waited.value
    return withJobId(input.jobId, snapshot(job, yield* Clock.currentTimeMillis))
  })

  const logs: Interface["logs"] = Effect.fn("ShellJob.logs")(function* (input) {
    const job = yield* read(input)
    if (!job) return
    return trimLines(job.chunks.join(""), input.lines ?? DEFAULT_LOG_LINES) || "(no output)"
  })

  const cancel: Interface["cancel"] = Effect.fn("ShellJob.cancel")(function* (input) {
    const job = yield* read(input)
    if (!job) return
    if (job.status === "running") {
      yield* background.cancel(input.jobId)
      return yield* complete(input.jobId, "cancelled", {})
    }
    return withJobId(input.jobId, snapshot(job, yield* Clock.currentTimeMillis))
  })

  return Service.of({ start, status, wait, logs, cancel })
})

export const layer = Layer.effect(Service, make)
export const defaultLayer = layer
