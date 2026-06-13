import { describe, expect } from "bun:test"
import { BackgroundJob } from "@cedric/core/background-job"
import { Deferred, Effect, Exit, Scope } from "effect"
import { it } from "./lib/effect"

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
    }).pipe(Effect.provide(BackgroundJob.layer)),
  )

  it.live("notifies listeners when jobs start and settle", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const latch = yield* Deferred.make<void>()
      const updates: BackgroundJob.Info[] = []
      const unsubscribe = yield* jobs.listen((info) =>
        Effect.sync(() => {
          updates.push(info)
        }),
      )

      const job = yield* jobs.start({
        type: "test",
        run: Deferred.await(latch).pipe(Effect.as("done")),
      })

      yield* Deferred.succeed(latch, undefined)
      yield* jobs.wait({ id: job.id })
      yield* unsubscribe

      expect(updates.map((info) => info.status)).toEqual(["running", "completed"])
      expect(updates[1]?.output).toBe("done")
    }).pipe(Effect.provide(BackgroundJob.layer)),
  )

  it.live("notifies listeners with partial output while extended work remains running", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const first = yield* Deferred.make<void>()
      const second = yield* Deferred.make<void>()
      const partial = yield* Deferred.make<BackgroundJob.Info>()
      const unsubscribe = yield* jobs.listen((info) => {
        if (info.status === "running" && info.output === "first") return Deferred.succeed(partial, info).pipe(Effect.asVoid)
        return Effect.void
      })

      const job = yield* jobs.start({
        type: "test",
        run: Deferred.await(first).pipe(Effect.as("first")),
      })
      expect(yield* jobs.extend({ id: job.id, run: Deferred.await(second).pipe(Effect.as("second")) })).toBe(true)

      yield* Deferred.succeed(first, undefined)
      const running = yield* Deferred.await(partial).pipe(Effect.timeout("1 second"))
      yield* unsubscribe

      expect(running.status).toBe("running")
      expect(running.output).toBe("first")
      expect(running.progress).toBeGreaterThan(10)
      expect(running.progress).toBeLessThan(100)

      yield* Deferred.succeed(second, undefined)
      expect(yield* jobs.wait({ id: job.id })).toMatchObject({
        timedOut: false,
        info: { status: "completed", output: "second", progress: 100 },
      })
    }).pipe(Effect.provide(BackgroundJob.layer)),
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
    }).pipe(Effect.provide(BackgroundJob.layer)),
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
    }).pipe(Effect.provide(BackgroundJob.layer)),
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
