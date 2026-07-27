import { Clock, Context, Effect, Layer, Queue, Ref } from "effect"
import { CronDeliveryPort, CronError } from "./port"
import { CronJob } from "./job"

interface Interface {
  readonly add: (input: {
    sessionID: string
    prompt: string
    intervalMs: number
    agent?: string
    model?: string
  }) => Effect.Effect<CronJob, CronError>
  readonly list: (sessionID: string) => Effect.Effect<ReadonlyArray<CronJob>>
  readonly remove: (sessionID: string, jobId: string) => Effect.Effect<number>
}

export class CronService extends Context.Service<CronService, Interface>()("@opencode/CronService") {}

const sortByNextRun = (jobs: Array<CronJob>) => [...jobs].sort((a, b) => a.nextRunAt - b.nextRunAt)

const make = Effect.gen(function* () {
  const port = yield* CronDeliveryPort
  const heap = yield* Ref.make<Array<CronJob>>([])
  const wakeQueue = yield* Queue.unbounded<void>()

  const insertJob = (job: CronJob) => Ref.update(heap, (jobs) => sortByNextRun([...jobs, job]))

  const dequeueJob = () =>
    Ref.modify(heap, (jobs) => {
      if (jobs.length === 0) return [null as CronJob | null, jobs] as const
      return [jobs[0], jobs.slice(1)] as const
    })

  const heapIsEmpty = () => Ref.get(heap).pipe(Effect.map((jobs) => jobs.length === 0))

  const filterInPlace = (predicate: (job: CronJob) => boolean) =>
    Ref.modify(heap, (jobs) => {
      const kept = jobs.filter(predicate)
      return [jobs.length - kept.length, sortByNextRun(kept)] as const
    })

  const sessionCount = (sessionID: string) =>
    Ref.get(heap).pipe(Effect.map((jobs) => jobs.filter((j) => j.sessionID === sessionID).length))

  const loop = Effect.gen(function* () {
    while (true) {
      const empty = yield* heapIsEmpty()
      if (empty) {
        yield* Queue.take(wakeQueue)
        continue
      }

      const top = yield* Ref.get(heap).pipe(Effect.map((jobs) => jobs[0]))
      const now = yield* Clock.currentTimeMillis
      const waitMs = Math.max(0, top.nextRunAt - now)

      const result = yield* Effect.race(
        Effect.sleep(waitMs).pipe(Effect.as("tick" as const)),
        Queue.take(wakeQueue).pipe(Effect.as("wake" as const)),
      )
      if (result === "wake") continue

      const job = yield* dequeueJob()
      if (!job) continue

      const current = yield* Clock.currentTimeMillis

      if (current >= job.expiresAt) continue

      const busy = yield* port.isBusy(job.sessionID)
      if (busy) {
        yield* insertJob({ ...job, nextRunAt: job.nextRunAt + job.intervalMs })
        continue
      }

      yield* port
        .deliver(job.sessionID, job.prompt, { agent: job.agent, model: job.model })
        .pipe(Effect.forkScoped)

      const updated: CronJob = {
        ...job,
        lastRunAt: current,
        runCount: job.runCount + 1,
        nextRunAt: job.nextRunAt + job.intervalMs,
      }
      yield* insertJob(updated)
    }
  })

  yield* loop.pipe(Effect.forkScoped)

  const add = (input: {
    sessionID: string
    prompt: string
    intervalMs: number
    agent?: string
    model?: string
  }) =>
    Effect.gen(function* () {
      if (input.intervalMs < 60_000) {
        return yield* new CronError({ message: "Interval must be at least 1 minute (60_000 ms)" })
      }
      const exists = yield* port.exists(input.sessionID)
      if (!exists) {
        return yield* new CronError({ message: `Session ${input.sessionID} not found` })
      }
      const count = yield* sessionCount(input.sessionID)
      if (count >= 50) {
        return yield* new CronError({ message: "Maximum 50 cron jobs per session" })
      }
      const now = yield* Clock.currentTimeMillis
      const job: CronJob = {
        id: crypto.randomUUID(),
        sessionID: input.sessionID,
        prompt: input.prompt,
        intervalMs: input.intervalMs,
        agent: input.agent,
        model: input.model,
        createdAt: now,
        expiresAt: now + 7 * 24 * 60 * 60 * 1000,
        nextRunAt: now + input.intervalMs,
        runCount: 0,
      }
      yield* insertJob(job)
      yield* Queue.offer(wakeQueue, undefined)
      return job
    })

  const list = (sessionID: string) =>
    Ref.get(heap).pipe(Effect.map((jobs) => jobs.filter((j) => j.sessionID === sessionID)))

  const remove = (sessionID: string, jobId: string) =>
    Effect.gen(function* () {
      const removed = yield* filterInPlace(
        (j) => j.sessionID !== sessionID || (jobId !== "all" && j.id !== jobId),
      )
      yield* Queue.offer(wakeQueue, undefined)
      return removed
    })

  return CronService.of({ add, list, remove })
})

export const layer = Layer.effect(CronService, make)
