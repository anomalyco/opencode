import { describe, expect } from "bun:test"
import { BackgroundJob } from "@opencode-ai/core/background-job"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Effect, Exit, Option, Scope } from "effect"
import { it } from "./lib/effect"

const jobsLayer = LayerNode.compile(BackgroundJob.node)

describe("BackgroundJob", () => {
  it.live("tracks process-local work through explicit observation", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const latch = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        type: "test",
        metadata: { durable: false },
        run: Deferred.await(latch).pipe(Effect.as("done")),
      })

      expect(job).toMatchObject({ type: "test", status: "running", metadata: { durable: false } })
      expect(yield* jobs.wait({ id: job.id, timeout: 0 })).toMatchObject({
        timedOut: true,
        info: { status: "running" },
      })

      yield* Deferred.succeed(latch, undefined)
      expect(yield* jobs.wait({ id: job.id })).toMatchObject({
        timedOut: false,
        info: { status: "completed", output: "done" },
      })
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("publishes jobs before starting immediately settling work", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service

      yield* Effect.forEach(Array.from({ length: 100 }), (_, index) => {
        const id = `job_immediate_start_${index}`
        return Effect.gen(function* () {
          const job = yield* jobs.start({
            id,
            type: "test",
            run: jobs
              .get(id)
              .pipe(
                Effect.flatMap((info) =>
                  info?.status === "running"
                    ? Effect.succeed(`done-${index}`)
                    : Effect.fail("job started before publish"),
                ),
              ),
          })

          expect(yield* jobs.wait({ id: job.id })).toMatchObject({
            timedOut: false,
            info: { status: "completed", output: `done-${index}` },
          })
        })
      })
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("increments pending work before starting immediately settling extensions", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service

      yield* Effect.forEach(Array.from({ length: 100 }), (_, index) =>
        Effect.gen(function* () {
          const first = yield* Deferred.make<void>()
          const job = yield* jobs.start({
            type: "test",
            run: Deferred.await(first).pipe(Effect.as(`first-${index}`)),
          })

          expect(yield* jobs.extend({ id: job.id, run: Effect.succeed(`second-${index}`) })).toBe(true)
          expect((yield* jobs.get(job.id))?.status).toBe("running")

          yield* Deferred.succeed(first, undefined)
          expect(yield* jobs.wait({ id: job.id })).toMatchObject({
            timedOut: false,
            info: { status: "completed", output: `second-${index}` },
          })
        }),
      )
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("prunes oldest terminal jobs while retaining running work", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const running = yield* jobs.start({ id: "job_running", type: "test", run: Effect.never })
      const completed: string[] = []

      yield* Effect.forEach(
        Array.from({ length: BackgroundJob.RETAINED_TERMINAL_JOBS + 5 }, (_, index) => index),
        (index) =>
          Effect.gen(function* () {
            const id = `job_terminal_${index}`
            yield* jobs.start({ id, type: "test", run: Effect.succeed(`done-${index}`) })
            yield* jobs.wait({ id })
            completed.push(id)
          }),
        { concurrency: 1 },
      )

      const listed = yield* jobs.list()
      expect(listed.some((job) => job.id === running.id)).toBe(true)
      expect(listed.filter((job) => job.status !== "running")).toHaveLength(BackgroundJob.RETAINED_TERMINAL_JOBS)
      expect(listed.some((job) => job.id === completed[0])).toBe(false)
      expect(listed.some((job) => job.id === completed[completed.length - 1])).toBe(true)

      yield* jobs.cancel(running.id)
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("delivers the lossless result once while retaining only a capped preview", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const body = `${"x".repeat(50_000)}END`
      const job = yield* jobs.start({ id: "job_large", type: "test", run: Effect.succeed(body) })

      const done = yield* jobs.wait({ id: job.id })
      expect(done.info?.output).toBe(body)

      const retained = yield* jobs.get(job.id)
      expect(retained?.output?.length).toBeLessThan(body.length)
      expect(retained?.output?.endsWith("END")).toBe(true)
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("interrupts live work without promising settlement after the owning process-local scope closes", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const interrupted = yield* Deferred.make<void>()
      const jobs = yield* BackgroundJob.make.pipe(Scope.provide(scope))
      const job = yield* jobs.start({
        type: "test",
        run: Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined))),
      })

      yield* Scope.close(scope, Exit.void)

      yield* Deferred.await(interrupted).pipe(Effect.timeout("1 second"))
      // The abandoned in-memory registry is not a durable observation channel.
      expect((yield* jobs.get(job.id))?.status).toBe("running")
    }),
  )

  it.live("resolves promotion waiters instead of hanging on missing or settled jobs", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service

      const missing = yield* jobs.waitForPromotion("job_missing").pipe(Effect.exit)
      expect(Exit.findErrorOption(missing).pipe(Option.getOrUndefined)).toBeInstanceOf(BackgroundJob.NotFoundError)

      const job = yield* jobs.start({ id: "job_settled", type: "test", run: Effect.succeed("done") })
      yield* jobs.wait({ id: job.id })

      expect(yield* jobs.waitForPromotion(job.id)).toMatchObject({ status: "completed" })
    }).pipe(Effect.provide(jobsLayer)),
  )
})
