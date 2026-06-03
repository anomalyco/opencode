import { InstanceState } from "@/effect/instance-state"
import { Identifier } from "@/id/id"
import { Cause, Clock, Context, Deferred, Effect, Exit, Layer, Scope, SynchronizedRef } from "effect"

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
  scope: Scope.Closeable
  token: object
  pending: number
  next: number
  output?: { sequence: number; text: string }
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

export type StartInput = {
  id?: string
  type: string
  title?: string
  metadata?: Record<string, unknown>
  run: Effect.Effect<string, unknown>
}

export type ExtendInput = {
  id: string
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

export interface Interface {
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (id: string) => Effect.Effect<Info | undefined>
  readonly start: (input: StartInput) => Effect.Effect<Info>
  readonly extend: (input: ExtendInput) => Effect.Effect<boolean>
  readonly wait: (input: WaitInput) => Effect.Effect<WaitResult>
  readonly cancel: (id: string) => Effect.Effect<Info | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/BackgroundJob") {}

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

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<State>(
      Effect.fn("BackgroundJob.state")(function* () {
        return {
          jobs: yield* SynchronizedRef.make(new Map()),
          scope: yield* Scope.Scope,
        }
      }),
    )

    const settle = Effect.fn("BackgroundJob.settle")(function* (
      id: string,
      token: object,
      sequence: number,
      exit: Exit.Exit<string, unknown>,
    ) {
      const completed_at = yield* Clock.currentTimeMillis
      const s = yield* InstanceState.get(state)
      const result = yield* SynchronizedRef.modify(s.jobs, (jobs): readonly [FinishResult, Map<string, Active>] => {
        const job = jobs.get(id)
        if (!job) return [{}, jobs]
        if (job.token !== token) return [{}, jobs]
        if (job.info.status !== "running") return [{ info: snapshot(job) }, jobs]
        const pending = job.pending - 1
        const output =
          Exit.isSuccess(exit) && (!job.output || sequence > job.output.sequence)
            ? { sequence, text: exit.value }
            : job.output
        if (Exit.isSuccess(exit) && pending > 0) {
          return [{}, new Map(jobs).set(id, { ...job, pending, output })]
        }
        const status: Exclude<Status, "running"> = Exit.isSuccess(exit)
          ? "completed"
          : Cause.hasInterruptsOnly(exit.cause)
            ? "cancelled"
            : "error"
        const next = {
          ...job,
          pending: 0,
          output,
          info: {
            ...job.info,
            status,
            completed_at,
            ...(output ? { output: output.text } : {}),
            ...(Exit.isFailure(exit) ? { error: errorText(Cause.squash(exit.cause)) } : {}),
          },
        }
        return [{ info: snapshot(next), done: job.done, scope: job.scope }, new Map(jobs).set(id, next)]
      })
      if (result.info && result.done) yield* Deferred.succeed(result.done, result.info).pipe(Effect.ignore)
      if (result.scope) {
        yield* Scope.close(result.scope, Exit.void).pipe(Effect.forkIn(s.scope, { startImmediately: true }))
      }
      return result.info
    })

    const fork = Effect.fn("BackgroundJob.fork")(function* (
      scope: Scope.Scope,
      id: string,
      token: object,
      sequence: number,
      run: Effect.Effect<string, unknown>,
    ) {
      return yield* run.pipe(
        Effect.matchCauseEffect({
          onSuccess: (output) => settle(id, token, sequence, Exit.succeed(output)),
          onFailure: (cause) => settle(id, token, sequence, Exit.failCause(cause)),
        }),
        Effect.asVoid,
        Effect.forkIn(scope, { startImmediately: true }),
      )
    })

    const list: Interface["list"] = Effect.fn("BackgroundJob.list")(function* () {
      return Array.from((yield* SynchronizedRef.get((yield* InstanceState.get(state)).jobs)).values())
        .map(snapshot)
        .toSorted((a, b) => a.started_at - b.started_at)
    })

    const get: Interface["get"] = Effect.fn("BackgroundJob.get")(function* (id) {
      const job = (yield* SynchronizedRef.get((yield* InstanceState.get(state)).jobs)).get(id)
      if (!job) return
      return snapshot(job)
    })

    const start: Interface["start"] = Effect.fn("BackgroundJob.start")(function* (input) {
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const s = yield* InstanceState.get(state)
          const id = input.id ?? Identifier.ascending("job")
          const started_at = yield* Clock.currentTimeMillis
          const done = yield* Deferred.make<Info>()
          return yield* SynchronizedRef.modifyEffect(
            s.jobs,
            Effect.fnUntraced(function* (jobs) {
              const existing = jobs.get(id)
              if (existing?.info.status === "running") return [snapshot(existing), jobs] as const
              const scope = yield* Scope.fork(s.scope, "parallel")
              const token = {}
              yield* fork(scope, id, token, 0, restore(input.run))
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
                scope,
                token,
                pending: 1,
                next: 1,
              }
              return [snapshot(job), new Map(jobs).set(id, job)] as const
            }),
          )
        }),
      )
    })

    const extend: Interface["extend"] = Effect.fn("BackgroundJob.extend")(function* (input) {
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const s = yield* InstanceState.get(state)
          return yield* SynchronizedRef.modifyEffect(
            s.jobs,
            Effect.fnUntraced(function* (jobs) {
              const job = jobs.get(input.id)
              if (!job || job.info.status !== "running") return [false, jobs] as const
              yield* fork(job.scope, input.id, job.token, job.next, restore(input.run))
              return [
                true,
                new Map(jobs).set(input.id, {
                  ...job,
                  pending: job.pending + 1,
                  next: job.next + 1,
                }),
              ] as const
            }),
          )
        }),
      )
    })

    const wait: Interface["wait"] = Effect.fn("BackgroundJob.wait")(function* (input) {
      const job = (yield* SynchronizedRef.get((yield* InstanceState.get(state)).jobs)).get(input.id)
      if (!job) return { timedOut: false }
      if (job.info.status !== "running") return { info: snapshot(job), timedOut: false }
      if (input.timeout === undefined) return { info: yield* Deferred.await(job.done), timedOut: false }
      if (input.timeout <= 0) return { info: snapshot(job), timedOut: true }
      const info = yield* Deferred.await(job.done).pipe(Effect.timeoutOption(input.timeout))
      if (info._tag === "Some") return { info: info.value, timedOut: false }
      return { info: snapshot(job), timedOut: true }
    })

    const cancel: Interface["cancel"] = Effect.fn("BackgroundJob.cancel")(function* (id) {
      const completed_at = yield* Clock.currentTimeMillis
      const result = yield* SynchronizedRef.modify(
        (yield* InstanceState.get(state)).jobs,
        (jobs): readonly [FinishResult, Map<string, Active>] => {
          const job = jobs.get(id)
          if (!job) return [{}, jobs]
          if (job.info.status !== "running") return [{ info: snapshot(job) }, jobs]
          const next = {
            ...job,
            pending: 0,
            info: {
              ...job.info,
              status: "cancelled" as const,
              completed_at,
            },
          }
          return [{ info: snapshot(next), done: job.done, scope: job.scope }, new Map(jobs).set(id, next)]
        },
      )
      if (result.info && result.done) yield* Deferred.succeed(result.done, result.info).pipe(Effect.ignore)
      if (result.scope) yield* Scope.close(result.scope, Exit.void)
      return result.info
    })

    return Service.of({ list, get, start, extend, wait, cancel })
  }),
)

export const defaultLayer = layer

export * as BackgroundJob from "./job"
