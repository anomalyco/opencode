import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { AlibabaPlugin } from "@opencode-ai/core/plugin/provider/alibaba"
import { AmazonBedrockPlugin } from "@opencode-ai/core/plugin/provider/amazon-bedrock"
import { AnthropicPlugin } from "@opencode-ai/core/plugin/provider/anthropic"
import { AzurePlugin } from "@opencode-ai/core/plugin/provider/azure"
import { CerebrasPlugin } from "@opencode-ai/core/plugin/provider/cerebras"
import { CoherePlugin } from "@opencode-ai/core/plugin/provider/cohere"
import { DeepInfraPlugin } from "@opencode-ai/core/plugin/provider/deepinfra"
import { GatewayPlugin } from "@opencode-ai/core/plugin/provider/gateway"
import { GithubCopilotPlugin } from "@opencode-ai/core/plugin/provider/github-copilot"
import { GooglePlugin } from "@opencode-ai/core/plugin/provider/google"
import { GoogleVertexAnthropicPlugin, GoogleVertexPlugin } from "@opencode-ai/core/plugin/provider/google-vertex"
import { GroqPlugin } from "@opencode-ai/core/plugin/provider/groq"
import { MistralPlugin } from "@opencode-ai/core/plugin/provider/mistral"
import { OpenAIPlugin } from "@opencode-ai/core/plugin/provider/openai"
import { OpenAICompatiblePlugin } from "@opencode-ai/core/plugin/provider/openai-compatible"
import { OpenRouterPlugin } from "@opencode-ai/core/plugin/provider/openrouter"
import { PerplexityPlugin } from "@opencode-ai/core/plugin/provider/perplexity"
import { TogetherAIPlugin } from "@opencode-ai/core/plugin/provider/togetherai"
import { VercelPlugin } from "@opencode-ai/core/plugin/provider/vercel"
import { VenicePlugin } from "@opencode-ai/core/plugin/provider/venice"
import { XAIPlugin } from "@opencode-ai/core/plugin/provider/xai"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { it, model } from "../../../../core/test/v2/plugin/provider-helper"

const cases = [
  { name: "AlibabaPlugin", plugin: AlibabaPlugin, providerID: "custom", package: "@ai-sdk/alibaba" },
  {
    name: "AmazonBedrockPlugin",
    plugin: AmazonBedrockPlugin,
    providerID: "custom",
    package: "@ai-sdk/amazon-bedrock",
    options: { bearerToken: "token" },
  },
  { name: "AnthropicPlugin", plugin: AnthropicPlugin, providerID: "custom", package: "@ai-sdk/anthropic" },
  { name: "AzurePlugin", plugin: AzurePlugin, providerID: "custom", package: "@ai-sdk/azure" },
  { name: "CerebrasPlugin", plugin: CerebrasPlugin, providerID: "custom", package: "@ai-sdk/cerebras" },
  { name: "CoherePlugin", plugin: CoherePlugin, providerID: "custom", package: "@ai-sdk/cohere" },
  { name: "DeepInfraPlugin", plugin: DeepInfraPlugin, providerID: "custom", package: "@ai-sdk/deepinfra" },
  { name: "GatewayPlugin", plugin: GatewayPlugin, providerID: "vercel", package: "@ai-sdk/gateway" },
  { name: "GithubCopilotPlugin", plugin: GithubCopilotPlugin, providerID: "custom", package: "@ai-sdk/github-copilot" },
  { name: "GooglePlugin", plugin: GooglePlugin, providerID: "custom", package: "@ai-sdk/google" },
  {
    name: "GoogleVertexPlugin",
    plugin: GoogleVertexPlugin,
    providerID: "custom",
    package: "@ai-sdk/google-vertex",
    options: { project: "project" },
  },
  {
    name: "GoogleVertexAnthropicPlugin",
    plugin: GoogleVertexAnthropicPlugin,
    providerID: "custom",
    package: "@ai-sdk/google-vertex/anthropic",
    options: { project: "project" },
  },
  { name: "GroqPlugin", plugin: GroqPlugin, providerID: "custom", package: "@ai-sdk/groq" },
  { name: "MistralPlugin", plugin: MistralPlugin, providerID: "custom", package: "@ai-sdk/mistral" },
  { name: "OpenAIPlugin", plugin: OpenAIPlugin, providerID: "custom", package: "@ai-sdk/openai" },
  {
    name: "OpenAICompatiblePlugin",
    plugin: OpenAICompatiblePlugin,
    providerID: "custom",
    package: "@ai-sdk/openai-compatible",
  },
  { name: "OpenRouterPlugin", plugin: OpenRouterPlugin, providerID: "custom", package: "@openrouter/ai-sdk-provider" },
  { name: "PerplexityPlugin", plugin: PerplexityPlugin, providerID: "custom", package: "@ai-sdk/perplexity" },
  { name: "TogetherAIPlugin", plugin: TogetherAIPlugin, providerID: "custom", package: "@ai-sdk/togetherai" },
  { name: "VercelPlugin", plugin: VercelPlugin, providerID: "custom", package: "@ai-sdk/vercel" },
  { name: "VenicePlugin", plugin: VenicePlugin, providerID: "custom", package: "venice-ai-sdk-provider" },
  { name: "XAIPlugin", plugin: XAIPlugin, providerID: "custom", package: "@ai-sdk/xai" },
]

describe("provider SDK package matching", () => {
  for (const item of cases) {
    it.effect(`${item.name} creates an SDK only for its package`, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* plugin.add(item.plugin)

        const ignored = yield* plugin.trigger(
          "aisdk.sdk",
          { model: model(item.providerID, "model"), package: "unmatched-package", options: item.options ?? {} },
          {},
        )
        expect(ignored.sdk).toBeUndefined()

        const result = yield* plugin.trigger(
          "aisdk.sdk",
          { model: model(item.providerID, "model"), package: item.package, options: item.options ?? {} },
          {},
        )
        expect(result.sdk).toBeDefined()
      }),
    )
  }
})
