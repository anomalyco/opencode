import { describe, expect, mock } from "bun:test"
import { Effect } from "effect"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { GatewayPlugin } from "@opencode-ai/core/plugin/provider/gateway"
import { snapshot } from "../../../src/provider/models-snapshot.js"
import { it, model } from "../../../../core/test/v2/plugin/provider-helper"

const gatewayCalls: Record<string, unknown>[] = []
const vercel = snapshot.vercel as {
  npm?: string
  models: Record<string, { provider?: { npm?: string } }>
}

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

  it.effect("matches real Vercel AI Gateway models by their inherited @ai-sdk/gateway package", () =>
    Effect.gen(function* () {
      gatewayCalls.length = 0
      const plugin = yield* PluginV2.Service
      yield* plugin.add(GatewayPlugin)

      for (const modelID of ["anthropic/claude-sonnet-4", "openai/gpt-5", "google/gemini-2.5-pro"]) {
        const realModel = vercel.models[modelID]
        const packageName = realModel.provider?.npm ?? vercel.npm ?? ""
        expect(packageName).toBe("@ai-sdk/gateway")

        const ignored = yield* plugin.trigger(
          "aisdk.sdk",
          { model: model("vercel", modelID), package: "@ai-sdk/vercel", options: { name: "vercel" } },
          {},
        )
        expect(ignored.sdk).toBeUndefined()

        const result = yield* plugin.trigger(
          "aisdk.sdk",
          { model: model("vercel", modelID), package: packageName, options: { name: "vercel" } },
          {},
        )
        expect(result.sdk).toBeDefined()
      }

      expect(gatewayCalls).toHaveLength(3)
    }),
  )
})
