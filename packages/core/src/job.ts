export * as Job from "./job.js"

import { asc, eq, or } from "drizzle-orm"
import { Array, Cause, Clock, Context, Deferred, Effect, Exit, Layer, Schema, Scope, SynchronizedRef } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Database } from "./database/database.js"
import { ImageNotice } from "./image/notice.js"
import { JobTable } from "./job/sql.js"
import { SessionMessage } from "./session/message.js"
import { SessionSchema } from "./session/schema.js"
import { ShellResult } from "./shell/result.js"

const Background = Schema.Struct({
  id: Schema.String,
  notificationID: SessionMessage.ID,
  recovery: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("shell"),
      sessionID: SessionSchema.ID,
      shellID: Schema.String,
      command: Schema.String,
    }),
    Schema.Struct({
      kind: Schema.Literal("subagent"),
      parentSessionID: SessionSchema.ID,
      childSessionID: SessionSchema.ID,
      agent: Schema.String,
      description: Schema.String,
    }),
    Schema.Struct({
      kind: Schema.Literal("image"),
      sessionID: SessionSchema.ID,
      path: Schema.String,
      model: Schema.String,
    }),
  ]),
  status: Schema.Literals(["running", "completed", "error", "cancelled"]),
  output: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
})

export type Background = typeof Background.Type
export type Recovery = Background["recovery"]
export type Status = Background["status"]

const decodeBackground = Schema.decodeUnknownResult(Background)
const COMPLETED_LIMIT = 25

export type Notice = {
  readonly id?: SessionMessage.ID
  readonly description?: string
  readonly text: string
  readonly metadata?: Record<string, unknown>
  readonly resume?: boolean
}

export type Notifier = (sessionID: SessionSchema.ID, notice: Notice) => Effect.Effect<void>

export function formatNotice(
  input: Pick<Background, "id" | "status" | "output" | "error"> & { readonly value?: unknown },
  recovery: Exclude<Recovery, { kind: "subagent" }>,
  options?: { readonly restarted?: boolean },
): Omit<Notice, "id" | "resume"> {
  const restarted = options?.restarted === true
  const state = input.status === "running" ? "cancelled" : input.status
  if (recovery.kind === "shell") {
    const text =
      input.status === "running"
        ? "Command cancelled because the server restarted"
        : state === "completed"
          ? (input.output ?? "Command completed")
          : state === "error"
            ? (input.error ?? "Command failed")
            : !restarted && input.output
              ? `${input.output}\n\nCancelled`
              : restarted
                ? "Command cancelled"
                : "Cancelled"
    return {
      description: recovery.command,
      ...ShellResult.notification({
        jobID: input.id,
        shellID: recovery.shellID,
        command: recovery.command,
        state,
        text,
        ...(input.value !== undefined
          ? { output: input.value as Parameters<typeof ShellResult.notification>[0]["output"] }
          : {}),
      }),
    }
  }
  const body =
    input.status === "running"
      ? `Image request for ${recovery.path} was cancelled because the server restarted.`
      : state === "completed"
        ? (input.output ?? `Image request finished. Saved image: ${recovery.path} (${recovery.model}).`)
        : state === "error"
          ? (input.error ?? `Image request failed for ${recovery.path}.`)
          : `Image request for ${recovery.path} was cancelled.`
  return {
    description: "Image generation",
    text: ImageNotice.text({ id: input.id, state, body }),
    metadata: { source: "experimental_image_generate", jobID: input.id, state, path: recovery.path },
  }
}

export type Info<Value = unknown> = {
  id: string
  sessionID?: SessionSchema.ID
  type: string
  title?: string
  status: Status
  started_at: number
  completed_at?: number
  output?: string
  error?: string
  value?: Value
  metadata?: Record<string, unknown>
  notificationID?: SessionMessage.ID
}

export type RunOutput<Value = unknown> = string | { readonly output: string; readonly value: Value }

type Active = {
  info: Info<any>
  done: Deferred.Deferred<Info<any>>
  backgrounded: Deferred.Deferred<Info<any>>
  scope: Scope.Closeable
  blockingSessions: Map<SessionSchema.ID, number>
  isBackgrounded: boolean
  autoNotify: boolean
  notified: boolean
  consumed: boolean
  recovery?: Recovery
  output?: Effect.Effect<string | undefined>
  stop?: Effect.Effect<void>
}

type State = {
  jobs: SynchronizedRef.SynchronizedRef<Map<string, Active>>
  scope: Scope.Scope
  notifier?: Notifier
}

type FinishResult = {
  info?: Info<any>
  done?: Deferred.Deferred<Info<any>>
  scope?: Scope.Closeable
  generation?: Scope.Closeable
  stop?: Effect.Effect<void>
  deliver?: Effect.Effect<void>
}

type BackgroundResult = {
  info?: Info<any>
  backgrounded?: Deferred.Deferred<Info<any>>
  deliver?: Effect.Effect<void>
}

export type StartInput<Value = unknown> = {
  id: string
  sessionID?: SessionSchema.ID
  type: string
  title?: string
  metadata?: Record<string, unknown>
  recovery?: Recovery
  notificationID?: SessionMessage.ID
  run: Effect.Effect<RunOutput<Value>, unknown>
  output?: Effect.Effect<string | undefined>
  stop?: Effect.Effect<void>
}

export type WaitInput = {
  id: string
  timeout?: number
}

export type WaitResult<Value = unknown> = {
  info?: Info<Value>
  timedOut: boolean
}

export type BlockInput = {
  id: string
  sessionID: SessionSchema.ID
}

export type BlockResult<Value = unknown> =
  | { type: "finished"; info: Info<Value> }
  | { type: "backgrounded"; info: Info<Value> }

export type BackgroundAllInput = {
  sessionID: SessionSchema.ID
  type?: string
}

export type ListInput = {
  sessionID?: SessionSchema.ID
  running?: boolean
}

export type CancelOptions = {
  readonly notify?: boolean
}

export interface Interface {
  readonly get: (id: string) => Effect.Effect<Info | undefined>
  readonly read: (id: string) => Effect.Effect<Info | undefined>
  readonly list: (input?: ListInput) => Effect.Effect<Info[]>
  readonly start: <Value = unknown>(input: StartInput<Value>) => Effect.Effect<Info<Value>>
  readonly wait: (input: WaitInput) => Effect.Effect<WaitResult>
  readonly block: <Value = unknown>(input: BlockInput) => Effect.Effect<BlockResult<Value> | undefined>
  readonly background: (id: string) => Effect.Effect<Info | undefined>
  readonly backgroundAll: (input: BackgroundAllInput) => Effect.Effect<Info[]>
  readonly cancel: (id: string, options?: CancelOptions) => Effect.Effect<Info | undefined>
  readonly cancelSession: (sessionID: SessionSchema.ID) => Effect.Effect<Info[]>
  readonly registerNotifier: (notifier: Notifier) => Effect.Effect<void>
  readonly pendingBackground: Effect.Effect<readonly Background[]>
  readonly runningBackground: Effect.Effect<readonly Recovery[]>
  readonly completeBackground: (notificationID: SessionMessage.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Job") {}

function snapshot<Value = unknown>(job: Active): Info<Value> {
  return {
    ...job.info,
    ...(job.info.metadata ? { metadata: { ...job.info.metadata } } : {}),
  }
}

function ownerSessionID(recovery: Recovery): SessionSchema.ID {
  return recovery.kind === "subagent" ? recovery.parentSessionID : recovery.sessionID
}

function resolveSessionID(input: StartInput<any>): SessionSchema.ID | undefined {
  if (input.sessionID !== undefined) return input.sessionID
  if (input.recovery !== undefined) return ownerSessionID(input.recovery)
  return Schema.is(SessionSchema.ID)(input.metadata?.sessionID) ? input.metadata.sessionID : undefined
}

function recoveryTitle(job: Active, recovery: Recovery): string | null {
  if (job.info.title !== undefined) return job.info.title
  if (recovery.kind === "shell") return recovery.command
  if (recovery.kind === "subagent") return recovery.description
  return recovery.path
}

function matchesSession(job: Active, sessionID: SessionSchema.ID) {
  if (job.info.sessionID === sessionID || job.info.metadata?.sessionID === sessionID) return true
  if (job.blockingSessions.has(sessionID)) return true
  if (!job.recovery) return false
  if (job.recovery.kind === "subagent")
    return job.recovery.parentSessionID === sessionID || job.recovery.childSessionID === sessionID
  return job.recovery.sessionID === sessionID
}

function errorText(cause: Cause.Cause<unknown>) {
  const render = (error: Error): string => {
    const message = error.message || error.name || "Unknown error"
    if (!(error.cause instanceof Error)) return message
    const detail = render(error.cause)
    return detail === message || detail.startsWith(`${message}\n`) ? detail : `${message}\nCaused by: ${detail}`
  }
  return Cause.prettyErrors(cause).map(render).join("\n") || "Unknown error"
}

function incrementSession(input: Map<SessionSchema.ID, number>, sessionID: SessionSchema.ID) {
  return new Map(input).set(sessionID, (input.get(sessionID) ?? 0) + 1)
}

function decrementSession(input: Map<SessionSchema.ID, number>, sessionID: SessionSchema.ID) {
  const count = input.get(sessionID)
  if (count === undefined) return input
  const next = new Map(input)
  if (count <= 1) next.delete(sessionID)
  else next.set(sessionID, count - 1)
  return next
}

/**
 * Makes one scoped, process-local registry backed by the durable SQLite `job` table for
 * backgrounded work until its completion notification is admitted.
 */
export const make = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  // Outlives any Location or plugin scope that started a job.
  const baseContext = yield* Effect.context<never>()
  const state: State = {
    jobs: yield* SynchronizedRef.make(new Map()),
    scope: yield* Scope.Scope,
  }

  const readLiveOutput = (job: Active) =>
    job.info.status === "running" && job.output
      ? job.output.pipe(Effect.setContext(baseContext), Effect.orElseSucceed(() => undefined))
      : Effect.succeed(job.info.output)

  const snapshotWithOutput = Effect.fnUntraced(function* <Value = unknown>(job: Active) {
    const base = snapshot<Value>(job)
    const live = yield* readLiveOutput(job)
    return live ? { ...base, output: live } : base
  })

  const consumeJob = (jobs: Map<string, Active>, id: string, generation: Scope.Closeable) => {
    const job = jobs.get(id)
    if (!job || job.scope !== generation || job.info.status === "running" || job.consumed) return jobs
    const next = new Map(jobs)
    // Order history by first consumption, not by start time or subsequent reads.
    next.delete(id)
    next.set(id, { ...job, consumed: true })
    const completed = [...next].filter(([, item]) => item.consumed && !item.info.notificationID)
    for (const [oldID] of completed.slice(0, -COMPLETED_LIMIT)) next.delete(oldID)
    return next
  }

  const consume = (id: string, generation: Scope.Closeable) =>
    SynchronizedRef.update(state.jobs, (jobs) => consumeJob(jobs, id, generation))

  const persistBackground = Effect.fnUntraced(function* (job: Active) {
    if (!job.recovery || !job.info.notificationID) return
    const now = yield* Clock.currentTimeMillis
    const values = {
      notification_id: job.info.notificationID,
      id: job.info.id,
      session_id: ownerSessionID(job.recovery),
      child_session_id: job.recovery.kind === "subagent" ? job.recovery.childSessionID : null,
      kind: job.recovery.kind,
      title: recoveryTitle(job, job.recovery),
      status: job.info.status,
      output: job.info.output ?? null,
      error: job.info.error ?? null,
      recovery: job.recovery,
      time_created: job.info.started_at,
      time_updated: now,
    }
    yield* db
      .insert(JobTable)
      .values(values)
      .onConflictDoUpdate({
        target: JobTable.notification_id,
        set: {
          status: values.status,
          output: values.output,
          error: values.error,
          recovery: values.recovery,
          time_updated: now,
        },
      })
      .run()
      .pipe(Effect.orDie)
  })

  const completeBackground: Interface["completeBackground"] = Effect.fn("Job.completeBackground")((notificationID) =>
    SynchronizedRef.updateEffect(state.jobs, (jobs) =>
      Effect.gen(function* () {
        yield* db.delete(JobTable).where(eq(JobTable.notification_id, notificationID)).run().pipe(Effect.orDie)
        const entry = [...jobs].find(([, job]) => job.info.notificationID === notificationID)
        if (!entry || entry[1].info.status === "running") return jobs
        const [id, job] = entry
        const { notificationID: _, ...info } = job.info
        return consumeJob(new Map(jobs).set(id, { ...job, info }), id, job.scope)
      }),
    ),
  )

  const canAutoNotify = (job: Active) =>
    job.autoNotify && state.notifier !== undefined && job.recovery !== undefined && job.recovery.kind !== "subagent"

  const deliverNotice = (job: Active, info: Info<any>) => {
    const notifier = state.notifier
    const recovery = job.recovery
    if (!notifier || !job.autoNotify || !recovery || recovery.kind === "subagent") return undefined
    return notifier(recovery.sessionID, {
      ...(info.notificationID ? { id: info.notificationID } : {}),
      ...(info.status === "cancelled" ? { resume: false } : {}),
      ...formatNotice(info, recovery),
    }).pipe(
      Effect.andThen(info.notificationID ? completeBackground(info.notificationID) : Effect.void),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logError("Failed to deliver background job notice", cause),
      ),
      Effect.forkIn(state.scope, { startImmediately: true }),
      Effect.setContext(baseContext),
      Effect.asVoid,
    )
  }

  const settle = Effect.fnUntraced(function* (
    id: string,
    scope: Scope.Closeable,
    exit: Exit.Exit<RunOutput<any>, unknown>,
  ) {
    const completed_at = yield* Clock.currentTimeMillis
    const result = yield* SynchronizedRef.modifyEffect(
      state.jobs,
      Effect.fnUntraced(function* (jobs): Effect.fn.Return<readonly [FinishResult, Map<string, Active>]> {
        const job = jobs.get(id)
        if (!job || job.scope !== scope) return [{}, jobs]
        if (job.info.status !== "running") return [{ info: snapshot(job) }, jobs]
        const status: Exclude<Status, "running"> = Exit.isSuccess(exit)
          ? "completed"
          : Cause.hasInterruptsOnly(exit.cause)
            ? "cancelled"
            : "error"
        const unpacked = Exit.isSuccess(exit)
          ? typeof exit.value === "string"
            ? { output: exit.value }
            : exit.value
          : undefined
        const shouldDeliver = status !== "cancelled" && job.isBackgrounded && !job.notified && canAutoNotify(job)
        const next: Active = {
          ...job,
          notified: job.notified || shouldDeliver,
          blockingSessions: new Map<SessionSchema.ID, number>(),
          info: {
            ...job.info,
            status,
            completed_at,
            ...(unpacked !== undefined ? { output: unpacked.output } : {}),
            ...(unpacked && "value" in unpacked && unpacked.value !== undefined ? { value: unpacked.value } : {}),
            ...(Exit.isFailure(exit) ? { error: errorText(exit.cause) } : {}),
          },
        }
        if (status !== "cancelled") yield* persistBackground(next)
        const info = snapshot(next)
        return [
          { info, done: job.done, scope: job.scope, deliver: shouldDeliver ? deliverNotice(next, info) : undefined },
          new Map(jobs).set(id, next),
        ]
      }),
    )
    if (result.info && result.done) yield* Deferred.succeed(result.done, result.info)
    if (result.deliver) yield* result.deliver
    if (result.scope) {
      yield* Scope.close(result.scope, Exit.void).pipe(Effect.forkIn(state.scope, { startImmediately: true }))
    }
    return result.info
  })

  const get: Interface["get"] = Effect.fn("Job.get")(function* (id) {
    const job = (yield* SynchronizedRef.get(state.jobs)).get(id)
    if (!job) return undefined
    return snapshot(job)
  })

  const read: Interface["read"] = Effect.fn("Job.read")(function* (id) {
    const job = (yield* SynchronizedRef.get(state.jobs)).get(id)
    if (!job) return undefined
    return yield* snapshotWithOutput(job)
  })

  const list: Interface["list"] = Effect.fn("Job.list")(function* (input) {
    const jobs = yield* SynchronizedRef.get(state.jobs)
    const matched = [...jobs.values()].filter(
      (job) =>
        (input?.sessionID === undefined || job.info.sessionID === input.sessionID) &&
        (input?.running !== true || job.info.status === "running"),
    )
    return yield* Effect.forEach(matched, (job) => snapshotWithOutput(job))
  })

  const start: Interface["start"] = <Value = unknown>(input: StartInput<Value>) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const started_at = yield* Clock.currentTimeMillis
        const done = yield* Deferred.make<Info<any>>()
        const backgrounded = yield* Deferred.make<Info<any>>()
        const sessionID = resolveSessionID(input)
        const result = yield* SynchronizedRef.modifyEffect(
          state.jobs,
          Effect.fnUntraced(function* (
            jobs,
          ): Effect.fn.Return<readonly [{ info: Info<any>; scope?: Scope.Closeable }, Map<string, Active>]> {
            const existing = jobs.get(input.id)
            if (existing?.info.status === "running") return [{ info: snapshot(existing) }, jobs]
            const scope = yield* Scope.fork(state.scope, "parallel")
            const job: Active = {
              info: {
                id: input.id,
                ...(sessionID !== undefined ? { sessionID } : {}),
                type: input.type,
                title: input.title,
                status: "running" as const,
                started_at,
                metadata: input.metadata,
                ...(input.notificationID ? { notificationID: input.notificationID } : {}),
              },
              done,
              backgrounded,
              scope,
              blockingSessions: new Map<SessionSchema.ID, number>(),
              isBackgrounded: false,
              autoNotify: input.sessionID !== undefined,
              notified: false,
              consumed: false,
              recovery: input.recovery,
              output: input.output,
              stop: input.stop,
            }
            return [{ info: snapshot(job), scope }, new Map(jobs).set(input.id, job)]
          }),
        )
        const scope = result.scope
        if (scope)
          yield* restore(input.run).pipe(
            Effect.exit,
            Effect.flatMap((exit) => settle(input.id, scope, exit)),
            Effect.asVoid,
            Effect.forkIn(scope, { startImmediately: true }),
          )
        return result.info as Info<Value>
      }),
    )

  const wait: Interface["wait"] = Effect.fn("Job.wait")(function* (input) {
    const job = (yield* SynchronizedRef.get(state.jobs)).get(input.id)
    if (!job) return { timedOut: false }
    return yield* Effect.gen(function* () {
      if (job.info.status !== "running") return { info: snapshot(job), timedOut: false }
      if (input.timeout === undefined) return { info: yield* Deferred.await(job.done), timedOut: false }
      if (input.timeout <= 0) return { info: yield* snapshotWithOutput(job), timedOut: true }
      const info = yield* Deferred.await(job.done).pipe(Effect.timeoutOption(input.timeout))
      if (info._tag === "Some") return { info: info.value, timedOut: false }
      const latest = (yield* SynchronizedRef.get(state.jobs)).get(input.id) ?? job
      if (latest.info.status !== "running") return { info: snapshot(latest), timedOut: false }
      return { info: yield* snapshotWithOutput(latest), timedOut: true }
    }).pipe(
      // Recoverable wait -> background is a supported handoff, even after failure.
      Effect.tap((result) =>
        result.info?.status === "running" || job.recovery ? Effect.void : consume(input.id, job.scope),
      ),
    )
  })

  const removeBlock = Effect.fnUntraced(function* (input: BlockInput) {
    yield* SynchronizedRef.update(state.jobs, (jobs) => {
      const job = jobs.get(input.id)
      if (!job || job.info.status !== "running" || job.isBackgrounded) return jobs
      return new Map(jobs).set(input.id, {
        ...job,
        blockingSessions: decrementSession(job.blockingSessions, input.sessionID),
      })
    })
  })

  type BlockStart =
    | { type: "missing" }
    | { type: "finished"; info: Info<any> }
    | { type: "backgrounded"; info: Info<any> }
    | { type: "wait"; done: Deferred.Deferred<Info<any>>; backgrounded: Deferred.Deferred<Info<any>>; generation: Scope.Closeable }

  const block: Interface["block"] = <Value = unknown>(input: BlockInput) =>
    Effect.gen(function* () {
      const result = yield* SynchronizedRef.modify(state.jobs, (jobs): readonly [BlockStart, Map<string, Active>] => {
        const job = jobs.get(input.id)
        if (!job) return [{ type: "missing" }, jobs]
        if (job.isBackgrounded) return [{ type: "backgrounded", info: snapshot(job) }, jobs]
        if (job.info.status !== "running")
          return [{ type: "finished", info: snapshot(job) }, consumeJob(jobs, input.id, job.scope)]
        return [
          { type: "wait", done: job.done, backgrounded: job.backgrounded, generation: job.scope },
          new Map(jobs).set(input.id, {
            ...job,
            blockingSessions: incrementSession(job.blockingSessions, input.sessionID),
          }),
        ]
      })
      if (result.type === "missing") return undefined
      if (result.type === "finished") return { type: "finished" as const, info: result.info as Info<Value> }
      if (result.type === "backgrounded") return { type: "backgrounded" as const, info: result.info as Info<Value> }
      return yield* Effect.raceFirst(
        Deferred.await(result.done).pipe(Effect.map((info) => ({ type: "finished" as const, info: info as Info<Value> }))),
        Deferred.await(result.backgrounded).pipe(
          Effect.map((info) => ({ type: "backgrounded" as const, info: info as Info<Value> })),
        ),
      ).pipe(
        Effect.tap((outcome) => (outcome.type === "finished" ? consume(input.id, result.generation) : Effect.void)),
        Effect.ensuring(removeBlock(input)),
      )
    })

  const markBackground = Effect.fnUntraced(function* (job: Active) {
    const shouldDeliver = job.info.status !== "running" && !job.notified && canAutoNotify(job)
    const next: Active = {
      ...job,
      isBackgrounded: true,
      notified: job.notified || shouldDeliver,
      blockingSessions: new Map<SessionSchema.ID, number>(),
      info: {
        ...job.info,
        ...(job.recovery ? { notificationID: job.info.notificationID ?? SessionMessage.ID.create() } : {}),
      },
    }
    yield* persistBackground(next)
    const info = snapshot(next)
    return { next, info, deliver: shouldDeliver ? deliverNotice(next, info) : undefined }
  })

  const background: Interface["background"] = Effect.fn("Job.background")(function* (id) {
    const result = yield* SynchronizedRef.modifyEffect(
      state.jobs,
      Effect.fnUntraced(function* (jobs): Effect.fn.Return<readonly [BackgroundResult, Map<string, Active>]> {
        const job = jobs.get(id)
        if (!job || job.consumed || (job.info.status !== "running" && !job.recovery)) return [{}, jobs]
        if (job.isBackgrounded) return [{ info: snapshot(job) }, jobs]
        const marked = yield* markBackground(job)
        return [
          { info: marked.info, backgrounded: job.backgrounded, deliver: marked.deliver },
          new Map(jobs).set(id, marked.next),
        ]
      }),
    )
    if (result.info && result.backgrounded) yield* Deferred.succeed(result.backgrounded, result.info)
    if (result.deliver) yield* result.deliver
    return result.info
  })

  const backgroundAll: Interface["backgroundAll"] = Effect.fn("Job.backgroundAll")(function* (input) {
    const result = yield* SynchronizedRef.modifyEffect(
      state.jobs,
      Effect.fnUntraced(function* (
        jobs,
      ): Effect.fn.Return<readonly [Array<{ info: Info<any>; backgrounded: Deferred.Deferred<Info<any>> }>, Map<string, Active>]> {
        const results: Array<{ info: Info<any>; backgrounded: Deferred.Deferred<Info<any>> }> = []
        const next = new Map(jobs)
        for (const [id, job] of jobs) {
          if (job.info.status !== "running" || job.isBackgrounded) continue
          if (input.type !== undefined && job.info.type !== input.type) continue
          if (!job.blockingSessions.has(input.sessionID)) continue
          const marked = yield* markBackground(job)
          results.push({ info: marked.info, backgrounded: job.backgrounded })
          next.set(id, marked.next)
        }
        return [results, next]
      }),
    )
    yield* Effect.forEach(result, (item) => Deferred.succeed(item.backgrounded, item.info), { discard: true })
    return result.map((item) => item.info)
  })

  const cancel: Interface["cancel"] = Effect.fn("Job.cancel")(function* (id, options) {
    const current = (yield* SynchronizedRef.get(state.jobs)).get(id)
    const partial = current?.info.status === "running" ? yield* readLiveOutput(current) : undefined
    const completed_at = yield* Clock.currentTimeMillis
    const notify = options?.notify !== false
    const result = yield* SynchronizedRef.modifyEffect(
      state.jobs,
      Effect.fnUntraced(function* (jobs): Effect.fn.Return<readonly [FinishResult, Map<string, Active>]> {
        const job = jobs.get(id)
        if (!job) return [{}, jobs]
        if (job.info.status !== "running") return [{ info: snapshot(job), generation: job.scope }, jobs]
        const shouldDeliver = notify && job.isBackgrounded && !job.notified && canAutoNotify(job)
        const clearMarker = !notify && job.info.notificationID !== undefined
        const { notificationID: droppedID, ...restInfo } = job.info
        if (clearMarker && droppedID)
          yield* db.delete(JobTable).where(eq(JobTable.notification_id, droppedID)).run().pipe(Effect.orDie)
        const next: Active = {
          ...job,
          notified: job.notified || shouldDeliver || !notify,
          blockingSessions: new Map<SessionSchema.ID, number>(),
          info: {
            ...(clearMarker ? restInfo : job.info),
            status: "cancelled" as const,
            completed_at,
            ...(partial ? { output: partial } : {}),
          },
        }
        if (!clearMarker) yield* persistBackground(next)
        const info = snapshot(next)
        return [
          {
            info,
            done: job.done,
            scope: job.scope,
            generation: job.scope,
            stop: job.stop,
            deliver: shouldDeliver ? deliverNotice(next, info) : undefined,
          },
          new Map(jobs).set(id, next),
        ]
      }),
    )
    if (result.info && result.done) yield* Deferred.succeed(result.done, result.info)
    if (result.stop) yield* result.stop.pipe(Effect.setContext(baseContext), Effect.ignoreCause)
    if (result.scope) yield* Scope.close(result.scope, Exit.void)
    if (result.deliver) yield* result.deliver
    if (result.generation) yield* consume(id, result.generation)
    return result.info
  })

  const cancelSession: Interface["cancelSession"] = Effect.fn("Job.cancelSession")(function* (sessionID) {
    const ids = [...(yield* SynchronizedRef.get(state.jobs)).values()]
      .filter((job) => job.info.status === "running" && matchesSession(job, sessionID))
      .map((job) => job.info.id)
    const cancelled = yield* Effect.forEach(ids, (id) => cancel(id, { notify: false }))
    yield* db
      .delete(JobTable)
      .where(or(eq(JobTable.session_id, sessionID), eq(JobTable.child_session_id, sessionID)))
      .run()
      .pipe(Effect.orDie)
    yield* SynchronizedRef.update(state.jobs, (jobs) => {
      const next = new Map(jobs)
      for (const [id, job] of jobs) {
        if (matchesSession(job, sessionID)) next.delete(id)
      }
      return next
    })
    return cancelled.filter((info): info is Info => info !== undefined)
  })

  const registerNotifier: Interface["registerNotifier"] = (notifier) =>
    Effect.sync(() => {
      state.notifier = notifier
    })

  const pendingBackground: Interface["pendingBackground"] = Effect.gen(function* () {
    const rows = yield* db
      .select()
      .from(JobTable)
      .orderBy(asc(JobTable.time_created), asc(JobTable.notification_id))
      .all()
      .pipe(Effect.orDie)
    return Array.filterMap(rows, (row) =>
      decodeBackground({
        id: row.id,
        notificationID: row.notification_id,
        recovery: row.recovery,
        status: row.status,
        ...(row.output !== null ? { output: row.output } : {}),
        ...(row.error !== null ? { error: row.error } : {}),
      }),
    )
  }).pipe(Effect.withSpan("Job.pendingBackground"))

  const runningBackground: Interface["runningBackground"] = SynchronizedRef.get(state.jobs).pipe(
    Effect.map((jobs) =>
      [...jobs.values()].flatMap((job) =>
        job.isBackgrounded && job.info.status === "running" && job.recovery ? [job.recovery] : [],
      ),
    ),
    Effect.withSpan("Job.runningBackground"),
  )

  return Service.of({
    get,
    read,
    list,
    start,
    wait,
    block,
    background,
    backgroundAll,
    cancel,
    cancelSession,
    registerNotifier,
    pendingBackground,
    runningBackground,
    completeBackground,
  })
})

const layer = Layer.effect(Service, make)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
