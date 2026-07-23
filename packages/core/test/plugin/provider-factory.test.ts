import { expect } from "bun:test"
import { Effect } from "effect"
import { AISDK } from "@opencode-ai/core/aisdk"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { AlibabaPlugin } from "@opencode-ai/core/plugin/provider/alibaba"
import { CoherePlugin } from "@opencode-ai/core/plugin/provider/cohere"
import { DeepInfraPlugin } from "@opencode-ai/core/plugin/provider/deepinfra"
import { GatewayPlugin } from "@opencode-ai/core/plugin/provider/gateway"
import { GroqPlugin } from "@opencode-ai/core/plugin/provider/groq"
import { MistralPlugin } from "@opencode-ai/core/plugin/provider/mistral"
import { PerplexityPlugin } from "@opencode-ai/core/plugin/provider/perplexity"
import { TogetherAIPlugin } from "@opencode-ai/core/plugin/provider/togetherai"
import { VenicePlugin } from "@opencode-ai/core/plugin/provider/venice"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const modelID = ModelV2.ID.make("test-model")
const options = { name: "custom-provider", apiKey: "test", baseURL: "https://example.test" }
const providers = [
  { id: "alibaba", plugin: AlibabaPlugin, package: "@ai-sdk/alibaba", provider: "alibaba.chat" },
  { id: "cohere", plugin: CoherePlugin, package: "@ai-sdk/cohere", provider: "cohere.chat" },
  { id: "deepinfra", plugin: DeepInfraPlugin, package: "@ai-sdk/deepinfra", provider: "deepinfra.chat" },
  { id: "gateway", plugin: GatewayPlugin, package: "@ai-sdk/gateway", provider: "gateway" },
  { id: "groq", plugin: GroqPlugin, package: "@ai-sdk/groq", provider: "groq.chat" },
  { id: "mistral", plugin: MistralPlugin, package: "@ai-sdk/mistral", provider: "mistral.chat" },
  { id: "perplexity", plugin: PerplexityPlugin, package: "@ai-sdk/perplexity", provider: "perplexity" },
  { id: "togetherai", plugin: TogetherAIPlugin, package: "@ai-sdk/togetherai", provider: "togetherai.chat" },
  { id: "venice", plugin: VenicePlugin, package: "venice-ai-sdk-provider", provider: "custom-provider.chat" },
] as const

const it = testEffect(PluginTestLayer)

providers.forEach((item) =>
  it.effect(`${item.id} loads only its exact package`, () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const host = yield* PluginHost.make(plugin)
      yield* item.plugin.effect(host)
      const model = ModelV2.Info.make({
        ...ModelV2.Info.default(ProviderV2.ID.make(item.id), modelID),
        modelID,
        package: ProviderV2.aisdk(item.package),
      })
      const matched = yield* aisdk.runSDK({ model, package: item.package, options })
      const ignored = yield* aisdk.runSDK({ model, package: `${item.package}/unsupported`, options })
      const language = matched.sdk?.languageModel(modelID)

      expect({
        provider: language?.provider,
        modelID: language?.modelId,
        version: language?.specificationVersion,
        ignored: ignored.sdk === undefined,
      }).toEqual({ provider: item.provider, modelID: "test-model", version: "v3", ignored: true })
    }),
  ),
)
