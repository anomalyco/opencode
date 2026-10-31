import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ai, isRetryable } from "../../src/effect.js"
import { Google } from "../../src/providers.js"
import { LLMClient } from "../../src/route.js"
import { it } from "../lib/effect.js"
import { fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

const model = Google.configure({ apiKey: "test", baseURL: "https://generativelanguage.test/v1beta" }).interactions(
  "gemini-3.8-flash",
)

const generate = (...events: ReadonlyArray<unknown>) =>
  LLMClient.generate(ai.request({ model, prompt: "Hi" })).pipe(Effect.provide(fixedResponse(sseEvents(...events))))

describe("Google Interactions", () => {
  it.effect("classifies premature EOF before interaction.completed as an incomplete stream", () =>
    Effect.gen(function* () {
      const error = yield* generate(
        { event_type: "interaction.created", interaction: { id: "int_1" } },
        { event_type: "step.start", index: 0, step: { type: "model_output", content: [] } },
        { event_type: "step.delta", index: 0, delta: { type: "text", text: "Partial" } },
      ).pipe(Effect.flip)

      expect(error.reason).toMatchObject({
        _tag: "InvalidProviderOutput",
        route: "google/google-interactions",
        message: "The provider response ended unexpectedly.",
        classification: "incomplete-stream",
      })
      expect(error.partial?.text).toBe("Partial")
      expect(isRetryable(error)).toBe(true)
    }),
  )

  it.effect("normalizes completed interactions that emitted function_call steps to tool-calls", () =>
    Effect.gen(function* () {
      const withToolCall = yield* generate(
        {
          event_type: "step.start",
          index: 0,
          step: { type: "function_call", id: "call_1", name: "lookup", arguments: { query: "weather" } },
        },
        { event_type: "step.stop", index: 0 },
        { event_type: "interaction.completed", interaction: { id: "int_1", status: "completed" } },
      )
      const textOnly = yield* generate(
        { event_type: "step.start", index: 0, step: { type: "model_output", content: [] } },
        { event_type: "step.delta", index: 0, delta: { type: "text", text: "Done." } },
        { event_type: "step.stop", index: 0 },
        { event_type: "interaction.completed", interaction: { id: "int_2", status: "completed" } },
      )

      expect(withToolCall.toolCalls).toMatchObject([{ id: "call_1", name: "lookup", input: { query: "weather" } }])
      expect(withToolCall.finishReason).toEqual({ normalized: "tool-calls", raw: "completed" })
      expect(textOnly.finishReason).toEqual({ normalized: "stop", raw: "completed" })
    }),
  )

  it.effect("marks malformed and unexpected tool-call failures as retryable incomplete streams", () =>
    Effect.gen(function* () {
      const codes = ["malformed_function_call", "malformed_tool_call", "unexpected_tool_call", "malformed_response"]
      for (const code of codes) {
        const completedEvent = {
          event_type: "interaction.completed",
          interaction: { status: "failed", errors: [{ code, message: `Stopped: ${code}` }] },
        }
        const fromCompleted = yield* generate(
          { event_type: "step.start", index: 0, step: { type: "thought", signature: "sig_1" } },
          {
            event_type: "step.delta",
            index: 0,
            delta: { type: "thought_summary", content: { type: "text", text: "Planning tool call" } },
          },
          { event_type: "step.stop", index: 0 },
          completedEvent,
        ).pipe(Effect.flip)

        expect(fromCompleted.reason).toMatchObject({
          _tag: "InvalidProviderOutput",
          route: "google/google-interactions",
          message: `Stopped: ${code}`,
          classification: "incomplete-stream",
          body: JSON.stringify(completedEvent),
        })
        expect(fromCompleted.partial?.reasoning).toBe("Planning tool call")
        expect(isRetryable(fromCompleted)).toBe(true)

        const streamEvent = { event_type: "error", error: { code, message: `Stream error: ${code}` } }
        const fromError = yield* generate(streamEvent).pipe(Effect.flip)
        expect(fromError.reason).toMatchObject({
          _tag: "InvalidProviderOutput",
          route: "google/google-interactions",
          message: `Stream error: ${code}`,
          classification: "incomplete-stream",
          body: JSON.stringify(streamEvent),
        })
        expect(isRetryable(fromError)).toBe(true)
      }
    }),
  )

  it.effect("keeps deterministic tool and image output rejections non-retryable", () =>
    Effect.gen(function* () {
      for (const code of ["missing_thought_signature", "too_many_tool_calls", "no_image"]) {
        const completedEvent = {
          event_type: "interaction.completed",
          interaction: { status: "failed", errors: [{ code, message: `Rejected: ${code}` }] },
        }
        const fromCompleted = yield* generate(completedEvent).pipe(Effect.flip)
        expect(fromCompleted.reason).toMatchObject({
          _tag: "InvalidProviderOutput",
          route: "google/google-interactions",
          message: `Rejected: ${code}`,
          body: JSON.stringify(completedEvent),
        })
        if (fromCompleted.reason._tag === "InvalidProviderOutput")
          expect(fromCompleted.reason.classification).toBeUndefined()
        expect(isRetryable(fromCompleted)).toBe(false)

        const streamEvent = { event_type: "error", error: { code, message: `Stream rejected: ${code}` } }
        const fromError = yield* generate(streamEvent).pipe(Effect.flip)
        expect(fromError.reason).toMatchObject({
          _tag: "InvalidProviderOutput",
          route: "google/google-interactions",
          message: `Stream rejected: ${code}`,
          body: JSON.stringify(streamEvent),
        })
        if (fromError.reason._tag === "InvalidProviderOutput")
          expect(fromError.reason.classification).toBeUndefined()
        expect(isRetryable(fromError)).toBe(false)
      }
    }),
  )

  it.effect("classifies plain-string stream error payloads by their message", () =>
    Effect.gen(function* () {
      const rateLimited = { event_type: "error", error: "Rate limit exceeded, too many requests" }
      const rateLimitError = yield* generate(rateLimited).pipe(Effect.flip)
      expect(rateLimitError.reason).toMatchObject({
        _tag: "RateLimit",
        message: "Rate limit exceeded, too many requests",
        body: JSON.stringify(rateLimited),
      })

      const overflow = { event_type: "error", error: "prompt is too long" }
      const overflowError = yield* generate(overflow).pipe(Effect.flip)
      expect(overflowError.reason).toMatchObject({
        _tag: "InvalidRequest",
        message: "prompt is too long",
        classification: "context-overflow",
        body: JSON.stringify(overflow),
      })

      const bare = yield* generate({ event_type: "error" }).pipe(Effect.flip)
      expect(bare.reason).toMatchObject({ _tag: "UnknownProvider", message: "Google Interactions stream error" })
    }),
  )

  it.effect("classifies blocked Interactions generations as non-retryable content policy errors", () =>
    Effect.gen(function* () {
      const codes = [
        "safety",
        "recitation",
        "prohibited_content",
        "spii",
        "blocklist",
        "image_safety",
        "image_prohibited_content",
        "image_recitation",
        "content_blocked",
      ]
      for (const code of codes) {
        const completedEvent = {
          event_type: "interaction.completed",
          interaction: { status: "failed", errors: [{ code, message: `Blocked: ${code}` }] },
        }
        const fromCompleted = yield* generate(completedEvent).pipe(Effect.flip)
        expect(fromCompleted.reason).toMatchObject({
          _tag: "ContentPolicy",
          message: `Blocked: ${code}`,
          body: JSON.stringify(completedEvent),
        })
        expect(isRetryable(fromCompleted)).toBe(false)

        const streamEvent = { event_type: "error", error: { code, message: `Stream blocked: ${code}` } }
        const fromError = yield* generate(streamEvent).pipe(Effect.flip)
        expect(fromError.reason).toMatchObject({
          _tag: "ContentPolicy",
          message: `Stream blocked: ${code}`,
          body: JSON.stringify(streamEvent),
        })
        expect(isRetryable(fromError)).toBe(false)
      }
    }),
  )
})
