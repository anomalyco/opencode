import { describe, expect, test } from "bun:test"
import { ClaudeQueryOptions } from "@opencode/core/plugin/provider/claude-agent/claude/query-options"
import { ClaudeSession } from "@opencode/core/plugin/provider/claude-agent/claude/session"
import { FakeClaude } from "../lib/fake-claude"
import { FakeIO } from "../lib/fake-io"
import { TestTools } from "../lib/tools"

describe("Claude session", () => {
  test.each([0, 1])("exit code %i before a result reports failure and allows cleanup", async (code) => {
    const turn = FakeClaude.expectTurn({ hold: new Promise(() => {}) })
    const claude = FakeClaude.make([FakeClaude.expectStartup(), turn])
    const session = await ClaudeSession.start({
      ...ClaudeQueryOptions.base({ executable: FakeIO.EXECUTABLE, io: FakeIO.make({ claude }) }),
      sessionId: crypto.randomUUID(),
    })
    try {
      await session.ready
      session.begin([{ type: "text", text: "Reply with a marker." }])
      await claude.started(turn)
      await claude.runs[0]!.exit(code)
      const message = code === 0 ? "Claude Code stopped before finishing its reply" : "code 1"
      await expect(session.readStep(() => {}, [])).rejects.toThrow(message)
      await session.interrupt()
      expect(claude.runs[0]!.received.some((message) => message.request?.subtype === "interrupt")).toBe(false)
    } finally {
      await session.stop()
    }
    await claude.runs[0]!.closed
    expect(() => claude.check()).toThrow("1 script steps did not finish")
  })

  const stream = (type: string, extra = {}) => ({
    type: "stream_event",
    parent_tool_use_id: null,
    event: { type, ...extra },
  })
  const fallbackReply = {
    type: "assistant",
    parent_tool_use_id: null,
    session_id: "s",
    uuid: crypto.randomUUID(),
    message: {
      id: "msg_fallback",
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "tool_use", id: "toolu_1", name: "mcp__opencode__lookup", input: { key: "a" } }],
    },
  }

  test.each([
    ["before any event", [fallbackReply]],
    [
      "after message_start",
      [stream("message_start", { message: { id: "msg_cut", usage: {} } }), stream("message_stop"), fallbackReply],
    ],
  ])("a tool call from a non-streaming fallback ends the step when the stream was cut %s", async (_, replies) => {
    const turn = { ...FakeClaude.expectTurn(), replies }
    const claude = FakeClaude.make([FakeClaude.expectStartup(), turn])
    const session = await ClaudeSession.start({
      ...ClaudeQueryOptions.base({ executable: FakeIO.EXECUTABLE, io: FakeIO.make({ claude }) }),
      sessionId: crypto.randomUUID(),
    })
    try {
      await session.ready
      session.begin([{ type: "text", text: "Look up a." }])
      expect(await session.readStep(() => {}, TestTools.tools)).toBe("tools")
      await claude.runs[0]!.exit(0)
    } finally {
      await session.stop()
    }
  })
})
