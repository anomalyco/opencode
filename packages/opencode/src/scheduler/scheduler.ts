import { Effect, Layer, Ref, Context } from "effect"

export interface ScheduledJob {
  id: string
  cron: string
  command: string
  isActive: boolean
  createdAt: Date
  lastRun?: Date
  nextRun?: Date
  metadata?: Record<string, unknown>
}

export interface ScheduleInput {
  id?: string
  cron: string
  command: string
  metadata?: Record<string, unknown>
}

export interface Interface {
  readonly schedule: (input: ScheduleInput) => Effect.Effect<string>
  readonly unschedule: (id: string) => Effect.Effect<boolean>
  readonly list: () => Effect.Effect<ScheduledJob[]>
  readonly get: (id: string) => Effect.Effect<ScheduledJob | undefined>
  readonly pause: (id: string) => Effect.Effect<boolean>
  readonly resume: (id: string) => Effect.Effect<boolean>
}

const make = Effect.gen(function* () {
  const jobs = yield* Ref.make<Map<string, ScheduledJob>>(new Map())

  const schedule = (input: ScheduleInput) =>
    Effect.gen(function* () {
      const id = input.id ?? `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
      const job: ScheduledJob = {
        id,
        cron: input.cron,
        command: input.command,
        isActive: true,
        createdAt: new Date(),
        metadata: input.metadata,
      }
      yield* Ref.update(jobs, (m) => new Map(m).set(id, job))
      return id
    })

  const unschedule = (id: string) =>
    Ref.modify(jobs, (m) => {
      const next = new Map(m)
      const had = next.delete(id)
      return [had, next]
    })

  const list = () => Ref.get(jobs).pipe(Effect.map((m) => Array.from(m.values())))

  const get = (id: string) => Ref.get(jobs).pipe(Effect.map((m) => m.get(id)))

  const pause = (id: string) =>
    Ref.modify(jobs, (m) => {
      const next = new Map(m)
      const job = next.get(id)
      if (job) next.set(id, { ...job, isActive: false })
      return [Boolean(job), next]
    })

  const resume = (id: string) =>
    Ref.modify(jobs, (m) => {
      const next = new Map(m)
      const job = next.get(id)
      if (job && !job.isActive) next.set(id, { ...job, isActive: true })
      return [Boolean(job && !job.isActive), next]
    })

  return { schedule, unschedule, list, get, pause, resume } satisfies Interface
})

export class Service extends Context.Service<Service, Interface>()("@opencode/Scheduler") {}

export const layer = Layer.effect(Service, make)
export const defaultLayer = layer

export * as Scheduler from "./scheduler"
