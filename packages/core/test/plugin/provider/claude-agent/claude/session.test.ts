import { describe, expect, test } from "bun:test"
import { ClaudeQueryOptions } from "@opencode/core/plugin/provider/claude-agent/claude/query-options"
import { ClaudeSession } from "@opencode/core/plugin/provider/claude-agent/claude/session"
import { FakeClaude } from "../lib/fake-claude"
import { FakeIO } from "../lib/fake-io"

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
})
