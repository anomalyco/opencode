import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Schema } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { LLM, LLMEvent } from "../../src/index.js"
import { CloudflareAIGateway } from "../../src/providers/cloudflare-ai-gateway.js"
import { CloudflareWorkersAI } from "../../src/providers/cloudflare-workers-ai.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { dynamicResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

const Json = Schema.fromJsonString(Schema.Unknown)
const decodeJson = Schema.decodeUnknownSync(Json)
const withEnv = (env: Record<string, string>) => Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))

const deltaChunk = (delta: object, finishReason: string | null = null) => ({
  id: "chatcmpl_fixture",
  choices: [{ delta, finish_reason: finishReason }],
  usage: null,
})

describe("Cloudflare", () => {
  it.effect("selects native AI Gateway protocols by model ID", () =>
    Effect.gen(function* () {
      const gateway = CloudflareAIGateway.configure({
        accountId: "test-account",
        gatewayId: "test-gateway",
        apiKey: "test-token",
      })
      const responses = yield* compileRequest(
        LLM.request({ model: gateway.model("openai/gpt-5.4"), prompt: "Say hello." }),
      )
      const messages = yield* compileRequest(
        LLM.request({ model: gateway.model("anthropic/claude-haiku-4.5"), prompt: "Say hello." }),
      )
      const chat = yield* compileRequest(LLM.request({ model: gateway.model("xai/grok-4.6"), prompt: "Say hello." }))
      const workers = yield* compileRequest(
        LLM.request({ model: gateway.model("workers-ai/@cf/meta/llama-3.3-70b-instruct"), prompt: "Say hello." }),
      )

      expect(responses.route).toBe("cloudflare-ai-gateway-responses")
      expect(responses.body).toMatchObject({ model: "openai/gpt-5.4", stream: true })
      expect(messages.route).toBe("cloudflare-ai-gateway-messages")
      expect(messages.body).toMatchObject({ model: "anthropic/claude-haiku-4-5" })
      expect(chat.route).toBe("cloudflare-ai-gateway-chat")
      expect(chat.body).toMatchObject({ model: "xai/grok-4.6", stream: true })
      expect(workers.route).toBe("cloudflare-ai-gateway-chat")
      expect(workers.body).toMatchObject({
        model: "@cf/meta/llama-3.3-70b-instruct",
        messages: [{ role: "user", content: "Say hello." }],
        stream: true,
      })
    }),
  )

  it.effect("posts to the Cloudflare REST API with gateway options", () =>
    Effect.gen(function* () {
      const response = yield* LLM.generate(
        LLM.request({
          model: CloudflareAIGateway.configure({
            accountId: "test-account",
            gatewayId: "test-gateway",
            apiKey: "test-token",
            cacheKey: "cache-key",
            cacheTtl: 300,
            collectLog: false,
            metadata: { invoked_by: "test" },
            skipCache: true,
          }).model("xai/grok-4.6"),
          prompt: "Say hello.",
        }),
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
              expect(web.url).toBe("https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1/chat/completions")
              expect(web.headers.get("authorization")).toBe("Bearer test-token")
              expect(web.headers.get("cf-aig-gateway-id")).toBe("test-gateway")
              expect(web.headers.get("cf-aig-cache-key")).toBe("cache-key")
              expect(web.headers.get("cf-aig-cache-ttl")).toBe("300")
              expect(web.headers.get("cf-aig-collect-log")).toBe("false")
              expect(web.headers.get("cf-aig-metadata")).toBe('{"invoked_by":"test"}')
              expect(web.headers.get("cf-aig-skip-cache")).toBe("true")
              expect(decodeJson(input.text)).toMatchObject({
                model: "xai/grok-4.6",
                stream: true,
                messages: [{ role: "user", content: "Say hello." }],
              })
              return input.respond(
                sseEvents(deltaChunk({ role: "assistant", content: "Hello" }), deltaChunk({}, "stop")),
                { headers: { "content-type": "text/event-stream" } },
              )
            }),
          ),
        ),
      )

      expect(response.text).toBe("Hello")
    }),
  )

  it.effect("preserves reasoning details for AI Gateway continuation", () =>
    Effect.gen(function* () {
      const model = CloudflareAIGateway.configure({
        accountId: "test-account",
        gatewayId: "test-gateway",
        apiKey: "test-token",
      }).model("xai/grok-4.6")
      const details = [
        { type: "reasoning.text", text: "Think", format: "anthropic-claude-v1", index: 0 },
        { type: "reasoning.text", text: "ing", format: "anthropic-claude-v1", index: 0 },
        { type: "reasoning.text", signature: "signed", format: "anthropic-claude-v1", index: 0 },
      ]
      const merged = [
        {
          type: "reasoning.text",
          text: "Thinking",
          signature: "signed",
          format: "anthropic-claude-v1",
          index: 0,
        },
      ]
      const response = yield* LLM.generate(LLM.request({ model, prompt: "Say hello." })).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.succeed(
              input.respond(
                sseEvents(
                  deltaChunk({ reasoning: "Think", reasoning_details: [details[0]] }),
                  deltaChunk({ reasoning: "ing", reasoning_details: [details[1]] }),
                  deltaChunk({ reasoning_details: [details[2]] }),
                  deltaChunk({ content: "Hello" }),
                  deltaChunk({}, "stop"),
                ),
                { headers: { "content-type": "text/event-stream" } },
              ),
            ),
          ),
        ),
      )

      expect(response.reasoning).toBe("Thinking")
      expect(response.events.filter(LLMEvent.is.reasoningDelta)).toHaveLength(2)
      expect(response.message.content.find((part) => part.type === "reasoning")?.providerMetadata).toEqual({
        "cloudflare-ai-gateway": { reasoningField: "reasoning", reasoningDetails: merged },
      })

      const replay = yield* compileRequest(LLM.request({ model, messages: [response.message] }))
      expect(replay.body.messages).toEqual([
        { role: "assistant", content: "Hello", reasoning: "Thinking", reasoning_details: merged },
      ])
    }),
  )

  it.effect("allows a fully configured baseURL override", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: CloudflareAIGateway.configure({
            baseURL: "https://gateway.proxy.test/v1",
            apiKey: "test-token",
          }).model("xai/grok-4.6"),
          prompt: "Say hello.",
        }),
      )

      expect(prepared.model.route.endpoint.baseURL).toBe("https://gateway.proxy.test/v1")
    }),
  )

  it.effect("prepares direct Workers AI models through the OpenAI-compatible Chat protocol", () =>
    Effect.gen(function* () {
      const model = CloudflareWorkersAI.configure({
        accountId: "test-account",
        apiKey: "test-token",
      }).model("@cf/meta/llama-3.1-8b-instruct")

      expect(model).toMatchObject({
        id: "@cf/meta/llama-3.1-8b-instruct",
        provider: "cloudflare-workers-ai",
        route: { id: "cloudflare-workers-ai" },
      })
      expect(model.route.endpoint.baseURL).toBe("https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1")

      const prepared = yield* compileRequest(LLM.request({ model, prompt: "Say hello." }))

      expect(prepared.route).toBe("cloudflare-workers-ai")
      expect(prepared.body).toMatchObject({
        model: "@cf/meta/llama-3.1-8b-instruct",
        messages: [{ role: "user", content: "Say hello." }],
        stream: true,
      })
    }),
  )

  it.effect("posts direct Workers AI requests to the account endpoint with bearer auth", () =>
    Effect.gen(function* () {
      const response = yield* LLM.generate(
        LLM.request({
          model: CloudflareWorkersAI.configure({
            accountId: "test-account",
            apiKey: "test-token",
          }).model("@cf/meta/llama-3.1-8b-instruct"),
          prompt: "Say hello.",
        }),
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
              expect(web.url).toBe("https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1/chat/completions")
              expect(web.headers.get("authorization")).toBe("Bearer test-token")
              expect(decodeJson(input.text)).toMatchObject({
                model: "@cf/meta/llama-3.1-8b-instruct",
                stream: true,
                messages: [{ role: "user", content: "Say hello." }],
              })
              return input.respond(
                sseEvents(deltaChunk({ role: "assistant", content: "Hello" }), deltaChunk({}, "stop")),
                { headers: { "content-type": "text/event-stream" } },
              )
            }),
          ),
        ),
      )

      expect(response.text).toBe("Hello")
    }),
  )

  it.effect("supports direct Workers AI token aliases through auth config", () =>
    Effect.gen(function* () {
      yield* Effect.forEach(["CLOUDFLARE_WORKERS_AI_TOKEN", "CLOUDFLARE_API_TOKEN"], (name) =>
        LLM.generate(
          LLM.request({
            model: CloudflareWorkersAI.configure({
              accountId: "test-account",
            }).model("@cf/meta/llama-3.1-8b-instruct"),
            prompt: "Say hello.",
          }),
        ).pipe(
          withEnv({
            CLOUDFLARE_API_KEY: undefined,
            CLOUDFLARE_WORKERS_AI_TOKEN: name === "CLOUDFLARE_WORKERS_AI_TOKEN" ? "test-token" : undefined,
            CLOUDFLARE_API_TOKEN: name === "CLOUDFLARE_API_TOKEN" ? "test-token" : undefined,
          }),
          Effect.provide(
            dynamicResponse((input) =>
              Effect.gen(function* () {
                const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
                expect(web.headers.get("authorization")).toBe("Bearer test-token")
                return input.respond(
                  sseEvents(deltaChunk({ role: "assistant", content: "Hello" }), deltaChunk({}, "stop")),
                  { headers: { "content-type": "text/event-stream" } },
                )
              }),
            ),
          ),
        ),
      )
    }),
  )
})
