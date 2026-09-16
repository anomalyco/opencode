import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageCompaction, SessionMessageInfo } from "@opencode/client/promise"
import { getSessionPerformance } from "./metrics"

const assistant = (id: string, overrides: Partial<SessionMessageAssistant> = {}): SessionMessageAssistant => ({
  id,
  type: "assistant",
  time: { created: 0 },
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content: [],
  ...overrides,
})

const tokens = (output: number, reasoning = 0) => ({
  input: 0,
  output,
  reasoning,
  cache: { read: 0, write: 0 },
})

const compaction: SessionMessageCompaction = {
  type: "compaction",
  id: "cmp_1",
  time: { created: 0 },
  status: "running",
  reason: "auto",
  summary: "",
  recent: "",
}

describe("getSessionPerformance", () => {
  test("measures ttft, generation, tps, and wall from text-only content", () => {
    const { rows } = getSessionPerformance({
      messages: [
        assistant("msg_1", {
          time: { created: 1000, streamed: 3400, completed: 3500 },
          content: [{ type: "text", text: "hi", time: { created: 1400 } }],
          tokens: tokens(100),
        }),
      ],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].ttft).toBe(400)
    expect(rows[0].generation).toBe(2000)
    expect(rows[0].tps).toBe(50)
    expect(rows[0].wall).toBe(2500)
    expect(rows[0].tokens).toBe(100)
  })

  test("uses the earliest of reasoning and text as first output", () => {
    const { rows } = getSessionPerformance({
      messages: [
        assistant("msg_1", {
          time: { created: 1000, streamed: 4200 },
          content: [
            { type: "reasoning", text: "think", time: { created: 1200 } },
            { type: "text", text: "hi", time: { created: 2300 } },
          ],
          tokens: tokens(100, 200),
        }),
      ],
    })

    expect(rows[0].ttft).toBe(200)
    expect(rows[0].generation).toBe(3000)
    expect(rows[0].tokens).toBe(300)
    expect(rows[0].tps).toBe(100)
  })

  test("measures tool-only content without text", () => {
    const { rows } = getSessionPerformance({
      messages: [
        assistant("msg_1", {
          time: { created: 1000, streamed: 2600 },
          content: [
            {
              type: "tool",
              id: "call_1",
              name: "bash",
              state: { status: "streaming", input: "" },
              time: { created: 1600 },
            },
          ],
          tokens: tokens(40),
        }),
      ],
    })

    expect(rows[0].ttft).toBe(600)
    expect(rows[0].generation).toBe(1000)
    expect(rows[0].tokens).toBe(40)
    expect(rows[0].tps).toBe(40)
  })

  test("keeps ttft for in-progress messages without streamed or completed", () => {
    const { rows } = getSessionPerformance({
      messages: [
        assistant("msg_1", {
          time: { created: 1000 },
          content: [{ type: "text", text: "hi", time: { created: 1400 } }],
        }),
      ],
    })

    expect(rows[0].ttft).toBe(400)
    expect(rows[0].generation).toBeUndefined()
    expect(rows[0].tps).toBeUndefined()
    expect(rows[0].wall).toBeUndefined()
  })

  test("treats missing tokens as zero and leaves tps undefined", () => {
    const { rows } = getSessionPerformance({
      messages: [
        assistant("msg_1", {
          time: { created: 1000, streamed: 3000, completed: 4000 },
          content: [{ type: "text", text: "hi", time: { created: 1500 } }],
        }),
      ],
    })

    expect(rows[0].tokens).toBe(0)
    expect(rows[0].tps).toBeUndefined()
    expect(rows[0].ttft).toBe(500)
    expect(rows[0].wall).toBe(3000)
  })

  test("excludes the revert message and everything after it", () => {
    const { rows } = getSessionPerformance({
      messages: [assistant("msg_1"), assistant("msg_2"), assistant("msg_3")],
      revert: "msg_2",
    })

    expect(rows.map((row) => row.message.id)).toEqual(["msg_1"])
  })

  test("excludes compaction messages", () => {
    const messages: SessionMessageInfo[] = [assistant("msg_1"), compaction, assistant("msg_2")]
    const { rows } = getSessionPerformance({ messages })

    expect(rows.map((row) => row.message.id)).toEqual(["msg_2", "msg_1"])
  })

  test("summarizes median ttft, pooled tps, wall, and all calls including tool-only", () => {
    const { summary } = getSessionPerformance({
      messages: [
        assistant("text_a", {
          time: { created: 1000, streamed: 3400, completed: 3500 },
          content: [{ type: "text", text: "a", time: { created: 1400 } }],
          tokens: tokens(100),
        }),
        assistant("text_b", {
          time: { created: 1000, streamed: 4200, completed: 5000 },
          content: [{ type: "text", text: "b", time: { created: 1200 } }],
          tokens: tokens(100, 200),
        }),
        assistant("tool_only", {
          time: { created: 1000, streamed: 2600 },
          content: [
            {
              type: "tool",
              id: "call_1",
              name: "bash",
              state: { status: "streaming", input: "" },
              time: { created: 1600 },
            },
          ],
          tokens: tokens(40),
        }),
        assistant("text_c", {
          time: { created: 1000, completed: 2000 },
          content: [{ type: "text", text: "c", time: { created: 1800 } }],
        }),
      ],
    })

    expect(summary.calls).toBe(4)
    expect(summary.ttftMedian).toBe(500)
    expect(summary.tps).toBe(440 / 6)
    expect(summary.wall).toBe(7500)
  })

  test("returns rows newest first", () => {
    const { rows } = getSessionPerformance({
      messages: [assistant("old"), assistant("new")],
    })

    expect(rows.map((row) => row.message.id)).toEqual(["new", "old"])
  })
})
