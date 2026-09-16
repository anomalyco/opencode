import { expect } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { LLM, LLMClient } from "../../src/index.js"
import { OpenResponses } from "../../src/protocols/open-responses.js"
import { Azure, Meta, OpenAI, XAI } from "../../src/providers/index.js"
import { WebSocketTransport } from "../../src/route.js"
import { configure } from "../../src/providers/openai-compatible-responses.js"
import { it } from "../lib/effect.js"
import { fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

const decodeEvent = Schema.decodeUnknownEffect(OpenResponses.protocol.stream.event)

it.effect("normalizes flat errors in shared SSE and WebSocket decoding", () =>
  Effect.gen(function* () {
    const frame = {
      type: "error",
      sequence_number: 4,
      code: "server_shutting_down",
      message: "Server is shutting down. Please retry your request.",
      param: null,
    }
    for (const decode of [decodeEvent, OpenResponses.decodeChannelEvent]) {
      const event = yield* decode(JSON.stringify(frame))
      expect(event).toEqual({
        type: "error",
        sequence_number: 4,
        error: { code: frame.code, message: frame.message, param: null },
      })

      for (const unchanged of [
        event,
        { type: "error" },
        {
          type: "response.failed",
          response: { id: "resp_failed", error: { code: "server_error", message: "Internal server error" } },
        },
        { type: "response.output_text.delta", item_id: "msg_text", delta: "Hello" },
      ]) {
        expect(yield* decode(JSON.stringify(unchanged))).toEqual(unchanged)
      }
    }
  }),
)

it.effect("continues to normalize untyped xAI WebSocket errors", () =>
  Effect.gen(function* () {
    const message = "gRPC error: Response with id=resp_missing not found"
    for (const error of [{ type: "api_error", message }, message]) {
      expect(yield* OpenResponses.decodeChannelEvent(JSON.stringify({ error }))).toEqual({
        type: "error",
        error: typeof error === "string" ? { message } : error,
      })
    }
  }),
)

it.effect("normalizes string errors in shared SSE and WebSocket decoding", () =>
  Effect.gen(function* () {
    for (const decode of [decodeEvent, OpenResponses.decodeChannelEvent]) {
      expect(yield* decode(JSON.stringify({ type: "error", error: "Gateway failed" }))).toEqual({
        type: "error",
        error: { message: "Gateway failed" },
      })
      expect(
        yield* decode(
          JSON.stringify({ type: "response.failed", response: { id: "resp_failed", error: "Gateway failed" } }),
        ),
      ).toEqual({
        type: "response.failed",
        response: { id: "resp_failed", error: { message: "Gateway failed" } },
      })
    }
  }),
)

for (const model of [
  OpenAI.configure({ apiKey: "fixture" }).responses("gpt-5.6-sol"),
  XAI.configure({ apiKey: "fixture" }).responses("grok-4.6"),
  Azure.configure({ apiKey: "fixture", resourceName: "fixture" }).responses("deployment"),
]) {
  it.effect(`preserves string error messages and raw bodies through ${model.provider} Responses`, () =>
    Effect.gen(function* () {
      const raw = '{ "type": "error", "error": "Gateway rejected the request", "trace": "original" }'
      const webSocket = WebSocketTransport.makeDirect({
        open: () => Effect.succeed({ sendText: () => Effect.void, messages: Stream.make(raw), close: Effect.void }),
      })
      for (const options of [{ webSocket }, {}]) {
        const error = yield* LLMClient.generate(LLM.request({ model, prompt: "Hello" }), options).pipe(
          Effect.provide(fixedResponse(sseEvents(raw))),
          Effect.flip,
        )
        expect(error.reason._tag).toBe("UnknownProvider")
        expect(error.message).toBe("Gateway rejected the request")
        expect(error.reason.body).toBe(raw)
      }
    }),
  )
}

it.effect("retains classification and original error bodies through Meta and generic Responses routes", () =>
  Effect.gen(function* () {
    const raw = `{
  "type": "error",
  "sequence_number": 4,
  "code": "server_shutting_down",
  "message": "Server is shutting down. Please retry your request.",
  "param": null,
  "diagnostic": "retain-original-frame"
}`
    for (const model of [
      Meta.configure({ apiKey: "fixture" }).responses("muse-spark-1.3"),
      configure({ apiKey: "fixture", provider: "gateway", baseURL: "https://responses.example.test/v1" }).model(
        "example-model",
      ),
    ]) {
      const error = yield* LLMClient.generate(LLM.request({ model, prompt: "Hello" })).pipe(
        Effect.provide(fixedResponse(sseEvents(raw.replaceAll("\n", "\ndata: ")))),
        Effect.flip,
      )
      expect(error.reason._tag).toBe("ProviderInternal")
      expect(error.message).toBe("server_shutting_down: Server is shutting down. Please retry your request.")
      expect(error.reason.body).toBe(raw)
      expect(error.reason.http?.status).toBe(200)
    }
  }),
)
