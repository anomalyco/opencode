import { describe, expect } from "bun:test"
import { Job } from "@opencode-ai/core/job"
import { KV } from "@opencode-ai/core/kv"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Deferred, Effect, Exit, Fiber, Scope } from "effect"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Job.node, KV.node])))

const finishJobs = Effect.fn(function* (count: number) {
  const jobs = yield* Job.Service
  const ids: string[] = []
  for (let index = 0; index < count; index++) {
    const job = yield* jobs.start({ type: "test", run: Effect.succeed(`output-${index}`) })
    expect((yield* jobs.wait({ id: job.id })).info?.output).toBe(`output-${index}`)
    ids.push(job.id)
  }
  return ids
})

describe("Job", () => {
  it.live("bounds consumed terminal results instead of retaining every completed job", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const ids = yield* finishJobs(100)
      const retained = yield* Effect.forEach(ids, jobs.get)
      expect(retained.filter((info) => info !== undefined).map((info) => info.id)).toEqual(ids.slice(-25))
      expect(yield* jobs.wait({ id: ids[0] })).toEqual({ timedOut: false })
    }),
  )

  it.live("preserves running and unconsumed results until a caller receives them", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const running = yield* jobs.start({ type: "test", run: Effect.never })
      const unread = yield* jobs.start({ type: "test", run: Effect.succeed("not received yet") })
      expect(yield* jobs.wait({ id: running.id, timeout: 0 })).toMatchObject({ timedOut: true })
      yield* finishJobs(100)
      expect(yield* jobs.get(running.id)).toMatchObject({ status: "running" })
      expect(yield* jobs.get(unread.id)).toMatchObject({ status: "completed", output: "not received yet" })
      expect(yield* jobs.block({ id: unread.id, sessionID: SessionSchema.ID.make("ses_late_waiter") })).toMatchObject({
        type: "finished",
        info: { output: "not received yet" },
      })
      yield* finishJobs(25)
      expect(yield* jobs.get(unread.id)).toBeUndefined()
      yield* jobs.cancel(running.id)
    }),
  )

  it.live("bounds results received by foreground blocking callers", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const sessionID = SessionSchema.ID.make("ses_foreground_churn")
      const ids: string[] = []
      for (let index = 0; index < 100; index++) {
        const latch = yield* Deferred.make<void>()
        const job = yield* jobs.start({ type: "shell", run: Deferred.await(latch).pipe(Effect.as("done")) })
        const waiter = yield* jobs
          .block({ id: job.id, sessionID })
          .pipe(Effect.forkIn(yield* Scope.Scope, { startImmediately: true }))
        yield* Deferred.succeed(latch, undefined)
        expect(yield* Fiber.join(waiter)).toMatchObject({ type: "finished", info: { output: "done" } })
        ids.push(job.id)
      }
      const retained = yield* Effect.forEach(ids, jobs.get)
      expect(retained.filter((info) => info !== undefined).map((info) => info.id)).toEqual(ids.slice(-25))
    }),
  )

  it.live("evicts consumed errors and cancellations along with successful results", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const failed = yield* jobs.start({ type: "test", run: Effect.fail(new Error("failed")) })
      const cancelled = yield* jobs.start({ type: "test", run: Effect.never })
      yield* jobs.cancel(cancelled.id)
      expect((yield* jobs.wait({ id: failed.id })).info?.status).toBe("error")
      expect((yield* jobs.wait({ id: cancelled.id })).info?.status).toBe("cancelled")
      yield* finishJobs(25)
      expect(yield* jobs.get(failed.id)).toBeUndefined()
      expect(yield* jobs.get(cancelled.id)).toBeUndefined()
    }),
  )

  it.live("bounds explicitly cancelled jobs even without a subsequent wait", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const ids: string[] = []
      for (let index = 0; index < 50; index++) {
        const job = yield* jobs.start({ type: "test", run: Effect.never })
        expect((yield* jobs.cancel(job.id))?.status).toBe("cancelled")
        ids.push(job.id)
      }
      const retained = yield* Effect.forEach(ids, jobs.get)
      expect(retained.filter((info) => info !== undefined).map((info) => info.id)).toEqual(ids.slice(-25))
    }),
  )

  it.live("preserves the recoverable wait-to-background handoff across consumed history eviction", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const job = yield* jobs.start({
        type: "shell",
        recovery: {
          kind: "shell",
          sessionID: SessionSchema.ID.make("ses_late_background"),
          shellID: "sh_late_background",
          command: "exit 1",
        },
        run: Effect.fail(new Error("immediate failure")),
      })
      expect((yield* jobs.wait({ id: job.id })).info?.error).toBe("immediate failure")
      yield* finishJobs(100)
      const background = yield* jobs.background(job.id)
      expect(background?.notificationID).toStartWith("msg_")
      expect((yield* jobs.pendingBackground).find((item) => item.id === job.id)).toMatchObject({
        status: "error",
        error: "immediate failure",
      })
    }),
  )

  it.live("keeps previously registered observers' results valid after cache eviction", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const scope = yield* Scope.Scope
      const latch = yield* Deferred.make<void>()
      const job = yield* jobs.start({ type: "test", run: Deferred.await(latch).pipe(Effect.as("shared output")) })
      const waiters = yield* Effect.forEach([0, 1, 2], () =>
        jobs.wait({ id: job.id }).pipe(Effect.forkIn(scope, { startImmediately: true })),
      )
      yield* Deferred.succeed(latch, undefined)
      yield* finishJobs(100)
      expect(yield* jobs.get(job.id)).toBeUndefined()
      for (const waiter of waiters) {
        expect(yield* Fiber.join(waiter)).toMatchObject({ info: { status: "completed", output: "shared output" } })
      }
    }),
  )

  it.live("protects pending background notifications from churn and releases them on acknowledgment", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const job = yield* jobs.start({
        type: "shell",
        recovery: {
          kind: "shell",
          sessionID: SessionSchema.ID.make("ses_pending_notification"),
          shellID: "sh_pending_notification",
          command: "echo done",
        },
        run: Effect.succeed("background output"),
      })
      const background = yield* jobs.background(job.id)
      if (!background?.notificationID) return yield* Effect.die("background marker missing")
      yield* jobs.wait({ id: job.id })
      yield* finishJobs(100)
      expect(yield* jobs.get(job.id)).toMatchObject({ status: "completed", output: "background output" })
      expect((yield* jobs.pendingBackground).find((item) => item.id === job.id)).toMatchObject({
        output: "background output",
      })
      yield* jobs.completeBackground(background.notificationID)
      yield* jobs.completeBackground(background.notificationID)
      expect(yield* jobs.get(job.id)).toBeUndefined()
      expect((yield* jobs.pendingBackground).find((item) => item.id === job.id)).toBeUndefined()
    }),
  )

  it.live("does not remove a newer generation when an older notification is acknowledged", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const id = "job_reused_notification"
      yield* jobs.start({
        id,
        type: "subagent",
        recovery: {
          kind: "subagent",
          parentSessionID: SessionSchema.ID.make("ses_generation_parent"),
          childSessionID: SessionSchema.ID.make("ses_generation_child"),
          agent: "explore",
          description: "first generation",
        },
        run: Effect.succeed("old output"),
      })
      const background = yield* jobs.background(id)
      if (!background?.notificationID) return yield* Effect.die("background marker missing")
      yield* jobs.wait({ id })
      yield* jobs.start({ id, type: "subagent", run: Effect.succeed("new output") })
      yield* jobs.completeBackground(background.notificationID)
      yield* finishJobs(100)
      expect((yield* jobs.wait({ id })).info?.output).toBe("new output")
    }),
  )

  it.live("tracks process-local work through explicit observation", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
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
    }),
  )

  it.live("publishes jobs before starting immediately settling work", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service

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
    }),
  )

  it.live("returns finished from a blocking wait when completion wins", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const latch = yield* Deferred.make<void>()
      const job = yield* jobs.start({ type: "test", run: Deferred.await(latch).pipe(Effect.as("done")) })
      const waiting = yield* jobs
        .block({ id: job.id, sessionID: SessionSchema.ID.make("ses_parent") })
        .pipe(Effect.forkIn(yield* Scope.Scope, { startImmediately: true }))

      yield* Deferred.succeed(latch, undefined)

      expect(yield* Fiber.join(waiting)).toMatchObject({
        type: "finished",
        info: { status: "completed", output: "done" },
      })
      expect(yield* jobs.background(job.id)).toBeUndefined()
    }),
  )

  it.live("returns backgrounded from a blocking wait when background wins", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const latch = yield* Deferred.make<void>()
      const job = yield* jobs.start({ type: "test", run: Deferred.await(latch).pipe(Effect.as("done")) })
      const waiting = yield* jobs
        .block({ id: job.id, sessionID: SessionSchema.ID.make("ses_parent") })
        .pipe(Effect.forkIn(yield* Scope.Scope, { startImmediately: true }))

      expect(yield* jobs.background(job.id)).toMatchObject({ id: job.id, status: "running" })
      expect(yield* Fiber.join(waiting)).toMatchObject({
        type: "backgrounded",
        info: { id: job.id, status: "running" },
      })

      yield* Deferred.succeed(latch, undefined)
      expect(yield* jobs.wait({ id: job.id })).toMatchObject({
        timedOut: false,
        info: { status: "completed", output: "done" },
      })
    }),
  )

  it.live("backgrounds only jobs actively blocking a session", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const parent = SessionSchema.ID.make("ses_parent")
      const other = SessionSchema.ID.make("ses_other")
      const latch = yield* Deferred.make<void>()
      const first = yield* jobs.start({
        id: "job_first",
        type: "test",
        run: Deferred.await(latch).pipe(Effect.as("first")),
      })
      const second = yield* jobs.start({
        id: "job_second",
        type: "test",
        run: Deferred.await(latch).pipe(Effect.as("second")),
      })
      const third = yield* jobs.start({
        id: "job_third",
        type: "other",
        run: Deferred.await(latch).pipe(Effect.as("third")),
      })
      const scope = yield* Scope.Scope
      const firstWait = yield* jobs
        .block({ id: first.id, sessionID: parent })
        .pipe(Effect.forkIn(scope, { startImmediately: true }))
      const secondWait = yield* jobs
        .block({ id: second.id, sessionID: other })
        .pipe(Effect.forkIn(scope, { startImmediately: true }))
      const thirdWait = yield* jobs
        .block({ id: third.id, sessionID: parent })
        .pipe(Effect.forkIn(scope, { startImmediately: true }))

      expect(yield* jobs.backgroundAll({ sessionID: parent, type: "test" })).toMatchObject([{ id: first.id }])
      expect(yield* Fiber.join(firstWait)).toMatchObject({ type: "backgrounded", info: { id: first.id } })

      yield* Deferred.succeed(latch, undefined)
      expect(yield* Fiber.join(secondWait)).toMatchObject({ type: "finished", info: { id: second.id } })
      expect(yield* Fiber.join(thirdWait)).toMatchObject({ type: "finished", info: { id: third.id } })
    }),
  )

  it.live("retains background ownership and terminal output until notification acknowledgment", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const latch = yield* Deferred.make<void>()
      const recovery = {
        kind: "shell" as const,
        sessionID: SessionSchema.ID.make("ses_background_shell"),
        shellID: "shell_background",
        command: "echo done",
      }
      const job = yield* jobs.start({ type: "shell", recovery, run: Deferred.await(latch).pipe(Effect.as("done")) })

      expect((yield* jobs.pendingBackground).find((item) => item.id === job.id)).toBeUndefined()
      const background = yield* jobs.background(job.id)

      const running = (yield* jobs.pendingBackground).find((item) => item.id === job.id)
      expect(running).toMatchObject({ id: job.id, recovery, status: "running" })
      expect(running?.notificationID).toStartWith("msg_")
      expect(background?.notificationID).toBe(running?.notificationID)

      yield* Deferred.succeed(latch, undefined)
      yield* jobs.wait({ id: job.id })

      const completed = (yield* jobs.pendingBackground).find((item) => item.id === job.id)
      expect(completed).toMatchObject({
        id: job.id,
        notificationID: running?.notificationID,
        recovery,
        status: "completed",
        output: "done",
      })
      if (!completed) return yield* Effect.die("background marker missing")

      yield* jobs.completeBackground(completed.notificationID)
      expect((yield* jobs.pendingBackground).find((item) => item.id === job.id)).toBeUndefined()
    }),
  )

  it.live("persists backgroundAll ownership before releasing a blocked subagent", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const parentSessionID = SessionSchema.ID.make("ses_background_parent")
      const latch = yield* Deferred.make<void>()
      const recovery = {
        kind: "subagent" as const,
        parentSessionID,
        childSessionID: SessionSchema.ID.make("ses_background_child"),
        agent: "explore",
        description: "Explore background recovery",
      }
      const job = yield* jobs.start({ type: "subagent", recovery, run: Deferred.await(latch).pipe(Effect.as("done")) })
      const waiting = yield* jobs
        .block({ id: job.id, sessionID: parentSessionID })
        .pipe(Effect.forkIn(yield* Scope.Scope, { startImmediately: true }))

      yield* jobs.backgroundAll({ sessionID: parentSessionID })
      expect(yield* Fiber.join(waiting)).toMatchObject({ type: "backgrounded", info: { id: job.id } })

      const marker = (yield* jobs.pendingBackground).find((item) => item.id === job.id)
      expect(marker).toMatchObject({ id: job.id, recovery, status: "running" })
      if (!marker) return yield* Effect.die("background marker missing")

      yield* jobs.cancel(job.id)
      expect((yield* jobs.pendingBackground).find((item) => item.id === job.id)).toMatchObject({
        notificationID: marker.notificationID,
        status: "cancelled",
      })
      yield* jobs.completeBackground(marker.notificationID)
    }),
  )

  it.live("retains terminal errors for recovery until notification acknowledgment", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const latch = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        type: "shell",
        recovery: {
          kind: "shell",
          sessionID: SessionSchema.ID.make("ses_background_error"),
          shellID: "shell_error",
          command: "exit 1",
        },
        run: Deferred.await(latch).pipe(Effect.andThen(Effect.fail(new Error("shell failed")))),
      })

      yield* jobs.background(job.id)
      yield* Deferred.succeed(latch, undefined)
      yield* jobs.wait({ id: job.id })

      const marker = (yield* jobs.pendingBackground).find((item) => item.id === job.id)
      expect(marker).toMatchObject({ id: job.id, status: "error", error: "shell failed" })
      if (!marker) return yield* Effect.die("background marker missing")
      yield* jobs.completeBackground(marker.notificationID)
    }),
  )

  it.live("durably backgrounds recoverable work that has already failed", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const job = yield* jobs.start({
        type: "shell",
        recovery: {
          kind: "shell",
          sessionID: SessionSchema.ID.make("ses_immediate_error"),
          shellID: "shell_immediate_error",
          command: "exit 1",
        },
        run: Effect.fail(new Error("shell failed")),
      })
      expect((yield* jobs.wait({ id: job.id })).info?.status).toBe("error")

      const background = yield* jobs.background(job.id)
      expect(background?.notificationID).toStartWith("msg_")
      expect(yield* jobs.pendingBackground).toMatchObject([
        { id: job.id, notificationID: background?.notificationID, status: "error", error: "shell failed" },
      ])
    }),
  )

  it.live("recovers a background marker after its process-local registry closes", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const previous = yield* Job.make.pipe(Scope.provide(scope))
      const job = yield* previous.start({
        type: "shell",
        recovery: {
          kind: "shell",
          sessionID: SessionSchema.ID.make("ses_background_restart"),
          shellID: "shell_restart",
          command: "sleep 60",
        },
        run: Effect.never,
      })
      yield* previous.background(job.id)
      yield* Scope.close(scope, Exit.void)

      const current = yield* Job.make
      const marker = (yield* current.pendingBackground).find((item) => item.id === job.id)
      expect(marker).toMatchObject({ id: job.id, status: "running" })
      if (!marker) return yield* Effect.die("background marker missing")
      yield* current.completeBackground(marker.notificationID)
    }),
  )

  it.live("preserves running background ownership when its work is interrupted", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const interrupted = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        type: "subagent",
        recovery: {
          kind: "subagent",
          parentSessionID: SessionSchema.ID.make("ses_interrupted_parent"),
          childSessionID: SessionSchema.ID.make("ses_interrupted_child"),
          agent: "explore",
          description: "Continue after shutdown",
        },
        run: Deferred.await(interrupted).pipe(Effect.andThen(Effect.interrupt)),
      })
      yield* jobs.background(job.id)
      yield* Deferred.succeed(interrupted, undefined)
      yield* jobs.wait({ id: job.id })

      const marker = (yield* jobs.pendingBackground).find((item) => item.id === job.id)
      expect(marker).toMatchObject({ id: job.id, status: "running" })
      if (!marker) return yield* Effect.die("background marker missing")
      yield* jobs.completeBackground(marker.notificationID)
    }),
  )

  it.live("interrupts live work without promising settlement after the owning process-local scope closes", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const interrupted = yield* Deferred.make<void>()
      const jobs = yield* Job.make.pipe(Scope.provide(scope))
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
