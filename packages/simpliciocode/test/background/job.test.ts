import { describe, expect } from "bun:test"
import { Deferred, Effect } from "effect"
import { BackgroundJob } from "@/background/job"
import { testEffect } from "../lib/effect"

const it = testEffect(BackgroundJob.defaultLayer)

describe("background.job", () => {
  it.instance("tracks started jobs through completion", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const latch = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        type: "test",
        title: "test job",
        run: Deferred.await(latch).pipe(Effect.as("done")),
      })

      expect(job.id.startsWith("job_")).toBe(true)
      expect(job.status).toBe("running")
      expect(job.title).toBe("test job")

      yield* Deferred.succeed(latch, undefined)
      const done = yield* jobs.wait({ id: job.id })

      expect(done.timedOut).toBe(false)
      expect(done.info?.status).toBe("completed")
      expect(done.info?.output).toBe("done")
      expect((yield* jobs.list()).map((item) => item.id)).toEqual([job.id])
    }),
  )

  it.instance("returns a running snapshot when wait times out", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const job = yield* jobs.start({
        type: "test",
        run: Effect.never,
      })

      const result = yield* jobs.wait({ id: job.id, timeout: 1 })

      expect(result.timedOut).toBe(true)
      expect(result.info?.status).toBe("running")
    }),
  )

  it.instance("deduplicates concurrent starts for a running id", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const started = yield* Deferred.make<void>()
      const id = "job_test"
      const [first, second] = yield* Effect.all(
        [
          jobs.start({
            id,
            type: "test",
            run: Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
          }),
          jobs.start({
            id,
            type: "test",
            run: Effect.fail(new Error("duplicate started")),
          }),
        ],
        { concurrency: "unbounded" },
      )

      yield* Deferred.await(started)

      expect(first.id).toBe(id)
      expect(second.id).toBe(id)
      expect(first.status).toBe("running")
      expect(second.status).toBe("running")
      expect((yield* jobs.list()).map((item) => item.id)).toEqual([id])

      yield* jobs.cancel(id)
    }),
  )

  it.instance("records failed jobs", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const job = yield* jobs.start({
        type: "test",
        run: Effect.fail(new Error("boom")),
      })

      const result = yield* jobs.wait({ id: job.id })

      expect(result.info?.status).toBe("error")
      expect(result.info?.error).toBe("boom")
    }),
  )

  it.instance("can cancel running jobs", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const interrupted = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        type: "test",
        run: Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined))),
      })

      const cancelled = yield* jobs.cancel(job.id)

      expect(cancelled?.status).toBe("cancelled")
      yield* Deferred.await(interrupted).pipe(Effect.timeout("1 second"))
      expect((yield* jobs.get(job.id))?.status).toBe("cancelled")
    }),
  )

  it.instance("returns immutable snapshots", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const job = yield* jobs.start({
        type: "test",
        metadata: { value: "initial" },
        run: Effect.succeed("done"),
      })

      if (job.metadata) job.metadata.value = "changed"

      expect((yield* jobs.get(job.id))?.metadata?.value).toBe("initial")
    }),
  )
})
