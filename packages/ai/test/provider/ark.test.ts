import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect } from "effect"
import { Headers } from "effect/http"
import { ai } from "../../src/effect.js"
import { Ark } from "../../src/providers.js"
import { compileRequest } from "../../src/route/client.js"
import { Endpoint } from "../../src/route/endpoint.js"
import { it } from "../lib/effect.js"

describe("Ark provider", () => {
  test("owns the Ark endpoint, provider identity and Chat compatibility", () => {
    const model = Ark.configure({ apiKey: "fixture" }).model("glm-5-2-260617")
    expect(model).toMatchObject({
      provider: "ark",
      compatibility: {
        reasoningField: "reasoning_content",
        maxTokensField: "max_tokens",
      },
      capabilities: { tools: { strict: false }, promptCacheKey: true },
      route: { id: "ark-chat", protocol: "ark-chat" },
    })
    expect(model.route.providerMetadataKey).toBe("ark")
  })

  it.effect("sends Chat Completions to Ark's base URL", () =>
    Effect.gen(function* () {
      const model = Ark.configure({ apiKey: "fixture" }).model("glm-5-2-260617")
      const request = ai.request({ model, prompt: "Hello" })
      const compiled = yield* compileRequest(request)
      const url = Endpoint.render(model.route.endpoint, { request, body: compiled.body }).toString()
      expect(url).toBe("https://ark.cn-beijing.volces.com/api/v3/chat/completions")
      const headers = yield* model.route.auth.apply({
        request,
        method: "POST",
        url,
        body: "{}",
        headers: Headers.empty,
      })
      expect(headers.authorization).toBe("Bearer fixture")
    }),
  )

  it.effect("reads any Ark environment variable", () =>
    Effect.gen(function* () {
      for (const env of [
        { ARK_API_KEY: "ark-secret" },
        { BYTEPLUS_API_KEY: "byteplus-secret" },
        { ARK_CODING_PLAN_API_KEY: "coding-secret" },
      ]) {
        yield* Effect.gen(function* () {
          const model = Ark.configure().model("glm-5-2-260617")
          const request = ai.request({ model, prompt: "Hello" })
          const compiled = yield* compileRequest(request)
          const url = Endpoint.render(model.route.endpoint, { request, body: compiled.body }).toString()
          const headers = yield* model.route.auth.apply({
            request,
            method: "POST",
            url,
            body: "{}",
            headers: Headers.empty,
          })
          expect(headers.authorization).toBe(`Bearer ${Object.values(env)[0]}`)
        }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))))
      }
    }),
  )

  it.effect("keeps deep reasoning on Ark's own `thinking` switch", () =>
    Effect.gen(function* () {
      const model = Ark.configure({ apiKey: "fixture" }).model("glm-5-2-260617")
      const compiled = yield* compileRequest(
        ai.request({
          model,
          prompt: "Hello",
          maxTokens: 128,
          providerOptions: { thinking: { type: "disabled" } },
        }),
      )
      expect(compiled.body).toMatchObject({
        thinking: { type: "disabled" },
        max_tokens: 128,
        stream_options: { include_usage: true },
      })
      expect(compiled.body).not.toHaveProperty("max_completion_tokens")
    }),
  )

  it.effect("honors a custom Ark base URL", () =>
    Effect.gen(function* () {
      const model = Ark.configure({ apiKey: "fixture", baseURL: "https://gateway.example/api/v3" }).model(
        "glm-5-2-260617",
      )
      const request = ai.request({ model, prompt: "Hello" })
      const compiled = yield* compileRequest(request)
      expect(Endpoint.render(model.route.endpoint, { request, body: compiled.body }).toString()).toBe(
        "https://gateway.example/api/v3/chat/completions",
      )
    }),
  )
})
