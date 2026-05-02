import { InstanceState } from "@/effect/instance-state"
import { Identifier } from "@/id/id"
import { Cause, Deferred, Effect, Fiber, Layer, Scope, Context } from "effect"

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
  jobs: Map<string, Active>
  scope: Scope.Scope
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
          jobs: new Map(),
          scope: yield* Scope.Scope,
        }
      }),
    )

    const finish = Effect.fn("BackgroundJob.finish")(function* (
      job: Active,
      status: Exclude<Status, "running">,
      data?: { output?: string; error?: string },
    ) {
      if (job.info.status !== "running") return snapshot(job)
      job.info.status = status
      job.info.completed_at = Date.now()
      if (data?.output !== undefined) job.info.output = data.output
      if (data?.error !== undefined) job.info.error = data.error
      job.fiber = undefined
      const info = snapshot(job)
      yield* Deferred.succeed(job.done, info).pipe(Effect.ignore)
      return info
    })

    const list: Interface["list"] = Effect.fn("BackgroundJob.list")(function* () {
      const s = yield* InstanceState.get(state)
      return Array.from(s.jobs.values())
        .map(snapshot)
        .toSorted((a, b) => a.started_at - b.started_at)
    })

    const get: Interface["get"] = Effect.fn("BackgroundJob.get")(function* (id) {
      const s = yield* InstanceState.get(state)
      const job = s.jobs.get(id)
      if (!job) return
      return snapshot(job)
    })

    const start: Interface["start"] = Effect.fn("BackgroundJob.start")(function* (input) {
      const s = yield* InstanceState.get(state)
      const id = input.id ?? Identifier.ascending("job")
      const existing = s.jobs.get(id)
      if (existing?.info.status === "running") return snapshot(existing)

      const job: Active = {
        info: {
          id,
          type: input.type,
          title: input.title,
          status: "running",
          started_at: Date.now(),
          metadata: input.metadata,
        },
        done: yield* Deferred.make<Info>(),
      }
      s.jobs.set(id, job)
      job.fiber = yield* input.run.pipe(
        Effect.matchCauseEffect({
          onSuccess: (output) => finish(job, "completed", { output }),
          onFailure: (cause) =>
            finish(job, Cause.hasInterruptsOnly(cause) ? "cancelled" : "error", {
              error: errorText(Cause.squash(cause)),
            }),
        }),
        Effect.asVoid,
        Effect.forkIn(s.scope),
      )
      return snapshot(job)
    })

    const wait: Interface["wait"] = Effect.fn("BackgroundJob.wait")(function* (input) {
      const s = yield* InstanceState.get(state)
      const job = s.jobs.get(input.id)
      if (!job) return { timedOut: false }
      if (job.info.status !== "running") return { info: snapshot(job), timedOut: false }
      if (!input.timeout) return { info: yield* Deferred.await(job.done), timedOut: false }
      return yield* Effect.raceAll([
        Deferred.await(job.done).pipe(Effect.map((info) => ({ info, timedOut: false }))),
        Effect.sleep(input.timeout).pipe(Effect.as({ info: snapshot(job), timedOut: true })),
      ])
    })

    const cancel: Interface["cancel"] = Effect.fn("BackgroundJob.cancel")(function* (id) {
      const s = yield* InstanceState.get(state)
      const job = s.jobs.get(id)
      if (!job) return
      if (job.info.status !== "running") return snapshot(job)
      const fiber = job.fiber
      const info = yield* finish(job, "cancelled")
      if (fiber) yield* Fiber.interrupt(fiber).pipe(Effect.ignore)
      return info
    })

    return Service.of({ list, get, start, wait, cancel })
  }),
)

export const defaultLayer = layer

export * as BackgroundJob from "./job"
