import { AlibabaPlugin } from "./provider/alibaba.js"
import { AmazonBedrockPlugin } from "./provider/amazon-bedrock.js"
import { AnthropicPlugin } from "./provider/anthropic.js"
import { AzurePlugin } from "./provider/azure.js"
import { CerebrasPlugin } from "./provider/cerebras.js"
import { CloudflareAIGatewayPlugin } from "./provider/cloudflare-ai-gateway.js"
import { CloudflareWorkersAIPlugin } from "./provider/cloudflare-workers-ai.js"
import { CoherePlugin } from "./provider/cohere.js"
import { DeepInfraPlugin } from "./provider/deepinfra.js"
import { DynamicProviderPlugin } from "./provider/dynamic.js"
import { GatewayPlugin } from "./provider/gateway.js"
import { GithubCopilotPlugin } from "./provider/github-copilot.js"
import { GitLabPlugin } from "./provider/gitlab.js"
import { GoogleVertexPlugin } from "./provider/google-vertex.js"
import { GroqPlugin } from "./provider/groq.js"
import { KiloPlugin } from "./provider/kilo.js"
import { LLMGatewayPlugin } from "./provider/llmgateway.js"
import { LMStudioPlugin } from "./provider/lmstudio.js"
import { MistralPlugin } from "./provider/mistral.js"
import { NvidiaPlugin } from "./provider/nvidia.js"
import { OllamaPlugin } from "./provider/ollama.js"
import { OpenAIPlugin } from "./provider/openai.js"
import { OpencodePlugin } from "./provider/opencode.js"
import { OpenRouterPlugin } from "./provider/openrouter.js"
import { PerplexityPlugin } from "./provider/perplexity.js"
import { SapAICorePlugin } from "./provider/sap-ai-core.js"
import { TogetherAIPlugin } from "./provider/togetherai.js"
import { VercelPlugin } from "./provider/vercel.js"
import { VenicePlugin } from "./provider/venice.js"
import { VLLMPlugin } from "./provider/vllm.js"
import { XAIPlugin } from "./provider/xai.js"
import { ZenmuxPlugin } from "./provider/zenmux.js"
import type { PluginInternal } from "./internal.js"

export const ProviderPlugins: PluginInternal.InternalPlugin[] = [
  AlibabaPlugin,
  AmazonBedrockPlugin,
  AnthropicPlugin,
  AzurePlugin,
  CerebrasPlugin,
  CloudflareAIGatewayPlugin,
  CloudflareWorkersAIPlugin,
  CoherePlugin,
  DeepInfraPlugin,
  GatewayPlugin,
  GithubCopilotPlugin,
  GitLabPlugin,
  GoogleVertexPlugin,
  GroqPlugin,
  KiloPlugin,
  LLMGatewayPlugin,
  LMStudioPlugin,
  MistralPlugin,
  NvidiaPlugin,
  OllamaPlugin,
  OpencodePlugin,
  OpenAIPlugin,
  OpenRouterPlugin,
  PerplexityPlugin,
  SapAICorePlugin,
  TogetherAIPlugin,
  VercelPlugin,
  VenicePlugin,
  VLLMPlugin,
  XAIPlugin,
  ZenmuxPlugin,
  DynamicProviderPlugin,
]
