import { describe, expect, it } from "bun:test"
import { Effect, Layer, Option, Schema, Stream } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionContext } from "@opencode/core/session/context"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionGoal } from "@opencode/core/session/goal"
import { SessionGoalActivation } from "@opencode/core/session/goal-activation"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionTable } from "@opencode/core/session/sql"
import { Tool } from "@opencode/core/tool"
import { GoalTool } from "@opencode/core/tool/plugin/goal"
import { GoalTodoTool } from "@opencode/core/tool/plugin/goal-todo"
import { TodoTool } from "@opencode/core/tool/plugin/todo"
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { executeTool, registerToolPlugin, toolDefinitions, toolIdentity } from "./lib/tool"
import { permissionLayer } from "./lib/permission"
import { testEffect } from "./lib/effect"

const sessionID = SessionSchema.ID.make("ses_goal_tool_test")

const goalToolNode = makeLocationNode({
  name: "test/goal-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(GoalTool.Plugin)),
  deps: [Tool.node, SessionGoal.node],
})

const goalTodoToolNode = makeLocationNode({
  name: "test/goal-todo-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(GoalTodoTool.Plugin)),
  deps: [Tool.node, SessionGoal.node],
})

const toolIt = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionGoal.node,
      SessionGoalActivation.node,
      Tool.node,
      goalToolNode,
      goalTodoToolNode,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      SessionExecution.node.replace(SessionExecution.noopLayer),
    ],
  ),
)

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
      slug: "goal-tool-test",
      directory: "/project",
      title: "Goal tool test",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
  return { db, bus: yield* Bus.Service, goal: yield* SessionGoal.Service, tools: yield* Tool.Service }
})

const textOf = (content: ReadonlyArray<Tool.Content> | undefined) =>
  (content ?? []).flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")

describe("GoalTool", () => {
  it("only exposes edit and pause", () => {
    for (const action of ["set", "clear", "resume"]) {
      expect(Option.isNone(Schema.decodeUnknownOption(GoalTool.Input)({ action }))).toBe(true)
    }
    for (const action of ["edit", "pause"]) {
      expect(Option.isSome(Schema.decodeUnknownOption(GoalTool.Input)({ action }))).toBe(true)
    }
  })

  toolIt.effect("edits the goal and reports the state back", () =>
    Effect.gen(function* () {
      const { goal, tools } = yield* setup
      yield* goal.update(sessionID, { action: "set", objective: "ship it" })
      const result = yield* executeTool(tools, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-goal-edit",
          name: "goal",
          input: { action: "edit", objective: "ship it well" },
        },
      })
      expect(result.status).toBe("completed")
      expect(result.output).toMatchObject({
        goal: { objective: "ship it well", phase: "active" },
        rounds: 0,
        maxGoalRounds: 8,
      })
      expect(yield* goal.read(sessionID)).toMatchObject({ objective: "ship it well", phase: "active" })
    }),
  )

  toolIt.effect("pauses without cancelling the turn that asked", () =>
    Effect.gen(function* () {
      const { goal, tools } = yield* setup
      yield* goal.update(sessionID, { action: "set", objective: "ship it" })
      const result = yield* executeTool(tools, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-goal-pause", name: "goal", input: { action: "pause" } },
      })
      expect(result.status).toBe("completed")
      expect(yield* goal.read(sessionID)).toMatchObject({ phase: "paused" })
    }),
  )
})

describe("GoalTodoTool", () => {
  it("has no completed status", () => {
    expect(
      Option.isNone(Schema.decodeUnknownOption(GoalTodoTool.Input)({ todos: [{ content: "x", status: "completed" }] })),
    ).toBe(true)
    expect(
      Option.isSome(Schema.decodeUnknownOption(GoalTodoTool.Input)({ todos: [{ content: "x", status: "pending" }] })),
    ).toBe(true)
  })

  it("bounds acceptance at 200 characters", () => {
    const acceptance = (length: number) => ({ content: "x", status: "pending", acceptance: "a".repeat(length) })
    expect(Option.isSome(Schema.decodeUnknownOption(GoalTodoTool.Input)({ todos: [acceptance(200)] }))).toBe(true)
    expect(Option.isNone(Schema.decodeUnknownOption(GoalTodoTool.Input)({ todos: [acceptance(201)] }))).toBe(true)
  })

  toolIt.effect("echoes the verifier's unmet items verbatim", () =>
    Effect.gen(function* () {
      const { bus, goal, tools } = yield* setup
      yield* goal.update(sessionID, { action: "set", objective: "ship it" })
      yield* goal.replaceTodo(sessionID, [{ content: "first", status: "pending" }])
      const current = yield* goal.read(sessionID)
      yield* bus.publish(SessionEvent.Todo.Verified, {
        sessionID,
        revision: current?.revision ?? 0,
        items: [{ position: 0, status: "pending", feedback: "no test output" }],
      })
      const result = yield* executeTool(tools, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-goal-todo-replace",
          name: "goal_todo",
          input: { todos: [{ content: "first", status: "in_progress" }] },
        },
      })
      expect(result.status).toBe("completed")
      expect(result.output).toMatchObject({ unmet: [{ position: 0, reason: "no test output" }] })
      expect(textOf(result.content)).toContain("no test output")
      expect(yield* goal.readTodo(sessionID)).toEqual([
        { position: 0, content: "first", status: "in_progress", acceptance: undefined, feedback: undefined },
      ])
    }),
  )
})

describe("goal tool visibility", () => {
  toolIt.effect("offers the goal tools only once the session has a goal", () =>
    Effect.gen(function* () {
      const { db, goal, tools } = yield* setup
      const names = (snapshot: Tool.Snapshot) => snapshot.definitions.map((definition) => definition.name)
      const registered = yield* tools.snapshot()
      expect(names(registered)).toContain("goal")
      expect(names(registered)).toContain("goal_todo")

      // A session with no goal is not offered either tool.
      const withoutGoal = yield* SessionContext.forSession(db, registered, sessionID)
      expect(names(withoutGoal)).not.toContain("goal")
      expect(names(withoutGoal)).not.toContain("goal_todo")

      // The same session gains them as soon as the goal exists.
      yield* goal.update(sessionID, { action: "set", objective: "ship it" })
      const withGoal = yield* SessionContext.forSession(db, registered, sessionID)
      expect(names(withGoal)).toContain("goal")
      expect(names(withGoal)).toContain("goal_todo")
    }),
  )
})

describe("goal todo next to todowrite", () => {
  // Registration is last-wins by effective name, so a shared name would hide one
  // of these plugins. Registering the upstream plugin after goal_todo proves the
  // two names stay independent.
  toolIt.effect("keeps the upstream todowrite and goal_todo both reachable", () =>
    Effect.gen(function* () {
      yield* registerToolPlugin(TodoTool.Plugin, { event: { subscribe: () => Stream.never } }).pipe(
        Effect.provide(
          Layer.mock(Config.Service)({
            entries: () =>
              Effect.succeed([
                new Document({
                  type: "document",
                  info: new Info({ experimental: new ConfigExperimental.Info({ todo: true }) }),
                }),
              ]),
          }),
        ),
        Effect.provide(permissionLayer({ assert: () => Effect.void })),
      )
      const { goal, tools } = yield* setup
      const names = (yield* toolDefinitions(tools)).map((definition) => definition.name)
      expect(names).toContain("todowrite")
      expect(names).toContain("goal_todo")

      yield* goal.update(sessionID, { action: "set", objective: "ship it" })
      const upstream = yield* executeTool(tools, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-todowrite",
          name: "todowrite",
          input: { todos: [{ content: "plan", status: "in_progress" }] },
        },
      })
      expect(upstream.status).toBe("completed")
      expect(upstream.output).toEqual({ todos: [{ content: "plan", status: "in_progress" }] })

      const goalTodo = yield* executeTool(tools, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-goal-todo",
          name: "goal_todo",
          input: { todos: [{ content: "durable", status: "pending" }] },
        },
      })
      expect(goalTodo.status).toBe("completed")
      expect(yield* goal.readTodo(sessionID)).toEqual([
        { position: 0, content: "durable", status: "pending", acceptance: undefined, feedback: undefined },
      ])
    }),
  )
})
