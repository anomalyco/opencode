import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect } from "effect"
import { Headers } from "effect/http"
import { ai } from "../../src/effect.js"
import { MiniMax } from "../../src/providers/minimax.js"
import { AnthropicMessages } from "../../src/protocols/anthropic-messages.js"
import { OpenResponses } from "../../src/protocols/open-responses.js"
import { Auth } from "../../src/route/auth.js"
import { compileRequest } from "../../src/route/client.js"
import { Endpoint } from "../../src/route/endpoint.js"
import { it } from "../lib/effect.js"

describe("MiniMax provider", () => {
  test("composes the baseline Messages and Responses protocols", () => {
    expect(MiniMax.model("MiniMax-M3").api.name).toBe("messages")
    expect(MiniMax.model("MiniMax-M3").api.protocol.body).toBe(AnthropicMessages.protocol.body)
    expect(MiniMax.responsesModel("MiniMax-M3").api.protocol.body).toBe(OpenResponses.protocol.body)
  })

  it.effect("owns API endpoints, provider identity and environment bearer authentication", () =>
    Effect.gen(function* () {
      for (const item of [
        { model: MiniMax.model("MiniMax-M3"), path: "/anthropic/v1/messages" },
        { model: MiniMax.chatModel("MiniMax-M3"), path: "/v1/chat/completions" },
        { model: MiniMax.responsesModel("MiniMax-M3"), path: "/v1/responses" },
      ]) {
        const request = ai.request({ model: item.model, prompt: "Hello" })
        const compiled = yield* compileRequest(request)
        expect(item.model.provider as string).toBe("minimax")
        expect(item.model.metadataKey).toBe("minimax")
        const url = Endpoint.render(
          { baseURL: item.model.baseURL, path: item.model.api.path, query: item.model.query },
          { request, body: compiled.body },
        ).toString()
        expect(url).toBe(`https://api.minimax.io${item.path}`)
        const headers = yield* item.model.auth.apply({
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
      const model = MiniMax.minimax
        .with({ baseURL: "https://gateway.example/anthropic/v1", auth: Auth.header("x-api-key", "gateway-key") })
        .model("custom-model")
      const request = ai.request({ model, prompt: "Hello" })
      const compiled = yield* compileRequest(request)
      expect(
        Endpoint.render(
          { baseURL: model.baseURL, path: model.api.path, query: model.query },
          { request, body: compiled.body },
        ).toString(),
      ).toBe("https://gateway.example/anthropic/v1/messages")
      expect(model.api.headers?.({ request })).toEqual({ "anthropic-version": "2023-06-01" })
      const headers = yield* model.auth.apply({
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
      const messages = yield* compileRequest(
        ai.request({
          model: MiniMax.model("MiniMax-M3", { apiKey: "fixture" }),
          prompt: "Hello",
          providerOptions: { thinking: { type: "adaptive" } },
        }),
      )
      expect(messages.body.thinking).toEqual({ type: "adaptive" })
      expect(messages.body.output_config).toBeUndefined()
      const chat = yield* compileRequest(
        ai.request({
          model: MiniMax.chatModel("MiniMax-M3", { apiKey: "fixture" }),
          prompt: "Hello",
          maxTokens: 128,
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
        ai.request({
          model: MiniMax.responsesModel("MiniMax-M3", { apiKey: "fixture" }),
          prompt: "Hello",
          providerOptions: { reasoningEffort: "minimal" },
        }),
      )
      expect(responses.body.reasoning).toEqual({ effort: "minimal" })
      expect(responses.body.include).toBeUndefined()
    }),
  )
})
