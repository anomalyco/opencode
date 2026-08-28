import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src/index.js"
import { Anthropic, Google, OpenAI } from "../../src/providers.js"
import { LLMClient } from "../../src/route.js"
import { it } from "../lib/effect.js"
import { fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

describe("provider error retention", () => {
  const options = { apiKey: "test", baseURL: "https://provider.test" }
  const cases = [
    {
      name: "Anthropic",
      model: Anthropic.configure(options).model("claude"),
      event: { type: "error", error: { type: "rate_limit_error", message: "Slow down", details: { opaque: [1, 2] } } },
    },
    {
      name: "OpenAI Chat",
      model: OpenAI.configure(options).chat("gpt"),
      event: { error: { code: "rate_limit_exceeded", message: "Slow down", details: { opaque: [1, 2] } } },
    },
    {
      name: "OpenAI Responses",
      model: OpenAI.configure(options).responses("gpt"),
      event: {
        type: "response.failed",
        response: {
          id: "resp_error",
          error: { code: "rate_limit_exceeded", message: "Slow down", details: { opaque: [1, 2] } },
          opaque: { upstream: true },
        },
      },
    },
    {
      name: "Gemini",
      model: Google.configure(options).model("gemini"),
      event: { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Slow down", details: { opaque: [1, 2] } } },
    },
  ]

  for (const entry of cases) {
    it.effect(`retains the complete ${entry.name} event and HTTP context`, () =>
      Effect.gen(function* () {
        const body = JSON.stringify({ ...entry.event, trace: { opaque: "outer" } })
        const error = yield* LLMClient.generate(LLM.request({ model: entry.model, prompt: "hello" })).pipe(
          Effect.provide(
            fixedResponse(sseEvents(body), {
              headers: { "content-type": "text/event-stream", "x-provider-trace": "trace-1" },
            }),
          ),
          Effect.flip,
        )
        expect(error.message).toContain("Slow down")
        expect(error.reason._tag).toBe("RateLimit")
        expect(error.reason.body).toBe(body)
        expect(error.reason.http).toMatchObject({ status: 200, headers: { "x-provider-trace": "trace-1" } })
        expect(error.reason.http?.url).toStartWith("https://provider.test/")
        expect(error.reason.cause).toBeUndefined()
        expect(error.cause).toBe(error.reason)
      }),
    )
  }

  it.effect("retains malformed provider frames and the original decode cause", () =>
    Effect.gen(function* () {
      const body = '{"type":"error","error":{"message":42,"opaque":{"nested":true}},"trace":"outer"}'
      const error = yield* LLMClient.generate(
        LLM.request({ model: Anthropic.configure(options).model("claude"), prompt: "hello" }),
      ).pipe(Effect.provide(fixedResponse(sseEvents(body))), Effect.flip)
      expect(error.reason._tag).toBe("InvalidProviderOutput")
      expect(error.reason.body).toBe(body)
      expect(error.reason.cause).toBeInstanceOf(Error)
      expect(error.reason.http?.status).toBe(200)
    }),
  )

  it.effect("retains the HTTP response context when a channel falls back", () =>
    Effect.gen(function* () {
      const body = '{"type":"error","error":{"code":"rate_limit_exceeded","message":"Slow down","extra":42}}'
      const error = yield* LLMClient.generate(
        LLM.request({ model: OpenAI.configure(options).responses("gpt"), prompt: "hello" }),
        {
          webSocket: {
            execute: (exchange) => Effect.succeed({ frames: exchange.fallback(), complete: Effect.void }),
          },
        },
      ).pipe(
        Effect.provide(fixedResponse(sseEvents(body), { headers: { "x-provider-trace": "fallback-1" } })),
        Effect.flip,
      )

      expect(error.reason._tag).toBe("RateLimit")
      expect(error.reason.body).toBe(body)
      expect(error.reason.http).toMatchObject({
        url: "https://provider.test/responses",
        status: 200,
        headers: { "x-provider-trace": "fallback-1" },
      })
    }),
  )
})
