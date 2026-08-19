import { describe, expect } from "bun:test"
import { BackgroundJob } from "@opencode-ai/core/background-job"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Effect, Exit, Scope } from "effect"
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

  it.live("cancels the observed run while it is still the one filed under its id", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const id = "job_lifetime_current"
      const latch = yield* Deferred.make<void>()
      yield* jobs.start({ id, type: "test", run: Deferred.await(latch).pipe(Effect.as("done")) })

      const observed = (yield* jobs.listExact()).filter((entry) => entry.info.id === id)[0]
      expect(observed.info).toMatchObject({ id, type: "test", status: "running" })

      expect(yield* jobs.cancelExact(observed.lifetime)).toMatchObject({ status: "cancelled" })
      expect((yield* jobs.get(id))?.status).toBe("cancelled")
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("leaves the successor alone when the observed run has already been replaced", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const id = "job_lifetime_replaced"
      const first = yield* Deferred.make<void>()
      yield* jobs.start({ id, type: "test", run: Deferred.await(first).pipe(Effect.as("first")) })

      // What a caller sees before it acts.
      const observed = (yield* jobs.listExact()).filter((entry) => entry.info.id === id)[0]

      // That run settles and a second one takes the same id, as a resumed session does.
      yield* Deferred.succeed(first, undefined)
      expect(yield* jobs.wait({ id })).toMatchObject({ info: { status: "completed", output: "first" } })
      const second = yield* Deferred.make<void>()
      yield* jobs.start({ id, type: "test", run: Deferred.await(second).pipe(Effect.as("second")) })

      expect(yield* jobs.cancelExact(observed.lifetime)).toBeUndefined()
      expect((yield* jobs.get(id))?.status).toBe("running")

      yield* Deferred.succeed(second, undefined)
      expect(yield* jobs.wait({ id })).toMatchObject({ info: { status: "completed", output: "second" } })
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("cancels by id whichever run is current, which is why callers that observed one use cancelExact", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const id = "job_lifetime_by_id"
      const first = yield* Deferred.make<void>()
      yield* jobs.start({ id, type: "test", run: Deferred.await(first).pipe(Effect.as("first")) })

      yield* Deferred.succeed(first, undefined)
      expect(yield* jobs.wait({ id })).toMatchObject({ info: { status: "completed", output: "first" } })
      const second = yield* Deferred.make<void>()
      yield* jobs.start({ id, type: "test", run: Deferred.await(second).pipe(Effect.as("second")) })

      expect((yield* jobs.cancel(id))?.status).toBe("cancelled")
      expect((yield* jobs.get(id))?.status).toBe("cancelled")
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
})
