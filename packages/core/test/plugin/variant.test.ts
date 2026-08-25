import { describe, expect, test } from "bun:test"
import { Catalog } from "@opencode-ai/core/catalog"
import { Config } from "@opencode-ai/core/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { Model } from "@opencode-ai/core/model"
import { VariantPlugin } from "@opencode-ai/core/plugin/variant"
import { Provider } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect, Layer } from "effect"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { catalogHost, host } from "./host"

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make(import.meta.dir) })),
)
const it = testEffect(AppNodeBuilder.build(Catalog.node, [[Location.node, locationLayer]]))

describe("VariantPlugin", () => {
  it.effect("adds GLM 5.2 variants after catalog sources", () =>
    Effect.gen(function* () {
      const service = yield* Catalog.Service
      yield* service.transform((catalog) => {
        catalog.provider.update(Provider.ID.opencode, (provider) => {
          provider.package = Provider.aisdk("@ai-sdk/openai-compatible")
        })
        catalog.model.update(Provider.ID.opencode, Model.ID.make("glm-5.2"), (model) => {
          model.modelID = Model.ID.make("glm-5.2")
          model.package = Provider.aisdk("@ai-sdk/openai-compatible")
        })
      })
      yield* VariantPlugin.Plugin.effect(host({ catalog: catalogHost(service) })).pipe(
        Effect.provide(Config.testLayer([])),
      )

      expect((yield* service.model.get(Provider.ID.opencode, Model.ID.make("glm-5.2")))?.variants).toEqual([
        expect.objectContaining({ id: "high", settings: { reasoningEffort: "high" } }),
        expect.objectContaining({ id: "max", settings: { reasoningEffort: "max" } }),
      ])
    }),
  )

  it.effect("keeps explicit variants over generated defaults", () =>
    Effect.gen(function* () {
      const service = yield* Catalog.Service
      yield* service.transform((catalog) => {
        catalog.model.update(Provider.ID.opencode, Model.ID.make("glm-5.2"), (model) => {
          model.modelID = Model.ID.make("glm-5.2")
          model.package = Provider.aisdk("@ai-sdk/openai-compatible")
          model.variants = [{ id: Model.VariantID.make("high"), settings: {}, headers: { custom: "true" }, body: {} }]
        })
      })
      yield* VariantPlugin.Plugin.effect(host({ catalog: catalogHost(service) })).pipe(
        Effect.provide(Config.testLayer([])),
      )

      expect((yield* service.model.get(Provider.ID.opencode, Model.ID.make("glm-5.2")))?.variants).toEqual([
        expect.objectContaining({ id: "high", headers: { custom: "true" } }),
        expect.objectContaining({ id: "max", settings: { reasoningEffort: "max" } }),
      ])
    }),
  )
})

describe("VariantPlugin.fallback", () => {
  const model = (
    modelID: string,
    packageName: string,
    output = 32_000,
    settings?: Readonly<Record<string, unknown>>,
  ) => ({
    modelID,
    package: packageName,
    settings,
    limit: { output },
  })
  const plain = (variants: Model.Info["variants"]) =>
    variants.map((variant) => ({ ...variant, id: String(variant.id) }))
  const settings = (packageName: string, value: Readonly<Record<string, unknown>>) =>
    Provider.isAISDK(packageName) ? value : { providerOptions: value }

  test.each([
    Provider.aisdk("@ai-sdk/openai"),
    Provider.aisdk("@ai-sdk/azure"),
    "@opencode-ai/ai/providers/openai",
    "@opencode-ai/ai/providers/openai/responses",
    "@opencode-ai/ai/providers/azure",
    "@opencode-ai/ai/providers/azure/responses",
    "@opencode-ai/ai/providers/google-vertex/responses",
  ])("adds OpenAI Responses variants for %s", (packageName) => {
    const variants = VariantPlugin.fallback(model("gpt-next", packageName))

    expect(variants.map((variant) => String(variant.id))).toEqual(["none", "low", "medium", "high", "xhigh", "max"])
    expect(variants[0]?.settings).toEqual(
      settings(packageName, {
        reasoningEffort: "none",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      }),
    )
  })

  test.each([
    Provider.aisdk("@ai-sdk/openai-compatible"),
    "@opencode-ai/ai/providers/openai/chat",
    "@opencode-ai/ai/providers/openai-compatible",
    "@opencode-ai/ai/providers/azure/chat",
    "@opencode-ai/ai/providers/google-vertex/chat",
  ])("adds conservative chat variants for %s", (packageName) => {
    expect(plain(VariantPlugin.fallback(model("reasoner", packageName)))).toEqual([
      { id: "low", settings: settings(packageName, { reasoningEffort: "low" }) },
      { id: "medium", settings: settings(packageName, { reasoningEffort: "medium" }) },
      { id: "high", settings: settings(packageName, { reasoningEffort: "high" }) },
    ])
  })

  test("uses chat fallbacks for AI SDK Azure completion URLs", () => {
    const variants = VariantPlugin.fallback(
      model("deployment", Provider.aisdk("@ai-sdk/azure"), 32_000, { useCompletionUrls: true }),
    )

    expect(plain(variants)).toEqual([
      { id: "low", settings: { reasoningEffort: "low" } },
      { id: "medium", settings: { reasoningEffort: "medium" } },
      { id: "high", settings: { reasoningEffort: "high" } },
    ])
  })

  test.each([
    Provider.aisdk("@ai-sdk/google"),
    Provider.aisdk("@ai-sdk/google-vertex"),
    "@opencode-ai/ai/providers/google",
    "@opencode-ai/ai/providers/google-vertex",
    "@opencode-ai/ai/providers/google-vertex/gemini",
  ])("adds Google level and legacy budget variants for %s", (packageName) => {
    expect(plain(VariantPlugin.fallback(model("gemini-next", packageName)))).toEqual([
      {
        id: "low",
        settings: settings(packageName, { thinkingConfig: { includeThoughts: true, thinkingLevel: "low" } }),
      },
      {
        id: "medium",
        settings: settings(packageName, { thinkingConfig: { includeThoughts: true, thinkingLevel: "medium" } }),
      },
      {
        id: "high",
        settings: settings(packageName, { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } }),
      },
    ])
    expect(plain(VariantPlugin.fallback(model("gemini-2.5-pro", packageName, 64_000)))).toEqual([
      {
        id: "high",
        settings: settings(packageName, { thinkingConfig: { includeThoughts: true, thinkingBudget: 16_000 } }),
      },
      {
        id: "max",
        settings: settings(packageName, { thinkingConfig: { includeThoughts: true, thinkingBudget: 32_768 } }),
      },
    ])
    expect(VariantPlugin.fallback(model("gemini-12.5-pro", packageName)).map((variant) => String(variant.id))).toEqual([
      "low",
      "medium",
      "high",
    ])
  })

  test.each([
    Provider.aisdk("@ai-sdk/anthropic"),
    Provider.aisdk("@ai-sdk/google-vertex/anthropic"),
    "@opencode-ai/ai/providers/anthropic",
    "@opencode-ai/ai/providers/anthropic-compatible",
    "@opencode-ai/ai/providers/google-vertex/messages",
  ])("adds Anthropic adaptive and legacy budget variants for %s", (packageName) => {
    expect(VariantPlugin.fallback(model("claude-opus-4-7", packageName)).map((variant) => String(variant.id))).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ])
    expect(VariantPlugin.fallback(model("claude-opus-4-7", packageName))[0]?.settings).toEqual(
      settings(packageName, {
        thinking: { type: "adaptive", display: "summarized" },
        effort: "low",
      }),
    )
    expect(plain(VariantPlugin.fallback(model("claude-haiku-4-5", packageName, 20_000)))).toEqual([
      { id: "high", settings: settings(packageName, { thinking: { type: "enabled", budgetTokens: 16_000 } }) },
      { id: "max", settings: settings(packageName, { thinking: { type: "enabled", budgetTokens: 19_999 } }) },
    ])
    for (const family of ["haiku", "sonnet", "opus"]) {
      expect(VariantPlugin.fallback(model(`claude-${family}-4-5`, packageName))[0]?.settings).toEqual(
        settings(packageName, { thinking: { type: "enabled", budgetTokens: 16_000 } }),
      )
      expect(VariantPlugin.fallback(model(`claude-${family}-4-6`, packageName))[0]?.settings).toEqual(
        settings(packageName, {
          thinking: { type: "adaptive", display: "summarized" },
          effort: "low",
        }),
      )
    }
    expect(VariantPlugin.fallback(model("claude-mythos-4-5", packageName))[0]?.settings).toEqual(
      settings(packageName, {
        thinking: { type: "adaptive", display: "summarized" },
        effort: "low",
      }),
    )
  })

  test("does not add fallbacks for unknown packages", () => {
    expect(VariantPlugin.fallback(model("reasoner", "custom"))).toEqual([])
  })
})
