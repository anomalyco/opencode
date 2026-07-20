import { describe, expect } from "bun:test"
import { ConfigProvider, Effect, Schema } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { LLM, LLMEvent } from "../../src"
import { CloudflareAIGateway, CloudflareWorkersAI } from "../../src/providers/cloudflare"
import { LLMClient } from "../../src/route"
import { it } from "../lib/effect"
import { dynamicResponse } from "../lib/http"
import { sseEvents } from "../lib/sse"

const Json = Schema.fromJsonString(Schema.Unknown)
const decodeJson = Schema.decodeUnknownSync(Json)
const withEnv = (env: Record<string, string>) => Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))

const deltaChunk = (delta: object, finishReason: string | null = null) => ({
  id: "chatcmpl_fixture",
  choices: [{ delta, finish_reason: finishReason }],
  usage: null,
})

describe("Cloudflare", () => {
  it.effect("prepares AI Gateway models through the OpenAI-compatible Chat protocol", () =>
    Effect.gen(function* () {
      const model = CloudflareAIGateway.configure({
        accountId: "test-account",
        gatewayId: "test-gateway",
        apiKey: "test-token",
      }).model("workers-ai/@cf/meta/llama-3.3-70b-instruct")

      expect(model).toMatchObject({
        id: "workers-ai/@cf/meta/llama-3.3-70b-instruct",
        provider: "cloudflare-ai-gateway",
        route: { id: "cloudflare-ai-gateway" },
      })
      expect(model.route.endpoint.baseURL).toBe("https://gateway.ai.cloudflare.com/v1/test-account/test-gateway/compat")

      const prepared = yield* LLMClient.prepare(LLM.request({ model, prompt: "Say hello." }))

      expect(prepared.route).toBe("cloudflare-ai-gateway")
      expect(prepared.body).toMatchObject({
        model: "workers-ai/@cf/meta/llama-3.3-70b-instruct",
        messages: [{ role: "user", content: "Say hello." }],
        stream: true,
      })
    }),
  )

  it.effect("posts to the derived gateway endpoint with bearer auth", () =>
    Effect.gen(function* () {
      const response = yield* LLM.generate(
        LLM.request({
          model: CloudflareAIGateway.configure({
            accountId: "test-account",
            gatewayId: "test-gateway",
            apiKey: "test-token",
          }).model("openai/gpt-4o-mini"),
          prompt: "Say hello.",
        }),
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
              expect(web.url).toBe(
                "https://gateway.ai.cloudflare.com/v1/test-account/test-gateway/compat/chat/completions",
              )
              expect(web.headers.get("authorization")).toBe("Bearer test-token")
              expect(decodeJson(input.text)).toMatchObject({
                model: "openai/gpt-4o-mini",
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
      }).model("anthropic/claude-sonnet-4.6")
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
        openai: { reasoningField: "reasoning", reasoningDetails: merged },
      })

      const replay = yield* LLMClient.prepare(LLM.request({ model, messages: [response.message] }))
      expect(replay.body.messages).toEqual([
        { role: "assistant", content: "Hello", reasoning: "Thinking", reasoning_details: merged },
      ])
    }),
  )

  it.effect("defaults AI Gateway id to default when omitted or blank", () =>
    Effect.gen(function* () {
      expect(
        CloudflareAIGateway.configure({
          accountId: "test-account",
          gatewayId: "",
          gatewayApiKey: "test-token",
        }).model("workers-ai/@cf/meta/llama-3.3-70b-instruct").route.endpoint.baseURL,
      ).toBe("https://gateway.ai.cloudflare.com/v1/test-account/default/compat")
    }),
  )

  it.effect("supports authenticated AI Gateway plus upstream provider auth", () =>
    Effect.gen(function* () {
      yield* LLM.generate(
        LLM.request({
          model: CloudflareAIGateway.configure({
            accountId: "test-account",
            gatewayApiKey: "gateway-token",
            apiKey: "provider-token",
          }).model("openai/gpt-4o-mini"),
          prompt: "Say hello.",
        }),
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
              expect(web.url).toBe("https://gateway.ai.cloudflare.com/v1/test-account/default/compat/chat/completions")
              expect(web.headers.get("cf-aig-authorization")).toBe("Bearer gateway-token")
              expect(web.headers.get("authorization")).toBe("Bearer provider-token")
              return input.respond(
                sseEvents(deltaChunk({ role: "assistant", content: "Hello" }), deltaChunk({}, "stop")),
                { headers: { "content-type": "text/event-stream" } },
              )
            }),
          ),
        ),
      )
    }),
  )

  it.effect("allows a fully configured baseURL override", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: CloudflareAIGateway.configure({
            baseURL: "https://gateway.proxy.test/v1/custom/compat",
            apiKey: "test-token",
          }).model("openai/gpt-4o-mini"),
          prompt: "Say hello.",
        }),
      )

      expect(prepared.model.route.endpoint.baseURL).toBe("https://gateway.proxy.test/v1/custom/compat")
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

      const prepared = yield* LLMClient.prepare(LLM.request({ model, prompt: "Say hello." }))

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
      yield* LLM.generate(
        LLM.request({
          model: CloudflareWorkersAI.configure({
            accountId: "test-account",
          }).model("@cf/meta/llama-3.1-8b-instruct"),
          prompt: "Say hello.",
        }),
      ).pipe(
        withEnv({ CLOUDFLARE_WORKERS_AI_TOKEN: "test-token" }),
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
      )
    }),
  )
})
