export * as Job from "./job"

import { Cause, Clock, Context, Deferred, Effect, Exit, Layer, Scope, SynchronizedRef } from "effect"
import { makeGlobalNode } from "./effect/app-node"
import { Identifier } from "./id/id"
import { SessionSchema } from "./session/schema"

export type Status = "running" | "completed" | "error" | "cancelled"

export type Info = {
  id: string
  type: string
  title?: string
  status: Status
  started_at: number
  completed_at?: number
  output?: string
  error?: string
  metadata?: Record<string, unknown>
}

type Active = {
  info: Info
  done: Deferred.Deferred<Info>
  backgrounded: Deferred.Deferred<Info>
  scope: Scope.Closeable
  token: object
  blockingSessions: Map<SessionSchema.ID, number>
  isBackgrounded: boolean
}

type State = {
  jobs: SynchronizedRef.SynchronizedRef<Map<string, Active>>
  scope: Scope.Scope
}

type FinishResult = {
  info?: Info
  done?: Deferred.Deferred<Info>
  scope?: Scope.Closeable
}

type BackgroundResult = {
  info?: Info
  backgrounded?: Deferred.Deferred<Info>
}

type StartResult = { info: Info } | { info: Info; scope: Scope.Closeable; token: object }

type BlockWait = {
  done: Deferred.Deferred<Info>
  backgrounded: Deferred.Deferred<Info>
}

type BlockStart =
  | { type: "missing" }
  | { type: "finished"; info: Info }
  | { type: "backgrounded"; info: Info }
  | { type: "wait"; wait: BlockWait }

export type StartInput = {
  id?: string
  type: string
  title?: string
  metadata?: Record<string, unknown>
  run: Effect.Effect<string, unknown>
}

export type WaitInput = {
  id: string
  timeout?: number
}

export type WaitResult = {
  info?: Info
  timedOut: boolean
}

export type BlockInput = {
  id: string
  sessionID: SessionSchema.ID
}

export type BlockResult = { type: "finished"; info: Info } | { type: "backgrounded"; info: Info }

export type BackgroundAllInput = {
  sessionID: SessionSchema.ID
  type?: string
}

export interface Interface {
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (id: string) => Effect.Effect<Info | undefined>
  readonly start: (input: StartInput) => Effect.Effect<Info>
  readonly wait: (input: WaitInput) => Effect.Effect<WaitResult>
  readonly block: (input: BlockInput) => Effect.Effect<BlockResult | undefined>
  readonly background: (id: string) => Effect.Effect<Info | undefined>
  readonly backgroundAll: (input: BackgroundAllInput) => Effect.Effect<Info[]>
  readonly cancel: (id: string) => Effect.Effect<Info | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Job") {}

function snapshot(job: Active): Info {
  return {
    ...job.info,
    ...(job.info.metadata ? { metadata: { ...job.info.metadata } } : {}),
  }
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
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
 * Makes one scoped, process-local registry. Entries are intentionally not
 * durable: process restart or owner-scope closure loses status and interrupts
 * live work. Persisted observation, restart recovery, and remote workers need a
 * separate durable ownership slice rather than pretending this registry has
 * those semantics.
 */
export const make = Effect.gen(function* () {
  const state: State = {
    jobs: yield* SynchronizedRef.make(new Map()),
    scope: yield* Scope.Scope,
  }

  const settle = Effect.fn("Job.settle")(function* (id: string, token: object, exit: Exit.Exit<string, unknown>) {
    const completed_at = yield* Clock.currentTimeMillis
    const result = yield* SynchronizedRef.modify(state.jobs, (jobs): readonly [FinishResult, Map<string, Active>] => {
      const job = jobs.get(id)
      if (!job) return [{}, jobs]
      if (job.token !== token) return [{}, jobs]
      if (job.info.status !== "running") return [{ info: snapshot(job) }, jobs]
      const status: Exclude<Status, "running"> = Exit.isSuccess(exit)
        ? "completed"
        : Cause.hasInterruptsOnly(exit.cause)
          ? "cancelled"
          : "error"
      const next = {
        ...job,
        blockingSessions: new Map<SessionSchema.ID, number>(),
        info: {
          ...job.info,
          status,
          completed_at,
          ...(Exit.isSuccess(exit) ? { output: exit.value } : {}),
          ...(Exit.isFailure(exit) ? { error: errorText(Cause.squash(exit.cause)) } : {}),
        },
      }
      return [{ info: snapshot(next), done: job.done, scope: job.scope }, new Map(jobs).set(id, next)]
    })
    if (result.info && result.done) yield* Deferred.succeed(result.done, result.info).pipe(Effect.ignore)
    if (result.scope) {
      yield* Scope.close(result.scope, Exit.void).pipe(Effect.forkIn(state.scope, { startImmediately: true }))
    }
    return result.info
  })

  const fork = Effect.fn("Job.fork")(function* (
    scope: Scope.Scope,
    id: string,
    token: object,
    run: Effect.Effect<string, unknown>,
  ) {
    return yield* run.pipe(
      Effect.matchCauseEffect({
        onSuccess: (output) => settle(id, token, Exit.succeed(output)),
        onFailure: (cause) => settle(id, token, Exit.failCause(cause)),
      }),
      Effect.asVoid,
      Effect.forkIn(scope, { startImmediately: true }),
    )
  })

  const list: Interface["list"] = Effect.fn("Job.list")(function* () {
    return Array.from((yield* SynchronizedRef.get(state.jobs)).values())
      .map(snapshot)
      .toSorted((a, b) => a.started_at - b.started_at)
  })

  const get: Interface["get"] = Effect.fn("Job.get")(function* (id) {
    const job = (yield* SynchronizedRef.get(state.jobs)).get(id)
    if (!job) return undefined
    return snapshot(job)
  })

  const start: Interface["start"] = Effect.fn("Job.start")(function* (input) {
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const id = input.id ?? Identifier.ascending("job")
        const started_at = yield* Clock.currentTimeMillis
        const done = yield* Deferred.make<Info>()
        const backgrounded = yield* Deferred.make<Info>()
        const result = yield* SynchronizedRef.modifyEffect(
          state.jobs,
          Effect.fnUntraced(function* (jobs) {
            const existing = jobs.get(id)
            if (existing?.info.status === "running") {
              return [{ info: snapshot(existing) }, jobs] as readonly [StartResult, Map<string, Active>]
            }
            const scope = yield* Scope.fork(state.scope, "parallel")
            const token = {}
            const job = {
              info: {
                id,
                type: input.type,
                title: input.title,
                status: "running" as const,
                started_at,
                metadata: input.metadata,
              },
              done,
              backgrounded,
              scope,
              token,
              blockingSessions: new Map<SessionSchema.ID, number>(),
              isBackgrounded: false,
            }
            return [{ info: snapshot(job), scope, token }, new Map(jobs).set(id, job)] as readonly [
              StartResult,
              Map<string, Active>,
            ]
          }),
        )
        if ("scope" in result) yield* fork(result.scope, id, result.token, restore(input.run))
        return result.info
      }),
    )
  })

  const wait: Interface["wait"] = Effect.fn("Job.wait")(function* (input) {
    const job = (yield* SynchronizedRef.get(state.jobs)).get(input.id)
    if (!job) return { timedOut: false }
    if (job.info.status !== "running") return { info: snapshot(job), timedOut: false }
    if (input.timeout === undefined) return { info: yield* Deferred.await(job.done), timedOut: false }
    if (input.timeout <= 0) return { info: snapshot(job), timedOut: true }
    const info = yield* Deferred.await(job.done).pipe(Effect.timeoutOption(input.timeout))
    if (info._tag === "Some") return { info: info.value, timedOut: false }
    return { info: snapshot(job), timedOut: true }
  })

  const removeBlock = Effect.fn("Job.removeBlock")(function* (input: BlockInput) {
    yield* SynchronizedRef.update(state.jobs, (jobs) => {
      const job = jobs.get(input.id)
      if (!job || job.info.status !== "running" || job.isBackgrounded) return jobs
      return new Map(jobs).set(input.id, {
        ...job,
        blockingSessions: decrementSession(job.blockingSessions, input.sessionID),
      })
    })
  })

  const block: Interface["block"] = Effect.fn("Job.block")(function* (input) {
    const result = yield* SynchronizedRef.modify(state.jobs, (jobs): readonly [BlockStart, Map<string, Active>] => {
      const job = jobs.get(input.id)
      if (!job) return [{ type: "missing" }, jobs]
      if (job.info.status !== "running") return [{ type: "finished", info: snapshot(job) }, jobs]
      if (job.isBackgrounded) return [{ type: "backgrounded", info: snapshot(job) }, jobs]
      return [
        { type: "wait", wait: { done: job.done, backgrounded: job.backgrounded } },
        new Map(jobs).set(input.id, {
          ...job,
          blockingSessions: incrementSession(job.blockingSessions, input.sessionID),
        }),
      ]
    })
    if (result.type === "missing") return undefined
    if (result.type === "finished") return { type: "finished", info: result.info }
    if (result.type === "backgrounded") return { type: "backgrounded", info: result.info }
    return yield* Effect.raceFirst(
      Deferred.await(result.wait.done).pipe(Effect.map((info) => ({ type: "finished" as const, info }))),
      Deferred.await(result.wait.backgrounded).pipe(Effect.map((info) => ({ type: "backgrounded" as const, info }))),
    ).pipe(Effect.ensuring(removeBlock(input)))
  })

  const background: Interface["background"] = Effect.fn("Job.background")(function* (id) {
    const result = yield* SynchronizedRef.modify(
      state.jobs,
      (jobs): readonly [BackgroundResult, Map<string, Active>] => {
        const job = jobs.get(id)
        if (!job || job.info.status !== "running") return [{}, jobs]
        if (job.isBackgrounded) return [{ info: snapshot(job) }, jobs]
        const next = {
          ...job,
          isBackgrounded: true,
          blockingSessions: new Map<SessionSchema.ID, number>(),
        }
        return [{ info: snapshot(next), backgrounded: job.backgrounded }, new Map(jobs).set(id, next)]
      },
    )
    if (result.info && result.backgrounded)
      yield* Deferred.succeed(result.backgrounded, result.info).pipe(Effect.ignore)
    return result.info
  })

  const backgroundAll: Interface["backgroundAll"] = Effect.fn("Job.backgroundAll")(function* (input) {
    const result = yield* SynchronizedRef.modify(
      state.jobs,
      (jobs): readonly [BackgroundResult[], Map<string, Active>] => {
        const results: BackgroundResult[] = []
        const next = new Map(jobs)
        for (const [id, job] of jobs) {
          if (job.info.status !== "running") continue
          if (job.isBackgrounded) continue
          if (input.type !== undefined && job.info.type !== input.type) continue
          if (!job.blockingSessions.has(input.sessionID)) continue
          const updated = {
            ...job,
            isBackgrounded: true,
            blockingSessions: new Map<SessionSchema.ID, number>(),
          }
          results.push({ info: snapshot(updated), backgrounded: job.backgrounded })
          next.set(id, updated)
        }
        return [results, next]
      },
    )
    yield* Effect.forEach(
      result,
      (item) => (item.info && item.backgrounded ? Deferred.succeed(item.backgrounded, item.info) : Effect.void),
      { discard: true },
    )
    return result.flatMap((item) => (item.info ? [item.info] : []))
  })

  const cancel: Interface["cancel"] = Effect.fn("Job.cancel")(function* (id) {
    const completed_at = yield* Clock.currentTimeMillis
    const result = yield* SynchronizedRef.modify(state.jobs, (jobs): readonly [FinishResult, Map<string, Active>] => {
      const job = jobs.get(id)
      if (!job) return [{}, jobs]
      if (job.info.status !== "running") return [{ info: snapshot(job) }, jobs]
      const next = {
        ...job,
        blockingSessions: new Map<SessionSchema.ID, number>(),
        info: {
          ...job.info,
          status: "cancelled" as const,
          completed_at,
        },
      }
      return [{ info: snapshot(next), done: job.done, scope: job.scope }, new Map(jobs).set(id, next)]
    })
    if (result.info && result.done) yield* Deferred.succeed(result.done, result.info).pipe(Effect.ignore)
    if (result.scope) yield* Scope.close(result.scope, Exit.void)
    return result.info
  })

  return Service.of({ list, get, start, wait, block, background, backgroundAll, cancel })
})

export const layer = Layer.effect(Service, make)

export const defaultLayer = layer

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
