import { describe, expect } from "bun:test"
import { Database } from "@opencode/core/database/database"
import jobMigration from "@opencode/core/database/migration/20261030054400_job"
import { Job } from "@opencode/core/job"
import { JobTable } from "@opencode/core/job/sql"
import { KVTable } from "@opencode/core/kv/sql"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Integration } from "@opencode/core/integration"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { eq, like } from "drizzle-orm"
import { Cause, Deferred, Effect, Exit, Fiber, Scope } from "effect"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionSchema } from "@opencode/core/session/schema"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Job.node, Database.node, Global.node])))

describe("Job", () => {
  it.live("tracks process-local work through explicit observation", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const latch = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        id: "job_metadata",
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

  it.live("preserves authorization and complete failure details without stacks", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const job = yield* jobs.start({
        id: "job_failure",
        type: "test",
        run: Effect.failCause(
          Cause.combine(
            Cause.fail(
              new Integration.AuthorizationError({
                cause: new Error("authorization failed", { cause: new Error("token expired") }),
              }),
            ),
            Cause.die({ code: "cleanup_failed" }),
          ),
        ),
      })

      expect((yield* jobs.wait({ id: job.id })).info).toMatchObject({
        status: "error",
        error: 'authorization failed\nCaused by: token expired\n{"code":"cleanup_failed"}',
      })
    }),
  )

  it.live("reuses running work when started again with the same ID", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const output = yield* Deferred.make<string>()
      const job = yield* jobs.start({ id: "job_reused", type: "test", run: Deferred.await(output) })

      expect(
        yield* jobs.start({ id: job.id, type: "duplicate", run: Effect.die("Duplicate work must not run") }),
      ).toEqual(job)

      yield* Deferred.succeed(output, "original output")
      expect((yield* jobs.wait({ id: job.id })).info).toMatchObject({
        type: "test",
        status: "completed",
        output: "original output",
      })
    }),
  )

  it.live("ignores an obsolete callback after a cancellation waiter starts a same-ID replacement", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const callback = yield* Deferred.make<() => void>()
      const output = yield* Deferred.make<string>()
      const finalized = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        id: "job_replaced",
        type: "test",
        run: Effect.callback<string>((resume) => {
          Deferred.doneUnsafe(
            callback,
            Effect.succeed(() => resume(Effect.succeed("obsolete output"))),
          )
        }),
      })
      const complete = yield* Deferred.await(callback)
      // Cancellation wakes waiters before closing the old scope, allowing the old callback to race replacement.
      const replacement = yield* jobs.wait({ id: job.id }).pipe(
        Effect.tap((result) => Effect.sync(() => expect(result.info?.status).toBe("cancelled"))),
        Effect.andThen(
          jobs.start({
            id: job.id,
            type: "replacement",
            run: Deferred.await(output).pipe(Effect.ensuring(Deferred.succeed(finalized, undefined))),
          }),
        ),
        Effect.andThen(Effect.sync(complete)),
        Effect.forkChild({ startImmediately: true }),
      )

      yield* jobs.cancel(job.id)
      yield* Fiber.join(replacement)
      expect(yield* jobs.get(job.id)).toMatchObject({ type: "replacement", status: "running" })
      expect(yield* Deferred.isDone(finalized)).toBe(false)

      yield* Deferred.succeed(output, "replacement output")
      expect((yield* jobs.wait({ id: job.id })).info).toMatchObject({
        type: "replacement",
        status: "completed",
        output: "replacement output",
      })
      expect(yield* Deferred.isDone(finalized)).toBe(true)
    }),
  )

  it.live("returns finished from a blocking wait when completion wins", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const latch = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        id: "job_finished",
        type: "test",
        run: Deferred.await(latch).pipe(Effect.as("done")),
      })
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
      const job = yield* jobs.start({
        id: "job_backgrounded",
        type: "test",
        run: Deferred.await(latch).pipe(Effect.as("done")),
      })
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
      const job = yield* jobs.start({
        id: recovery.shellID,
        type: "shell",
        recovery,
        run: Deferred.await(latch).pipe(Effect.as("done")),
      })

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
      const job = yield* jobs.start({
        id: recovery.childSessionID,
        type: "subagent",
        recovery,
        run: Deferred.await(latch).pipe(Effect.as("done")),
      })
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
        id: "shell_error",
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
        id: "shell_immediate_error",
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
        id: "shell_restart",
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
        id: "ses_interrupted_child",
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
        id: "job_abandoned",
        type: "test",
        run: Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined))),
      })

      yield* Scope.close(scope, Exit.void)

      yield* Deferred.await(interrupted).pipe(Effect.timeout("1 second"))
      // The abandoned in-memory registry is not a durable observation channel.
      expect((yield* jobs.get(job.id))?.status).toBe("running")
    }),
  )

  it.live("interrupts observers without settling a background job, or running its cancel hook, on teardown", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const jobs = yield* Job.make.pipe(Scope.provide(scope))
      let cancels = 0
      const job = yield* jobs.start({
        id: "shell_teardown",
        type: "shell",
        recovery: {
          kind: "shell",
          sessionID: SessionSchema.ID.make("ses_teardown"),
          shellID: "shell_teardown",
          command: "sleep 60",
        },
        run: Effect.never,
        cancel: Effect.sync(() => void cancels++),
      })
      const background = yield* jobs.background(job.id)
      const observer = yield* jobs.wait({ id: job.id }).pipe(Effect.forkChild({ startImmediately: true }))

      yield* Scope.close(scope, Exit.void)

      const observed = yield* Fiber.await(observer).pipe(Effect.timeout("1 second"))
      expect(Exit.isFailure(observed) && Cause.hasInterruptsOnly(observed.cause)).toBe(true)
      expect(cancels).toBe(0)
      const current = yield* Job.make
      expect(yield* current.pendingBackground).toMatchObject([
        { id: job.id, notificationID: background?.notificationID, status: "running" },
      ])
      if (background?.notificationID) yield* current.completeBackground(background.notificationID)
    }),
  )

  it.live("runs a job's cancel hook when it is cancelled, alone or with its session", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const cancelled: string[] = []
      const start = (id: string) =>
        jobs.start({
          id,
          type: "shell",
          recovery: { kind: "shell", sessionID: SessionSchema.ID.make("ses_cancel_hook"), shellID: id, command: "x" },
          run: Effect.never,
          cancel: Effect.sync(() => void cancelled.push(id)),
        })
      yield* start("shell_cancel_one")
      yield* start("shell_cancel_session")
      yield* jobs.cancel("shell_cancel_one")
      yield* jobs.cancelSession(SessionSchema.ID.make("ses_cancel_hook"))
      expect(cancelled).toEqual(["shell_cancel_one", "shell_cancel_session"])
    }),
  )

  it.live("cancels running session jobs and removes unacknowledged SQLite job rows on cancelSession", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const db = (yield* Database.Service).db
      const sessionID = SessionSchema.ID.make("ses_cleanup_owner")
      const otherSessionID = SessionSchema.ID.make("ses_cleanup_other")
      const interrupted = yield* Deferred.make<void>()

      const owned = yield* jobs.start({
        id: "job_cleanup_owned",
        type: "shell",
        recovery: { kind: "shell", sessionID, shellID: "job_cleanup_owned", command: "bun run dev" },
        run: Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined))),
      })
      const other = yield* jobs.start({
        id: "job_cleanup_other",
        type: "shell",
        recovery: { kind: "shell", sessionID: otherSessionID, shellID: "job_cleanup_other", command: "bun test" },
        run: Effect.succeed("kept"),
      })
      yield* jobs.background(owned.id)
      yield* jobs.background(other.id)
      yield* jobs.wait({ id: other.id })

      const cancelled = yield* jobs.cancelSession(sessionID)
      expect(cancelled).toMatchObject([{ id: owned.id, status: "cancelled" }])
      yield* Deferred.await(interrupted).pipe(Effect.timeout("1 second"))

      expect(yield* db.select().from(JobTable).where(eq(JobTable.session_id, sessionID)).all()).toEqual([])
      const remaining = yield* jobs.pendingBackground
      expect(remaining).toMatchObject([{ id: other.id, status: "completed", output: "kept" }])
      if (remaining[0]) yield* jobs.completeBackground(remaining[0].notificationID)
    }),
  )

  it.live("does not restore a consumed background row when its running work settles", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const latch = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        id: "shell_consumed_before_settle",
        type: "shell",
        recovery: {
          kind: "shell",
          sessionID: SessionSchema.ID.make("ses_consumed_before_settle"),
          shellID: "shell_consumed_before_settle",
          command: "bun test",
        },
        run: Deferred.await(latch).pipe(Effect.as("done")),
      })

      const background = yield* jobs.background(job.id)
      if (!background?.notificationID) return yield* Effect.die("background marker missing")
      const waiting = yield* jobs.wait({ id: job.id }).pipe(Effect.forkChild({ startImmediately: true }))

      yield* jobs.completeBackground(background.notificationID)
      expect(yield* jobs.pendingBackground).toEqual([])
      expect(yield* jobs.backgroundJobs).toEqual([])

      yield* Deferred.succeed(latch, undefined)
      expect(yield* Fiber.join(waiting)).toMatchObject({ info: { status: "completed", output: "done" } })
      // Settling a consumed job must not re-insert the row its notification already cleared.
      expect(yield* jobs.pendingBackground).toEqual([])
      expect(yield* jobs.backgroundJobs).toEqual([])
      expect(yield* jobs.get(job.id)).toBeUndefined()
    }),
  )

  it.live("classifies a backgrounded subagent report and marks it settling", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const latch = yield* Deferred.make<void>()
      const recovery = {
        kind: "subagent" as const,
        parentSessionID: SessionSchema.ID.make("ses_report_parent"),
        childSessionID: SessionSchema.ID.make("ses_report_child"),
        agent: "explore",
        description: "Report work",
      }
      const job = yield* jobs.start({
        id: recovery.childSessionID,
        type: "subagent",
        title: "Report work",
        recovery,
        run: Deferred.await(latch).pipe(Effect.as("done")),
      })
      const background = yield* jobs.background(job.id)
      if (!background?.notificationID) return yield* Effect.die("background marker missing")

      expect(yield* jobs.currentGeneration(job.id)).toMatchObject({ running: true })
      expect(yield* jobs.prepareSubagentReport(job.id)).toEqual({
        mode: "background",
        notificationID: background.notificationID,
        recovery,
        startedAt: job.started_at,
      })
      expect(yield* jobs.currentGeneration(job.id)).toMatchObject({ running: false })
      expect(yield* jobs.prepareSubagentReport(job.id)).toEqual({ mode: "none" })
      expect(yield* jobs.currentGeneration("job_missing")).toBeUndefined()

      yield* Deferred.succeed(latch, undefined)
      yield* jobs.wait({ id: job.id })
      // The settlement commit owns the terminal row while this generation is settling.
      // Settling must not overwrite it with a stale running-period value.
      expect(yield* jobs.pendingBackground).toMatchObject([
        { notificationID: background.notificationID, status: "running" },
      ])
      yield* jobs.recordSubagentReport({
        notificationID: background.notificationID,
        recovery,
        status: "completed",
        output: "done",
        startedAt: job.started_at,
      })
      expect(yield* jobs.pendingBackground).toMatchObject([
        { notificationID: background.notificationID, status: "completed", output: "done" },
      ])
      yield* jobs.completeBackground(background.notificationID)
    }),
  )

  it.live("refuses a late background handoff for settling foreground work and starts a fresh generation", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const latch = yield* Deferred.make<void>()
      const recovery = {
        kind: "subagent" as const,
        parentSessionID: SessionSchema.ID.make("ses_settling_parent"),
        childSessionID: SessionSchema.ID.make("ses_settling_child"),
        agent: "explore",
        description: "Settling work",
      }
      const job = yield* jobs.start({
        id: recovery.childSessionID,
        type: "subagent",
        recovery,
        run: Deferred.await(latch).pipe(Effect.as("old")),
      })
      const generation = (yield* jobs.currentGeneration(job.id))?.generation
      if (generation === undefined) return yield* Effect.die("generation missing")
      const oldWait = yield* jobs.wait({ id: job.id }).pipe(Effect.forkChild({ startImmediately: true }))

      expect(yield* jobs.prepareSubagentReport(job.id)).toEqual({ mode: "foreground" })
      expect(yield* jobs.currentGeneration(job.id)).toEqual({ generation, running: false })
      expect(yield* jobs.background(job.id)).toBeUndefined()

      const replacementLatch = yield* Deferred.make<string>()
      yield* jobs.start({
        id: job.id,
        type: "subagent",
        recovery,
        run: Deferred.await(replacementLatch),
      })
      const current = yield* jobs.currentGeneration(job.id)
      expect(current?.generation).not.toBe(generation)
      expect(current?.running).toBe(true)

      yield* Deferred.succeed(latch, undefined)
      // The superseded generation still resolves its waiters instead of dropping the settlement.
      expect(yield* Fiber.join(oldWait)).toMatchObject({
        timedOut: false,
        info: { status: "completed", output: "old" },
      })
      expect(yield* jobs.get(job.id)).toMatchObject({ status: "running" })

      yield* Deferred.succeed(replacementLatch, "new")
      expect((yield* jobs.wait({ id: job.id })).info).toMatchObject({ status: "completed", output: "new" })
    }),
  )

  it.live("keeps settling work out of a session-wide background handoff", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const parent = SessionSchema.ID.make("ses_settling_all")
      const latch = yield* Deferred.make<void>()
      const first = yield* jobs.start({
        id: "job_settling_all_first",
        type: "test",
        run: Deferred.await(latch).pipe(Effect.as("first")),
      })
      const second = yield* jobs.start({
        id: "job_settling_all_second",
        type: "test",
        run: Deferred.await(latch).pipe(Effect.as("second")),
      })
      const scope = yield* Scope.Scope
      const firstWait = yield* jobs
        .block({ id: first.id, sessionID: parent })
        .pipe(Effect.forkIn(scope, { startImmediately: true }))
      const secondWait = yield* jobs
        .block({ id: second.id, sessionID: parent })
        .pipe(Effect.forkIn(scope, { startImmediately: true }))

      expect(yield* jobs.prepareSubagentReport(first.id)).toEqual({ mode: "foreground" })
      expect(yield* jobs.backgroundAll({ sessionID: parent })).toMatchObject([{ id: second.id }])
      expect(yield* jobs.get(first.id)).toMatchObject({ status: "running" })
      expect((yield* jobs.get(first.id))?.notificationID).toBeUndefined()

      yield* Deferred.succeed(latch, undefined)
      expect(yield* Fiber.join(firstWait)).toMatchObject({ type: "finished", info: { id: first.id } })
      expect(yield* Fiber.join(secondWait)).toMatchObject({ type: "backgrounded", info: { id: second.id } })
    }),
  )

  it.live("matches an external cancel to its busy period through the bound generation", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const recovery = {
        kind: "subagent" as const,
        parentSessionID: SessionSchema.ID.make("ses_cancel_bound_parent"),
        childSessionID: SessionSchema.ID.make("ses_cancel_bound_child"),
        agent: "explore",
        description: "Cancelled during the busy period",
      }
      const job = yield* jobs.start({
        id: recovery.childSessionID,
        type: "subagent",
        recovery,
        run: Effect.never,
      })
      const generation = (yield* jobs.currentGeneration(job.id))?.generation
      if (generation === undefined) return yield* Effect.die("generation missing")

      yield* jobs.cancel(job.id)
      expect(yield* jobs.get(job.id)).toMatchObject({ status: "cancelled" })
      // The cancel consumed the live entry; its matching generation still belongs to this busy period.
      expect(yield* jobs.prepareSubagentReport(job.id, generation)).toEqual({ mode: "foreground" })
      expect(yield* jobs.prepareSubagentReport(job.id, generation - 1)).toEqual({ mode: "none" })
      expect(yield* jobs.prepareSubagentReport(job.id)).toEqual({ mode: "none" })
    }),
  )

  it.live("writes subagent outbox rows with pure SQL upserts outside the live registry", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const db = (yield* Database.Service).db
      const notificationID = SessionMessage.ID.create()
      const recovery = {
        kind: "subagent" as const,
        parentSessionID: SessionSchema.ID.make("ses_outbox_parent"),
        childSessionID: SessionSchema.ID.make("ses_outbox_child"),
        agent: "explore",
        description: "Outbox report",
      }

      yield* jobs.recordSubagentReport({
        notificationID,
        recovery,
        status: "completed",
        output: "report body",
        startedAt: 1234,
      })
      expect(yield* jobs.get(recovery.childSessionID)).toBeUndefined()
      expect(yield* jobs.pendingBackground).toMatchObject([
        { id: recovery.childSessionID, notificationID, status: "completed", output: "report body", recovery },
      ])

      yield* jobs.recordSubagentReport({ notificationID, recovery, status: "error", error: "failed" })
      const rows = yield* db.select().from(JobTable).all()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        notification_id: notificationID,
        id: recovery.childSessionID,
        session_id: recovery.parentSessionID,
        child_session_id: recovery.childSessionID,
        kind: "subagent",
        status: "error",
        output: null,
        error: "failed",
        time_created: 1234,
      })

      yield* jobs.deleteBackgroundRow(notificationID)
      expect(yield* jobs.pendingBackground).toEqual([])
    }),
  )

  it.live("persists a background marker before forking background work", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const notificationID = SessionMessage.ID.create()
      const recovery = {
        kind: "subagent" as const,
        parentSessionID: SessionSchema.ID.make("ses_atomic_parent"),
        childSessionID: SessionSchema.ID.make("ses_atomic_child"),
        agent: "explore",
        description: "Atomic start",
      }
      const job = yield* jobs.start({
        id: recovery.childSessionID,
        type: "subagent",
        recovery,
        notificationID,
        background: true,
        // The row must already be durable when the run begins, not after an async handoff.
        run: jobs.pendingBackground.pipe(
          Effect.map((rows) =>
            String(rows.some((row) => row.notificationID === notificationID && row.status === "running")),
          ),
        ),
      })

      expect(job.notificationID).toBe(notificationID)
      expect((yield* jobs.wait({ id: job.id })).info).toMatchObject({ status: "completed", output: "true" })
      expect(yield* jobs.pendingBackground).toMatchObject([{ notificationID, status: "completed", output: "true" }])
      yield* jobs.completeBackground(notificationID)
    }),
  )

  it.live("promotes joined foreground work to background while it is still live", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const parent = SessionSchema.ID.make("ses_promote_parent")
      const recovery = {
        kind: "subagent" as const,
        parentSessionID: parent,
        childSessionID: SessionSchema.ID.make("ses_promote_child"),
        agent: "explore",
        description: "Promote work",
      }
      const latch = yield* Deferred.make<void>()
      const foreground = yield* jobs.start({
        id: recovery.childSessionID,
        type: "subagent",
        recovery,
        run: Deferred.await(latch).pipe(Effect.as("foreground")),
      })
      const waiting = yield* jobs
        .block({ id: foreground.id, sessionID: parent })
        .pipe(Effect.forkChild({ startImmediately: true }))

      const promoted = yield* jobs.start({
        id: foreground.id,
        type: "subagent",
        recovery,
        background: true,
        run: Effect.die("Joined work must not run twice"),
      })
      expect(promoted.notificationID).toEqual(expect.any(String))
      expect(yield* Fiber.join(waiting)).toMatchObject({ type: "backgrounded", info: { id: foreground.id } })
      expect(yield* jobs.pendingBackground).toMatchObject([{ id: foreground.id, status: "running" }])

      yield* Deferred.succeed(latch, undefined)
      yield* jobs.wait({ id: foreground.id })
      const marker = (yield* jobs.pendingBackground)[0]
      if (!marker) return yield* Effect.die("background marker missing")
      expect(marker.status).toBe("completed")
      yield* jobs.completeBackground(marker.notificationID)
    }),
  )

  it.live("distinguishes caller cancellation from teardown", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const cancelled = yield* Deferred.make<void>()
      const explicit = yield* jobs.start({
        id: "job_explicit_cancel",
        type: "test",
        run: Effect.never.pipe(Effect.ensuring(Deferred.succeed(cancelled, undefined))),
      })
      expect(yield* jobs.isCancelled(explicit.id)).toBe(false)
      yield* jobs.cancel(explicit.id)
      expect(yield* jobs.isCancelled(explicit.id)).toBe(true)
      yield* Deferred.await(cancelled).pipe(Effect.timeout("1 second"))

      const scope = yield* Scope.make()
      const abandoned = yield* Job.make.pipe(Scope.provide(scope))
      const job = yield* abandoned.start({ id: "job_teardown_cancel", type: "test", run: Effect.never })
      yield* Scope.close(scope, Exit.void)
      // Scope teardown is a shutdown, not a caller cancellation: restart recovery depends on it.
      expect(yield* abandoned.isCancelled(job.id)).toBe(false)
    }),
  )

  it.live("matches a creation-tick cancellation without a bound generation exactly once", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const recovery = {
        kind: "subagent" as const,
        parentSessionID: SessionSchema.ID.make("ses_creation_parent"),
        childSessionID: SessionSchema.ID.make("ses_creation_child"),
        agent: "explore",
        description: "Cancelled on creation",
      }
      yield* jobs.start({
        id: recovery.childSessionID,
        type: "subagent",
        recovery,
        background: true,
        run: Effect.never,
      })
      yield* jobs.cancel(recovery.childSessionID)

      // The started hook never ran, so no generation was bound; the cancel still owns this period.
      expect(yield* jobs.prepareSubagentReport(recovery.childSessionID)).toMatchObject({ mode: "background" })
      expect(yield* jobs.prepareSubagentReport(recovery.childSessionID)).toEqual({ mode: "none" })
    }),
  )

  it.live("excludes settling and consumed work from running background snapshots", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const latch = yield* Deferred.make<void>()
      const recovery = {
        kind: "subagent" as const,
        parentSessionID: SessionSchema.ID.make("ses_snapshot_parent"),
        childSessionID: SessionSchema.ID.make("ses_snapshot_child"),
        agent: "explore",
        description: "Snapshot work",
      }
      const job = yield* jobs.start({
        id: recovery.childSessionID,
        type: "subagent",
        recovery,
        background: true,
        run: Deferred.await(latch).pipe(Effect.as("done")),
      })
      const notificationID = job.notificationID
      if (!notificationID) return yield* Effect.die("background marker missing")

      expect(yield* jobs.runningBackground).toEqual([recovery])
      expect(yield* jobs.prepareSubagentReport(recovery.childSessionID)).toMatchObject({ mode: "background" })
      expect(yield* jobs.runningBackground).toEqual([])

      // A settling live entry without its row must not leak back into the durable list.
      yield* jobs.deleteBackgroundRow(notificationID)
      expect(yield* jobs.backgroundJobs).toEqual([])

      yield* Deferred.succeed(latch, undefined)
      yield* jobs.wait({ id: recovery.childSessionID })
      yield* jobs.completeBackground(notificationID)
      expect(yield* jobs.runningBackground).toEqual([])
    }),
  )

  it.live("migrates legacy kv job.background/* markers into the job table", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const jobs = yield* Job.Service
      const notificationID = SessionMessage.ID.create()
      const sessionID = SessionSchema.ID.make("ses_migrated")

      yield* db.run("DROP TABLE `job`")
      yield* db
        .insert(KVTable)
        .values({
          key: `job.background/${notificationID}`,
          value: {
            id: "shell_legacy",
            notificationID,
            recovery: {
              kind: "shell",
              sessionID,
              shellID: "shell_legacy",
              command: "bun test",
            },
            status: "completed",
            output: "all green",
          },
        })
        .run()

      yield* db.transaction((tx) => jobMigration.up(tx))

      expect(yield* db.select().from(KVTable).where(like(KVTable.key, "job.background/%")).all()).toEqual([])
      expect(yield* jobs.pendingBackground).toMatchObject([
        {
          id: "shell_legacy",
          notificationID,
          status: "completed",
          output: "all green",
          recovery: { kind: "shell", sessionID, shellID: "shell_legacy", command: "bun test" },
        },
      ])
      yield* jobs.completeBackground(notificationID)
    }),
  )
})
