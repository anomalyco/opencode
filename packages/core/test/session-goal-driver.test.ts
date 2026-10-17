import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
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
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionGoalTable, SessionTable } from "@opencode/core/session/sql"
import { testEffect } from "./lib/effect"

const sessionID = SessionSchema.ID.make("ses_goal_driver_test")

// The driver only admits rounds and reads the inbox; the rest of the Session
// surface is unreachable from here.
const rounds: Array<Parameters<Session.Interface["synthetic"]>[0]> = []
const pending: SessionInbox.Info[] = []
const verified: SessionSchema.ID[] = []
let completeGoal: (sessionID: SessionSchema.ID) => Effect.Effect<void> = () => Effect.void

const reset = () => {
  rounds.length = 0
  pending.length = 0
  verified.length = 0
  completeGoal = () => Effect.void
}

const sessionLayer = Layer.succeed(
  Session.Service,
  Session.Service.of({
    synthetic: (input: Parameters<Session.Interface["synthetic"]>[0]) =>
      Effect.sync(() => {
        rounds.push(input)
        return {
          id: SessionMessage.ID.create(),
          sessionID: input.sessionID,
          time: { created: 0 },
          type: "synthetic" as const,
          payload: { text: input.text },
          delivery: "steer" as const,
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
    verify: (id) => Effect.sync(() => verified.push(id)).pipe(Effect.andThen(completeGoal(id))),
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

  it.effect("a disarmed goal admits nothing", () =>
    Effect.gen(function* () {
      reset()
      const { activation } = yield* start
      yield* activation.disarm(sessionID)
      yield* SessionGoalDriver.onSucceeded(sessionID, context)
      expect(verified).toHaveLength(0)
      expect(rounds).toHaveLength(0)
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
  it.effect("a verification advances the durable round counter", () =>
    Effect.gen(function* () {
      reset()
      const { db, bus, goal } = yield* start
      const current = yield* goal.read(sessionID)
      yield* bus.publish(SessionEvent.Todo.Verified, {
        sessionID,
        revision: current?.revision ?? 0,
        items: [{ position: 0, status: "pending", feedback: "not yet" }],
      })
      const row = yield* db
        .select({ rounds: SessionGoalTable.rounds })
        .from(SessionGoalTable)
        .where(eq(SessionGoalTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie)
      expect(row?.rounds).toBe(1)
    }),
  )
})
