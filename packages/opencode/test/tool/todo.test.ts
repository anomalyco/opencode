import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { Tool } from "@/tool/tool"
import * as Truncate from "@/tool/truncate"
import { TodoWriteTool } from "../../src/tool/todo"
import { Todo } from "../../src/session/todo"
import { SessionID, MessageID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

const sessionID = SessionID.make("ses_todo_ask_test")

const ctxBase: Omit<Tool.Context, "ask"> = {
  sessionID,
  messageID: MessageID.make("msg_todo_ask_test"),
  callID: "call_todo",
  agent: "default",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
}

const harness = Layer.mergeAll(
  Layer.mock(Todo.Service, {
    update: () => Effect.void,
    get: () => Effect.succeed([]),
  }),
  Layer.mock(Truncate.Service, {
    output: (text: string) => Effect.succeed({ content: text, truncated: false as const }),
  }),
  Layer.mock(Agent.Service, {
    get: () => Effect.succeed({ name: "default", permission: [] } as never),
  }),
)

const it = testEffect(harness)

describe("tool.todowrite", () => {
  it.effect("permission ask uses session scope pattern and metadata", () =>
    Effect.gen(function* () {
      const info = yield* TodoWriteTool
      const tool = yield* Tool.init(info)
      const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      const todos = [{ content: "Ship fix", status: "in_progress" as const, priority: "high" as const }]

      const result = yield* tool.execute(
        { todos },
        {
          ...ctxBase,
          ask: (req) =>
            Effect.sync(() => {
              requests.push(req)
            }),
        },
      )

      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({
        permission: "todowrite",
        patterns: ["session"],
        always: ["*"],
        metadata: {
          sessionID,
          scope: "session",
          kind: "todo_list",
          count: 1,
        },
      })
      expect(result.metadata.todos).toEqual(todos)
    }),
  )
})
