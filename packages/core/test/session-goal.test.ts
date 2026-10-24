import { describe, expect } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionGoal } from "@opencode/core/session/goal"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionGoalTable, SessionTable } from "@opencode/core/session/sql"
import { SessionGoal as GoalSchema } from "@opencode/schema/session-goal"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionProjector.node]), [
    Bus.node.replace(Bus.configured({ persist: true })),
  ]),
)

const sessionID = SessionSchema.ID.make("ses_goal_test")

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
      slug: "goal-test",
      directory: "/project",
      title: "Goal test",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
  return { db, bus: yield* Bus.Service }
})

const snapshot = (revision: number, overrides?: Partial<GoalSchema.Snapshot>): GoalSchema.Snapshot => ({
  id: GoalSchema.ID.make("goal_test"),
  revision,
  objective: "ship it",
  phase: "active",
  maxGoalRounds: 8,
  ...overrides,
})

const todos = [
  { content: "first", status: "pending" as const, acceptance: "tests pass" },
  { content: "second", status: "in_progress" as const },
]

const rounds = (db: Effect.Success<typeof setup>["db"]) =>
  db
    .select({ rounds: SessionGoalTable.rounds })
    .from(SessionGoalTable)
    .where(eq(SessionGoalTable.session_id, sessionID))
    .get()
    .pipe(Effect.orDie)

describe("SessionGoal", () => {
  it.effect("migration creates the session_goal and session_todo tables", () =>
    Effect.gen(function* () {
      const { db } = yield* setup
      const tables = yield* db
        .all<{ name: string }>(
          sql`select name from sqlite_master where type = 'table' and name in ('session_goal', 'session_todo')`,
        )
        .pipe(Effect.orDie)
      expect(tables.map((row) => row.name).toSorted()).toEqual(["session_goal", "session_todo"])
    }),
  )

  it.effect("goal.updated upserts and the latest event wins", () =>
    Effect.gen(function* () {
      const { db, bus } = yield* setup
      yield* bus.publish(SessionEvent.Goal.Updated, { sessionID, snapshot: snapshot(1) })
      expect(yield* SessionGoal.read(db, sessionID)).toMatchObject({ revision: 1, objective: "ship it" })

      // A newer revision wins.
      yield* bus.publish(SessionEvent.Goal.Updated, { sessionID, snapshot: snapshot(2, { phase: "paused" }) })
      expect(yield* SessionGoal.read(db, sessionID)).toMatchObject({ revision: 2, phase: "paused" })
    }),
  )

  it.effect("goal.updated replaces the goal when the id differs, even at a lower revision", () =>
    Effect.gen(function* () {
      const { db, bus } = yield* setup
      yield* bus.publish(SessionEvent.Goal.Updated, { sessionID, snapshot: snapshot(5) })
      yield* bus.publish(SessionEvent.Goal.Updated, {
        sessionID,
        snapshot: snapshot(1, { id: GoalSchema.ID.make("goal_other"), objective: "new goal" }),
      })
      expect(yield* SessionGoal.read(db, sessionID)).toMatchObject({
        id: "goal_other",
        revision: 1,
        objective: "new goal",
      })
    }),
  )

  it.effect("goal.cleared removes the row and its todo list", () =>
    Effect.gen(function* () {
      const { db, bus } = yield* setup
      yield* bus.publish(SessionEvent.Goal.Updated, { sessionID, snapshot: snapshot(1) })
      yield* bus.publish(SessionEvent.Todo.Updated, { sessionID, revision: 2, todos })
      expect(yield* SessionGoal.readTodo(db, sessionID)).toHaveLength(2)

      yield* bus.publish(SessionEvent.Goal.Cleared, {
        sessionID,
        goalID: GoalSchema.ID.make("goal_test"),
        revision: 3,
      })
      expect(yield* SessionGoal.read(db, sessionID)).toBeUndefined()
      expect(yield* SessionGoal.readTodo(db, sessionID)).toEqual([])
    }),
  )

  it.effect("a new goal identity clears the previous todo list", () =>
    Effect.gen(function* () {
      const { db, bus } = yield* setup
      yield* bus.publish(SessionEvent.Goal.Updated, { sessionID, snapshot: snapshot(1) })
      yield* bus.publish(SessionEvent.Todo.Updated, { sessionID, revision: 2, todos })

      yield* bus.publish(SessionEvent.Goal.Updated, {
        sessionID,
        snapshot: snapshot(3, { id: GoalSchema.ID.make("goal_other") }),
      })
      expect(yield* SessionGoal.readTodo(db, sessionID)).toEqual([])
    }),
  )

  it.effect("todo.updated replaces the whole list and a replayed event is a no-op", () =>
    Effect.gen(function* () {
      const { db, bus } = yield* setup
      yield* bus.publish(SessionEvent.Goal.Updated, { sessionID, snapshot: snapshot(1) })
      yield* bus.publish(SessionEvent.Todo.Updated, { sessionID, revision: 2, todos })
      expect(yield* SessionGoal.readTodo(db, sessionID)).toEqual([
        { position: 0, content: "first", status: "pending", acceptance: "tests pass", feedback: undefined },
        { position: 1, content: "second", status: "in_progress", acceptance: undefined, feedback: undefined },
      ])

      // The same revision arrives twice; only the first one advances the goal.
      yield* bus.publish(SessionEvent.Todo.Updated, { sessionID, revision: 2, todos: [todos[0]] })
      expect(yield* SessionGoal.readTodo(db, sessionID)).toHaveLength(2)
    }),
  )

  it.effect("todo.updated never rewinds the goal revision, so a stale verdict stays rejected", () =>
    Effect.gen(function* () {
      const { db, bus } = yield* setup
      yield* bus.publish(SessionEvent.Goal.Updated, { sessionID, snapshot: snapshot(1) })
      yield* bus.publish(SessionEvent.Todo.Updated, { sessionID, revision: 2, todos })
      yield* bus.publish(SessionEvent.Todo.Updated, { sessionID, revision: 3, todos })

      // A late list event carrying an older revision must not move the goal back to a
      // number a verdict judged against the previous list still carries.
      yield* bus.publish(SessionEvent.Todo.Updated, { sessionID, revision: 2, todos: [todos[0]] })
      expect(yield* SessionGoal.read(db, sessionID)).toMatchObject({ revision: 3 })
      expect(yield* SessionGoal.readTodo(db, sessionID)).toHaveLength(2)

      yield* bus.publish(SessionEvent.Todo.Verified, {
        sessionID,
        revision: 2,
        items: [{ position: 0, status: "completed", feedback: "stale" }],
      })
      expect((yield* rounds(db))?.rounds).toBe(0)
      expect(yield* SessionGoal.readTodo(db, sessionID)).toEqual([
        { position: 0, content: "first", status: "pending", acceptance: "tests pass", feedback: undefined },
        { position: 1, content: "second", status: "in_progress", acceptance: undefined, feedback: undefined },
      ])
    }),
  )

  it.effect("todo.updated without a goal row is dropped", () =>
    Effect.gen(function* () {
      const { db, bus } = yield* setup
      // A list only exists under a goal, so an event without one leaves no state.
      yield* bus.publish(SessionEvent.Todo.Updated, { sessionID, revision: 1, todos })
      expect(yield* SessionGoal.read(db, sessionID)).toBeUndefined()
      expect(yield* SessionGoal.readTodo(db, sessionID)).toEqual([])
    }),
  )

  it.effect("todo.verified applies a fresh verdict and advances rounds", () =>
    Effect.gen(function* () {
      const { db, bus } = yield* setup
      yield* bus.publish(SessionEvent.Goal.Updated, { sessionID, snapshot: snapshot(1) })
      yield* bus.publish(SessionEvent.Todo.Updated, { sessionID, revision: 2, todos })
      yield* bus.publish(SessionEvent.Todo.Verified, {
        sessionID,
        revision: 2,
        items: [
          { position: 0, status: "completed", feedback: "ok" },
          { position: 1, status: "in_progress", feedback: "needs work" },
        ],
      })
      expect(yield* SessionGoal.readTodo(db, sessionID)).toEqual([
        { position: 0, content: "first", status: "completed", acceptance: "tests pass", feedback: "ok" },
        { position: 1, content: "second", status: "in_progress", acceptance: undefined, feedback: "needs work" },
      ])
      expect((yield* rounds(db))?.rounds).toBe(1)
    }),
  )

  it.effect("todo.verified rejects a verdict judged against a stale list", () =>
    Effect.gen(function* () {
      const { db, bus } = yield* setup
      yield* bus.publish(SessionEvent.Goal.Updated, { sessionID, snapshot: snapshot(1) })
      yield* bus.publish(SessionEvent.Todo.Updated, { sessionID, revision: 2, todos })
      // The list is replaced after the verifier read it.
      yield* bus.publish(SessionEvent.Todo.Updated, { sessionID, revision: 3, todos })

      yield* bus.publish(SessionEvent.Todo.Verified, {
        sessionID,
        revision: 2,
        items: [{ position: 0, status: "completed", feedback: "stale" }],
      })
      expect(yield* SessionGoal.readTodo(db, sessionID)).toEqual([
        { position: 0, content: "first", status: "pending", acceptance: "tests pass", feedback: undefined },
        { position: 1, content: "second", status: "in_progress", acceptance: undefined, feedback: undefined },
      ])
      expect((yield* rounds(db))?.rounds).toBe(0)
    }),
  )

  it.effect("todo.verified with no goal row is a no-op", () =>
    Effect.gen(function* () {
      const { db, bus } = yield* setup
      yield* bus.publish(SessionEvent.Todo.Updated, { sessionID, revision: 1, todos })
      yield* bus.publish(SessionEvent.Todo.Verified, {
        sessionID,
        revision: 1,
        items: [{ position: 0, status: "completed", feedback: "ok" }],
      })
      expect(yield* SessionGoal.read(db, sessionID)).toBeUndefined()
      expect(yield* SessionGoal.readTodo(db, sessionID)).toEqual([])
    }),
  )
})
