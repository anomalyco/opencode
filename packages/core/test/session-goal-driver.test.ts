import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Deferred, Effect, Layer, Stream } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionContext } from "@opencode/core/session/context"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionGoal } from "@opencode/core/session/goal"
import { SessionGoalActivation } from "@opencode/core/session/goal-activation"
import { SessionGoalDriver } from "@opencode/core/session/goal-driver"
import { SessionGoalVerify } from "@opencode/core/session/goal-verify"
import { SessionInbox } from "@opencode/core/session/inbox"
import { GoalPlugin } from "@opencode/core/plugin/goal"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionGoalTable, SessionTable } from "@opencode/core/session/sql"
import { testEffect } from "./lib/effect"
import { host } from "./plugin/host"

const sessionID = SessionSchema.ID.make("ses_goal_driver_test")

// The driver only admits rounds and reads the inbox; the rest of the Session
// surface is unreachable from here.
const rounds: Array<Parameters<Session.Interface["synthetic"]>[0]> = []
const pending: SessionInbox.Info[] = []
const verified: SessionSchema.ID[] = []
let completeGoal: (sessionID: SessionSchema.ID) => Effect.Effect<void> = () => Effect.void
let verifyStarted: Deferred.Deferred<void> | undefined
let verifyGate: Deferred.Deferred<void> | undefined

const reset = () => {
  rounds.length = 0
  pending.length = 0
  verified.length = 0
  completeGoal = () => Effect.void
  verifyStarted = undefined
  verifyGate = undefined
}

const sessionLayer = Layer.succeed(
  Session.Service,
  Session.Service.of({
    // The real admission path publishes `session.inbox.enqueued`, whose projection
    // owns the round count; the stub keeps that contract instead of counting itself.
    synthetic: (input: Parameters<Session.Interface["synthetic"]>[0]) =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        rounds.push(input)
        const id = SessionMessage.ID.create()
        const delivery = input.delivery ?? "steer"
        const event = yield* bus.publish(SessionEvent.InboxEnqueued, {
          inboxID: id,
          sessionID: input.sessionID,
          item: {
            type: "synthetic",
            payload: { text: input.text, description: input.description, metadata: input.metadata },
            delivery,
          },
        })
        return {
          id,
          sessionID: input.sessionID,
          time: { created: event.created },
          type: "synthetic" as const,
          payload: { text: input.text, description: input.description, metadata: input.metadata },
          delivery,
        }
      }),
    inbox: () => Effect.succeed(pending),
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  } as unknown as Session.Interface),
)

// The stub stands in for the verifier's LLM round; the test decides what the
// verdict does to the goal.
const verifyLayer = Layer.succeed(
  SessionGoalVerify.Service,
  SessionGoalVerify.Service.of({
    verify: (id) =>
      Effect.gen(function* () {
        verified.push(id)
        if (verifyStarted) yield* Deferred.succeed(verifyStarted, undefined)
        if (verifyGate) yield* Deferred.await(verifyGate)
        yield* completeGoal(id)
      }),
  }),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionGoal.node,
      SessionGoalActivation.node,
      Session.node,
      SessionGoalVerify.node,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      Session.node.replace(sessionLayer),
      SessionGoalVerify.node.replace(verifyLayer),
    ],
  ),
)

// The verifier stub ignores the request builder, so the driver's own contract is
// what these tests observe.
const context = {} as SessionContext.Interface

// Only `type` and `data` are read by the driver.
const driverEvent = (type: string, data: object) =>
  ({ type, data }) as unknown as SessionGoalDriver.SessionGoalDriverEvent

const userItem = {
  id: SessionMessage.ID.create(),
  sessionID,
  time: { created: 0 },
  type: "user",
  payload: { text: "hello" },
  delivery: "steer",
} as unknown as SessionInbox.Info

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "goal-driver-test",
      directory: "/project",
      title: "Goal driver test",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
  return {
    db,
    bus: yield* Bus.Service,
    goal: yield* SessionGoal.Service,
    activation: yield* SessionGoalActivation.Service,
  }
})

/** An armed, active goal with one open todo item. */
const start = Effect.gen(function* () {
  const { db, bus, goal, activation } = yield* setup
  const snapshot = yield* goal.update(sessionID, { action: "set", objective: "ship it" })
  yield* goal.replaceTodo(sessionID, [{ content: "first", status: "pending", acceptance: "tests pass" }])
  yield* activation.arm(sessionID)
  return { db, bus, goal, activation, snapshot }
})

describe("SessionGoalDriver", () => {
  it.effect("a succeeded execution admits exactly one round", () =>
    Effect.gen(function* () {
      reset()
      yield* start
      yield* SessionGoalDriver.onSucceeded(sessionID, context)
      expect(verified).toEqual([sessionID])
      expect(rounds).toHaveLength(1)
      expect(rounds[0]?.text).toContain("ship it")
      expect(rounds[0]?.delivery).toBe("steer")
      expect(rounds[0]?.metadata).toEqual({ source: "goal", round: 1 })
    }),
  )

  it.effect("a pending human item yields the floor", () =>
    Effect.gen(function* () {
      reset()
      yield* start
      pending.push(userItem)
      yield* SessionGoalDriver.onSucceeded(sessionID, context)
      expect(verified).toEqual([sessionID])
      expect(rounds).toHaveLength(0)
    }),
  )

  it.effect("an exhausted round budget pushes the goal to blocked", () =>
    Effect.gen(function* () {
      reset()
      const { bus, goal, snapshot } = yield* start
      yield* bus.publish(SessionEvent.Goal.Updated, { sessionID, snapshot: { ...snapshot, maxGoalRounds: 0 } })
      yield* SessionGoalDriver.onSucceeded(sessionID, context)
      expect(yield* goal.read(sessionID)).toMatchObject({
        phase: "blocked",
        blockedReason: { code: "max_rounds" },
      })
      expect(rounds).toHaveLength(0)
    }),
  )

  it.effect("a settled list admits no further round", () =>
    Effect.gen(function* () {
      reset()
      const { goal } = yield* start
      yield* goal.replaceTodo(sessionID, [{ content: "first", status: "cancelled" }])
      yield* SessionGoalDriver.onSucceeded(sessionID, context)
      expect(rounds).toHaveLength(0)
    }),
  )

  it.effect("a goal the verifier completed admits no further round", () =>
    Effect.gen(function* () {
      reset()
      const { goal } = yield* start
      completeGoal = (id) => goal.complete(id)
      yield* SessionGoalDriver.onSucceeded(sessionID, context)
      expect(yield* goal.read(sessionID)).toMatchObject({ phase: "complete" })
      expect(rounds).toHaveLength(0)
    }),
  )

  it.effect("a disarmed active goal is re-armed at the idle boundary", () =>
    Effect.gen(function* () {
      reset()
      const { activation } = yield* start
      yield* activation.disarm(sessionID)
      yield* SessionGoalDriver.onSucceeded(sessionID, context)
      expect(yield* activation.isArmed(sessionID)).toBe(true)
      expect(verified).toEqual([sessionID])
      expect(rounds).toHaveLength(1)
    }),
  )

  it.effect("a human turn re-arms the goal at the next idle boundary", () =>
    Effect.gen(function* () {
      reset()
      const { activation } = yield* start
      yield* SessionGoalDriver.handle(
        driverEvent("session.inbox.enqueued", { sessionID, item: { type: "user" } }),
        context,
      )
      expect(yield* activation.isArmed(sessionID)).toBe(false)
      yield* SessionGoalDriver.onSucceeded(sessionID, context)
      expect(yield* activation.isArmed(sessionID)).toBe(true)
      expect(verified).toEqual([sessionID])
      expect(rounds).toHaveLength(1)
    }),
  )

  it.effect("an empty todo list admits a round", () =>
    Effect.gen(function* () {
      reset()
      const { goal } = yield* start
      yield* goal.replaceTodo(sessionID, [])
      yield* SessionGoalDriver.onSucceeded(sessionID, context)
      expect(verified).toEqual([sessionID])
      expect(rounds).toHaveLength(1)
    }),
  )

  it.effect("a slow verification for one session does not block another session's disarm", () =>
    Effect.gen(function* () {
      reset()
      const { activation } = yield* start
      const other = SessionSchema.ID.make("ses_goal_driver_other")
      yield* activation.arm(other)
      verifyStarted = yield* Deferred.make<void>()
      verifyGate = yield* Deferred.make<void>()
      yield* SessionGoalDriver.run(
        Stream.fromIterable([
          driverEvent("session.execution.succeeded", { sessionID }),
          driverEvent("session.inbox.enqueued", { sessionID: other, item: { type: "user" } }),
        ]),
        context,
      ).pipe(Effect.forkScoped({ startImmediately: true }))
      yield* Deferred.await(verifyStarted)
      // The other session's disarm must not wait behind this verification.
      yield* Effect.forEach(Array.from({ length: 50 }), () => Effect.yieldNow, { discard: true })
      expect(yield* activation.isArmed(other)).toBe(false)
      yield* Deferred.succeed(verifyGate, undefined)
    }),
  )

  it.effect("the plugin keeps a slow verification from blocking another session's disarm", () =>
    Effect.gen(function* () {
      reset()
      const { activation } = yield* start
      const other = SessionSchema.ID.make("ses_goal_driver_other")
      yield* activation.arm(other)
      verifyStarted = yield* Deferred.make<void>()
      verifyGate = yield* Deferred.make<void>()
      yield* GoalPlugin.Plugin.effect(
        host({
          event: {
            subscribe: () =>
              Stream.fromIterable([
                driverEvent("session.execution.succeeded", { sessionID }),
                driverEvent("session.inbox.enqueued", { sessionID: other, item: { type: "user" } }),
              ]),
          },
        }),
      ).pipe(Effect.provideService(SessionContext.Service, context))
      yield* Deferred.await(verifyStarted)
      yield* Effect.forEach(Array.from({ length: 50 }), () => Effect.yieldNow, { discard: true })
      expect(yield* activation.isArmed(other)).toBe(false)
      yield* Deferred.succeed(verifyGate, undefined)
    }),
  )

  it.effect("a paused goal admits nothing even while armed", () =>
    Effect.gen(function* () {
      reset()
      const { bus, activation, snapshot } = yield* start
      yield* bus.publish(SessionEvent.Goal.Updated, { sessionID, snapshot: { ...snapshot, phase: "paused" } })
      yield* activation.arm(sessionID)
      yield* SessionGoalDriver.onSucceeded(sessionID, context)
      expect(verified).toHaveLength(0)
      expect(rounds).toHaveLength(0)
    }),
  )

  it.effect("a human enqueue disarms the goal", () =>
    Effect.gen(function* () {
      reset()
      const { activation } = yield* start
      yield* SessionGoalDriver.handle(
        driverEvent("session.inbox.enqueued", { sessionID, item: { type: "user" } }),
        context,
      )
      expect(yield* activation.isArmed(sessionID)).toBe(false)
    }),
  )

  it.effect("a shutdown interruption disarms the goal", () =>
    Effect.gen(function* () {
      reset()
      const { activation } = yield* start
      yield* SessionGoalDriver.handle(
        driverEvent("session.execution.interrupted", { sessionID, reason: "shutdown" }),
        context,
      )
      expect(yield* activation.isArmed(sessionID)).toBe(false)
    }),
  )

  it.effect("a failed execution disarms the goal", () =>
    Effect.gen(function* () {
      reset()
      const { activation } = yield* start
      yield* SessionGoalDriver.handle(driverEvent("session.execution.failed", { sessionID }), context)
      expect(yield* activation.isArmed(sessionID)).toBe(false)
    }),
  )

  it.effect("a forked session disarms the goal", () =>
    Effect.gen(function* () {
      reset()
      const { activation } = yield* start
      yield* SessionGoalDriver.handle(driverEvent("session.forked", { sessionID }), context)
      expect(yield* activation.isArmed(sessionID)).toBe(false)
    }),
  )

  it.effect("a compaction failure disarms the goal", () =>
    Effect.gen(function* () {
      reset()
      const { activation } = yield* start
      yield* SessionGoalDriver.handle(driverEvent("session.compaction.failed", { sessionID }), context)
      expect(yield* activation.isArmed(sessionID)).toBe(false)
    }),
  )

  it.effect("a deliberate interruption leaves the goal armed", () =>
    Effect.gen(function* () {
      reset()
      const { activation } = yield* start
      yield* SessionGoalDriver.handle(
        driverEvent("session.execution.interrupted", { sessionID, reason: "user" }),
        context,
      )
      expect(yield* activation.isArmed(sessionID)).toBe(true)
    }),
  )
})

describe("SessionGoalDriver rounds", () => {
  it.effect("a silent verifier cannot schedule past the round budget", () =>
    Effect.gen(function* () {
      reset()
      const { db, goal, snapshot } = yield* start
      // `reset()` leaves the verifier stub publishing nothing, so only the durable
      // count written by the scheduled row's projection can stop the sequence.
      const budget = snapshot.maxGoalRounds
      const counts = yield* Effect.forEach(
        Array.from({ length: budget + 2 }),
        () => SessionGoalDriver.onSucceeded(sessionID, context).pipe(Effect.andThen(roundCount(db))),
      )
      expect(counts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 8, 8])
      expect(rounds).toHaveLength(budget)
      expect(yield* goal.read(sessionID)).toMatchObject({
        phase: "blocked",
        blockedReason: { code: "max_rounds" },
      })
    }),
  )

  it.effect("a verdict does not count a round by itself", () =>
    Effect.gen(function* () {
      reset()
      const { db, bus, goal } = yield* start
      const current = yield* goal.read(sessionID)
      yield* bus.publish(SessionEvent.Todo.Verified, {
        sessionID,
        revision: current?.revision ?? 0,
        items: [{ position: 0, status: "pending", feedback: "not yet" }],
      })
      // The scheduled inbox row is the only writer: a verdict alone must not move
      // the counter.
      expect(yield* roundCount(db)).toBe(0)
    }),
  )
})

const roundCount = (db: Database.Interface["db"]) =>
  db
    .select({ rounds: SessionGoalTable.rounds })
    .from(SessionGoalTable)
    .where(eq(SessionGoalTable.session_id, sessionID))
    .get()
    .pipe(
      Effect.orDie,
      Effect.map((row) => row?.rounds ?? 0),
    )
