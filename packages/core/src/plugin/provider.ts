import { Effect } from "effect"
import { PluginV2 } from "../plugin"

export type ProviderPlugin = {
  readonly id: PluginV2.ID
  readonly effect: Effect.Effect<any, never, any>
}

type Loader = () => Promise<ProviderPlugin>

const loaders: Array<Loader> = [
  () => import("./provider/alibaba").then((m) => m.AlibabaPlugin),
  () => import("./provider/amazon-bedrock").then((m) => m.AmazonBedrockPlugin),
  () => import("./provider/anthropic").then((m) => m.AnthropicPlugin),
  () => import("./provider/azure").then((m) => m.AzureCognitiveServicesPlugin),
  () => import("./provider/azure").then((m) => m.AzurePlugin),
  () => import("./provider/cerebras").then((m) => m.CerebrasPlugin),
  () => import("./provider/cloudflare-ai-gateway").then((m) => m.CloudflareAIGatewayPlugin),
  () => import("./provider/cloudflare-workers-ai").then((m) => m.CloudflareWorkersAIPlugin),
  () => import("./provider/cohere").then((m) => m.CoherePlugin),
  () => import("./provider/deepinfra").then((m) => m.DeepInfraPlugin),
  () => import("./provider/dynamic").then((m) => m.DynamicProviderPlugin),
  () => import("./provider/gateway").then((m) => m.GatewayPlugin),
  () => import("./provider/github-copilot").then((m) => m.GithubCopilotPlugin),
  () => import("./provider/gitlab").then((m) => m.GitLabPlugin),
  () => import("./provider/google").then((m) => m.GooglePlugin),
  () => import("./provider/google-vertex").then((m) => m.GoogleVertexAnthropicPlugin),
  () => import("./provider/google-vertex").then((m) => m.GoogleVertexPlugin),
  () => import("./provider/groq").then((m) => m.GroqPlugin),
  () => import("./provider/kilo").then((m) => m.KiloPlugin),
  () => import("./provider/llmgateway").then((m) => m.LLMGatewayPlugin),
  () => import("./provider/mistral").then((m) => m.MistralPlugin),
  () => import("./provider/nvidia").then((m) => m.NvidiaPlugin),
  () => import("./provider/snowflake-cortex").then((m) => m.SnowflakeCortexPlugin),
  () => import("./provider/openai-compatible").then((m) => m.OpenAICompatiblePlugin),
  () => import("./provider/openai").then((m) => m.OpenAIPlugin),
  () => import("./provider/opencode").then((m) => m.OpencodePlugin),
  () => import("./provider/openrouter").then((m) => m.OpenRouterPlugin),
  () => import("./provider/perplexity").then((m) => m.PerplexityPlugin),
  () => import("./provider/sap-ai-core").then((m) => m.SapAICorePlugin),
  () => import("./provider/togetherai").then((m) => m.TogetherAIPlugin),
  () => import("./provider/vercel").then((m) => m.VercelPlugin),
  () => import("./provider/venice").then((m) => m.VenicePlugin),
  () => import("./provider/xai").then((m) => m.XAIPlugin),
  () => import("./provider/zenmux").then((m) => m.ZenmuxPlugin),
]

export function loadAllProviders(): Effect.Effect<ReadonlyArray<ProviderPlugin>> {
  return Effect.forEach(loaders, (loader) => Effect.promise(loader), { concurrency: "unbounded" })
}
