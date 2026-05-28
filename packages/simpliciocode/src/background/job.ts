import { InstanceState } from "@/effect/instance-state"
import { Identifier } from "@/id/id"
import { Cause, Clock, Context, Deferred, Effect, Fiber, Layer, Scope, SynchronizedRef } from "effect"

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
  fiber?: Fiber.Fiber<void, unknown>
}

type State = {
  jobs: SynchronizedRef.SynchronizedRef<Map<string, Active>>
  scope: Scope.Scope
}

type FinishResult = {
  info?: Info
  done?: Deferred.Deferred<Info>
}

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

export interface Interface {
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (id: string) => Effect.Effect<Info | undefined>
  readonly start: (input: StartInput) => Effect.Effect<Info>
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

    const finish = Effect.fn("BackgroundJob.finish")(function* (
      id: string,
      status: Exclude<Status, "running">,
      data?: { output?: string; error?: string },
    ) {
      const completed_at = yield* Clock.currentTimeMillis
      const result = yield* SynchronizedRef.modify(
        (yield* InstanceState.get(state)).jobs,
        (jobs): readonly [FinishResult, Map<string, Active>] => {
          const job = jobs.get(id)
          if (!job) return [{}, jobs]
          if (job.info.status !== "running") return [{ info: snapshot(job) }, jobs]
          const next = {
            ...job,
            fiber: undefined,
            info: {
              ...job.info,
              status,
              completed_at,
              ...(data?.output !== undefined ? { output: data.output } : {}),
              ...(data?.error !== undefined ? { error: data.error } : {}),
            },
          }
          return [{ info: snapshot(next), done: job.done }, new Map(jobs).set(id, next)]
        },
      )
      if (result.info && result.done) yield* Deferred.succeed(result.done, result.info).pipe(Effect.ignore)
      return result.info
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
              const fiber = yield* restore(input.run).pipe(
                Effect.matchCauseEffect({
                  onSuccess: (output) => finish(id, "completed", { output }),
                  onFailure: (cause) =>
                    finish(id, Cause.hasInterruptsOnly(cause) ? "cancelled" : "error", {
                      error: errorText(Cause.squash(cause)),
                    }),
                }),
                Effect.asVoid,
                Effect.forkIn(s.scope, { startImmediately: true }),
              )
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
                fiber,
              }
              return [snapshot(job), new Map(jobs).set(id, job)] as const
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
      const job = (yield* SynchronizedRef.get((yield* InstanceState.get(state)).jobs)).get(id)
      if (!job) return
      if (job.info.status !== "running") return snapshot(job)
      if (job.fiber) {
        yield* Fiber.interrupt(job.fiber).pipe(Effect.ignore)
        yield* Fiber.await(job.fiber).pipe(Effect.ignore)
      }
      const info = yield* finish(id, "cancelled")
      return info
    })

    return Service.of({ list, get, start, wait, cancel })
  }),
)

export const defaultLayer = layer

export * as BackgroundJob from "./job"
