import { describe, expect, test } from "bun:test"
import type { LanguageModelV3StreamPart, LanguageModelV3Usage } from "@ai-sdk/provider"
import { ReasoningToolGuard } from "@/session/llm/reasoning-tool-guard"

const usage: LanguageModelV3Usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
}

async function guard(parts: LanguageModelV3StreamPart[]): Promise<LanguageModelV3StreamPart[]> {
  const input = new ReadableStream<LanguageModelV3StreamPart>({
    start(controller) {
      for (const part of parts) controller.enqueue(part)
      controller.close()
    },
  })
  const out: LanguageModelV3StreamPart[] = []
  const reader = input.pipeThrough(ReasoningToolGuard.transform()).getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out.push(value)
  }
  return out
}

describe("session.llm.reasoning-tool-guard", () => {
  test("suppresses a tool call emitted inside an open reasoning block", async () => {
    const out = await guard([
      { type: "reasoning-start", id: "r1" },
      { type: "reasoning-delta", id: "r1", delta: "Let me read the file" },
      { type: "tool-input-start", id: "c1", toolName: "read" },
      { type: "tool-input-delta", id: "c1", delta: '{"path":"a.ts"}' },
      { type: "tool-input-end", id: "c1" },
      { type: "tool-call", toolCallId: "c1", toolName: "read", input: '{"path":"a.ts"}' },
      { type: "reasoning-end", id: "r1" },
      { type: "finish", usage, finishReason: { unified: "tool-calls", raw: "tool_calls" } },
    ])

    // No tool lifecycle parts survive.
    expect(out.some((p) => p.type.startsWith("tool-"))).toBe(false)
    // Finish reason downgraded so the session loop does not wait on a tool.
    expect(out.find((p) => p.type === "finish")).toMatchObject({
      type: "finish",
      finishReason: { unified: "stop", raw: "tool_calls" },
    })
    // Reasoning parts are preserved untouched.
    expect(out.map((p) => p.type)).toEqual(["reasoning-start", "reasoning-delta", "reasoning-end", "finish"])
  })

  test("preserves a legitimate tool call emitted after reasoning-end", async () => {
    const out = await guard([
      { type: "reasoning-start", id: "r1" },
      { type: "reasoning-delta", id: "r1", delta: "I should read the file" },
      { type: "reasoning-end", id: "r1" },
      { type: "tool-input-start", id: "c1", toolName: "read" },
      { type: "tool-input-end", id: "c1" },
      { type: "tool-call", toolCallId: "c1", toolName: "read", input: '{"path":"a.ts"}' },
      { type: "finish", usage, finishReason: { unified: "tool-calls", raw: "tool_calls" } },
    ])

    expect(out.filter((p) => p.type === "tool-call")).toHaveLength(1)
    expect(out.find((p) => p.type === "finish")).toMatchObject({ finishReason: { unified: "tool-calls" } })
  })

  test("keeps tool-calls finish when an in-reasoning call is suppressed but a later call survives", async () => {
    const out = await guard([
      { type: "reasoning-start", id: "r1" },
      { type: "tool-call", toolCallId: "c1", toolName: "read", input: "{}" }, // inside reasoning -> dropped
      { type: "reasoning-end", id: "r1" },
      { type: "tool-call", toolCallId: "c2", toolName: "bash", input: "{}" }, // after reasoning -> kept
      { type: "finish", usage, finishReason: { unified: "tool-calls", raw: "tool_calls" } },
    ])

    const calls = out.flatMap((p) => (p.type === "tool-call" ? [p.toolCallId] : []))
    expect(calls).toEqual(["c2"])
    expect(out.find((p) => p.type === "finish")).toMatchObject({ finishReason: { unified: "tool-calls" } })
  })

  test("is a no-op for a normal text stream with no reasoning", async () => {
    const parts: LanguageModelV3StreamPart[] = [
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "Hello" },
      { type: "text-end", id: "t1" },
      { type: "finish", usage, finishReason: { unified: "stop", raw: "stop" } },
    ]
    expect(await guard(parts)).toEqual(parts)
  })

  test("suppresses a tool call when reasoning never closes (model stops mid-think)", async () => {
    const out = await guard([
      { type: "reasoning-start", id: "r1" },
      { type: "reasoning-delta", id: "r1", delta: "I'll just call the tool" },
      { type: "tool-call", toolCallId: "c1", toolName: "read", input: "{}" },
      { type: "finish", usage, finishReason: { unified: "tool-calls", raw: "tool_calls" } },
    ])
    expect(out.some((p) => p.type === "tool-call")).toBe(false)
    expect(out.find((p) => p.type === "finish")).toMatchObject({ finishReason: { unified: "stop" } })
  })
})
