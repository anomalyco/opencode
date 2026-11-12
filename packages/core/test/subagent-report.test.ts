import type { FileSystem } from "@opencode/core/filesystem"
import { describe, expect } from "bun:test"
import { AIError, TransportError } from "@opencode/ai/effect"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Instance } from "@opencode/core/instance/service"
import { Job } from "@opencode/core/job"
import { JobTable } from "@opencode/core/job/sql"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import type { LocationServices } from "@opencode/core/location-services"
import { Model } from "@opencode/core/model"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionExecution } from "@opencode/core/session/execution"
import { SubagentReport } from "@opencode/core/session/execution/subagent-report"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionRunner } from "@opencode/core/session/runner/index"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionMessageTable, SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Cause, Context, DateTime, Deferred, Effect, Exit, Layer, LayerMap, Schema, Scope } from "effect"
import { eq, sql } from "drizzle-orm"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionStore.node, SessionInbox.node, SessionProjector.node, Job.node]),
  ),
)

type SessionID = SessionSchema.ID
type Drain = (input: Parameters<SessionRunner.Interface["drain"]>[0]) => Effect.Effect<void, SessionRunner.RunError>

describe("SubagentReport settlement", () => {
  it.effect("reports a directly prompted child when it goes idle", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const parent = sessionID("ses_direct_parent")
      const child = sessionID("ses_direct_child")
      yield* seedSessions(database, [parent])
      yield* seedSessions(database, [child], { parent_id: parent, agent: "explore", title: "Direct audit" })
      yield* seedAssistant(database, child, 100, "Investigation complete")

      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const context = yield* buildExecution(scope, () => Effect.void)
      const execution = Context.get(context, SessionExecution.Service)

      yield* execution.wake(child)
      yield* execution.awaitIdle(child)
      yield* execution.awaitIdle(parent)

      expect(yield* claims(database)).toEqual({ [parent]: false, [child]: false })
      expect(yield* SessionInbox.list(database.db, parent)).toMatchObject([
        {
          type: "synthetic",
          payload: {
            text: [
              `<subagent sessionID="${child}" state="completed" description="Direct audit">`,
              "Investigation complete",
              "</subagent>",
            ].join("\n"),
            metadata: { source: "subagent", childID: child, agent: "explore", state: "completed" },
          },
          delivery: "steer",
        },
      ])
    }),
  )

  it.effect("reports immediately with still-running background work and skips non-running descendants", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const jobs = yield* Job.Service
      const parent = sessionID("ses_bgreport_parent")
      const child = sessionID("ses_bgreport_child")
      const active = sessionID("ses_bgreport_active")
      const cancelled = sessionID("ses_bgreport_cancelled")
      const stopping = sessionID("ses_bgreport_stopping")
      yield* seedSessions(database, [parent])
      yield* seedSessions(database, [child], { parent_id: parent, agent: "explore", title: "Background audit" })
      yield* seedSessions(database, [active, cancelled, stopping], { parent_id: child })

      const shell = yield* jobs.start({
        id: "sh_bgreport_shell",
        type: "shell",
        recovery: { kind: "shell", sessionID: child, shellID: "sh_1", command: "bun test\n  --watch" },
        background: true,
        run: Effect.never,
      })
      const image = yield* jobs.start({
        id: "image_bgreport",
        type: "experimental_image_generate",
        recovery: { kind: "image", sessionID: child, path: "/tmp/chart.png", model: "test/painter" },
        background: true,
        run: Effect.never,
      })
      yield* jobs.start({
        id: cancelled,
        type: "subagent",
        recovery: {
          kind: "subagent",
          parentSessionID: child,
          childSessionID: cancelled,
          agent: "explore",
          description: "Cancelled descendant",
        },
        background: true,
        run: Effect.never,
      })
      yield* jobs.cancel(cancelled)

      const started = yield* Deferred.make<void>()
      const released = yield* Deferred.make<void>()
      const stoppingStarted = yield* Deferred.make<void>()
      const cleanup = yield* Deferred.make<void>()
      const gate = Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(released)))
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const context = yield* buildExecution(scope, ({ sessionID }) => {
        if (sessionID === active || sessionID === cancelled) return gate
        if (sessionID === stopping)
          return Deferred.succeed(stoppingStarted, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.await(cleanup)),
          )
        return Effect.void
      })
      const execution = Context.get(context, SessionExecution.Service)
      yield* execution.resume(active).pipe(Effect.forkIn(scope))
      yield* execution.resume(cancelled).pipe(Effect.forkIn(scope))
      yield* execution.resume(stopping).pipe(Effect.forkIn(scope))
      yield* Deferred.await(started)
      yield* Deferred.await(stoppingStarted)
      // A stopping execution still owns cleanup, but it is no longer running work.
      expect(yield* execution.interrupt(stopping)).toBe(true)
      expect(yield* execution.isActive(stopping)).toBe(true)

      yield* seedAssistant(database, child, 200, "Started tests")
      yield* execution.wake(child)
      yield* execution.awaitIdle(child)

      // The report does not wait for descendants: they are genuinely draining right now.
      expect(yield* execution.isActive(active)).toBe(true)
      expect(yield* SessionInbox.list(database.db, parent)).toMatchObject([
        {
          payload: {
            text: [
              `<subagent sessionID="${child}" state="completed" description="Background audit">`,
              "Started tests",
              "",
              "Background work still running:",
              "- shell (sh_1): bun test --watch",
              "- image (test/painter): /tmp/chart.png",
              `- subagent (subagent, sessionID: ${active}): ${active}`,
              "</subagent>",
            ].join("\n"),
          },
        },
      ])

      if (!shell.notificationID || !image.notificationID) return yield* Effect.die("background marker missing")
      yield* jobs.completeBackground(shell.notificationID)
      yield* jobs.completeBackground(image.notificationID)
      yield* Deferred.succeed(cleanup, undefined)
    }),
  )

  it.effect("reports each later busy period with its own boundary and without stale running work", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const jobs = yield* Job.Service
      const parent = sessionID("ses_period_parent")
      const child = sessionID("ses_period_child")
      yield* seedSessions(database, [parent])
      yield* seedSessions(database, [child], { parent_id: parent, agent: "explore", title: "Turn audit" })

      const shellDone = yield* Deferred.make<void>()
      const shell = yield* jobs.start({
        id: "sh_period_shell",
        type: "shell",
        recovery: { kind: "shell", sessionID: child, shellID: "sh_turn", command: "bun test" },
        background: true,
        run: Deferred.await(shellDone).pipe(Effect.as("done")),
      })
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const context = yield* buildExecution(scope, () => Effect.void)
      const execution = Context.get(context, SessionExecution.Service)

      yield* seedAssistant(database, child, 100, "Started tests")
      yield* execution.wake(child)
      yield* execution.awaitIdle(child)
      const first = yield* SessionInbox.list(database.db, parent)
      expect(text(first[0])).toContain("Started tests")
      expect(text(first[0])).toContain("Background work still running:\n- shell (sh_turn): bun test")

      // The shell finishing wakes the child: that is a new busy period with its own boundary.
      yield* Deferred.succeed(shellDone, undefined)
      yield* jobs.wait({ id: shell.id })
      const marker = (yield* jobs.pendingBackground)[0]
      if (!marker) return yield* Effect.die("shell marker missing")
      yield* jobs.completeBackground(marker.notificationID)
      yield* seedAssistant(database, child, 200, "Tests green")
      yield* execution.wake(child)
      yield* execution.awaitIdle(child)

      const second = yield* SessionInbox.list(database.db, parent)
      expect(second).toHaveLength(2)
      expect(second[1]?.id).not.toBe(first[0]?.id)
      expect(text(second[1])).toContain("Tests green")
      expect(text(second[1])).not.toContain("Started tests")
      expect(text(second[1])).not.toContain("Background work still running:")

      // A human or parent follow-up prompt is another period with its own answer.
      yield* seedAssistant(database, child, 300, "Follow-up answer")
      const inbox = yield* SessionInbox.Service
      yield* inbox.admit({
        id: SessionMessage.ID.create(),
        sessionID: child,
        item: { type: "user", payload: { text: "Follow up" }, delivery: "steer" },
      })
      yield* execution.wake(child)
      yield* execution.awaitIdle(child)
      const third = yield* SessionInbox.list(database.db, parent)
      expect(third).toHaveLength(3)
      expect(text(third[2])).toContain("Follow-up answer")
      expect(text(third[2])).not.toContain("Tests green")
    }),
  )

  it.effect("keeps control-only periods quiet while background jobs still report their own completion", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const jobs = yield* Job.Service
      const parent = sessionID("ses_quiet_parent")
      const child = sessionID("ses_quiet_child")
      const jobChild = sessionID("ses_quiet_job_child")
      yield* seedSessions(database, [parent])
      yield* seedSessions(database, [child, jobChild], { parent_id: parent })

      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const context = yield* buildExecution(scope, () => Effect.void)
      const execution = Context.get(context, SessionExecution.Service)

      // Empty wake and manual compaction both settle without a completed answer.
      yield* execution.wake(child)
      yield* execution.awaitIdle(child)
      const inbox = yield* SessionInbox.Service
      yield* inbox.admitCompaction({
        id: SessionMessage.ID.create(),
        sessionID: child,
        delivery: "steer",
      })
      yield* execution.wake(child)
      yield* execution.awaitIdle(child)
      expect(yield* SessionInbox.list(database.db, parent)).toEqual([])

      // A background Job promised a report marker: an empty run must clear it with NO_TEXT.
      const job = yield* jobs.start({
        id: jobChild,
        type: "subagent",
        recovery: {
          kind: "subagent",
          parentSessionID: parent,
          childSessionID: jobChild,
          agent: "explore",
          description: "Empty job",
        },
        background: true,
        run: execution.resume(jobChild).pipe(Effect.as("")),
      })
      yield* jobs.wait({ id: job.id })
      const reports = yield* SessionInbox.list(database.db, parent)
      expect(reports).toHaveLength(1)
      expect(text(reports[0])).toContain("Subagent completed without a text response.")
      expect(yield* jobs.pendingBackground).toEqual([])
      expect(yield* jobs.backgroundJobs).toEqual([])
    }),
  )

  it.effect("reports failures and user interruptions with running work preserved", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const jobs = yield* Job.Service
      const parent = sessionID("ses_terminal_parent")
      const failed = sessionID("ses_terminal_failed")
      const cancelled = sessionID("ses_terminal_cancelled")
      yield* seedSessions(database, [parent])
      yield* seedSessions(database, [failed, cancelled], { parent_id: parent, agent: "explore" })

      yield* jobs.start({
        id: "sh_terminal_failed",
        type: "shell",
        recovery: { kind: "shell", sessionID: failed, shellID: "sh_fail", command: "bun test" },
        background: true,
        run: Effect.never,
      })
      yield* jobs.start({
        id: "sh_terminal_cancelled",
        type: "shell",
        recovery: { kind: "shell", sessionID: cancelled, shellID: "sh_cancel", command: "bun test" },
        background: true,
        run: Effect.never,
      })

      const started = yield* Deferred.make<void>()
      const released = yield* Deferred.make<void>()
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const context = yield* buildExecution(scope, ({ sessionID }) => {
        if (sessionID === failed)
          return Effect.fail(
            new AIError({
              reason: new TransportError({ message: "Disconnected", transport: "http", operation: "request" }),
            }),
          )
        if (sessionID === cancelled)
          return Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(released)))
        return Effect.void
      })
      const execution = Context.get(context, SessionExecution.Service)

      yield* execution.wake(failed)
      yield* execution.awaitIdle(failed)
      const reports = yield* SessionInbox.list(database.db, parent)
      expect(text(reports[0])).toContain('state="error"')
      expect(text(reports[0])).toContain("Disconnected")
      expect(text(reports[0])).toContain("Background work still running:\n- shell (sh_fail): bun test")

      yield* execution.resume(cancelled).pipe(Effect.forkIn(scope))
      yield* Deferred.await(started)
      expect(yield* execution.interrupt(cancelled)).toBe(true)
      yield* execution.awaitIdle(cancelled)
      const afterCancel = yield* SessionInbox.list(database.db, parent)
      expect(afterCancel).toHaveLength(2)
      expect(text(afterCancel[1])).toContain('state="cancelled"')
      expect(text(afterCancel[1])).toContain("Subagent cancelled")
      expect(text(afterCancel[1])).toContain("Background work still running:\n- shell (sh_cancel): bun test")
    }),
  )

  it.effect("reports a creation-tick cancellation exactly once without a bound started event", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const jobs = yield* Job.Service
      const parent = sessionID("ses_tick_parent")
      const child = sessionID("ses_tick_child")
      yield* seedSessions(database, [parent])
      yield* seedSessions(database, [child], { parent_id: parent, agent: "explore", title: "Created then cancelled" })

      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const context = yield* buildExecution(scope, () => Effect.never)
      const execution = Context.get(context, SessionExecution.Service)
      const job = yield* jobs.start({
        id: child,
        type: "subagent",
        recovery: {
          kind: "subagent",
          parentSessionID: parent,
          childSessionID: child,
          agent: "explore",
          description: "Created then cancelled",
        },
        background: true,
        run: execution.resume(child).pipe(Effect.as("")),
      })

      // Match the tool's onInterrupt: cancel the job and interrupt the execution before
      // the coordinator's leading yield lets `started` run.
      yield* jobs.cancel(child)
      yield* execution.interrupt(child)
      yield* execution.awaitIdle(child)

      const reports = yield* SessionInbox.list(database.db, parent)
      expect(reports).toHaveLength(1)
      expect(text(reports[0])).toContain('state="cancelled"')
      expect(text(reports[0])).toContain(`sessionID="${child}"`)
      expect(yield* jobs.pendingBackground).toEqual([])
      expect(job.id).toBe(child)
    }),
  )

  it.effect("sends nothing on shutdown and preserves the claim and running job marker", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const jobs = yield* Job.Service
      const parent = sessionID("ses_shutdown_parent")
      const child = sessionID("ses_shutdown_child")
      yield* seedSessions(database, [parent])
      yield* seedSessions(database, [child], { parent_id: parent, agent: "explore", title: "Shutdown audit" })

      const started = yield* Deferred.make<void>()
      const scope = yield* Scope.make()
      const context = yield* buildExecution(scope, () =>
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      )
      const execution = Context.get(context, SessionExecution.Service)
      const job = yield* jobs.start({
        id: child,
        type: "subagent",
        recovery: {
          kind: "subagent",
          parentSessionID: parent,
          childSessionID: child,
          agent: "explore",
          description: "Shutdown audit",
        },
        background: true,
        run: execution.resume(child).pipe(Effect.as("")),
      })
      yield* Deferred.await(started)
      expect((yield* claims(database))[child]).toBe(true)

      yield* Scope.close(scope, Exit.void)
      yield* jobs.wait({ id: job.id })
      expect(yield* SessionInbox.list(database.db, parent)).toEqual([])
      // Shutdown keeps the claim and the running marker so the next boot resumes the turn.
      expect((yield* claims(database))[child]).toBe(true)
      const marker = (yield* jobs.pendingBackground)[0]
      expect(marker).toMatchObject({ id: child, status: "running" })
      if (marker) yield* jobs.completeBackground(marker.notificationID)
    }),
  )
})

describe("SubagentReport outbox", () => {
  it.effect("rolls back the idle projection and claim release when the report insert fails", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const parent = sessionID("ses_rollback_parent")
      const child = sessionID("ses_rollback_child")
      yield* seedSessions(database, [parent])
      yield* seedSessions(database, [child], { parent_id: parent })
      const context = yield* buildExecution(yield* Scope.Scope, () =>
        seedAssistant(database, child, 100, "Answer to report").pipe(Effect.asVoid),
      )
      const execution = Context.get(context, SessionExecution.Service)
      yield* Effect.acquireRelease(
        database.db.run(sql`CREATE TRIGGER fail_report BEFORE INSERT ON job BEGIN SELECT RAISE(ABORT, 'forced'); END`),
        () => database.db.run(sql`DROP TRIGGER fail_report`).pipe(Effect.orDie),
      )

      const exit = yield* execution.resume(child).pipe(Effect.exit)
      expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain("forced")
      const row = yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, child)).get()
      expect(row).toMatchObject({ time_suspended: expect.any(Number), time_idle: null, idle_outcome: null })
      expect(yield* SessionInbox.list(database.db, parent)).toEqual([])
    }),
  )

  it.effect("commits the report and release before delivery, then acknowledges and wakes the parent", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const store = yield* SessionStore.Service
      const jobs = yield* Job.Service
      const inbox = yield* SessionInbox.Service
      const parent = sessionID("ses_outbox_parent")
      const child = sessionID("ses_outbox_child")
      yield* seedSessions(database, [parent])
      yield* seedSessions(database, [child], { parent_id: parent, agent: "explore", title: "Outbox audit" })
      yield* seedAssistant(database, child, 100, "Outbox report")
      yield* store.claim(child)

      const wakes: SessionID[] = []
      const report = SubagentReport.make({
        store,
        jobs,
        inbox,
        draining: Effect.succeed(new Set()),
        wake: (sessionID) => Effect.sync(() => void wakes.push(sessionID)),
      })
      const job = yield* jobs.start({
        id: child,
        type: "subagent",
        recovery: {
          kind: "subagent",
          parentSessionID: parent,
          childSessionID: child,
          agent: "explore",
          description: "Outbox audit",
        },
        background: true,
        run: Effect.never,
      })
      const generation = (yield* jobs.currentGeneration(child))?.generation
      report.started(child, { startedSeq: 0, boundGeneration: generation })
      const settlement = yield* report.prepare(child, { type: "succeeded" })

      // Simulated crash right after the terminal publish: the release and outbox row are
      // already durable, and nothing has been admitted for the parent yet.
      yield* settlement.commit()
      expect(yield* claimValue(database, child)).toBeNull()
      expect(yield* SessionInbox.list(database.db, parent)).toEqual([])
      expect(yield* database.db.select().from(JobTable).all().pipe(Effect.orDie)).toMatchObject([
        {
          notification_id: job.notificationID,
          id: child,
          session_id: parent,
          status: "completed",
          output: "Outbox report",
        },
      ])

      yield* settlement.deliver
      expect(wakes).toEqual([parent])
      expect(yield* SessionInbox.list(database.db, parent)).toMatchObject([
        { type: "synthetic", payload: { text: expect.stringContaining("Outbox report") } },
      ])
      expect(yield* jobs.pendingBackground).toEqual([])

      // A staged revert admits the notice but never wakes the parent.
      const revertChild = sessionID("ses_outbox_revert_child")
      yield* seedSessions(database, [revertChild], { parent_id: parent, agent: "explore", title: "Reverted audit" })
      yield* database.db
        .update(SessionTable)
        .set({ revert: { messageID: SessionMessage.ID.create() } })
        .where(eq(SessionTable.id, parent))
        .run()
        .pipe(Effect.orDie)
      yield* seedAssistant(database, revertChild, 100, "Reverted report")
      const revertJob = yield* jobs.start({
        id: revertChild,
        type: "subagent",
        recovery: {
          kind: "subagent",
          parentSessionID: parent,
          childSessionID: revertChild,
          agent: "explore",
          description: "Reverted audit",
        },
        background: true,
        run: Effect.never,
      })
      const revertSettlement = yield* report.prepare(revertChild, { type: "succeeded" })
      yield* revertSettlement.commit()
      yield* revertSettlement.deliver
      expect(yield* SessionInbox.list(database.db, parent)).toHaveLength(2)
      expect(wakes).toEqual([parent])
      expect(yield* jobs.pendingBackground).toEqual([])
      expect(revertJob.notificationID).toBeDefined()
    }),
  )

  it.effect("acknowledges a parent deleted before or after commit without crashing", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const store = yield* SessionStore.Service
      const jobs = yield* Job.Service
      const inbox = yield* SessionInbox.Service
      const report = SubagentReport.make({
        store,
        jobs,
        inbox,
        draining: Effect.succeed(new Set()),
        wake: () => Effect.void,
      })

      for (const afterCommit of [false, true]) {
        const parent = sessionID(`ses_deleted_parent_${afterCommit}`)
        const child = sessionID(`ses_deleted_child_${afterCommit}`)
        yield* seedSessions(database, [parent])
        yield* seedSessions(database, [child], { parent_id: parent, agent: "explore", title: "Deleted audit" })
        yield* seedAssistant(database, child, 100, "Deletion report")
        yield* store.claim(child)
        const job = yield* jobs.start({
          id: child,
          type: "subagent",
          recovery: {
            kind: "subagent",
            parentSessionID: parent,
            childSessionID: child,
            agent: "explore",
            description: "Deleted audit",
          },
          background: true,
          run: Effect.never,
        })
        const settlement = yield* report.prepare(child, { type: "succeeded" })
        if (!afterCommit) {
          yield* database.db.delete(SessionTable).where(eq(SessionTable.id, parent)).run().pipe(Effect.orDie)
        }
        yield* settlement.commit()
        if (afterCommit) {
          yield* database.db.delete(SessionTable).where(eq(SessionTable.id, parent)).run().pipe(Effect.orDie)
        }
        yield* settlement.deliver
        expect(yield* jobs.pendingBackground).toEqual([])
        expect(yield* SessionInbox.list(database.db, parent)).toEqual([])
        expect(job.notificationID).toBeDefined()
      }
    }),
  )

  it.effect("retains a conflicted marker and keeps the settled hook alive", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const jobs = yield* Job.Service
      const inbox = yield* SessionInbox.Service
      const parent = sessionID("ses_conflict_parent")
      const child = sessionID("ses_conflict_child")
      yield* seedSessions(database, [parent])
      yield* seedSessions(database, [child], { parent_id: parent, agent: "explore", title: "Conflict audit" })

      const notificationID = SessionMessage.ID.create()
      yield* inbox.admit({
        id: notificationID,
        sessionID: parent,
        item: { type: "user", payload: { text: "User input" }, delivery: "steer" },
      })
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const context = yield* buildExecution(scope, () => Effect.void)
      const execution = Context.get(context, SessionExecution.Service)
      const job = yield* jobs.start({
        id: child,
        type: "subagent",
        recovery: {
          kind: "subagent",
          parentSessionID: parent,
          childSessionID: child,
          agent: "explore",
          description: "Conflict audit",
        },
        notificationID,
        background: true,
        run: execution.resume(child).pipe(Effect.as("")),
      })

      yield* jobs.wait({ id: job.id })
      // Settlement must not die on admission conflict, and the durable marker is retained.
      yield* execution.awaitIdle(child)
      expect(yield* jobs.pendingBackground).toMatchObject([{ notificationID, status: "completed" }])
      expect(yield* SessionInbox.list(database.db, parent)).toMatchObject([
        { type: "user", payload: { text: "User input" } },
      ])
      const marker = (yield* jobs.pendingBackground)[0]
      if (marker) yield* jobs.completeBackground(marker.notificationID)
    }),
  )
})

function sessionID(value: string): SessionID {
  return SessionSchema.ID.make(value)
}

function text(item: SessionInbox.Info | undefined) {
  if (item?.type !== "synthetic") return ""
  return item.payload.text
}

/** Builds the local execution layer against the harness services and a stubbed runner. */
function buildExecution(scope: Scope.Scope, drain: Drain) {
  return Effect.gen(function* () {
    const database = yield* Database.Service
    const bus = yield* Bus.Service
    const store = yield* SessionStore.Service
    const jobs = yield* Job.Service
    const inbox = yield* SessionInbox.Service
    const runner = Layer.succeed(
      SessionRunner.Service,
      SessionRunner.Service.of({
        drain: (input) => drain(input).pipe(Effect.as(SessionRunner.DrainResult.Complete())),
      }),
    )
    const locations = Layer.effect(
      LocationServiceMap.Service,
      LayerMap.make(
        () =>
          // The settlement test only needs the Session runner from the Location graph.
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          runner as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>,
      ),
    )
    return yield* Layer.buildWithScope(
      SessionExecution.layer.pipe(
        Layer.provide(Layer.succeed(Database.Service, database)),
        Layer.provide(Layer.succeed(Bus.Service, bus)),
        Layer.provide(Layer.succeed(SessionStore.Service, store)),
        Layer.provide(Layer.succeed(SessionInbox.Service, inbox)),
        Layer.provide(Layer.succeed(Job.Service, jobs)),
        Layer.provide(
          AppNodeBuilder.build(Instance.node, [LocationServiceMap.node.replace(locations)]).pipe(Layer.fresh),
        ),
      ),
      scope,
    )
  })
}

type SeedValues = Partial<
  Pick<typeof SessionTable.$inferInsert, "time_suspended" | "resume_attempts" | "parent_id" | "title" | "revert">
> & { readonly agent?: string }

function seedSessions(
  database: Database.Service["Service"],
  sessionIDs: ReadonlyArray<SessionID>,
  values: SeedValues = {},
) {
  return Effect.gen(function* () {
    const { agent, ...rest } = values
    yield* database.db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* database.db
      .insert(SessionTable)
      .values(
        sessionIDs.map((id) => ({
          id,
          project_id: Project.ID.global,
          slug: id,
          directory: "/project",
          title: id,
          version: "test",
          ...rest,
          ...(agent ? { agent: Agent.ID.make(agent) } : {}),
        })),
      )
      .run()
      .pipe(Effect.orDie)
  })
}

const encodeMessage = Schema.encodeSync(SessionMessage.Info)

function seedAssistant(database: Database.Service["Service"], sessionID: SessionID, seq: number, text: string) {
  const id = SessionMessage.ID.make(`msg_seed_${sessionID}_${seq}`)
  const {
    id: _,
    type,
    ...data
  } = encodeMessage(
    SessionMessage.Assistant.make({
      id,
      type: "assistant",
      agent: Agent.ID.make("build"),
      model: { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") },
      content: [SessionMessage.AssistantText.make({ type: "text", text })],
      time: { created: DateTime.makeUnsafe(0), completed: DateTime.makeUnsafe(1) },
    }),
  )
  return database.db
    .insert(SessionMessageTable)
    .values({ id, session_id: sessionID, type, seq, time_created: 0, data })
    .run()
    .pipe(Effect.orDie)
}

function claimValue(database: Database.Service["Service"], sessionID: SessionID) {
  return database.db
    .select({ claimed: SessionTable.time_suspended })
    .from(SessionTable)
    .where(eq(SessionTable.id, sessionID))
    .get()
    .pipe(
      Effect.orDie,
      Effect.map((row) => row?.claimed),
    )
}

function claims(database: Database.Service["Service"]) {
  return database.db
    .select({ id: SessionTable.id, claimed: SessionTable.time_suspended })
    .from(SessionTable)
    .all()
    .pipe(
      Effect.orDie,
      Effect.map((rows) => Object.fromEntries(rows.map((row) => [row.id, row.claimed !== null]))),
    )
}
