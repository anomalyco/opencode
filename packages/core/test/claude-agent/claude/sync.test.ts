import { describe, expect } from "bun:test"
import type { LanguageModelV3Prompt } from "@ai-sdk/provider"
import { Effect } from "effect"
import { SessionRecord } from "@opencode/core/claude-agent/sync/record"
import { it } from "../../lib/effect"
import { FakeClaude } from "../lib/fake-claude"
import { TestSessions } from "../lib/sessions"

describe("recorded history sync", () => {
  it.effect("catches up once, saves transcript boundaries, then continues without replaying history", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn({ recording: "sync" }),
        FakeClaude.expectTurn({ recording: "sync", index: 1 }),
        FakeClaude.expectTurn({ recording: "sync", index: 2 }),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude)
      const history: LanguageModelV3Prompt = [
        { role: "user", content: [{ type: "text", text: "Give me a marker." }] },
        { role: "assistant", content: [{ type: "text", text: "My marker is LILAC-HERON." }] },
      ]
      const ask = Effect.fn(function* (text: string) {
        history.push({ role: "user", content: [{ type: "text", text }] })
        const parts = yield* TestSessions.reply(test.model, history)
        const reply = TestSessions.text(parts)
        history.push({ role: "assistant", content: [{ type: "text", text: reply }] })
        return reply
      })
      yield* ask("Remember COPPER-OTTER too. Reply only with COPPER-OTTER.")
      history.push(
        { role: "user", content: [{ type: "text", text: "Read the marker file." }] },
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "marker-read", toolName: "read", input: { path: "marker.txt" } }],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "marker-read",
              toolName: "read",
              output: { type: "text", value: "LEMON-IBIS" },
            },
          ],
        },
        { role: "assistant", content: [{ type: "text", text: "I read the file successfully." }] },
      )
      const reply = yield* ask(
        "List all three markers from our conversation, including the file. Output only the markers.",
      )
      for (const marker of ["LILAC-HERON", "COPPER-OTTER", "LEMON-IBIS"]) expect(reply).toContain(marker)
      yield* ask("Repeat those three markers.")
      expect(claude.runs).toHaveLength(1)
      const users = claude.runs[0]!.received.filter((message) => message.type === "user")
      expect(JSON.stringify(users[0].message.content)).toContain("LILAC-HERON")
      expect(JSON.stringify(users[1].message.content)).toContain("LEMON-IBIS")
      expect(JSON.stringify(users[1].message.content)).not.toContain("LILAC-HERON")
      expect(users[2].message.content).toEqual([{ type: "text", text: "Repeat those three markers." }])
      const record = (yield* SessionRecord.make(test.storage).get("session-a"))!
      expect(record.history).toHaveLength(12)
      expect(record.history![2]!.claudeMessageID).toBe(users[0].uuid)
      expect(record.history![8]!.claudeMessageID).toBe(users[1].uuid)
      expect(record.history![10]!.claudeMessageID).toBe(users[2].uuid)
      // Catch-up's interior messages don't claim independent transcript boundaries.
      expect(record.history![5]!.claudeMessageID).toBeUndefined()
      yield* test.registry.close()
      claude.check()
    }),
  )
})
