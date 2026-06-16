import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AISDK } from "@opencode-ai/core/aisdk"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { testEffect } from "./lib/effect"
import { model } from "./plugin/provider-helper"

const itWithAISDK = testEffect(
  AISDK.layer.pipe(Layer.provideMerge(PluginV2.locationLayer.pipe(Layer.provide(EventV2.defaultLayer)))),
)

function languageSdk() {
  return {
    languageModel: (modelID: string) => ({
      modelId: modelID,
      provider: "test",
      specificationVersion: "v3",
    }),
  }
}

describe("AISDK", () => {
  itWithAISDK.effect("strips Perplexity Agent response fields rejected by its OpenAI-compatible endpoint", () =>
    Effect.gen(function* () {
      const bodies: Array<Record<string, unknown>> = []
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service

      yield* plugin.add({
        id: PluginV2.ID.make("capture-perplexity-agent-fetch"),
        effect: Effect.succeed({
          "aisdk.sdk": (evt) =>
            Effect.promise(async () => {
              await evt.options.fetch("https://api.perplexity.ai/v1/responses", {
                method: "POST",
                body: JSON.stringify({
                  model: "openai/gpt-5.5",
                  input: [],
                  stream: true,
                  store: false,
                  temperature: 1,
                  include: ["reasoning.encrypted_content"],
                  tool_choice: "auto",
                  max_output_tokens: 16,
                }),
              })
              evt.sdk = languageSdk()
            }),
        }),
      })

      yield* aisdk.language(
        model("perplexity-agent", "gpt-5.5", {
          api: {
            id: ModelV2.ID.make("openai/gpt-5.5"),
            type: "aisdk",
            package: "@ai-sdk/openai",
            url: "https://api.perplexity.ai/v1",
          },
          request: {
            headers: {},
            body: {
              fetch: async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
                if (typeof init?.body !== "string") throw new Error("expected string body")
                bodies.push(JSON.parse(init.body))
                return new Response("ok")
              },
            },
          },
        }),
      )

      expect(bodies).toEqual([
        {
          model: "openai/gpt-5.5",
          input: [],
          stream: true,
          max_output_tokens: 16,
        },
      ])
    }),
  )
})
