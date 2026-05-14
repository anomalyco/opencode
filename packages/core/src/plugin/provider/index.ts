import { AlibabaPlugin } from "./alibaba"
import { AmazonBedrockPlugin } from "./amazon-bedrock"
import { AnthropicPlugin } from "./anthropic"
import { AzureCognitiveServicesPlugin, AzurePlugin } from "./azure"
import { CerebrasPlugin } from "./cerebras"
import { CloudflareAIGatewayPlugin } from "./cloudflare-ai-gateway"
import { CloudflareWorkersAIPlugin } from "./cloudflare-workers-ai"
import { CoherePlugin } from "./cohere"
import { DeepInfraPlugin } from "./deepinfra"
import { DynamicProviderPlugin } from "./dynamic"
import { GatewayPlugin } from "./gateway"
import { GithubCopilotPlugin } from "./github-copilot"
import { GitLabPlugin } from "./gitlab"
import { GooglePlugin } from "./google"
import { GoogleVertexAnthropicPlugin, GoogleVertexPlugin } from "./google-vertex"
import { GroqPlugin } from "./groq"
import { KiloPlugin } from "./kilo"
import { LLMGatewayPlugin } from "./llmgateway"
import { MistralPlugin } from "./mistral"
import { NvidiaPlugin } from "./nvidia"
import { OpenAIPlugin } from "./openai"
import { OpenAICompatiblePlugin } from "./openai-compatible"
import { OpencodePlugin } from "./opencode"
import { OpenRouterPlugin } from "./openrouter"
import { PerplexityPlugin } from "./perplexity"
import { SapAICorePlugin } from "./sap-ai-core"
import { TogetherAIPlugin } from "./togetherai"
import { VercelPlugin } from "./vercel"
import { VenicePlugin } from "./venice"
import { XAIPlugin } from "./xai"
import { ZenmuxPlugin } from "./zenmux"

export const ProviderPlugins = [
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
