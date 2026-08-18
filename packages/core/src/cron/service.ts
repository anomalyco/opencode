import { Cause, Clock, Context, Effect, Layer, Queue, Ref } from "effect"
import { CronDeliveryPort, CronError } from "./port"
import { CronJob } from "./job"

interface Interface {
  readonly add: (input: {
    sessionID: string
    prompt: string
    intervalMs: number
    agent?: string
    model?: string
    context?: unknown
  }) => Effect.Effect<CronJob, CronError>
  readonly list: (sessionID: string) => Effect.Effect<ReadonlyArray<CronJob>>
  readonly remove: (sessionID: string, jobId: string) => Effect.Effect<number>
}

export class CronService extends Context.Service<CronService, Interface>()("@opencode/CronService") {}

const sortByNextRun = (jobs: Array<CronJob>) => [...jobs].sort((a, b) => a.nextRunAt - b.nextRunAt)

const BUSY_RETRY_MS = 10_000

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

      if (job.id !== top.id) {
        // A sooner job was inserted during the sleep and won the heap head.
        // Re-queue the job we just popped and re-iterate instead of firing early.
        yield* insertJob(job)
        continue
      }

      const current = yield* Clock.currentTimeMillis

      if (current >= job.expiresAt) continue

      const busy = yield* port.isBusy(job.sessionID, { context: job.context })
      if (busy) {
        const retryMs = job.runCount === 0 ? BUSY_RETRY_MS : job.intervalMs
        yield* insertJob({ ...job, nextRunAt: current + retryMs })
        continue
      }

      yield* port
        .deliver(job.sessionID, job.prompt, { agent: job.agent, model: job.model, context: job.context })
        .pipe(
          Effect.catch((e) =>
            Effect.logError("cron delivery failed", { sessionID: job.sessionID, error: String(e) }),
          ),
          Effect.catchCause((cause) =>
            Cause.hasInterrupts(cause)
              ? Effect.failCause(cause)
              : Effect.logError("cron delivery defect", { sessionID: job.sessionID, cause: Cause.pretty(cause) }),
          ),
          Effect.forkScoped,
        )

      const updated: CronJob = {
        ...job,
        lastRunAt: current,
        runCount: job.runCount + 1,
        nextRunAt: current + job.intervalMs,
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
    context?: unknown
  }) =>
    Effect.gen(function* () {
      if (input.intervalMs < 60_000) {
        return yield* new CronError({ message: "Interval must be at least 1 minute (60s)" })
      }
      const exists = yield* port.exists(input.sessionID)
      if (!exists) {
        return yield* new CronError({ message: `Session ${input.sessionID} not found` })
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
        nextRunAt: now,
        runCount: 0,
        context: input.context,
      }
      const inserted = yield* Ref.modify(heap, (jobs) => {
        const count = jobs.filter((j) => j.sessionID === input.sessionID).length
        if (count >= 50) return [false, jobs] as const
        return [true, sortByNextRun([...jobs, job])] as const
      })
      if (!inserted) {
        return yield* new CronError({ message: "Maximum 50 cron jobs per session" })
      }
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
