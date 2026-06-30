import { expect, test } from "bun:test"
import { streamText } from "ai"
import { convertArrayToReadableStream, MockLanguageModelV3 } from "ai/test"
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"

test("streamText recovers orphan reasoning stream parts", async () => {
  const streamParts = [
    { type: "stream-start", warnings: [] },
    { type: "response-metadata", id: "response-id", modelId: "mock-model-id", timestamp: new Date(0) },
    { type: "reasoning-delta", id: "rs_test:0", delta: "thinking" },
    { type: "reasoning-end", id: "rs_test:0" },
    { type: "text-start", id: "text-1" },
    { type: "text-delta", id: "text-1", delta: "ok" },
    { type: "text-end", id: "text-1" },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 2, text: 1, reasoning: 1 },
      },
    },
  ] satisfies LanguageModelV3StreamPart[]

  const result = streamText({
    model: new MockLanguageModelV3({
      doStream: {
        stream: convertArrayToReadableStream(streamParts),
      },
    }),
    prompt: "hello",
  })

  const parts = []
  for await (const part of result.fullStream) {
    parts.push(part)
  }

  expect(parts.filter((part) => part.type === "error")).toEqual([])
  expect(parts).toContainEqual(expect.objectContaining({ type: "reasoning-delta", id: "rs_test:0", text: "thinking" }))
  expect(await result.text).toBe("ok")
})
