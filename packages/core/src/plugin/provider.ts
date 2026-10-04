import { AlibabaPlugin } from "./provider/alibaba"
import { AmazonBedrockPlugin } from "./provider/amazon-bedrock"
import { AnthropicPlugin } from "./provider/anthropic"
import { AzureCognitiveServicesPlugin, AzurePlugin } from "./provider/azure"
import { CerebrasPlugin } from "./provider/cerebras"
import { CloudflareAIGatewayPlugin } from "./provider/cloudflare-ai-gateway"
import { CloudflareWorkersAIPlugin } from "./provider/cloudflare-workers-ai"
import { CoherePlugin } from "./provider/cohere"
import { DeepInfraPlugin } from "./provider/deepinfra"
import { DynamicProviderPlugin } from "./provider/dynamic"
import { GatewayPlugin } from "./provider/gateway"
import { GithubCopilotPlugin } from "./provider/github-copilot"
import { GitLabPlugin } from "./provider/gitlab"
import { GooglePlugin } from "./provider/google"
import { GoogleVertexAnthropicPlugin, GoogleVertexPlugin } from "./provider/google-vertex"
import { GroqPlugin } from "./provider/groq"
import { KiloPlugin } from "./provider/kilo"
import { LLMGatewayPlugin } from "./provider/llmgateway"
import { MistralPlugin } from "./provider/mistral"
import { NvidiaPlugin } from "./provider/nvidia"
import { OpenAIPlugin } from "./provider/openai"
import { SnowflakeCortexPlugin } from "./provider/snowflake-cortex"
import { OpenAICompatiblePlugin } from "./provider/openai-compatible"
import { OpencodePlugin } from "./provider/opencode"
import { OpenRouterPlugin } from "./provider/openrouter"
import { PerplexityPlugin } from "./provider/perplexity"
import { SapAICorePlugin } from "./provider/sap-ai-core"
import { TogetherAIPlugin } from "./provider/togetherai"
import { VercelPlugin } from "./provider/vercel"
import { VenicePlugin } from "./provider/venice"
import { XAIPlugin } from "./provider/xai"
import { ZenmuxPlugin } from "./provider/zenmux"
import type { PluginInternal } from "./internal"
import type { Scope } from "effect"

export const ProviderPlugins: PluginInternal.Plugin<PluginInternal.Requirements | Scope.Scope>[] = [
  AlibabaPlugin,
  AmazonBedrockPlugin,
  AnthropicPlugin,
  AzureCognitiveServicesPlugin,
  AzurePlugin,
  CerebrasPlugin,
  CloudflareAIGatewayPlugin,
  CloudflareWorkersAIPlugin,
  CoherePlugin,
  DeepInfraPlugin,
  GatewayPlugin,
  GithubCopilotPlugin,
  GitLabPlugin,
  GooglePlugin,
  GoogleVertexAnthropicPlugin,
  GoogleVertexPlugin,
  GroqPlugin,
  KiloPlugin,
  LLMGatewayPlugin,
  MistralPlugin,
  NvidiaPlugin,
  OpencodePlugin,
  SnowflakeCortexPlugin,
  OpenAICompatiblePlugin,
  OpenAIPlugin,
  OpenRouterPlugin,
  PerplexityPlugin,
  SapAICorePlugin,
  TogetherAIPlugin,
  VercelPlugin,
  VenicePlugin,
  XAIPlugin,
  ZenmuxPlugin,
  DynamicProviderPlugin,
]
