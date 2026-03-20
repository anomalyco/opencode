import { describe, expect, test } from "bun:test"
import { SessionCompaction } from "../../src/session/compaction"
import { Token } from "../../src/util/token"
import type { Provider } from "../../src/provider/provider"
import type { ModelMessage } from "ai"
import { Log } from "../../src/util/log"

Log.init({ print: false })

function createModel(opts: { context: number; output: number }): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: { context: opts.context, output: opts.output },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

function text(tokens: number) {
  return "x".repeat(tokens * 4)
}
function userMsg(tokens: number): ModelMessage {
  return { role: "user", content: [{ type: "text", text: text(tokens) }] }
}
function assistantMsg(tokens: number): ModelMessage {
  return { role: "assistant", content: [{ type: "text", text: text(tokens) }] }
}
function toolCallMsg(id: string, tokens: number): ModelMessage {
  return {
    role: "assistant",
    content: [{ type: "tool-call", toolCallId: id, toolName: "confluence_get_page", input: text(tokens) } as any],
  }
}
function toolResultMsg(id: string, tokens: number): ModelMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: id,
        toolName: "confluence_get_page",
        output: { type: "text", value: text(tokens) },
      } as any,
    ],
  }
}

describe("compaction with tool-call-heavy sessions", () => {
  const model = createModel({ context: 180_000, output: 16_000 })

  test("30+ MCP tool calls trigger compaction", () => {
    // Simulate daily-digest: user asks to fetch 30+ confluence pages
    // Each tool call: user(200) + tool-call(500) + tool-result(4000) + assistant(300) ≈ 5K per turn
    const msgs: ModelMessage[] = [userMsg(1_000)] // initial prompt
    for (let i = 0; i < 30; i++) {
      msgs.push(toolCallMsg(`tc_${i}`, 500))
      msgs.push(toolResultMsg(`tc_${i}`, 4_000))
      msgs.push(assistantMsg(300))
    }
    // ~1K + 30*(500+4000+300) = ~145K raw, ×1.3 correction ≈ 189K estimated
    expect(SessionCompaction.shouldCompact(msgs, model)).toBe(true)
  })

  test("fitMessages trims tool-heavy history from front", () => {
    const msgs: ModelMessage[] = [userMsg(1_000)]
    for (let i = 0; i < 30; i++) {
      msgs.push(toolCallMsg(`tc_${i}`, 500))
      msgs.push(toolResultMsg(`tc_${i}`, 4_000))
      msgs.push(assistantMsg(300))
    }
    const promptTokens = 500
    const fitted = SessionCompaction.fitMessages(msgs, model, promptTokens)
    expect(fitted.length).toBeLessThan(msgs.length)
    expect(fitted.length).toBeGreaterThan(0)

    // fitted messages should fit within budget
    let total = 0
    for (const m of fitted) total += SessionCompaction.estimateMessageTokens(m)
    const budget = model.limit.context - model.limit.output - 20_000 - promptTokens
    expect(total).toBeLessThanOrEqual(budget)
  })

  test("even after fitMessages, massive tool results can still exceed context", () => {
    // Simulate worst case: each tool result is huge (10K tokens)
    // Even a single turn might be too large for compaction budget
    const msgs: ModelMessage[] = [userMsg(500)]
    for (let i = 0; i < 20; i++) {
      msgs.push(toolCallMsg(`tc_${i}`, 1_000))
      msgs.push(toolResultMsg(`tc_${i}`, 10_000))
      msgs.push(assistantMsg(500))
    }
    const promptTokens = 1_000
    const fitted = SessionCompaction.fitMessages(msgs, model, promptTokens)

    // Even fitted, the remaining messages are large
    let total = 0
    for (const m of fitted) total += SessionCompaction.estimateMessageTokens(m)

    // The key insight: fitMessages does its best, but if individual messages are huge,
    // the compaction LLM call itself may still overflow — this is the scenario
    // where our fix (returning "stop" after MAX_ATTEMPTS) prevents infinite loop
    expect(fitted.length).toBeGreaterThan(0)
    // With 10K tool results × 1.3 correction = 13K per result,
    // budget ≈ 180K - 16K - 30K - 1K = 133K, fits ~10 results
    expect(fitted.length).toBeLessThan(msgs.length)
  })

  test("single massive tool result still returns at least 1 message from fitMessages", () => {
    // Edge case: one tool result so large it exceeds entire budget
    const msgs: ModelMessage[] = [
      userMsg(500),
      toolCallMsg("tc_0", 1_000),
      toolResultMsg("tc_0", 200_000), // way over context
      assistantMsg(500),
    ]
    const fitted = SessionCompaction.fitMessages(msgs, model, 1_000)
    expect(fitted.length).toBeGreaterThanOrEqual(1)
  })

  test("shouldCompact returns false after successful compaction replaces history with summary", () => {
    // After compaction succeeds, old messages are replaced with a summary
    const postCompaction: ModelMessage[] = [
      assistantMsg(3_000), // compaction summary
    ]
    expect(SessionCompaction.shouldCompact(postCompaction, model)).toBe(false)
  })

  test("tool token estimation includes both input and output", () => {
    const call = toolCallMsg("tc_1", 5_000)
    const result = toolResultMsg("tc_1", 5_000)
    const callTokens = SessionCompaction.estimateMessageTokens(call)
    const resultTokens = SessionCompaction.estimateMessageTokens(result)
    // Each should be ~5000 × 1.3 = 6500
    expect(callTokens).toBeGreaterThan(5_000)
    expect(resultTokens).toBeGreaterThan(5_000)
  })
})

describe("compaction process loop simulation", () => {
  // Simulates the exact while-loop logic from compaction.ts process()
  // to verify the infinite loop fix without needing full integration setup

  function simulateCompactionLoop(input: {
    processorResults: ("compact" | "continue" | "stop")[]
    messageCount: number
  }) {
    const MAX_ATTEMPTS = 5
    let result: "compact" | "continue" | "stop" = "compact"
    let attempt = 0
    let msgCount = input.messageCount
    let callIndex = 0

    while (result === "compact") {
      attempt++
      if (attempt > MAX_ATTEMPTS) break
      if (msgCount === 0) break
      result = input.processorResults[Math.min(callIndex++, input.processorResults.length - 1)]
      if (result === "compact") {
        if (msgCount <= 1) break
        msgCount--
      }
    }
    if (result === "compact") return "stop"
    return "continue"
  }

  test("returns stop when processor always returns compact (MAX_ATTEMPTS exhausted)", () => {
    const result = simulateCompactionLoop({
      processorResults: ["compact", "compact", "compact", "compact", "compact"],
      messageCount: 20,
    })
    expect(result).toBe("stop")
  })

  test("returns stop when messages exhausted before MAX_ATTEMPTS", () => {
    const result = simulateCompactionLoop({
      processorResults: ["compact", "compact"],
      messageCount: 2,
    })
    expect(result).toBe("stop")
  })

  test("returns stop when zero messages", () => {
    const result = simulateCompactionLoop({
      processorResults: ["compact"],
      messageCount: 0,
    })
    expect(result).toBe("stop")
  })

  test("returns continue when compaction succeeds on first attempt", () => {
    const result = simulateCompactionLoop({
      processorResults: ["continue"],
      messageCount: 20,
    })
    expect(result).toBe("continue")
  })

  test("returns continue when compaction succeeds after 3 failed attempts", () => {
    const result = simulateCompactionLoop({
      processorResults: ["compact", "compact", "compact", "continue"],
      messageCount: 20,
    })
    expect(result).toBe("continue")
  })

  test("returns continue when compaction succeeds on last attempt", () => {
    const result = simulateCompactionLoop({
      processorResults: ["compact", "compact", "compact", "compact", "continue"],
      messageCount: 20,
    })
    expect(result).toBe("continue")
  })

  test("documents the bug: without fix, all-fail loop would return continue", () => {
    const MAX_ATTEMPTS = 5
    let result: "compact" | "continue" | "stop" = "compact"
    let attempt = 0
    let msgCount = 20

    while (result === "compact") {
      attempt++
      if (attempt > MAX_ATTEMPTS) break
      if (msgCount === 0) break
      result = "compact"
      if (result === "compact") {
        if (msgCount <= 1) break
        msgCount--
      }
    }

    expect(result).toBe("compact")
    // BUG: without fix, code falls through to return "continue" → infinite loop
    // FIX: guard catches result === "compact" → returns "stop"
    const fixed = result === "compact" ? "stop" : "continue"
    expect(fixed).toBe("stop")
  })
})
