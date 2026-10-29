import { describe, expect } from "bun:test"
import { Database } from "@opencode/core/database/database"
import { Job } from "@opencode/core/job"
import { KV } from "@opencode/core/kv"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Integration } from "@opencode/core/integration"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionInboxTable, SessionTable } from "@opencode/core/session/sql"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { eq } from "drizzle-orm"
import { Cause, Deferred, Effect, Exit, Fiber, References, Scope } from "effect"
import { TestClock } from "effect/testing"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, Job.node, KV.node])))

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

  it.live("backgrounds a newly blocking job when its session already has a pending user steer", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const { db } = yield* Database.Service
      const steered = SessionSchema.ID.make("ses_steered")
      const other = SessionSchema.ID.make("ses_other")
      const inboxID = SessionMessage.ID.create()
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: steered,
          project_id: Project.ID.global,
          slug: "steered",
          directory: "/project",
          title: "steered",
          version: "test",
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      yield* SessionInbox.projectAdmitted(db, {
        enqueuedSeq: 1,
        id: inboxID,
        sessionID: steered,
        item: { type: "user", payload: SessionInbox.UserPayload.make({ text: "Steer now" }), delivery: "steer" },
        timeCreated: 1,
      })

      const latch = yield* Deferred.make<void>()
      const recovery = {
        kind: "shell" as const,
        sessionID: steered,
        shellID: "shell_guarded",
        command: "sleep 60",
      }
      const first = yield* jobs.start({
        id: recovery.shellID,
        type: "shell",
        recovery,
        run: Deferred.await(latch).pipe(Effect.as("guarded")),
      })
      const second = yield* jobs.start({
        id: "job_unguarded",
        type: "test",
        run: Deferred.await(latch).pipe(Effect.as("unguarded")),
      })

      const guarded = yield* jobs.block({ id: first.id, sessionID: steered })
      expect(guarded).toMatchObject({ type: "backgrounded", info: { id: first.id, status: "running" } })
      const marker = (yield* jobs.pendingBackground).find((item) => item.id === first.id)
      expect(marker).toMatchObject({ id: first.id, recovery, status: "running" })

      const unguarded = yield* jobs
        .block({ id: second.id, sessionID: other })
        .pipe(Effect.forkIn(yield* Scope.Scope, { startImmediately: true }))
      yield* Deferred.succeed(latch, undefined)
      expect(yield* Fiber.join(unguarded)).toMatchObject({
        type: "finished",
        info: { id: second.id, status: "completed", output: "unguarded" },
      })
      if (marker) yield* jobs.completeBackground(marker.notificationID)
      yield* db.delete(SessionInboxTable).where(eq(SessionInboxTable.id, inboxID)).run().pipe(Effect.orDie)
    }),
  )

  it.live("returns backgrounded when completion settles after background ownership commits during block entry", () =>
    Effect.gen(function* () {
      const baseKv = yield* KV.Service
      const { db } = yield* Database.Service
      const steered = SessionSchema.ID.make("ses_steered_race")
      const inboxID = SessionMessage.ID.create()
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: steered,
          project_id: Project.ID.global,
          slug: "steered-race",
          directory: "/project",
          title: "steered-race",
          version: "test",
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      yield* SessionInbox.projectAdmitted(db, {
        enqueuedSeq: 1,
        id: inboxID,
        sessionID: steered,
        item: { type: "user", payload: SessionInbox.UserPayload.make({ text: "Steer race" }), delivery: "steer" },
        timeCreated: 1,
      })

      const finishJob = yield* Deferred.make<string>()
      const kv = KV.Service.of({
        ...baseKv,
        set: (key, value) =>
          Effect.gen(function* () {
            yield* baseKv.set(key, value)
            if (typeof value === "object" && value !== null && "status" in value && value.status === "running") {
              yield* Deferred.succeed(finishJob, "settled-during-background")
              yield* Effect.yieldNow
            }
          }),
      })
      const jobs = yield* Job.make.pipe(Effect.provideService(KV.Service, kv))
      const recovery = {
        kind: "shell" as const,
        sessionID: steered,
        shellID: "shell_race_entry",
        command: "printf done",
      }
      const started = yield* jobs.start({
        id: recovery.shellID,
        type: "shell",
        recovery,
        run: Deferred.await(finishJob),
      })

      const deliveries: string[] = []
      const blocking = yield* jobs
        .block({ id: started.id, sessionID: steered })
        .pipe(Effect.provideService(References.MaxOpsBeforeYield, 5), Effect.timeout("2 seconds"), Effect.forkChild)
      const outcome = yield* Fiber.join(blocking)
      if (outcome?.type === "finished") {
        deliveries.push(`inline:${outcome.info.output}`)
      }
      if (outcome?.type === "backgrounded") {
        const waited = (yield* jobs.wait({ id: started.id })).info
        if (waited && waited.status !== "running") {
          deliveries.push(`background:${waited.output}`)
          if (waited.notificationID) yield* jobs.completeBackground(waited.notificationID)
        }
      }

      expect(outcome?.type).toBe("backgrounded")
      expect(deliveries).toEqual(["background:settled-during-background"])
      expect((yield* jobs.pendingBackground).find((item) => item.id === started.id)).toBeUndefined()
      yield* db.delete(SessionInboxTable).where(eq(SessionInboxTable.id, inboxID)).run().pipe(Effect.orDie)
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

  it.effect("auto-backgrounds after yield_after and delivers settlement even after caller scope closes", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const sessionID = SessionSchema.ID.make("ses_yield_after")
      const callerScope = yield* Scope.make()
      const latch = yield* Deferred.make<void>()
      const delivered = yield* Deferred.make<Job.Info<{ exit: number }>>()
      let live = "step 1"

      const job = yield* jobs
        .start<{ exit: number }>({
          id: "job_yield_after",
          sessionID,
          type: "shell",
          title: "slow build",
          recovery: {
            kind: "shell",
            sessionID,
            shellID: "job_yield_after",
            command: "slow build",
          },
          run: Deferred.await(latch).pipe(Effect.as({ output: "step 1\nstep 2", value: { exit: 0 } })),
          output: Effect.sync(() => live),
          onSettle: (info) => Deferred.succeed(delivered, info).pipe(Effect.asVoid),
        })
        .pipe(Scope.provide(callerScope))

      const blocked = yield* jobs
        .block<{ exit: number }>({ id: job.id, sessionID, yield_after: 5_000 })
        .pipe(Effect.forkChild({ startImmediately: true }))

      yield* Effect.yieldNow
      expect(Array.from(yield* jobs.activeSessions)).toContain(sessionID)
      yield* TestClock.adjust("4999 millis")
      expect(blocked.pollUnsafe()).toBeUndefined()

      yield* TestClock.adjust("1 millis")
      const yielded = yield* Fiber.join(blocked)
      expect(yielded).toMatchObject({ type: "backgrounded", info: { id: job.id, status: "running" } })
      expect(yield* jobs.read(job.id)).toMatchObject({ id: job.id, status: "running", output: "step 1" })

      // Simulate plugin/location reload closing the scope that started the job.
      yield* Scope.close(callerScope, Exit.void)
      live = "step 1\nnearly done"
      expect(yield* jobs.read(job.id)).toMatchObject({ output: "step 1\nnearly done" })

      yield* Deferred.succeed(latch, undefined)
      const finalInfo = yield* Deferred.await(delivered)
      expect(finalInfo).toMatchObject({
        id: job.id,
        status: "completed",
        output: "step 1\nstep 2",
        value: { exit: 0 },
      })
      yield* jobs.awaitSessionBackground(sessionID)
      expect(Array.from(yield* jobs.activeSessions)).not.toContain(sessionID)
    }),
  )

  it.effect("captures output so far before running stop when cancelling a running job", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const sessionID = SessionSchema.ID.make("ses_stop_job")
      let buffer: string | undefined = "partial output before stop"
      let stopped = false

      const job = yield* jobs.start({
        id: "job_stoppable",
        sessionID,
        type: "shell",
        run: Effect.never,
        output: Effect.sync(() => buffer),
        stop: Effect.sync(() => {
          stopped = true
          buffer = undefined
        }),
      })
      yield* jobs.background(job.id)
      expect(Array.from(yield* jobs.activeSessions)).toContain(sessionID)

      const cancelled = yield* jobs.cancel(job.id)
      expect(stopped).toBe(true)
      expect(cancelled).toMatchObject({
        id: job.id,
        status: "cancelled",
        output: "partial output before stop",
      })
      expect(Array.from(yield* jobs.activeSessions)).not.toContain(sessionID)
    }),
  )

  it.live("delivers once via background notice when completion races yield_after after isBackgrounded commits", () =>
    Effect.gen(function* () {
      const baseKv = yield* KV.Service
      const sessionID = SessionSchema.ID.make("ses_yield_race")
      const finishJob = yield* Deferred.make<string>()
      const settledNotice = yield* Deferred.make<string>()
      const deliveries: string[] = []

      const kv = KV.Service.of({
        ...baseKv,
        set: (key, value) =>
          Effect.gen(function* () {
            yield* baseKv.set(key, value)
            if (typeof value === "object" && value !== null && "status" in value && value.status === "running") {
              // Complete `run` while `yieldRunning` has committed `isBackgrounded` in `state.jobs`
              // but before `yieldRunning` resolves `job.backgrounded`, so `done` wins `raceFirst`.
              yield* Deferred.succeed(finishJob, "settled-during-yield")
              yield* Effect.yieldNow
            }
          }),
      })
      const jobs = yield* Job.make.pipe(Effect.provideService(KV.Service, kv))
      const recovery = {
        kind: "shell" as const,
        sessionID,
        shellID: "shell_yield_race",
        command: "printf done",
      }
      const started = yield* jobs.start({
        id: recovery.shellID,
        sessionID,
        type: "shell",
        recovery,
        run: Deferred.await(finishJob),
        onSettle: (info) =>
          Effect.sync(() => {
            deliveries.push(`background:${info.output}`)
          }).pipe(Effect.andThen(Deferred.succeed(settledNotice, info.output ?? "")), Effect.asVoid),
      })

      const blocking = yield* jobs
        .block({ id: started.id, sessionID, yield_after: 1 })
        .pipe(Effect.provideService(References.MaxOpsBeforeYield, 5), Effect.timeout("2 seconds"), Effect.forkChild)
      const outcome = yield* Fiber.join(blocking)
      if (outcome?.type === "finished") deliveries.push(`inline:${outcome.info.output}`)

      yield* Deferred.await(settledNotice).pipe(Effect.timeout("2 seconds"))
      yield* jobs.awaitSessionBackground(sessionID)

      expect(outcome?.type).toBe("backgrounded")
      expect(deliveries).toEqual(["background:settled-during-yield"])
      expect((yield* jobs.pendingBackground).find((item) => item.id === started.id)).toBeUndefined()
      expect(yield* jobs.read(started.id)).toMatchObject({
        id: started.id,
        status: "completed",
        output: "settled-during-yield",
      })
    }),
  )
})
