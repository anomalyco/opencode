import { describe, expect } from "bun:test"
import { Effect, Stream } from "effect"
import { LLM } from "../src/effect.js"
import { Auth, LLMClient } from "../src/route.js"
import { AnthropicMessages } from "../src/protocols/anthropic-messages.js"
import { it } from "./lib/effect.js"
import { fixedResponse } from "./lib/http.js"
import { sseEvents } from "./lib/sse.js"

const model = AnthropicMessages.route
  .with({ endpoint: { baseURL: "https://api.anthropic.test/v1/" }, auth: Auth.header("x-api-key", "test") })
  .model({ id: "claude-sonnet-4-5" })

const frames = [
  { type: "message_start", message: { usage: { input_tokens: 5 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "future_event", detail: "unknown to the protocol" },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
  { type: "message_stop" },
  { type: "ping" },
]

const layer = fixedResponse(sseEvents(...frames))

describe("raw provider events", () => {
  it.effect("stream emits every frame before its own events only when requested", () =>
    Effect.gen(function* () {
      const raw = Array.from(
        yield* LLMClient.stream(LLM.request({ model, prompt: "Hi", includeRaw: true })).pipe(
          Stream.runCollect,
          Effect.provide(layer),
        ),
      )
      const plain = Array.from(
        yield* LLMClient.stream(LLM.request({ model, prompt: "Hi" })).pipe(Stream.runCollect, Effect.provide(layer)),
      )

      expect(raw.filter((event) => event.type === "raw").map((event) => event.data)).toEqual(frames)
      expect(
        raw.map((event) => (event.type === "raw" ? `raw:${(event.data as { type: string }).type}` : event.type)),
      ).toEqual([
        "raw:message_start",
        "raw:content_block_start",
        "step-start",
        "text-start",
        "raw:future_event",
        "raw:content_block_delta",
        "text-delta",
        "raw:content_block_stop",
        "text-end",
        "raw:message_delta",
        "raw:message_stop",
        "step-finish",
        "finish",
        "raw:ping",
      ])
      expect(raw.filter((event) => event.type !== "raw")).toEqual(plain)
      expect(plain.some((event) => event.type === "raw")).toBe(false)
    }),
  )

  it.effect("generate ignores raw events", () =>
    Effect.gen(function* () {
      const withRaw = yield* LLMClient.generate(LLM.request({ model, prompt: "Hi", includeRaw: true })).pipe(
        Effect.provide(layer),
      )
      const plain = yield* LLMClient.generate(LLM.request({ model, prompt: "Hi" })).pipe(Effect.provide(layer))

      expect(withRaw).toEqual(plain)
      expect(withRaw.text).toBe("Hello")
    }),
  )
})
