import { describe, expect } from "bun:test"
import { ConfigProvider, Effect, Schema } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { LLM } from "../../src"
import * as Cloudflare from "../../src/providers/cloudflare"
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
      const model = Cloudflare.aiGateway("workers-ai/@cf/meta/llama-3.3-70b-instruct", {
        accountId: "test-account",
        gatewayId: "test-gateway",
        apiKey: "test-token",
      })

      expect(model).toMatchObject({
        id: "workers-ai/@cf/meta/llama-3.3-70b-instruct",
        provider: "cloudflare-ai-gateway",
        route: "cloudflare-ai-gateway",
        baseURL: "https://gateway.ai.cloudflare.com/v1/test-account/test-gateway/compat",
      })

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
          model: Cloudflare.aiGateway("openai/gpt-4o-mini", {
            accountId: "test-account",
            gatewayId: "test-gateway",
            apiKey: "test-token",
          }),
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

  it.effect("defaults AI Gateway id to default when omitted or blank", () =>
    Effect.gen(function* () {
      expect(
        Cloudflare.aiGateway("workers-ai/@cf/meta/llama-3.3-70b-instruct", {
          accountId: "test-account",
          gatewayId: "",
          gatewayApiKey: "test-token",
        }).baseURL,
      ).toBe("https://gateway.ai.cloudflare.com/v1/test-account/default/compat")
    }),
  )

  it.effect("supports authenticated AI Gateway plus upstream provider auth", () =>
    Effect.gen(function* () {
      yield* LLM.generate(
        LLM.request({
          model: Cloudflare.aiGateway("openai/gpt-4o-mini", {
            accountId: "test-account",
            gatewayApiKey: "gateway-token",
            apiKey: "provider-token",
          }),
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
          model: Cloudflare.aiGateway("openai/gpt-4o-mini", {
            baseURL: "https://gateway.proxy.test/v1/custom/compat",
            apiKey: "test-token",
          }),
          prompt: "Say hello.",
        }),
      )

      expect(prepared.model.baseURL).toBe("https://gateway.proxy.test/v1/custom/compat")
    }),
  )

  it.effect("prepares direct Workers AI models through the OpenAI-compatible Chat protocol", () =>
    Effect.gen(function* () {
      const model = Cloudflare.workersAI("@cf/meta/llama-3.1-8b-instruct", {
        accountId: "test-account",
        apiKey: "test-token",
      })

      expect(model).toMatchObject({
        id: "@cf/meta/llama-3.1-8b-instruct",
        provider: "cloudflare-workers-ai",
        route: "cloudflare-workers-ai",
        baseURL: "https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1",
      })

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
          model: Cloudflare.workersAI("@cf/meta/llama-3.1-8b-instruct", {
            accountId: "test-account",
            apiKey: "test-token",
          }),
          prompt: "Say hello.",
        }),
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
              expect(web.url).toBe(
                "https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1/chat/completions",
              )
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
          model: Cloudflare.workersAI("@cf/meta/llama-3.1-8b-instruct", {
            accountId: "test-account",
          }),
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
