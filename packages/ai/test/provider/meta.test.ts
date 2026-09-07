import { expect } from "bun:test"
import { ConfigProvider, Effect } from "effect"
import { Headers } from "effect/unstable/http"
import { Auth, LLM } from "../../src/index.js"
import { Meta } from "../../src/providers/index.js"
import { OpenAIChat } from "../../src/protocols/openai-chat.js"
import { OpenResponses } from "../../src/protocols/open-responses.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"

it.effect("Meta composes baseline protocols with provider-owned endpoints and defaults", () =>
  Effect.gen(function* () {
    const meta = Meta.configure({ apiKey: "fixture" })
    const responses = meta.model("muse-spark-1.3")
    const chat = meta.chat("muse-spark-1.3")
    expect(responses.route.body).toBe(OpenResponses.protocol.body)
    expect(chat.route.body).toBe(OpenAIChat.protocol.body)
    expect(meta.model).toBe(meta.responses)
    for (const model of [responses, chat]) {
      expect(model.provider).toBe("meta")
      expect(model.route.providerMetadataKey).toBe("meta")
      expect(model.route.endpoint.baseURL).toBe("https://api.meta.ai/v1")
    }
    expect(responses.route.endpoint.path).toBe("/responses")
    expect(chat.route.endpoint.path).toBe("/chat/completions")
    const compiled = yield* compileRequest(LLM.request({ model: responses, prompt: "Hello" }))
    expect(compiled.protocol).toBe("open-responses")
    expect(compiled.body).toMatchObject({ store: false, include: ["reasoning.encrypted_content"] })
    expect(compiled.body.reasoning).toBeUndefined()
  }),
)

it.effect("Meta package selectors preserve overrides and Chat token policy on custom endpoints", () =>
  Effect.gen(function* () {
    for (const select of [Meta.model, Meta.chatModel]) {
      const model = select("future-model", {
        apiKey: "fixture",
        baseURL: "https://gateway.example/v1",
        headers: { "x-client": "test" },
        body: { custom: "value" },
        providerOptions: { reasoningEffort: "future-effort" },
      })
      expect(model.route.endpoint.baseURL).toBe("https://gateway.example/v1")
      expect(model.route.defaults.headers).toEqual({ "x-client": "test" })
      expect(model.route.defaults.http?.body).toEqual({ custom: "value" })
      const compiled = yield* compileRequest(
        LLM.request({
          model,
          prompt: "Hello",
          generation: { maxTokens: 64 },
          providerOptions: { store: true, include: [] },
        }),
      )
      if (select === Meta.model) {
        expect(compiled.body).toMatchObject({
          store: true,
          max_output_tokens: 64,
          reasoning: { effort: "future-effort" },
        })
        expect(compiled.body.include).toBeUndefined()
      }
      if (select === Meta.chatModel) {
        expect(compiled.body).toMatchObject({ max_completion_tokens: 64, reasoning_effort: "future-effort" })
        expect(compiled.body.max_tokens).toBeUndefined()
        expect(compiled.body.store).toBeUndefined()
      }
    }
  }),
)

it.effect("Meta resolves environment credentials and accepts explicit auth overrides", () =>
  Effect.gen(function* () {
    for (const api of ["responses", "chat"] as const) {
      for (const scenario of [
        { provider: Meta.configure(), authorization: "Bearer environment-key" },
        { provider: Meta.configure({ apiKey: "explicit-key" }), authorization: "Bearer explicit-key" },
        { provider: Meta.configure({ auth: Auth.none }), authorization: undefined },
      ]) {
        const model = scenario.provider[api]("muse-spark-1.3")
        const headers = yield* model.route.auth.apply({
          request: LLM.request({ model, prompt: "Hello" }),
          method: "POST",
          url: "https://api.meta.ai/v1/responses",
          body: "{}",
          headers: Headers.empty,
        })
        expect(headers.authorization).toBe(scenario.authorization)
      }
    }
  }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { META_API_KEY: "environment-key" } })))),
)
