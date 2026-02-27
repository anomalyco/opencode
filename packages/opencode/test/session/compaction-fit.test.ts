import { describe, expect, test } from "bun:test"
import { SessionCompaction } from "../../src/session/compaction"
import { Token } from "../../src/util/token"
import type { Provider } from "../../src/provider/provider"
import type { ModelMessage } from "ai"
import { Log } from "../../src/util/log"

Log.init({ print: false })

function createModel(opts: { context: number; output: number; input?: number }): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: {
      context: opts.context,
      output: opts.output,
      input: opts.input,
    },
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

// Generate text that estimates to a target token count (4 chars per token)
function textForTokens(tokens: number) {
  return "x".repeat(tokens * 4)
}

function userMsg(tokens: number): ModelMessage {
  return { role: "user", content: [{ type: "text", text: textForTokens(tokens) }] }
}

function assistantMsg(tokens: number): ModelMessage {
  return { role: "assistant", content: [{ type: "text", text: textForTokens(tokens) }] }
}

describe("SessionCompaction.fitMessages", () => {
  test("small messages fit without trimming", () => {
    const model = createModel({ context: 200_000, output: 32_000 })
    const msgs: ModelMessage[] = [userMsg(1000), assistantMsg(1000), userMsg(1000)]
    const result = SessionCompaction.fitMessages(msgs, model, 500)
    expect(result.length).toBe(3)
  })

  test("150K history + 60K input: trims oldest to fit context", () => {
    // Simulate: 15 history messages of 10K tokens each = 150K total
    // Plus 60K of "current input" accounted as extraTokens
    const model = createModel({ context: 180_000, output: 16_000 })
    // budget = 180K - 16K - 20K(buffer) - 60K(extra) = 84K
    const msgs: ModelMessage[] = []
    for (let i = 0; i < 15; i++) {
      msgs.push(userMsg(5_000))
      msgs.push(assistantMsg(5_000))
    }
    // 30 messages, 10K tokens each = 150K total, budget = 84K
    const result = SessionCompaction.fitMessages(msgs, model, 60_000)
    const totalTokens = result.reduce((sum, m) => {
      if (typeof m.content === "string") return sum + Token.estimate(m.content)
      if (!Array.isArray(m.content)) return sum
      return sum + m.content.reduce((s, p) => s + ("text" in p ? Token.estimate(p.text) : 0), 0)
    }, 0)
    // Result should fit within budget (84K)
    expect(totalTokens).toBeLessThanOrEqual(84_000)
    // Should have dropped some messages from the front
    expect(result.length).toBeLessThan(30)
    // Should still have recent messages
    expect(result.length).toBeGreaterThan(0)
  })

  test("preserves newest messages when trimming", () => {
    const model = createModel({ context: 100_000, output: 16_000 })
    // budget = 100K - 16K - 20K - 1K(extra) = 63K
    const msgs: ModelMessage[] = []
    for (let i = 0; i < 10; i++) {
      msgs.push({ role: "user", content: [{ type: "text", text: `msg_${i}_` + textForTokens(9_997) }] })
    }
    // 10 messages × 10K = 100K, budget = 63K → keeps ~6 newest
    const result = SessionCompaction.fitMessages(msgs, model, 1_000)
    // Last message should be the newest (msg_9)
    const lastContent = result[result.length - 1].content
    expect(
      Array.isArray(lastContent) && lastContent[0].type === "text" && lastContent[0].text.startsWith("msg_9_"),
    ).toBe(true)
    // First message should NOT be msg_0 (it was trimmed)
    const firstContent = result[0].content
    expect(
      Array.isArray(firstContent) && firstContent[0].type === "text" && firstContent[0].text.startsWith("msg_0_"),
    ).toBe(false)
  })

  test("returns at least 1 message even if budget is 0", () => {
    const model = createModel({ context: 50_000, output: 32_000 })
    // budget = 50K - 32K - 20K - 10K = negative
    const msgs: ModelMessage[] = [userMsg(5_000), assistantMsg(5_000)]
    const result = SessionCompaction.fitMessages(msgs, model, 10_000)
    expect(result.length).toBe(1)
  })

  test("context 0 returns all messages", () => {
    const model = createModel({ context: 0, output: 32_000 })
    const msgs: ModelMessage[] = [userMsg(100_000)]
    const result = SessionCompaction.fitMessages(msgs, model, 0)
    expect(result.length).toBe(1)
  })

  test("repeated compaction scenario: first compaction fits, second also fits", () => {
    // Simulate: after first compaction produces a summary, new messages accumulate
    // and trigger a second compaction. Both should fit without slice loops.
    const model = createModel({ context: 180_000, output: 16_000 })

    // First compaction: 150K history, 60K extra
    // budget = 180K - 16K - 20K - 60K = 84K
    const history1: ModelMessage[] = []
    for (let i = 0; i < 15; i++) {
      history1.push(userMsg(5_000))
      history1.push(assistantMsg(5_000))
    }
    const result1 = SessionCompaction.fitMessages(history1, model, 60_000)
    const tokens1 = result1.reduce((sum, m) => {
      if (!Array.isArray(m.content)) return sum
      return sum + m.content.reduce((s, p) => s + ("text" in p ? Token.estimate(p.text) : 0), 0)
    }, 0)
    expect(tokens1).toBeLessThanOrEqual(84_000)

    // Second compaction: summary (5K) + new messages (120K), extra = 30K
    // budget = 180K - 16K - 20K - 30K = 114K
    const history2: ModelMessage[] = [assistantMsg(5_000)] // summary from first compaction
    for (let i = 0; i < 12; i++) {
      history2.push(userMsg(5_000))
      history2.push(assistantMsg(5_000))
    }
    // 25 messages, 125K total, budget = 114K
    const result2 = SessionCompaction.fitMessages(history2, model, 30_000)
    const tokens2 = result2.reduce((sum, m) => {
      if (!Array.isArray(m.content)) return sum
      return sum + m.content.reduce((s, p) => s + ("text" in p ? Token.estimate(p.text) : 0), 0)
    }, 0)
    expect(tokens2).toBeLessThanOrEqual(114_000)
    expect(result2.length).toBeGreaterThan(0)
  })

  test("tool results are counted in token estimation", () => {
    const model = createModel({ context: 100_000, output: 16_000 })
    // budget = 100K - 16K - 20K - 0 = 64K
    const msgs: ModelMessage[] = []
    for (let i = 0; i < 5; i++) {
      msgs.push(userMsg(1_000))
      msgs.push({
        role: "assistant",
        content: [
          { type: "text", text: "calling tool" },
          { type: "tool-call", toolCallId: `tc_${i}`, toolName: "bash", input: textForTokens(5_000) } as any,
        ],
      })
      msgs.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: `tc_${i}`,
            toolName: "bash",
            output: { type: "text", value: textForTokens(5_000) },
          } as any,
        ],
      })
    }
    // With TOKEN_CORRECTION=1.3, ~55K raw becomes ~71.5K estimated, budget=64K → some trimmed
    const result = SessionCompaction.fitMessages(msgs, model, 0)
    expect(result.length).toBeLessThan(15)
    expect(result.length).toBeLessThan(15)
    expect(result.length).toBeGreaterThan(5)

    // Now with extra tokens that push it over
    const result2 = SessionCompaction.fitMessages(msgs, model, 30_000)
    // budget = 64K - 30K = 34K, should trim more
    expect(result2.length).toBeLessThan(result.length)
  })
})
