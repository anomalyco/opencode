import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import { SessionTitleTool } from "../../src/tool/session-title"
import { Session } from "../../src/session/session"
import { MessageID, SessionID } from "../../src/session/schema"
import { Agent } from "../../src/agent/agent"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { testEffect } from "../lib/effect"

const calls: Array<{ sessionID: SessionID; title: string }> = []

const sessionMock = Layer.mock(Session.Service, {
  setTitle: (input: { sessionID: SessionID; title: string }) =>
    Effect.sync(() => {
      calls.push({ sessionID: input.sessionID, title: input.title })
    }),
})

const it = testEffect(Layer.mergeAll(sessionMock, LayerNode.compile(LayerNode.group([Truncate.node, Agent.node]))))

function makeCtx(sessionID = SessionID.descending()): Tool.Context {
  return {
    sessionID,
    messageID: MessageID.ascending(),
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata() {
      return Effect.void
    },
    ask() {
      return Effect.void
    },
  }
}

describe("tool.session_title", () => {
  it.instance("renames the session via Session.setTitle", () =>
    Effect.gen(function* () {
      calls.length = 0
      const info = yield* SessionTitleTool
      const tool = yield* info.init()
      const sessionID = SessionID.descending()
      const result = yield* tool.execute({ title: "  Correção do login  " }, makeCtx(sessionID))

      expect(result.output).toBe('Session renamed to "Correção do login"')
      expect(calls).toEqual([{ sessionID, title: "Correção do login" }])
    }),
  )

  it.instance("truncates titles longer than 100 characters", () =>
    Effect.gen(function* () {
      calls.length = 0
      const info = yield* SessionTitleTool
      const tool = yield* info.init()
      const long = "a".repeat(150)
      const result = yield* tool.execute({ title: long }, makeCtx())

      expect(calls).toHaveLength(1)
      expect(calls[0]?.title).toBe("a".repeat(97) + "...")
      expect(result.title).toBe("a".repeat(97) + "...")
    }),
  )

  it.instance("rejects whitespace-only titles without calling setTitle", () =>
    Effect.gen(function* () {
      calls.length = 0
      const info = yield* SessionTitleTool
      const tool = yield* info.init()
      const result = yield* tool.execute({ title: "   " }, makeCtx())

      expect(result.title).toBe("Rename failed")
      expect(calls).toHaveLength(0)
    }),
  )
})
