import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { LLM } from "../../src"
import { GoogleVertex, GoogleVertexAnthropic } from "../../src/providers"
import { LLMClient } from "../../src/route"
import { it } from "../lib/effect"
import { dynamicResponse } from "../lib/http"
import { sseEvents } from "../lib/sse"

describe("Google Vertex providers", () => {
  it.effect("sends Gemini requests to the global Vertex endpoint", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({
          model: GoogleVertex.configure({
            accessToken: "vertex-token",
            location: "global",
            project: "vertex-project",
          }).model("gemini-3.5-flash"),
          prompt: "Say hello.",
        }),
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const request = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
              expect(request.url).toBe(
                "https://aiplatform.googleapis.com/v1beta1/projects/vertex-project/locations/global/publishers/google/models/gemini-3.5-flash:streamGenerateContent?alt=sse",
              )
              expect(request.headers.get("authorization")).toBe("Bearer vertex-token")
              expect(yield* Effect.promise(() => request.json())).toMatchObject({
                contents: [{ role: "user", parts: [{ text: "Say hello." }] }],
              })
              return input.respond(
                sseEvents({
                  candidates: [
                    {
                      content: { role: "model", parts: [{ text: "Hello." }] },
                      finishReason: "STOP",
                    },
                  ],
                }),
                { headers: { "content-type": "text/event-stream" } },
              )
            }),
          ),
        ),
      )

      expect(response.text).toBe("Hello.")
    }),
  )

  it.effect("projects Anthropic Messages onto the Vertex raw-predict API", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({
          model: GoogleVertexAnthropic.configure({
            accessToken: "vertex-token",
            location: "eu",
            project: "vertex-project",
          }).model("claude-sonnet-4-6"),
          prompt: "Say hello.",
        }),
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const request = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
              expect(request.url).toBe(
                "https://aiplatform.eu.rep.googleapis.com/v1/projects/vertex-project/locations/eu/publishers/anthropic/models/claude-sonnet-4-6:streamRawPredict",
              )
              expect(request.headers.get("authorization")).toBe("Bearer vertex-token")
              expect(request.headers.get("anthropic-version")).toBeNull()
              const body = yield* Effect.promise(() => request.json())
              expect(body).toMatchObject({
                anthropic_version: "vertex-2023-10-16",
                messages: [{ role: "user", content: [{ type: "text", text: "Say hello." }] }],
                stream: true,
              })
              expect(body).not.toHaveProperty("model")
              return input.respond(
                sseEvents(
                  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
                  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello." } },
                  { type: "content_block_stop", index: 0 },
                  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
                  { type: "message_stop" },
                ),
                { headers: { "content-type": "text/event-stream" } },
              )
            }),
          ),
        ),
      )

      expect(response.text).toBe("Hello.")
    }),
  )

  it.effect("protects the Vertex Anthropic API version from body overlays", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.prepare(
        LLM.request({
          model: GoogleVertexAnthropic.configure({
            accessToken: "vertex-token",
            http: { body: { anthropic_version: "wrong" } },
            project: "vertex-project",
          }).model("claude-sonnet-4-6"),
          prompt: "Say hello.",
        }),
      ).pipe(Effect.flip)

      expect(error.message).toContain("http.body cannot overlay protocol-owned field(s): anthropic_version")
    }),
  )

  it.effect("routes tuned Gemini models through their deployed endpoint", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({
          model: GoogleVertex.configure({
            accessToken: "vertex-token",
            location: "us-central1",
            project: "vertex-project",
          }).model("endpoints/1234567890"),
          prompt: "Say hello.",
        }),
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const request = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
              expect(request.url).toBe(
                "https://us-central1-aiplatform.googleapis.com/v1beta1/projects/vertex-project/locations/us-central1/endpoints/1234567890:streamGenerateContent?alt=sse",
              )
              return input.respond(
                sseEvents({
                  candidates: [
                    {
                      content: { role: "model", parts: [{ text: "Hello." }] },
                      finishReason: "STOP",
                    },
                  ],
                }),
                { headers: { "content-type": "text/event-stream" } },
              )
            }),
          ),
        ),
      )

      expect(response.text).toBe("Hello.")
    }),
  )

  it.effect("rejects tuned Gemini models in express mode", () =>
    Effect.sync(() => {
      expect(() => GoogleVertex.configure({ apiKey: "fixture" }).model("endpoints/1234567890")).toThrow(
        "Google Vertex tuned models do not support Express Mode API keys",
      )
    }),
  )
})
