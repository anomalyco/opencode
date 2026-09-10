import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Effect } from "effect"
import { BackgroundJob } from "@/background/job"
import { SessionClosure } from "@/session/closure/coordinator"
import { answered, noAnswer, syntheticAdmission } from "../lib/background"
import { admittingClosure } from "../lib/closure"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(BackgroundJob.node, [[SessionClosure.node, admittingClosure]]))

describe("background.job", () => {
  it.instance("tracks started jobs through completion", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const latch = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        admission: syntheticAdmission(),
        type: "test",
        title: "test job",
        run: Deferred.await(latch).pipe(Effect.as(answered("m1", 100, "done"))),
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
        admission: syntheticAdmission(),
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
            admission: syntheticAdmission(),
            id,
            type: "test",
            run: Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
          }),
          jobs.start({
            admission: syntheticAdmission(),
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

  it.instance("waits for extensions before completing a running job", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const first = yield* Deferred.make<void>()
      const second = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        admission: syntheticAdmission(),
        type: "test",
        run: Deferred.await(first).pipe(Effect.as(answered("m1", 100, "first"))),
      })

      expect(
        yield* jobs.extend({
          admission: syntheticAdmission(),
          id: job.id,
          run: Deferred.await(second).pipe(Effect.as(answered("m2", 200, "second"))),
        }),
      ).toBe(true)
      yield* Deferred.succeed(first, undefined)
      expect((yield* jobs.get(job.id))?.status).toBe("running")

      yield* Deferred.succeed(second, undefined)
      const done = yield* jobs.wait({ id: job.id })
      expect(done.info?.status).toBe("completed")
      // The inline slot carries the first answer in conversation order - the one the caller blocked
      // on this job was waiting for - and the later answer stays retained rather than replacing it.
      expect(done.info?.output).toBe("first")
    }),
  )

  it.instance("runs a supplemental sequence without waiting for the previous one", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const first = yield* Deferred.make<void>()
      const extended = yield* Deferred.make<void>()
      const order: string[] = []
      const job = yield* jobs.start({
        admission: syntheticAdmission(),
        type: "test",
        run: Effect.sync(() => order.push("start")).pipe(
          Effect.andThen(Deferred.await(first)),
          Effect.as(answered("m1", 100, "first")),
        ),
      })

      expect(
        yield* jobs.extend({
          admission: syntheticAdmission(),
          id: job.id,
          run: Effect.sync(() => order.push("extend")).pipe(
            Effect.andThen(Deferred.succeed(extended, undefined)),
            Effect.as(answered("m2", 200, "second")),
          ),
        }),
      ).toBe(true)

      // Several runs on one lifetime can now be in flight at once: this resolves while the first run
      // is still parked on its latch. Previously an extension could not begin until the run before
      // it had settled, and awaiting this signal here would deadlock.
      yield* Deferred.await(extended).pipe(Effect.timeout("5 seconds"))
      expect(order).toEqual(["start", "extend"])

      yield* Deferred.succeed(first, undefined)
      // Execution ran the extension first, but delivery follows conversation order, so the inline
      // slot carries the earlier answer rather than the one that happened to settle first.
      expect((yield* jobs.wait({ id: job.id })).info?.output).toBe("first")
    }),
  )

  it.instance("rejects extensions after a job completes", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const job = yield* jobs.start({
        admission: syntheticAdmission(),
        type: "test",
        run: Effect.succeed(answered("m1", 100, "done")),
      })
      yield* jobs.wait({ id: job.id })

      expect(
        yield* jobs.extend({
          admission: syntheticAdmission(),
          id: job.id,
          run: Effect.succeed(answered("m2", 200, "late")),
        }),
      ).toBe(false)
      expect((yield* jobs.get(job.id))?.output).toBe("done")
    }),
  )

  it.instance("records failed jobs", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const job = yield* jobs.start({
        admission: syntheticAdmission(),
        type: "test",
        run: Effect.fail(new Error("boom")),
      })

      const result = yield* jobs.wait({ id: job.id })

      expect(result.info?.status).toBe("error")
      expect(result.info?.error).toBe("boom")
    }),
  )

  it.instance("ignores stale settlements after restarting a failed job", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const fail = yield* Deferred.make<void>()
      const interrupted = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const id = "job_test"
      yield* jobs.start({
        admission: syntheticAdmission(),
        id,
        type: "test",
        run: Deferred.await(fail).pipe(Effect.andThen(Effect.fail(new Error("boom")))),
      })
      yield* jobs.extend({
        admission: syntheticAdmission(),
        id,
        run: Effect.never.pipe(
          Effect.ensuring(Deferred.succeed(interrupted, undefined).pipe(Effect.andThen(Deferred.await(release)))),
        ),
      })

      yield* Deferred.succeed(fail, undefined)
      expect((yield* jobs.wait({ id })).info?.status).toBe("error")
      yield* Deferred.await(interrupted)
      yield* jobs.start({ admission: syntheticAdmission(), id, type: "test", run: Effect.never })

      yield* Deferred.succeed(release, undefined)
      yield* Effect.yieldNow
      expect((yield* jobs.get(id))?.status).toBe("running")
      yield* jobs.cancel(id)
    }),
  )

  it.instance("can cancel running jobs", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const interrupted = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        admission: syntheticAdmission(),
        type: "test",
        run: Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined))),
      })
      yield* jobs.extend({
        admission: syntheticAdmission(),
        id: job.id,
        run: Effect.never,
      })

      const cancelled = yield* jobs.cancel(job.id)

      expect(cancelled?.status).toBe("cancelled")
      yield* Deferred.await(interrupted).pipe(Effect.timeout("1 second"))
      expect((yield* jobs.get(job.id))?.status).toBe("cancelled")
    }),
  )

  it.instance("promotes running jobs without interrupting them", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const latch = yield* Deferred.make<void>()
      const promoted = yield* Deferred.make<void>()
      const started = yield* jobs.startExact({
        admission: syntheticAdmission(),
        type: "test",
        metadata: { parentSessionId: "parent" },
        onPromote: Deferred.succeed(promoted, undefined).pipe(Effect.asVoid),
        run: Deferred.await(latch).pipe(Effect.as(answered("m1", 100, "done"))),
      })
      const job = started.info
      const handle = started.handle
      expect(handle).toBeDefined()
      if (!handle) return

      const info = yield* jobs.promote(job.id)

      expect(info?.status).toBe("running")
      expect(info?.metadata?.background).toBe(true)
      yield* Deferred.await(promoted)
      expect((yield* jobs.get(job.id))?.status).toBe("running")

      yield* Deferred.succeed(latch, undefined)
      // Promotion moves delivery to the observer: the answer is published for it to take one at a
      // time, and the terminal carries no inline payload, because an inline payload is only for a
      // caller blocked on the job.
      const delivered = yield* jobs.waitAnswer({ handle, after: 0 })
      expect(delivered.answer?.detected).toBe("done")
      expect((yield* jobs.wait({ id: job.id })).info?.output).toBeUndefined()
    }),
  )

  it.instance("returns immutable snapshots", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const job = yield* jobs.start({
        admission: syntheticAdmission(),
        type: "test",
        metadata: { value: "initial" },
        run: Effect.succeed(noAnswer),
      })

      if (job.metadata) job.metadata.value = "changed"

      expect((yield* jobs.get(job.id))?.metadata?.value).toBe("initial")
    }),
  )
})
