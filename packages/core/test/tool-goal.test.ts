import { describe, expect, it } from "bun:test"
import { Effect, Layer, Option, Schema } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionGoal } from "@opencode/core/session/goal"
import { SessionGoalActivation } from "@opencode/core/session/goal-activation"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionTable } from "@opencode/core/session/sql"
import { Tool } from "@opencode/core/tool"
import { GoalTool } from "@opencode/core/tool/plugin/goal"
import { TodoTool } from "@opencode/core/tool/plugin/todo"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"
import { testEffect } from "./lib/effect"

const sessionID = SessionSchema.ID.make("ses_goal_tool_test")

const goalToolNode = makeLocationNode({
  name: "test/goal-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(GoalTool.Plugin)),
  deps: [Tool.node, SessionGoal.node],
})

const todoToolNode = makeLocationNode({
  name: "test/todo-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(TodoTool.Plugin)),
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
      todoToolNode,
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
  it("has no resume action", () => {
    expect(Option.isNone(Schema.decodeUnknownOption(GoalTool.Input)({ action: "resume" }))).toBe(true)
    expect(Option.isSome(Schema.decodeUnknownOption(GoalTool.Input)({ action: "pause" }))).toBe(true)
  })

  toolIt.effect("sets a goal and reports the state back", () =>
    Effect.gen(function* () {
      const { goal, tools } = yield* setup
      const result = yield* executeTool(tools, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-goal-set",
          name: "goal",
          input: { action: "set", objective: "ship it" },
        },
      })
      expect(result.status).toBe("completed")
      expect(result.output).toMatchObject({
        goal: { objective: "ship it", phase: "active" },
        rounds: 0,
        maxGoalRounds: 8,
      })
      expect(yield* goal.read(sessionID)).toMatchObject({ objective: "ship it", phase: "active" })
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

describe("TodoTool", () => {
  it("has no completed status", () => {
    expect(
      Option.isNone(Schema.decodeUnknownOption(TodoTool.Input)({ todos: [{ content: "x", status: "completed" }] })),
    ).toBe(true)
    expect(
      Option.isSome(Schema.decodeUnknownOption(TodoTool.Input)({ todos: [{ content: "x", status: "pending" }] })),
    ).toBe(true)
  })

  it("bounds acceptance at 200 characters", () => {
    const acceptance = (length: number) => ({ content: "x", status: "pending", acceptance: "a".repeat(length) })
    expect(Option.isSome(Schema.decodeUnknownOption(TodoTool.Input)({ todos: [acceptance(200)] }))).toBe(true)
    expect(Option.isNone(Schema.decodeUnknownOption(TodoTool.Input)({ todos: [acceptance(201)] }))).toBe(true)
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
          id: "call-todo-replace",
          name: "todo",
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
