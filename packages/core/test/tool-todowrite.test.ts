import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionTodo } from "@opencode-ai/core/session/todo"
import { TodoWriteTool } from "@opencode-ai/core/tool/todowrite"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, settleTool, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_todowrite_tool_test")
const assertions: PermissionV2.AssertInput[] = []
let deny = false

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(deny ? Effect.fail(new PermissionV2.BlockedError({ rules: [] })) : Effect.void),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionTodo.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      TodoWriteTool.node,
    ]),
    [
      [PermissionV2.node, permission],
      [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
    ],
  ),
)

const setup = Effect.gen(function* () {
  assertions.length = 0
  deny = false
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "todowrite",
      directory: "/project",
      title: "todowrite",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
})

const call = (todos: ReadonlyArray<SessionTodo.Info>, id = "call-todowrite") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: TodoWriteTool.name, input: { todos } },
})

describe("TodoWriteTool", () => {
  it.effect("registers, approves the wildcard resource, persists todos, and returns typed output", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const service = yield* SessionTodo.Service
      const todoList: ReadonlyArray<SessionTodo.Info> = [
        { content: "Implement slice", status: "in_progress", priority: "high" },
      ]

      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual([TodoWriteTool.name])
      expect(yield* settleTool(registry, call(todoList))).toEqual({
        result: { type: "text", value: JSON.stringify(todoList, null, 2) },
        output: {
          structured: { todos: todoList },
          content: [{ type: "text", text: JSON.stringify(todoList, null, 2) }],
        },
      })
      expect(assertions).toMatchObject([{ sessionID, action: "todowrite", resources: ["*"], save: ["*"] }])
      expect(yield* service.get(sessionID)).toEqual(todoList)
    }),
  )

  it.effect("does not update persisted todos when permission is denied", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const service = yield* SessionTodo.Service
      yield* service.update({ sessionID, todos: [{ content: "keep", status: "pending", priority: "low" }] })
      deny = true

      expect(
        yield* executeTool(registry, call([{ content: "blocked", status: "completed", priority: "high" }])),
      ).toEqual({
        type: "error",
        value: "Unable to update todos",
      })
      expect(yield* service.get(sessionID)).toEqual([{ content: "keep", status: "pending", priority: "low" }])
      expect(assertions).toMatchObject([{ sessionID, action: "todowrite", resources: ["*"], save: ["*"] }])
    }),
  )
})
