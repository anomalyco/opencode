import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { LLMClient } from "../../src/route"
import * as EdenAI from "../../src/providers/edenai"
import { it } from "../lib/effect"

describe("EdenAI", () => {
  it.effect("prepares EdenAI models through the OpenAI-compatible Chat route", () =>
    Effect.gen(function* () {
      const model = EdenAI.configure({ apiKey: "test-key" }).model("openai/gpt-4o-mini")

      expect(model).toMatchObject({
        id: "openai/gpt-4o-mini",
        provider: "edenai",
        route: { id: "edenai" },
      })
      expect(model.route.endpoint.baseURL).toBe("https://api.edenai.run/v3")

      const prepared = yield* LLMClient.prepare(LLM.request({ model, prompt: "Say hello." }))

      expect(prepared.route).toBe("edenai")
      expect(prepared.body).toMatchObject({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "Say hello." }],
        stream: true,
      })
    }),
  )

  it.effect("targets the @edenai smart router model", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: EdenAI.configure({ apiKey: "test-key" }).model("@edenai"),
          prompt: "Route this.",
        }),
      )
      expect(prepared.body).toMatchObject({ model: "@edenai" })
    }),
  )

  it.effect("applies EdenAI payload options from the model helper", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: EdenAI.configure({
            apiKey: "test-key",
            providerOptions: {
              edenai: {
                fallbacks: ["openai/gpt-5", "anthropic/claude-sonnet-4-5"],
                routerCandidates: ["anthropic/claude-haiku-4-5"],
              },
            },
          }).model("@edenai"),
          prompt: "Think briefly.",
        }),
      )

      expect(prepared.body).toMatchObject({
        fallbacks: ["openai/gpt-5", "anthropic/claude-sonnet-4-5"],
        router_candidates: ["anthropic/claude-haiku-4-5"],
      })
    }),
  )
})
