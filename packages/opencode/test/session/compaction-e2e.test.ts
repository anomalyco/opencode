import { describe, expect, test } from "bun:test"
import { SessionCompaction } from "../../src/session/compaction"
import { Token } from "../../src/util/token"
import type { Provider } from "../../src/provider/provider"
import type { ModelMessage } from "ai"
import { Log } from "../../src/util/log"

Log.init({ print: true })

function createKiroModel(): Provider.Model {
  return {
    id: "kiro/claude-opus-4-6",
    providerID: "kiro",
    name: "Kiro",
    limit: { context: 180_000, output: 16_000 },
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

function textForTokens(n: number) {
  return "x".repeat(n * 4)
}
function userMsg(tokens: number): ModelMessage {
  return { role: "user", content: [{ type: "text", text: textForTokens(tokens) }] }
}
function assistantMsg(tokens: number): ModelMessage {
  return { role: "assistant", content: [{ type: "text", text: textForTokens(tokens) }] }
}
function toolCallMsg(tokens: number): ModelMessage {
  return {
    role: "assistant",
    content: [{ type: "tool-call", toolCallId: "tc_1", toolName: "bash", input: textForTokens(tokens) } as any],
  }
}
function toolResultMsg(tokens: number): ModelMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "tc_1",
        toolName: "bash",
        output: { type: "text", value: textForTokens(tokens) },
      } as any,
    ],
  }
}

describe("compaction e2e flow simulation", () => {
  const model = createKiroModel()

  test("session grows → shouldCompact triggers → fitMessages trims → compaction summary replaces → continues", () => {
    console.log("\n=== Phase 1: Session accumulates messages ===")

    // Simulate a session with tool-heavy conversation (like daily review)
    // Each turn: user(1K) + assistant tool-call(2K) + tool-result(8K) + assistant(3K) = ~14K per turn
    const msgs: ModelMessage[] = []
    for (let i = 0; i < 10; i++) {
      msgs.push(userMsg(1_000))
      msgs.push(toolCallMsg(2_000))
      msgs.push(toolResultMsg(8_000))
      msgs.push(assistantMsg(3_000))
    }
    // 40 messages, ~14K * 10 = ~140K raw, with TOKEN_CORRECTION ~182K estimated

    const compact1 = SessionCompaction.shouldCompact(msgs, model)
    console.log(`After 10 turns: shouldCompact = ${compact1}`)
    expect(compact1).toBe(true)

    console.log("\n=== Phase 2: fitMessages trims for compaction LLM call ===")
    const promptTokens = 500 // compaction prompt
    const fitted = SessionCompaction.fitMessages(msgs, model, promptTokens)
    console.log(`Original: ${msgs.length} msgs, Fitted: ${fitted.length} msgs`)
    expect(fitted.length).toBeLessThan(msgs.length)
    expect(fitted.length).toBeGreaterThan(0)

    console.log("\n=== Phase 3: After compaction, summary replaces old messages ===")
    // Simulate: compaction produced a 3K token summary
    const postCompaction: ModelMessage[] = [
      assistantMsg(3_000), // summary from compaction
    ]
    const compact2 = SessionCompaction.shouldCompact(postCompaction, model)
    console.log(`After compaction (summary only): shouldCompact = ${compact2}`)
    expect(compact2).toBe(false)

    console.log("\n=== Phase 4: New messages accumulate after compaction ===")
    // Add more turns after compaction
    for (let i = 0; i < 5; i++) {
      postCompaction.push(userMsg(1_000))
      postCompaction.push(toolCallMsg(2_000))
      postCompaction.push(toolResultMsg(8_000))
      postCompaction.push(assistantMsg(3_000))
    }
    const compact3 = SessionCompaction.shouldCompact(postCompaction, model)
    console.log(`After 5 more turns: shouldCompact = ${compact3}`)
    // ~3K summary + 5*14K = ~73K raw, ~95K estimated — should NOT trigger yet
    expect(compact3).toBe(false)

    // Add 3 more turns to push over
    for (let i = 0; i < 3; i++) {
      postCompaction.push(userMsg(1_000))
      postCompaction.push(toolCallMsg(2_000))
      postCompaction.push(toolResultMsg(8_000))
      postCompaction.push(assistantMsg(3_000))
    }
    const compact4 = SessionCompaction.shouldCompact(postCompaction, model)
    console.log(`After 8 more turns: shouldCompact = ${compact4}`)
    // ~3K + 8*14K = ~115K raw, ~150K estimated — should trigger
    expect(compact4).toBe(true)

    console.log("\n=== Phase 5: Second compaction fitMessages ===")
    const fitted2 = SessionCompaction.fitMessages(postCompaction, model, promptTokens)
    console.log(`Before 2nd compaction: ${postCompaction.length} msgs, Fitted: ${fitted2.length} msgs`)
    expect(fitted2.length).toBeLessThan(postCompaction.length)
    expect(fitted2.length).toBeGreaterThan(0)
  })

  test("realistic kiro scenario: 130K tokens with system overhead", () => {
    console.log("\n=== Realistic kiro: ~130K message tokens + 16K system overhead ===")
    // This simulates the actual logs: [kiro] tokens=133K but shouldCompact saw 122K
    // With SYSTEM_OVERHEAD=16K, usable = 180K - 16K - 20K - 16K = 128K → now 112K
    // So 122K estimated message tokens > 112K usable → triggers

    const msgs: ModelMessage[] = []
    for (let i = 0; i < 20; i++) {
      msgs.push(userMsg(1_000))
      msgs.push(assistantMsg(4_000))
    }

    const result = SessionCompaction.shouldCompact(msgs, model)
    console.log(`130K kiro scenario: shouldCompact = ${result}`)
    expect(result).toBe(true)
  })
})
