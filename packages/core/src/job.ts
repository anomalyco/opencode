export * as Job from "./job.js"
export { Event, Status } from "@opencode/schema/job"

import {
  Array,
  Cause,
  Clock,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Schema,
  Scope,
  SynchronizedRef,
} from "effect"
import { Job } from "@opencode/schema/job"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "./bus.js"
import { Database } from "./database/database.js"
import { KV } from "./kv.js"
import { SessionInbox } from "./session/inbox.js"
import { SessionMessage } from "./session/message.js"
import { SessionSchema } from "./session/schema.js"

export const DEFAULT_YIELD_AFTER_MS = 30_000

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
      kind: Schema.Literal("execute"),
      sessionID: SessionSchema.ID,
      code: Schema.String,
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

const decodeBackground = Schema.decodeUnknownResult(Background)
const backgroundPrefix = "job.background/"
const COMPLETED_LIMIT = 25

export type Info<Value = unknown> = {
  id: string
  sessionID?: SessionSchema.ID
  type: string
  title?: string
  status: Job.Status
  started_at: number
  completed_at?: number
  output?: string
  error?: string
  value?: Value
  metadata?: Record<string, unknown>
  notificationID?: SessionMessage.ID
}

export type PublicInfo = Job.Info

export type RunOutput<Value = unknown> = string | { readonly output: string; readonly value: Value }

type Active = {
  info: Info<any>
  done: Deferred.Deferred<Info<any>>
  backgrounded: Deferred.Deferred<Info<any>>
  acknowledged: Deferred.Deferred<void>
  scope: Scope.Closeable
  blockingSessions: Map<SessionSchema.ID, number>
  isBackgrounded: boolean
  notified: boolean
  consumed: boolean
  recovery?: Recovery
  output?: Effect.Effect<string | undefined>
  stop?: Effect.Effect<void>
  onSettle?: (info: Info<any>) => Effect.Effect<void>
}

type State = {
  jobs: SynchronizedRef.SynchronizedRef<Map<string, Active>>
  scope: Scope.Scope
}

type FinishResult = {
  info?: Info<any>
  done?: Deferred.Deferred<Info<any>>
  acknowledged?: Deferred.Deferred<void>
  scope?: Scope.Closeable
  generation?: Scope.Closeable
  stop?: Effect.Effect<void>
  deliver?: (info: Info<any>) => Effect.Effect<void>
}

type BackgroundResult = {
  info?: Info<any>
  backgrounded?: Deferred.Deferred<Info<any>>
  deliver?: (info: Info<any>) => Effect.Effect<void>
}

type StartResult = { info: Info<any>; created?: false } | { info: Info<any>; scope: Scope.Closeable; created: true }

type BlockWait = {
  done: Deferred.Deferred<Info<any>>
  backgrounded: Deferred.Deferred<Info<any>>
  generation: Scope.Closeable
}

type BlockStart =
  | { type: "missing" }
  | { type: "finished"; info: Info<any> }
  | { type: "backgrounded"; info: Info<any> }
  | { type: "wait"; wait: BlockWait }

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
  onSettle?: (info: Info<Value>) => Effect.Effect<void>
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
  yield_after?: number
  deferYield?: Effect.Effect<boolean>
}

export type BlockResult<Value = unknown> =
  | { type: "finished"; info: Info<Value> }
  | { type: "backgrounded"; info: Info<Value> }

export type BackgroundAllInput = {
  sessionID: SessionSchema.ID
  type?: string
}

export type CancelOptions = {
  readonly notify?: boolean
}

export type ListInput = {
  sessionID?: SessionSchema.ID
  running?: boolean
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
  readonly activeSessions: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  readonly awaitSessionBackground: (sessionID: SessionSchema.ID) => Effect.Effect<void>
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

function publicSnapshot(info: Info<any>): PublicInfo {
  return {
    id: info.id,
    ...(info.sessionID !== undefined ? { sessionID: info.sessionID } : {}),
    type: info.type,
    ...(info.title !== undefined ? { title: info.title } : {}),
    status: info.status,
    started_at: info.started_at,
    ...(info.completed_at !== undefined ? { completed_at: info.completed_at } : {}),
    ...(info.output !== undefined ? { output: info.output } : {}),
    ...(info.error !== undefined ? { error: info.error } : {}),
    ...(info.metadata !== undefined ? { metadata: { ...info.metadata } } : {}),
  }
}

function unpackOutput<Value>(result: RunOutput<Value>): { output: string; value?: Value } {
  if (typeof result === "string") return { output: result }
  return { output: result.output, value: result.value }
}

function resolveSessionID(input: StartInput<any>): SessionSchema.ID | undefined {
  if (input.sessionID !== undefined) return input.sessionID
  if (input.recovery !== undefined)
    return input.recovery.kind === "subagent" ? input.recovery.parentSessionID : input.recovery.sessionID
  const metaSessionID = input.metadata?.sessionID
  return Schema.is(SessionSchema.ID)(metaSessionID) ? metaSessionID : undefined
}

function matchesSession(recovery: Recovery | undefined, sessionID: SessionSchema.ID) {
  if (!recovery) return false
  if (recovery.kind === "subagent")
    return recovery.parentSessionID === sessionID || recovery.childSessionID === sessionID
  return recovery.sessionID === sessionID
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
 * Makes one scoped, process-local registry. Explicitly recoverable background
 * work also owns a durable notification marker until its notification is admitted.
 * Unconsumed results survive the start-to-wait handoff. Foreground block/cancel,
 * acknowledged background results, and non-recoverable wait results enter a 25-entry
 * consumed history. Recoverable wait results stay available for background registration
 * and acknowledgment until completed.
 */
export const make = Effect.gen(function* () {
  const kv = yield* KV.Service
  const database = yield* Effect.serviceOption(Database.Service)
  const bus = Option.getOrUndefined(yield* Effect.serviceOption(Bus.Service))
  // Outlives any Location or plugin scope that started a job.
  const baseContext = yield* Effect.context<never>()
  const state: State = {
    jobs: yield* SynchronizedRef.make(new Map()),
    scope: yield* Scope.Scope,
  }

  const publish = (info: Info<any>) => {
    if (!bus) return Effect.void
    return bus.publish(Job.Event.Updated, {
      info: publicSnapshot(info),
      active: info.status === "running",
    })
  }

  const readLiveOutput = (job: Active) =>
    job.info.status === "running" && job.output
      ? job.output.pipe(
          Effect.setContext(baseContext),
          Effect.catchCause(() => Effect.succeed(undefined)),
        )
      : Effect.succeed(job.info.output)

  const snapshotWithOutput = Effect.fnUntraced(function* <Value = unknown>(job: Active) {
    const base = snapshot<Value>(job)
    const live = yield* readLiveOutput(job)
    return live !== undefined && live !== "" ? { ...base, output: live } : base
  })

  const consumeJob = (jobs: Map<string, Active>, id: string, generation: Scope.Closeable) => {
    const job = jobs.get(id)
    if (!job || job.scope !== generation || job.info.status === "running" || job.consumed) return jobs
    const next = new Map(jobs)
    // Order history by first consumption, not by start time or subsequent reads.
    next.delete(id)
    next.set(id, { ...job, consumed: true })
    const completed = [...next].filter(([, job]) => job.consumed && !job.info.notificationID)
    for (const [id] of completed.slice(0, -COMPLETED_LIMIT)) next.delete(id)
    return next
  }

  const consume = (id: string, generation: Scope.Closeable) =>
    SynchronizedRef.update(state.jobs, (jobs) => consumeJob(jobs, id, generation))

  const persistBackground = Effect.fnUntraced(function* (job: Active) {
    if (!job.recovery || !job.info.notificationID) return
    yield* kv.set(`${backgroundPrefix}${job.info.notificationID}`, {
      id: job.info.id,
      notificationID: job.info.notificationID,
      recovery: job.recovery,
      status: job.info.status,
      ...(job.info.output !== undefined ? { output: job.info.output } : {}),
      ...(job.info.error !== undefined ? { error: job.info.error } : {}),
    })
  })

  const completeBackground: Interface["completeBackground"] = Effect.fn("Job.completeBackground")((notificationID) =>
    Effect.gen(function* () {
      const acknowledged = yield* SynchronizedRef.modifyEffect(
        state.jobs,
        Effect.fnUntraced(function* (
          jobs,
        ): Effect.fn.Return<readonly [Deferred.Deferred<void> | undefined, Map<string, Active>]> {
          yield* kv.remove(`${backgroundPrefix}${notificationID}`)
          const entry = [...jobs].find(([, job]) => job.info.notificationID === notificationID)
          if (!entry || entry[1].info.status === "running") return [undefined, jobs]
          const [id, job] = entry
          const { notificationID: _, ...restInfo } = job.info
          const cleared = new Map(jobs).set(id, { ...job, info: restInfo })
          return [job.acknowledged, consumeJob(cleared, id, job.scope)]
        }),
      )
      if (acknowledged) yield* Deferred.succeed(acknowledged, undefined)
    }),
  )

  const deliverSettlement = (info: Info<any>, deliver: ((info: Info<any>) => Effect.Effect<void>) | undefined) => {
    if (!deliver) return Effect.void
    return deliver(info).pipe(
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
        if (!job) return [{}, jobs]
        if (job.scope !== scope) return [{}, jobs]
        if (job.info.status !== "running") return [{ info: snapshot(job) }, jobs]
        const status: Exclude<Job.Status, "running"> = Exit.isSuccess(exit)
          ? "completed"
          : Cause.hasInterruptsOnly(exit.cause)
            ? "cancelled"
            : "error"
        const unpacked = Exit.isSuccess(exit) ? unpackOutput(exit.value) : undefined
        // Interruptions arriving without an explicit `cancel` call come from scope teardown (shutdown);
        // keep their durable background marker untouched so restart recovery can resume or report them.
        const shouldDeliver = status !== "cancelled" && job.isBackgrounded && !job.notified && job.onSettle !== undefined
        const next: Active = {
          ...job,
          notified: job.notified || shouldDeliver,
          blockingSessions: new Map<SessionSchema.ID, number>(),
          info: {
            ...job.info,
            status,
            completed_at,
            ...(unpacked !== undefined ? { output: unpacked.output } : {}),
            ...(unpacked?.value !== undefined ? { value: unpacked.value } : {}),
            ...(Exit.isFailure(exit) ? { error: errorText(exit.cause) } : {}),
          },
        }
        if (status !== "cancelled") yield* persistBackground(next)
        return [
          {
            info: snapshot(next),
            done: job.done,
            acknowledged: !next.isBackgrounded || !next.onSettle ? job.acknowledged : undefined,
            scope: job.scope,
            deliver: shouldDeliver ? job.onSettle : undefined,
          },
          new Map(jobs).set(id, next),
        ]
      }),
    )
    if (result.info && result.done) yield* Deferred.succeed(result.done, result.info)
    if (result.acknowledged) yield* Deferred.succeed(result.acknowledged, undefined)
    if (result.info) {
      yield* deliverSettlement(result.info, result.deliver)
      yield* publish(result.info)
    }
    if (result.scope) {
      yield* Scope.close(result.scope, Exit.void).pipe(Effect.forkIn(state.scope, { startImmediately: true }))
    }
    return result.info
  })

  const get: Interface["get"] = Effect.fn("Job.get")(function* (id: string) {
    const job = (yield* SynchronizedRef.get(state.jobs)).get(id)
    if (!job) return undefined
    return snapshot(job)
  })

  const read: Interface["read"] = Effect.fn("Job.read")(function* (id: string) {
    const job = (yield* SynchronizedRef.get(state.jobs)).get(id)
    if (!job) return undefined
    return yield* snapshotWithOutput(job)
  })

  const list: Interface["list"] = Effect.fn("Job.list")(function* (input) {
    const jobs = yield* SynchronizedRef.get(state.jobs)
    const matched = [...jobs.values()].filter((job) => {
      if (input?.sessionID !== undefined && job.info.sessionID !== input.sessionID) return false
      if (input?.running === true && job.info.status !== "running") return false
      return true
    })
    return yield* Effect.forEach(matched, (job) => snapshotWithOutput(job))
  })

  const start: Interface["start"] = <Value = unknown>(input: StartInput<Value>) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const started_at = yield* Clock.currentTimeMillis
        const done = yield* Deferred.make<Info<any>>()
        const backgrounded = yield* Deferred.make<Info<any>>()
        const acknowledged = yield* Deferred.make<void>()
        const sessionID = resolveSessionID(input)
        const result = yield* SynchronizedRef.modifyEffect(
          state.jobs,
          Effect.fnUntraced(function* (jobs): Effect.fn.Return<readonly [StartResult, Map<string, Active>]> {
            const existing = jobs.get(input.id)
            if (existing?.info.status === "running") {
              const updated: Active = {
                ...existing,
                info: {
                  ...existing.info,
                  ...(existing.info.sessionID === undefined && sessionID !== undefined ? { sessionID } : {}),
                },
                recovery: input.recovery ?? existing.recovery,
                output: input.output ?? existing.output,
                stop: input.stop ?? existing.stop,
                onSettle: input.onSettle ?? existing.onSettle,
              }
              return [{ info: snapshot(updated) }, new Map(jobs).set(input.id, updated)]
            }
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
              acknowledged,
              scope,
              blockingSessions: new Map<SessionSchema.ID, number>(),
              isBackgrounded: false,
              notified: false,
              consumed: false,
              recovery: input.recovery,
              output: input.output,
              stop: input.stop,
              onSettle: input.onSettle,
            }
            return [{ info: snapshot(job), scope, created: true }, new Map(jobs).set(input.id, job)]
          }),
        )
        if ("scope" in result) {
          yield* publish(result.info)
          yield* restore(input.run).pipe(
            Effect.exit,
            Effect.flatMap((exit) => settle(input.id, result.scope, exit)),
            Effect.asVoid,
            Effect.forkIn(result.scope, { startImmediately: true }),
          )
        }
        return result.info as Info<Value>
      }),
    )

  const wait: Interface["wait"] = Effect.fn("Job.wait")(function* (input: WaitInput) {
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

  const markBackground = Effect.fnUntraced(function* (job: Active) {
    const shouldDeliver = job.info.status !== "running" && !job.notified && job.onSettle !== undefined
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
    return { next, deliver: shouldDeliver ? job.onSettle : undefined }
  })

  const yieldRunning = Effect.fnUntraced(function* (id: string, generation: Scope.Closeable) {
    const result = yield* SynchronizedRef.modifyEffect(
      state.jobs,
      Effect.fnUntraced(function* (jobs): Effect.fn.Return<readonly [BackgroundResult, Map<string, Active>]> {
        const job = jobs.get(id)
        if (!job || job.scope !== generation || job.info.status !== "running") return [{}, jobs]
        if (job.isBackgrounded) return [{ info: snapshot(job) }, jobs]
        const marked = yield* markBackground(job)
        return [{ info: snapshot(marked.next), backgrounded: job.backgrounded }, new Map(jobs).set(id, marked.next)]
      }),
    )
    if (result.info && result.backgrounded) {
      yield* Deferred.succeed(result.backgrounded, result.info)
      yield* publish(result.info)
    }
    return result.info
  })

  const waitUntilYield = (delayMs: number, deferYield?: Effect.Effect<boolean>): Effect.Effect<void> =>
    delayMs <= 0
      ? Effect.void
      : Effect.gen(function* () {
          yield* Effect.sleep(Duration.millis(delayMs))
          while (deferYield && (yield* deferYield)) {
            yield* Effect.sleep(Duration.millis(Math.max(50, delayMs)))
          }
        })

  const block: Interface["block"] = <Value = unknown>(input: BlockInput) =>
    Effect.gen(function* () {
      const result = yield* SynchronizedRef.modify(state.jobs, (jobs): readonly [BlockStart, Map<string, Active>] => {
        const job = jobs.get(input.id)
        if (!job) return [{ type: "missing" }, jobs]
        if (job.isBackgrounded) return [{ type: "backgrounded", info: snapshot(job) }, jobs]
        if (job.info.status !== "running")
          return [{ type: "finished", info: snapshot(job) }, consumeJob(jobs, input.id, job.scope)]
        return [
          { type: "wait", wait: { done: job.done, backgrounded: job.backgrounded, generation: job.scope } },
          new Map(jobs).set(input.id, {
            ...job,
            blockingSessions: incrementSession(job.blockingSessions, input.sessionID),
          }),
        ]
      })
      if (result.type === "missing") return undefined
      if (result.type === "finished") return { type: "finished" as const, info: result.info as Info<Value> }
      if (result.type === "backgrounded") return { type: "backgrounded" as const, info: result.info as Info<Value> }
      return yield* Effect.gen(function* () {
        // A steer that landed while tool-call JSON was streaming or the job was starting yields on arrival here.
        if (Option.isSome(database) && (yield* SessionInbox.hasUserSteer(database.value.db, input.sessionID)))
          yield* backgroundAll({ sessionID: input.sessionID })
        const waitYield =
          input.yield_after === undefined
            ? Effect.never
            : waitUntilYield(input.yield_after, input.deferYield).pipe(
                Effect.andThen(yieldRunning(input.id, result.wait.generation)),
                Effect.andThen(Effect.never),
              )
        const settled = yield* Effect.raceFirst(
          Effect.raceFirst(Deferred.await(result.wait.done), Deferred.await(result.wait.backgrounded)),
          waitYield,
        )
        // Decide foreground vs background ownership under the registry lock: once isBackgrounded is committed,
        // block returns backgrounded even if completion also resolved, so the background observer owns delivery.
        return yield* SynchronizedRef.modify(
          state.jobs,
          (jobs): readonly [BlockResult<Value>, Map<string, Active>] => {
            const job = jobs.get(input.id)
            if (!job || job.scope !== result.wait.generation)
              return [{ type: "finished", info: settled as Info<Value> }, jobs]
            if (job.isBackgrounded) return [{ type: "backgrounded", info: snapshot<Value>(job) }, jobs]
            return [
              { type: "finished", info: snapshot<Value>(job) },
              consumeJob(jobs, input.id, result.wait.generation),
            ]
          },
        )
      }).pipe(Effect.ensuring(removeBlock(input)))
    })

  const background: Interface["background"] = Effect.fn("Job.background")(function* (id: string) {
    const result = yield* SynchronizedRef.modifyEffect(
      state.jobs,
      Effect.fnUntraced(function* (jobs): Effect.fn.Return<readonly [BackgroundResult, Map<string, Active>]> {
        const job = jobs.get(id)
        // Recoverable work may finish before the caller backgrounds it, unless a foreground block already consumed it.
        if (!job || job.consumed || (job.info.status !== "running" && !job.recovery)) return [{}, jobs]
        if (job.isBackgrounded) return [{ info: snapshot(job) }, jobs]
        const marked = yield* markBackground(job)
        return [
          { info: snapshot(marked.next), backgrounded: job.backgrounded, deliver: marked.deliver },
          new Map(jobs).set(id, marked.next),
        ]
      }),
    )
    if (result.info && result.backgrounded) yield* Deferred.succeed(result.backgrounded, result.info)
    if (result.info) {
      yield* deliverSettlement(result.info, result.deliver)
      yield* publish(result.info)
    }
    return result.info
  })

  const backgroundAll: Interface["backgroundAll"] = Effect.fn("Job.backgroundAll")(function* (input) {
    const result = yield* SynchronizedRef.modifyEffect(
      state.jobs,
      Effect.fnUntraced(function* (jobs): Effect.fn.Return<
        readonly [Array<{ info: Info<any>; backgrounded: Deferred.Deferred<Info<any>> }>, Map<string, Active>]
      > {
        const results: Array<{ info: Info<any>; backgrounded: Deferred.Deferred<Info<any>> }> = []
        const next = new Map(jobs)
        for (const [id, job] of jobs) {
          if (job.info.status !== "running") continue
          if (job.isBackgrounded) continue
          if (input.type !== undefined && job.info.type !== input.type) continue
          if (!job.blockingSessions.has(input.sessionID)) continue
          const marked = yield* markBackground(job)
          results.push({ info: snapshot(marked.next), backgrounded: job.backgrounded })
          next.set(id, marked.next)
        }
        return [results, next]
      }),
    )
    yield* Effect.forEach(
      result,
      (item) => Effect.andThen(Deferred.succeed(item.backgrounded, item.info), publish(item.info)),
      { discard: true },
    )
    return result.map((item) => item.info)
  })

  const cancel: Interface["cancel"] = Effect.fn("Job.cancel")(function* (id: string, options?: CancelOptions) {
    const current = (yield* SynchronizedRef.get(state.jobs)).get(id)
    const partial = current && current.info.status === "running" ? yield* readLiveOutput(current) : undefined
    const completed_at = yield* Clock.currentTimeMillis
    const notify = options?.notify !== false
    const result = yield* SynchronizedRef.modifyEffect(
      state.jobs,
      Effect.fnUntraced(function* (jobs): Effect.fn.Return<readonly [FinishResult, Map<string, Active>]> {
        const job = jobs.get(id)
        if (!job) return [{}, jobs]
        if (job.info.status !== "running") return [{ info: snapshot(job), generation: job.scope }, jobs]
        const shouldDeliver = notify && job.isBackgrounded && !job.notified && job.onSettle !== undefined
        const clearMarker = !notify && job.info.notificationID !== undefined
        const { notificationID: droppedNotificationID, ...restInfo } = job.info
        if (clearMarker && droppedNotificationID) yield* kv.remove(`${backgroundPrefix}${droppedNotificationID}`)
        const next: Active = {
          ...job,
          notified: job.notified || shouldDeliver || !notify,
          blockingSessions: new Map<SessionSchema.ID, number>(),
          info: {
            ...(clearMarker ? restInfo : job.info),
            status: "cancelled" as const,
            completed_at,
            ...(partial !== undefined && partial !== "" ? { output: partial } : {}),
          },
        }
        if (!clearMarker) yield* persistBackground(next)
        return [
          {
            info: snapshot(next),
            done: job.done,
            acknowledged: !shouldDeliver ? job.acknowledged : undefined,
            scope: job.scope,
            generation: job.scope,
            stop: job.stop,
            deliver: shouldDeliver ? job.onSettle : undefined,
          },
          new Map(jobs).set(id, next),
        ]
      }),
    )
    if (result.info && result.done) yield* Deferred.succeed(result.done, result.info)
    if (result.stop) yield* result.stop.pipe(Effect.setContext(baseContext), Effect.ignoreCause)
    if (result.scope) yield* Scope.close(result.scope, Exit.void)
    if (result.acknowledged) yield* Deferred.succeed(result.acknowledged, undefined)
    if (result.info) {
      yield* deliverSettlement(result.info, result.deliver)
      yield* publish(result.info)
    }
    if (result.generation) yield* consume(id, result.generation)
    return result.info
  })

  const pendingBackground: Interface["pendingBackground"] = Effect.gen(function* () {
    const recovered: Background[] = []
    let after: string | undefined
    do {
      const page = yield* kv.scan({ prefix: backgroundPrefix, after })
      recovered.push(...Array.filterMap(page.entries, (entry) => decodeBackground(entry.value)))
      after = page.next
    } while (after)
    return recovered
  }).pipe(Effect.withSpan("Job.pendingBackground"))

  const cancelSession: Interface["cancelSession"] = Effect.fn("Job.cancelSession")(function* (sessionID) {
    const jobs = yield* SynchronizedRef.get(state.jobs)
    const ids = [...jobs.values()]
      .filter(
        (job) =>
          job.info.status === "running" &&
          (job.info.sessionID === sessionID || matchesSession(job.recovery, sessionID)),
      )
      .map((job) => job.info.id)
    const cancelled = yield* Effect.forEach(ids, (id) => cancel(id, { notify: false }))
    const markers = (yield* pendingBackground).filter((marker) => matchesSession(marker.recovery, sessionID))
    yield* Effect.forEach(markers, (marker) => completeBackground(marker.notificationID), { discard: true })
    return cancelled.filter((info): info is Info => info !== undefined)
  })

  const activeSessions: Interface["activeSessions"] = SynchronizedRef.get(state.jobs).pipe(
    Effect.map(
      (jobs) =>
        new Set(
          [...jobs.values()].flatMap((job) =>
            job.info.status === "running" && job.info.sessionID !== undefined ? [job.info.sessionID] : [],
          ),
        ),
    ),
    Effect.withSpan("Job.activeSessions"),
  )

  const awaitSessionBackground: Interface["awaitSessionBackground"] = Effect.fn("Job.awaitSessionBackground")(
    function* (sessionID) {
      while (true) {
        const owned = [...(yield* SynchronizedRef.get(state.jobs)).values()].filter(
          (job) =>
            job.isBackgrounded &&
            job.info.sessionID === sessionID &&
            (job.info.status === "running" || !Deferred.isDoneUnsafe(job.acknowledged)),
        )
        if (owned.length === 0) return
        yield* Effect.forEach(
          owned,
          (job) =>
            job.info.status === "running"
              ? Deferred.await(job.done).pipe(Effect.andThen(Deferred.await(job.acknowledged)))
              : Deferred.await(job.acknowledged),
          { discard: true },
        )
      }
    },
  )

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
    activeSessions,
    awaitSessionBackground,
    pendingBackground,
    runningBackground,
    completeBackground,
  })
})

const layer = Layer.effect(Service, make)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, KV.node, Bus.node] })
