import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect } from "effect"
import { Headers } from "effect/unstable/http"
import { LLM } from "../../src/index.js"
import { MiniMax } from "../../src/providers.js"
import { AnthropicMessages } from "../../src/protocols/anthropic-messages.js"
import { OpenResponses } from "../../src/protocols/open-responses.js"
import { Auth } from "../../src/route/auth.js"
import { compileRequest } from "../../src/route/client.js"
import { Endpoint } from "../../src/route/endpoint.js"
import { it } from "../lib/effect.js"

describe("MiniMax provider", () => {
  test("composes the baseline Messages and Responses protocols", () => {
    const minimax = MiniMax.configure()
    expect(minimax.model).toBe(minimax.messages)
    expect(minimax.model("MiniMax-M3").route.body).toBe(AnthropicMessages.protocol.body)
    expect(minimax.responses("MiniMax-M3").route.body).toBe(OpenResponses.protocol.body)
  })

  it.effect("owns API endpoints, provider identity and environment bearer authentication", () =>
    Effect.gen(function* () {
      const minimax = MiniMax.configure()
      for (const item of [
        { model: minimax.model("MiniMax-M3"), path: "/anthropic/v1/messages" },
        { model: minimax.chat("MiniMax-M3"), path: "/v1/chat/completions" },
        { model: minimax.responses("MiniMax-M3"), path: "/v1/responses" },
      ]) {
        const request = LLM.request({ model: item.model, prompt: "Hello" })
        const compiled = yield* compileRequest(request)
        expect(item.model.provider).toBe("minimax")
        expect(item.model.route.providerMetadataKey).toBe("minimax")
        const url = Endpoint.render(item.model.route.endpoint, { request, body: compiled.body }).toString()
        expect(url).toBe(`https://api.minimax.io${item.path}`)
        const headers = yield* item.model.route.auth.apply({
          request,
          method: "POST",
          url,
          body: "{}",
          headers: Headers.empty,
        })
        expect(headers.authorization).toBe("Bearer fixture-key")
        expect(headers["x-api-key"]).toBeUndefined()
      }
    }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { MINIMAX_API_KEY: "fixture-key" } })))),
  )

  it.effect("honors explicit auth and custom API bases", () =>
    Effect.gen(function* () {
      const model = MiniMax.configure({
        baseURL: "https://gateway.example/anthropic/v1",
        auth: Auth.header("x-api-key", "gateway-key"),
      }).model("custom-model")
      const request = LLM.request({ model, prompt: "Hello" })
      const compiled = yield* compileRequest(request)
      expect(Endpoint.render(model.route.endpoint, { request, body: compiled.body }).toString()).toBe(
        "https://gateway.example/anthropic/v1/messages",
      )
      expect(model.route.headers?.({ request })).toEqual({ "anthropic-version": "2023-06-01" })
      const headers = yield* model.route.auth.apply({
        request,
        method: "POST",
        url: "https://gateway.example/anthropic/v1/messages",
        body: "{}",
        headers: Headers.empty,
      })
      expect(headers["x-api-key"]).toBe("gateway-key")
      expect(headers.authorization).toBeUndefined()
    }),
  )

  it.effect("keeps thinking controls native to the selected API", () =>
    Effect.gen(function* () {
      const minimax = MiniMax.configure({ apiKey: "fixture" })
      const messages = yield* compileRequest(
        LLM.request({ model: minimax.model("MiniMax-M3"), providerOptions: { thinking: { type: "adaptive" } } }),
      )
      expect(messages.body.thinking).toEqual({ type: "adaptive" })
      expect(messages.body.output_config).toBeUndefined()
      const chat = yield* compileRequest(
        LLM.request({
          model: minimax.chat("MiniMax-M3"),
          generation: { maxTokens: 128 },
          providerOptions: { thinking: { type: "disabled" }, reasoningSplit: false },
        }),
      )
      expect(chat.body).toMatchObject({
        thinking: { type: "disabled" },
        reasoning_split: false,
        max_completion_tokens: 128,
        stream_options: { include_usage: true },
      })
      expect(chat.body.store).toBeUndefined()
      const responses = yield* compileRequest(
        LLM.request({ model: minimax.responses("MiniMax-M3"), providerOptions: { reasoningEffort: "minimal" } }),
      )
      expect(responses.body.reasoning).toEqual({ effort: "minimal" })
      expect(responses.body.include).toBeUndefined()
    }),
  )
})
