import { describe, expect, mock } from "bun:test"
import { Effect } from "effect"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { GatewayPlugin } from "@opencode-ai/core/plugin/provider/gateway"
import { it, model } from "./provider-helper"

const gatewayCalls: Record<string, unknown>[] = []
const vercelGatewayModels = ["anthropic/claude-sonnet-4", "openai/gpt-5", "google/gemini-2.5-pro"]

mock.module("@ai-sdk/gateway", () => ({
  createGateway(options: Record<string, unknown>) {
    gatewayCalls.push({ ...options })
    return {
      languageModel(modelID: string) {
        return {
          modelId: modelID,
          provider: options.name,
          specificationVersion: "v3",
        }
      },
    }
  },
}))

describe("GatewayPlugin", () => {
  it.effect("creates a Gateway SDK for @ai-sdk/gateway", () =>
    Effect.gen(function* () {
      gatewayCalls.length = 0
      const plugin = yield* PluginV2.Service
      yield* plugin.add(GatewayPlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        { model: model("gateway", "model"), package: "@ai-sdk/gateway", options: { name: "gateway" } },
        {},
      )
      expect(result.sdk).toBeDefined()
      expect(gatewayCalls).toHaveLength(1)
    }),
  )

  it.effect("passes the model providerID as the Gateway SDK name", () =>
    Effect.gen(function* () {
      gatewayCalls.length = 0
      const plugin = yield* PluginV2.Service
      yield* plugin.add(GatewayPlugin)

      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("vercel", "anthropic/claude-sonnet-4"),
          package: "@ai-sdk/gateway",
          options: { name: "vercel", apiKey: "test-key" },
        },
        {},
      )

      expect(gatewayCalls).toEqual([{ name: "vercel", apiKey: "test-key" }])
      expect(result.sdk.languageModel("anthropic/claude-sonnet-4").provider).toBe("vercel")
    }),
  )

  it.effect("matches Vercel AI Gateway models by their @ai-sdk/gateway package", () =>
    Effect.gen(function* () {
      gatewayCalls.length = 0
      const plugin = yield* PluginV2.Service
      yield* plugin.add(GatewayPlugin)

      for (const modelID of vercelGatewayModels) {
        const ignored = yield* plugin.trigger(
          "aisdk.sdk",
          { model: model("vercel", modelID), package: "@ai-sdk/vercel", options: { name: "vercel" } },
          {},
        )
        expect(ignored.sdk).toBeUndefined()

        const result = yield* plugin.trigger(
          "aisdk.sdk",
          { model: model("vercel", modelID), package: "@ai-sdk/gateway", options: { name: "vercel" } },
          {},
        )
        expect(result.sdk).toBeDefined()
      }

      expect(gatewayCalls).toHaveLength(3)
    }),
  )
})
