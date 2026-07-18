import { PermissionV1 } from "@kancode/core/v1/permission"
import { describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { Tool } from "@/tool/tool"
import * as Truncate from "@/tool/truncate"
import { SessionRenameTool } from "../../src/tool/session-rename"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

const sessionID = SessionID.make("ses_rename_ask_test")

const ctxBase: Omit<Tool.Context, "ask"> = {
  sessionID,
  messageID: MessageID.make("msg_rename_ask_test"),
  callID: "call_rename",
  agent: "default",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
}

const setTitleCalls: Array<{ sessionID: SessionID; title: string }> = []

const harness = Layer.mergeAll(
  Layer.mock(Session.Service, {
    get: () =>
      Effect.succeed({
        id: sessionID,
        title: "Old title",
      } as never),
    setTitle: (input) =>
      Effect.sync(() => {
        setTitleCalls.push(input)
      }),
  }),
  Layer.mock(Truncate.Service, {
    output: (text: string) => Effect.succeed({ content: text, truncated: false as const }),
  }),
  Layer.mock(Agent.Service, {
    get: () => Effect.succeed({ name: "default", permission: [] } as never),
  }),
)

const it = testEffect(harness)

describe("tool.session_rename", () => {
  it.effect("permission ask uses session scope pattern and metadata", () =>
    Effect.gen(function* () {
      setTitleCalls.length = 0
      const info = yield* SessionRenameTool
      const tool = yield* Tool.init(info)
      const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []

      const result = yield* tool.execute(
        { title: "  New session name  " },
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
        permission: "session_rename",
        patterns: ["session"],
        always: ["*"],
        metadata: {
          sessionID,
          scope: "session",
          kind: "session_title",
          title: "New session name",
        },
      })
      expect(setTitleCalls).toEqual([{ sessionID, title: "New session name" }])
      expect(result.metadata).toMatchObject({
        title: "New session name",
        previousTitle: "Old title",
      })
      expect(result.output).toContain("New session name")
    }),
  )

  it.effect("rejects empty title", () =>
    Effect.gen(function* () {
      setTitleCalls.length = 0
      const info = yield* SessionRenameTool
      const tool = yield* Tool.init(info)
      const exit = yield* tool
        .execute(
          { title: "   " },
          {
            ...ctxBase,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(setTitleCalls).toEqual([])
    }),
  )
})
