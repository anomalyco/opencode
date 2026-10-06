import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect, Layer } from "effect"
import { Auth } from "@/auth"
import { Plugin } from "@/plugin"
import { CopilotModels } from "@/plugin/github-copilot/models"
import { Provider } from "@/provider/provider"
import { usable } from "@/session/overflow"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(Provider.node, [
    [
      ModelsDev.node,
      Layer.mock(ModelsDev.Service, {
        get: () =>
          Effect.succeed({
            "github-copilot": { id: "github-copilot", name: "GitHub Copilot", env: [], models: {} },
          }),
      }),
    ],
    [
      Auth.node,
      Layer.mock(Auth.Service, {
        get: () => Effect.succeed(undefined),
        all: () => Effect.succeed({ "github-copilot": { type: "api", key: "test-token" } }),
      }),
    ],
    [
      Plugin.node,
      Layer.mock(Plugin.Service, {
        list: () =>
          Effect.succeed([
            {
              provider: {
                id: "github-copilot",
                async models(provider) {
                  using server = Bun.serve({
                    port: 0,
                    fetch: () =>
                      Response.json({
                        data: [
                          {
                            id: "mai-test",
                            name: "MAI Test",
                            version: "mai-test-2026-10-01",
                            model_picker_enabled: true,
                            supported_endpoints: ["/responses"],
                            billing: {
                              token_prices: {
                                batch_size: 1_000_000,
                                default: { context_max: 272_000, input_price: 200, output_price: 1000 },
                                long_context: { context_max: 922_000, input_price: 400, output_price: 1500 },
                              },
                            },
                            capabilities: {
                              family: "mai",
                              limits: {
                                max_context_window_tokens: 1_050_000,
                                max_prompt_tokens: 922_000,
                                max_output_tokens: 128_000,
                              },
                              supports: { tool_calls: true },
                            },
                          },
                        ],
                      }),
                  })
                  return (await CopilotModels.get(server.url.origin, {}, provider.models)).models
                },
              },
            },
          ]),
      }),
    ],
  ]),
)

it.instance(
  "model config preserves Copilot context variants, live pricing, and endpoint",
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const model = yield* provider.getModel(ProviderV2.ID.githubCopilot, ModelV2.ID.make("mai-test"))
    expect(Object.keys((yield* provider.list())[ProviderV2.ID.githubCopilot].models)).toEqual(["mai-test"])

    expect(model.name).toBe("MAI Test")
    expect(model.options).toEqual({ custom: true, copilotContext: { default: 272_000, long: 922_000 } })
    expect(model.api).toMatchObject({ id: "mai-test", npm: "@ai-sdk/github-copilot", endpoint: "responses" })
    expect(model.limit).toEqual({ context: 1_050_000, input: 922_000, output: 128_000 })
    expect(model.cost).toEqual({
      input: 2,
      output: 10,
      cache: { read: 0, write: 0 },
      tiers: [{ input: 4, output: 15, cache: { read: 0, write: 0 }, tier: { type: "context", size: 272_000 } }],
    })
    expect(model.variants).toEqual({
      "default@default": { copilotContextTier: "default" },
      "default@long": { copilotContextTier: "long", reasoningEffort: "high", reasoningSummary: "detailed" },
    })
    for (const tier of ["default", "long"]) {
      const effective = CopilotModels.context(model, `default@${tier}`) as Provider.Model
      expect(effective.limit).toEqual({
        context: tier === "long" ? 1_050_000 : 400_000,
        input: tier === "long" ? 922_000 : 272_000,
        output: 128_000,
      })
      expect(effective.cost).toEqual(model.cost)
      expect(effective.api).toEqual(model.api)
      expect(usable({ cfg: {}, model: effective })).toBe(tier === "long" ? 902_000 : 252_000)
    }
    expect(CopilotModels.context(model).limit.input).toBe(272_000)
  }),
  {
    config: {
      provider: {
        "github-copilot": {
          models: {
            "mai-test": {
              options: { custom: true },
              variants: { "default@long": { reasoningEffort: "high", reasoningSummary: "detailed" } },
            },
          },
        },
      },
    },
  },
)
