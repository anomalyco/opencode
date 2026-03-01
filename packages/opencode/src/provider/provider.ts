import z from "zod"
import os from "os"
import fuzzysort from "fuzzysort"
import { Config } from "../config/config"
import { mapValues, mergeDeep, omit, pickBy, sortBy } from "remeda"
import { NoSuchModelError, type Provider as SDK } from "ai"
import { Log } from "../util/log"
import { BunProc } from "../bun"
import { Plugin } from "../plugin"
import { ModelsDev } from "./models"
import { NamedError } from "@opencode-ai/util/error"
import { Auth } from "../auth"
import { Env } from "../env"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"
import { iife } from "@/util/iife"
import { Global } from "../global"
import path from "path"
import { Filesystem } from "../util/filesystem"

// Direct imports for bundled providers
import { createAmazonBedrock, type AmazonBedrockProviderSettings } from "@ai-sdk/amazon-bedrock"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createAzure } from "@ai-sdk/azure"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createVertex } from "@ai-sdk/google-vertex"
import { createVertexAnthropic } from "@ai-sdk/google-vertex/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createOpenRouter, type LanguageModelV2 } from "@openrouter/ai-sdk-provider"
import { createOpenaiCompatible as createGitHubCopilotOpenAICompatible } from "./sdk/copilot"
import { createXai } from "@ai-sdk/xai"
import { createMistral } from "@ai-sdk/mistral"
import { createGroq } from "@ai-sdk/groq"
import { createDeepInfra } from "@ai-sdk/deepinfra"
import { createCerebras } from "@ai-sdk/cerebras"
import { createCohere } from "@ai-sdk/cohere"
import { createGateway } from "@ai-sdk/gateway"
import { createTogetherAI } from "@ai-sdk/togetherai"
import { createPerplexity } from "@ai-sdk/perplexity"
import { createVercel } from "@ai-sdk/vercel"
import { createGitLab, VERSION as GITLAB_PROVIDER_VERSION } from "@gitlab/gitlab-ai-provider"
import { fromNodeProviderChain } from "@aws-sdk/credential-providers"
import { GoogleAuth } from "google-auth-library"
import { ProviderTransform } from "./transform"
import { Installation } from "../installation"

export namespace Provider {
  const log = Log.create({ service: "provider" })

  const ANTIGRAVITY: Record<
    string,
    { name: string; order: string[]; providers?: string[] }
  > = {
    "gemini-3.1-pro": {
      name: "Gemini 3.1 Pro (Antigravity)",
      order: ["gemini-3.1-pro-preview"],
      providers: ["google"],
    },
    "gemini-3.1-flash": {
      name: "Gemini 3.1 Flash (Antigravity)",
      order: ["gemini-3.1-flash-preview"],
      providers: ["google"],
    },
    "gemini-3.1-flash-image": {
      name: "Gemini 3.1 Flash Image (Antigravity)",
      order: ["gemini-3.1-flash-image-preview"],
      providers: ["google"],
    },
    "gemini-3-pro-image": {
      name: "Gemini 3 Pro Image (Antigravity)",
      order: ["gemini-3-pro-image-preview"],
      providers: ["google"],
    },
    "gemini-3-pro-high": {
      name: "Gemini 3 Pro High (Antigravity)",
      order: ["gemini-3-pro-preview", "gemini-3-pro"],
      providers: ["google"],
    },
    "gemini-3-pro-low": {
      name: "Gemini 3 Pro Low (Antigravity)",
      order: ["gemini-3-pro-preview", "gemini-3-pro"],
      providers: ["google"],
    },
    "gemini-3-flash": {
      name: "Gemini 3 Flash (Antigravity)",
      order: ["gemini-3-flash-preview", "gemini-3-flash"],
      providers: ["google"],
    },
    "gemini-2.5-pro": {
      name: "Gemini 2.5 Pro (Antigravity)",
      order: ["gemini-2.5-pro-preview-06-05", "gemini-2.5-pro-preview-05-06", "gemini-2.5-pro"],
      providers: ["google"],
    },
    "gemini-2.5-flash": {
      name: "Gemini 2.5 Flash (Antigravity)",
      order: [
        "gemini-2.5-flash-preview-09-2025",
        "gemini-2.5-flash-preview-04-17",
        "gemini-2.5-flash-preview-05-20",
        "gemini-2.5-flash",
      ],
      providers: ["google"],
    },
    "gemini-2.5-flash-lite": {
      name: "Gemini 2.5 Flash Lite (Antigravity)",
      order: [
        "gemini-2.5-flash-lite-preview-09-2025",
        "gemini-2.5-flash-lite-preview-06-17",
        "gemini-2.5-flash-lite",
      ],
      providers: ["google"],
    },
    "gemini-2.0-flash": {
      name: "Gemini 2.0 Flash (Antigravity)",
      order: ["gemini-2.0-flash"],
      providers: ["google"],
    },
    "gemini-2.0-flash-lite": {
      name: "Gemini 2.0 Flash Lite (Antigravity)",
      order: ["gemini-2.0-flash-lite"],
      providers: ["google"],
    },
    "gemini-1.5-pro": {
      name: "Gemini 1.5 Pro (Antigravity)",
      order: ["gemini-1.5-pro"],
      providers: ["google"],
    },
    "gemini-1.5-flash": {
      name: "Gemini 1.5 Flash (Antigravity)",
      order: ["gemini-1.5-flash"],
      providers: ["google"],
    },
    "gemini-1.5-flash-8b": {
      name: "Gemini 1.5 Flash 8B (Antigravity)",
      order: ["gemini-1.5-flash-8b"],
      providers: ["google"],
    },
    "gemini-live": {
      name: "Gemini Live (Antigravity)",
      order: ["gemini-live-2.5-flash"],
      providers: ["google"],
    },
    "gemini-flash-latest": {
      name: "Gemini Flash Latest (Antigravity)",
      order: ["gemini-flash-latest"],
      providers: ["google"],
    },
    "gemini-flash-lite": {
      name: "Gemini Flash Lite (Antigravity)",
      order: ["gemini-flash-lite-latest"],
      providers: ["google"],
    },
    "gemini-2.5-flash-image": {
      name: "Gemini 2.5 Flash Image (Antigravity)",
      order: ["gemini-2.5-flash-image-preview", "gemini-2.5-flash-image"],
      providers: ["google"],
    },
    "gemini-2.5-pro-tts": {
      name: "Gemini 2.5 Pro TTS (Antigravity)",
      order: ["gemini-2.5-pro-preview-tts"],
      providers: ["google"],
    },
    "gemini-2.5-flash-tts": {
      name: "Gemini 2.5 Flash TTS (Antigravity)",
      order: ["gemini-2.5-flash-preview-tts"],
      providers: ["google"],
    },
    "claude-opus": {
      name: "Claude Opus (Antigravity)",
      order: ["claude-opus-4-6", "claude-opus-4-5-20251101", "claude-opus-4-5", "claude-opus-4-1-20250805", "claude-opus-4"],
      providers: ["anthropic", "claude"],
    },
    "claude-sonnet": {
      name: "Claude Sonnet (Antigravity)",
      order: [
        "claude-sonnet-4-6",
        "claude-sonnet-4-5-20250929",
        "claude-sonnet-4-5",
        "claude-sonnet-4-20250514",
        "claude-sonnet-4",
        "claude-3-5-sonnet-20241022",
        "claude-3-5-sonnet-20240620",
        "claude-3.5-sonnet",
      ],
      providers: ["anthropic", "claude"],
    },
    "claude-haiku": {
      name: "Claude Haiku (Antigravity)",
      order: ["claude-haiku-4-5-20251001", "claude-haiku-4-5", "claude-haiku-4.5", "claude-3.5-haiku"],
      providers: ["anthropic", "claude"],
    },
    "claude-3-7-sonnet": {
      name: "Claude 3.7 Sonnet (Antigravity)",
      order: ["claude-3-7-sonnet-20250219", "claude-3-7-sonnet-latest"],
      providers: ["anthropic", "claude"],
    },
    "gpt-5": {
      name: "GPT-5 (Antigravity)",
      order: ["gpt-5.2", "gpt-5.2-pro", "gpt-5.1", "gpt-5-pro", "gpt-5"],
      providers: ["openai", "openrouter"],
    },
    "gpt-5-mini": {
      name: "GPT-5 Mini (Antigravity)",
      order: ["gpt-5-mini", "gpt-5-nano"],
      providers: ["openai", "openrouter"],
    },
    "gpt-5-codex": {
      name: "GPT-5 Codex (Antigravity)",
      order: ["gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.1-codex", "gpt-5.1-codex-max", "gpt-5-codex"],
      providers: ["openai", "openrouter"],
    },
    "gpt-4o": {
      name: "GPT-4o (Antigravity)",
      order: ["gpt-4o", "gpt-4o-2024-11-20"],
      providers: ["openai", "openrouter"],
    },
    "gpt-4o-mini": {
      name: "GPT-4o Mini (Antigravity)",
      order: ["gpt-4o-mini"],
      providers: ["openai", "openrouter"],
    },
    "gpt-4.1": {
      name: "GPT-4.1 (Antigravity)",
      order: ["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"],
      providers: ["openai", "openrouter"],
    },
    "gpt-4": {
      name: "GPT-4 (Antigravity)",
      order: ["gpt-4", "gpt-4-turbo", "gpt-4-32k"],
      providers: ["openai", "openrouter"],
    },
    "gpt-3.5-turbo": {
      name: "GPT-3.5 Turbo (Antigravity)",
      order: ["gpt-3.5-turbo-0125", "gpt-3.5-turbo-1106", "gpt-3.5-turbo-0613"],
      providers: ["openai", "openrouter"],
    },
    "gpt-oss": {
      name: "GPT-OSS (Antigravity)",
      order: ["gpt-oss-120b", "gpt-oss:120b", "gpt-oss-20b", "gpt-oss:20b"],
      providers: ["openai", "openrouter"],
    },
    "o3": {
      name: "O3 (Antigravity)",
      order: ["o3", "o3-mini"],
      providers: ["openai", "openrouter"],
    },
    "o4-mini": {
      name: "O4 Mini (Antigravity)",
      order: ["o4-mini"],
      providers: ["openai", "openrouter"],
    },
    "gpt-realtime": {
      name: "GPT Realtime (Antigravity)",
      order: ["gpt-realtime", "gpt-realtime-1.5", "gpt-realtime-mini"],
      providers: ["openai"],
    },
    "gpt-audio": {
      name: "GPT Audio (Antigravity)",
      order: ["gpt-audio", "gpt-audio-1.5", "gpt-audio-mini"],
      providers: ["openai"],
    },
    "gpt-image": {
      name: "GPT Image (Antigravity)",
      order: ["gpt-image-1.5", "chatgpt-image-latest", "gpt-image-1"],
      providers: ["openai"],
    },
    "grok-4": {
      name: "Grok 4 (Antigravity)",
      order: ["grok-4", "grok-4-fast", "grok-4-1-fast", "grok-3"],
      providers: ["xai"],
    },
    "grok-3": {
      name: "Grok 3 (Antigravity)",
      order: ["grok-3", "grok-3-fast", "grok-3-mini", "grok-3-mini-fast"],
      providers: ["xai"],
    },
    "grok-2": {
      name: "Grok 2 (Antigravity)",
      order: ["grok-2", "grok-2-vision", "grok-2-latest"],
      providers: ["xai"],
    },
    "deepseek-v3": {
      name: "DeepSeek V3 (Antigravity)",
      order: ["deepseek-v3.2", "deepseek-v3.2-thinking", "deepseek-v3.1"],
      providers: ["deepseek"],
    },
    "deepseek-reasoner": {
      name: "DeepSeek Reasoner (Antigravity)",
      order: ["deepseek-reasoner"],
      providers: ["deepseek"],
    },
    "deepseek-chat": {
      name: "DeepSeek Chat (Antigravity)",
      order: ["deepseek-chat"],
      providers: ["deepseek"],
    },
    "mistral-large": {
      name: "Mistral Large (Antigravity)",
      order: ["mistral-large-2512", "mistral-large-3", "mistral-large-2"],
      providers: ["mistral"],
    },
    "mistral-small": {
      name: "Mistral Small (Antigravity)",
      order: ["mistral-small-3.1", "mistral-small"],
      providers: ["mistral"],
    },
    "codestral": {
      name: "Codestral (Antigravity)",
      order: ["codestral-22b", "codestral"],
      providers: ["mistral"],
    },
    "ministral": {
      name: "Ministral (Antigravity)",
      order: ["ministral-14b", "ministral-3"],
      providers: ["mistral"],
    },
    "command-r": {
      name: "Command R (Antigravity)",
      order: ["command-r-plus", "command-r"],
      providers: ["cohere"],
    },
    "command": {
      name: "Command (Antigravity)",
      order: ["command-r-plus", "command-r", "command"],
      providers: ["cohere"],
    },
    "qwen3": {
      name: "Qwen3 (Antigravity)",
      order: ["qwen3-max", "qwen3-235b-a22b", "qwen3-30b-a3b", "qwen3-32b", "qwen3-8b"],
      providers: ["alibaba", "openrouter"],
    },
    "qwen2.5": {
      name: "Qwen 2.5 (Antigravity)",
      order: ["qwen2.5-72b-instruct", "qwen2.5-32b-instruct", "qwen2.5-14b-instruct", "qwen2.5-7b-instruct"],
      providers: ["alibaba", "openrouter"],
    },
    "qwen-coder": {
      name: "Qwen Coder (Antigravity)",
      order: ["qwen3-coder-480b", "qwen3-coder-30b-a3b", "qwen2.5-coder-32b", "qwen2.5-coder-7b"],
      providers: ["alibaba", "openrouter"],
    },
    "qwen-vl": {
      name: "Qwen VL (Antigravity)",
      order: ["qwen-vl-max", "qwen2.5-vl-72b", "qwen2.5-vl-7b"],
      providers: ["alibaba", "openrouter"],
    },
    "llama-4": {
      name: "Llama 4 (Antigravity)",
      order: ["llama-4-maverick", "llama-4-scout"],
      providers: ["meta", "openrouter"],
    },
    "llama-3.3": {
      name: "Llama 3.3 (Antigravity)",
      order: ["llama-3.3-70b"],
      providers: ["meta", "openrouter"],
    },
    "llama-3.2": {
      name: "Llama 3.2 (Antigravity)",
      order: ["llama-3.2-11b-vision", "llama-3.2-1b"],
      providers: ["meta", "openrouter"],
    },
    "llama-3": {
      name: "Llama 3 (Antigravity)",
      order: ["llama-3.1-70b", "llama-3-70b"],
      providers: ["meta", "openrouter"],
    },
    "phi-4": {
      name: "Phi 4 (Antigravity)",
      order: ["phi-4-mini"],
      providers: ["microsoft"],
    },
    "phi-3": {
      name: "Phi 3 (Antigravity)",
      order: ["phi-3-medium", "phi-3-small"],
      providers: ["microsoft"],
    },
    "gemma-3": {
      name: "Gemma 3 (Antigravity)",
      order: ["gemma-3-27b", "gemma-3-12b", "gemma-3-4b", "gemma-3-1b"],
      providers: ["google"],
    },
    "gemma-2": {
      name: "Gemma 2 (Antigravity)",
      order: ["gemma-2-27b", "gemma-2-2b"],
      providers: ["google"],
    },
    "kimi-k2": {
      name: "Kimi K2 (Antigravity)",
      order: ["kimi-k2.5", "kimi-k2-thinking", "kimi-k2-turbo", "kimi-k2"],
      providers: ["moonshotai", "moonshotai-cn"],
    },
    "doubao": {
      name: "Doubao (Antigravity)",
      order: ["doubao-seed-1-6-thinking", "doubao-seed-1-8", "doubao-seed-1-6-vision"],
      providers: ["bytedance"],
    },
    "glm-4": {
      name: "GLM-4 (Antigravity)",
      order: ["glm-4.7", "glm-4.6", "glm-4.5", "glm-4"],
      providers: ["zhipuai"],
    },
    "glm-4v": {
      name: "GLM-4V (Antigravity)",
      order: ["glm-4.6v", "glm-4.5v"],
      providers: ["zhipuai"],
    },
  }

  function shouldApplyAntigravity(providerID: string, aliasProviders?: string[]): boolean {
    if (!aliasProviders || aliasProviders.length === 0) return true
    const root = providerBaseID(providerID)
    return aliasProviders.some((p) => root === p || providerID === p || providerID.startsWith(p + "-"))
  }

  /**
   * Extracts the base provider ID from a multi-account provider ID.
   * Supports formats:
   *   google-user@gmail.com  → google
   *   anthropic-2            → anthropic
   *   openai:scope           → openai
   *   google                 → google
   */
  function providerBaseID(providerID: string): string {
    // Handle scoped format: provider:scope
    const scoped = providerID.split(":")[0]
    // Handle email-suffix format: provider-user@domain.com
    // Match the longest known provider prefix followed by a dash and an account identifier
    // We find the base by stripping a trailing "-<non-empty>" that contains @ or is purely numeric
    const emailMatch = scoped.match(/^(.*)-([^-]+@.+)$/)
    if (emailMatch) return emailMatch[1]
    const numericMatch = scoped.match(/^(.*)-(\d+)$/)
    if (numericMatch) return numericMatch[1]
    return scoped
  }

  function isGpt5OrLater(modelID: string): boolean {
    const match = /^gpt-(\d+)/.exec(modelID)
    if (!match) {
      return false
    }
    return Number(match[1]) >= 5
  }

  function shouldUseCopilotResponsesApi(modelID: string): boolean {
    return isGpt5OrLater(modelID) && !modelID.startsWith("gpt-5-mini")
  }

  function googleVertexVars(options: Record<string, any>) {
    const project =
      options["project"] ?? Env.get("GOOGLE_CLOUD_PROJECT") ?? Env.get("GCP_PROJECT") ?? Env.get("GCLOUD_PROJECT")
    const location =
      options["location"] ?? Env.get("GOOGLE_CLOUD_LOCATION") ?? Env.get("VERTEX_LOCATION") ?? "us-central1"
    const endpoint = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`

    return {
      GOOGLE_VERTEX_PROJECT: project,
      GOOGLE_VERTEX_LOCATION: location,
      GOOGLE_VERTEX_ENDPOINT: endpoint,
    }
  }

  function loadBaseURL(model: Model, options: Record<string, any>) {
    const raw = options["baseURL"] ?? model.api.url
    if (typeof raw !== "string") return raw
    const vars = model.providerID === "google-vertex" ? googleVertexVars(options) : undefined
    return raw.replace(/\$\{([^}]+)\}/g, (match, key) => {
      const val = Env.get(String(key)) ?? vars?.[String(key) as keyof typeof vars]
      return val ?? match
    })
  }

  const BUNDLED_PROVIDERS: Record<string, (options: any) => SDK> = {
    "@ai-sdk/amazon-bedrock": createAmazonBedrock,
    "@ai-sdk/anthropic": createAnthropic,
    "@ai-sdk/azure": createAzure,
    "@ai-sdk/google": createGoogleGenerativeAI,
    "@ai-sdk/google-vertex": createVertex,
    "@ai-sdk/google-vertex/anthropic": createVertexAnthropic,
    "@ai-sdk/openai": createOpenAI,
    "@ai-sdk/openai-compatible": createOpenAICompatible,
    "@openrouter/ai-sdk-provider": createOpenRouter,
    "@ai-sdk/xai": createXai,
    "@ai-sdk/mistral": createMistral,
    "@ai-sdk/groq": createGroq,
    "@ai-sdk/deepinfra": createDeepInfra,
    "@ai-sdk/cerebras": createCerebras,
    "@ai-sdk/cohere": createCohere,
    "@ai-sdk/gateway": createGateway,
    "@ai-sdk/togetherai": createTogetherAI,
    "@ai-sdk/perplexity": createPerplexity,
    "@ai-sdk/vercel": createVercel,
    "@gitlab/gitlab-ai-provider": createGitLab,
    // @ts-ignore (TODO: kill this code so we dont have to maintain it)
    "@ai-sdk/github-copilot": createGitHubCopilotOpenAICompatible,
  }

  type CustomModelLoader = (sdk: any, modelID: string, options?: Record<string, any>) => Promise<any>
  type CustomLoader = (provider: Info) => Promise<{
    autoload: boolean
    getModel?: CustomModelLoader
    options?: Record<string, any>
  }>

  const CUSTOM_LOADERS: Record<string, CustomLoader> = {
    async anthropic() {
      return {
        autoload: false,
        options: {
          headers: {
            "anthropic-beta":
              "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
          },
        },
      }
    },
    async opencode(input) {
      const hasKey = await (async () => {
        const env = Env.all()
        if (input.env.some((item) => env[item])) return true
        if (await Auth.get(input.id)) return true
        const config = await Config.get()
        if (config.provider?.["opencode"]?.options?.apiKey) return true
        return false
      })()

      if (!hasKey) {
        for (const [key, value] of Object.entries(input.models)) {
          if (value.cost.input === 0) continue
          delete input.models[key]
        }
      }

      return {
        autoload: Object.keys(input.models).length > 0,
        options: hasKey ? {} : { apiKey: "public" },
      }
    },
    openai: async () => {
      return {
        autoload: false,
        async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
          return sdk.responses(modelID)
        },
        options: {},
      }
    },
    "github-copilot": async () => {
      return {
        autoload: false,
        async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
          if (sdk.responses === undefined && sdk.chat === undefined) return sdk.languageModel(modelID)
          return shouldUseCopilotResponsesApi(modelID) ? sdk.responses(modelID) : sdk.chat(modelID)
        },
        options: {},
      }
    },
    "github-copilot-enterprise": async () => {
      return {
        autoload: false,
        async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
          if (sdk.responses === undefined && sdk.chat === undefined) return sdk.languageModel(modelID)
          return shouldUseCopilotResponsesApi(modelID) ? sdk.responses(modelID) : sdk.chat(modelID)
        },
        options: {},
      }
    },
    azure: async () => {
      return {
        autoload: false,
        async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
          if (options?.["useCompletionUrls"]) {
            return sdk.chat(modelID)
          } else {
            return sdk.responses(modelID)
          }
        },
        options: {},
      }
    },
    "azure-cognitive-services": async () => {
      const resourceName = Env.get("AZURE_COGNITIVE_SERVICES_RESOURCE_NAME")
      return {
        autoload: false,
        async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
          if (options?.["useCompletionUrls"]) {
            return sdk.chat(modelID)
          } else {
            return sdk.responses(modelID)
          }
        },
        options: {
          baseURL: resourceName ? `https://${resourceName}.cognitiveservices.azure.com/openai` : undefined,
        },
      }
    },
    "amazon-bedrock": async () => {
      const config = await Config.get()
      const providerConfig = config.provider?.["amazon-bedrock"]

      const auth = await Auth.get("amazon-bedrock")

      // Region precedence: 1) config file, 2) env var, 3) default
      const configRegion = providerConfig?.options?.region
      const envRegion = Env.get("AWS_REGION")
      const defaultRegion = configRegion ?? envRegion ?? "us-east-1"

      // Profile: config file takes precedence over env var
      const configProfile = providerConfig?.options?.profile
      const envProfile = Env.get("AWS_PROFILE")
      const profile = configProfile ?? envProfile

      const awsAccessKeyId = Env.get("AWS_ACCESS_KEY_ID")

      // TODO: Using process.env directly because Env.set only updates a process.env shallow copy,
      // until the scope of the Env API is clarified (test only or runtime?)
      const awsBearerToken = iife(() => {
        const envToken = process.env.AWS_BEARER_TOKEN_BEDROCK
        if (envToken) return envToken
        if (auth?.type === "api") {
          process.env.AWS_BEARER_TOKEN_BEDROCK = auth.key
          return auth.key
        }
        return undefined
      })

      const awsWebIdentityTokenFile = Env.get("AWS_WEB_IDENTITY_TOKEN_FILE")

      const containerCreds = Boolean(
        process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI,
      )

      if (!profile && !awsAccessKeyId && !awsBearerToken && !awsWebIdentityTokenFile && !containerCreds)
        return { autoload: false }

      const providerOptions: AmazonBedrockProviderSettings = {
        region: defaultRegion,
      }

      // Only use credential chain if no bearer token exists
      // Bearer token takes precedence over credential chain (profiles, access keys, IAM roles, web identity tokens)
      if (!awsBearerToken) {
        // Build credential provider options (only pass profile if specified)
        const credentialProviderOptions = profile ? { profile } : {}

        providerOptions.credentialProvider = fromNodeProviderChain(credentialProviderOptions)
      }

      // Add custom endpoint if specified (endpoint takes precedence over baseURL)
      const endpoint = providerConfig?.options?.endpoint ?? providerConfig?.options?.baseURL
      if (endpoint) {
        providerOptions.baseURL = endpoint
      }

      return {
        autoload: true,
        options: providerOptions,
        async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
          // Skip region prefixing if model already has a cross-region inference profile prefix
          // Models from models.dev may already include prefixes like us., eu., global., etc.
          const crossRegionPrefixes = ["global.", "us.", "eu.", "jp.", "apac.", "au."]
          if (crossRegionPrefixes.some((prefix) => modelID.startsWith(prefix))) {
            return sdk.languageModel(modelID)
          }

          // Region resolution precedence (highest to lowest):
          // 1. options.region from opencode.json provider config
          // 2. defaultRegion from AWS_REGION environment variable
          // 3. Default "us-east-1" (baked into defaultRegion)
          const region = options?.region ?? defaultRegion

          let regionPrefix = region.split("-")[0]

          switch (regionPrefix) {
            case "us": {
              const modelRequiresPrefix = [
                "nova-micro",
                "nova-lite",
                "nova-pro",
                "nova-premier",
                "nova-2",
                "claude",
                "deepseek",
              ].some((m) => modelID.includes(m))
              const isGovCloud = region.startsWith("us-gov")
              if (modelRequiresPrefix && !isGovCloud) {
                modelID = `${regionPrefix}.${modelID}`
              }
              break
            }
            case "eu": {
              const regionRequiresPrefix = [
                "eu-west-1",
                "eu-west-2",
                "eu-west-3",
                "eu-north-1",
                "eu-central-1",
                "eu-south-1",
                "eu-south-2",
              ].some((r) => region.includes(r))
              const modelRequiresPrefix = ["claude", "nova-lite", "nova-micro", "llama3", "pixtral"].some((m) =>
                modelID.includes(m),
              )
              if (regionRequiresPrefix && modelRequiresPrefix) {
                modelID = `${regionPrefix}.${modelID}`
              }
              break
            }
            case "ap": {
              const isAustraliaRegion = ["ap-southeast-2", "ap-southeast-4"].includes(region)
              const isTokyoRegion = region === "ap-northeast-1"
              if (
                isAustraliaRegion &&
                ["anthropic.claude-sonnet-4-5", "anthropic.claude-haiku"].some((m) => modelID.includes(m))
              ) {
                regionPrefix = "au"
                modelID = `${regionPrefix}.${modelID}`
              } else if (isTokyoRegion) {
                // Tokyo region uses jp. prefix for cross-region inference
                const modelRequiresPrefix = ["claude", "nova-lite", "nova-micro", "nova-pro"].some((m) =>
                  modelID.includes(m),
                )
                if (modelRequiresPrefix) {
                  regionPrefix = "jp"
                  modelID = `${regionPrefix}.${modelID}`
                }
              } else {
                // Other APAC regions use apac. prefix
                const modelRequiresPrefix = ["claude", "nova-lite", "nova-micro", "nova-pro"].some((m) =>
                  modelID.includes(m),
                )
                if (modelRequiresPrefix) {
                  regionPrefix = "apac"
                  modelID = `${regionPrefix}.${modelID}`
                }
              }
              break
            }
          }

          return sdk.languageModel(modelID)
        },
      }
    },
    openrouter: async () => {
      return {
        autoload: false,
        options: {
          headers: {
            "HTTP-Referer": "https://opencode.ai/",
            "X-Title": "opencode",
          },
        },
      }
    },
    vercel: async () => {
      return {
        autoload: false,
        options: {
          headers: {
            "http-referer": "https://opencode.ai/",
            "x-title": "opencode",
          },
        },
      }
    },
    "google-vertex": async (provider) => {
      const project =
        provider.options?.project ??
        Env.get("GOOGLE_CLOUD_PROJECT") ??
        Env.get("GCP_PROJECT") ??
        Env.get("GCLOUD_PROJECT")

      const location =
        provider.options?.location ?? Env.get("GOOGLE_CLOUD_LOCATION") ?? Env.get("VERTEX_LOCATION") ?? "us-central1"

      const autoload = Boolean(project)
      if (!autoload) return { autoload: false }
      return {
        autoload: true,
        options: {
          project,
          location,
          fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
            const auth = new GoogleAuth()
            const client = await auth.getApplicationDefault()
            const token = await client.credential.getAccessToken()

            const headers = new Headers(init?.headers)
            headers.set("Authorization", `Bearer ${token.token}`)

            return fetch(input, { ...init, headers })
          },
        },
        async getModel(sdk: any, modelID: string) {
          const id = String(modelID).trim()
          return sdk.languageModel(id)
        },
      }
    },
    "google-vertex-anthropic": async () => {
      const project = Env.get("GOOGLE_CLOUD_PROJECT") ?? Env.get("GCP_PROJECT") ?? Env.get("GCLOUD_PROJECT")
      const location = Env.get("GOOGLE_CLOUD_LOCATION") ?? Env.get("VERTEX_LOCATION") ?? "global"
      const autoload = Boolean(project)
      if (!autoload) return { autoload: false }
      return {
        autoload: true,
        options: {
          project,
          location,
        },
        async getModel(sdk: any, modelID) {
          const id = String(modelID).trim()
          return sdk.languageModel(id)
        },
      }
    },
    "sap-ai-core": async () => {
      const auth = await Auth.get("sap-ai-core")
      // TODO: Using process.env directly because Env.set only updates a shallow copy (not process.env),
      // until the scope of the Env API is clarified (test only or runtime?)
      const envServiceKey = iife(() => {
        const envAICoreServiceKey = process.env.AICORE_SERVICE_KEY
        if (envAICoreServiceKey) return envAICoreServiceKey
        if (auth?.type === "api") {
          process.env.AICORE_SERVICE_KEY = auth.key
          return auth.key
        }
        return undefined
      })
      const deploymentId = process.env.AICORE_DEPLOYMENT_ID
      const resourceGroup = process.env.AICORE_RESOURCE_GROUP

      return {
        autoload: !!envServiceKey,
        options: envServiceKey ? { deploymentId, resourceGroup } : {},
        async getModel(sdk: any, modelID: string) {
          return sdk(modelID)
        },
      }
    },
    zenmux: async () => {
      return {
        autoload: false,
        options: {
          headers: {
            "HTTP-Referer": "https://opencode.ai/",
            "X-Title": "opencode",
          },
        },
      }
    },
    gitlab: async (input) => {
      const instanceUrl = Env.get("GITLAB_INSTANCE_URL") || "https://gitlab.com"

      const auth = await Auth.get(input.id)
      const apiKey = await (async () => {
        if (auth?.type === "oauth") return auth.access
        if (auth?.type === "api") return auth.key
        return Env.get("GITLAB_TOKEN")
      })()

      const config = await Config.get()
      const providerConfig = config.provider?.["gitlab"]

      const aiGatewayHeaders = {
        "User-Agent": `opencode/${Installation.VERSION} gitlab-ai-provider/${GITLAB_PROVIDER_VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
        ...(providerConfig?.options?.aiGatewayHeaders || {}),
      }

      return {
        autoload: !!apiKey,
        options: {
          instanceUrl,
          apiKey,
          aiGatewayHeaders,
          featureFlags: {
            duo_agent_platform_agentic_chat: true,
            duo_agent_platform: true,
            ...(providerConfig?.options?.featureFlags || {}),
          },
        },
        async getModel(sdk: ReturnType<typeof createGitLab>, modelID: string) {
          return sdk.agenticChat(modelID, {
            aiGatewayHeaders,
            featureFlags: {
              duo_agent_platform_agentic_chat: true,
              duo_agent_platform: true,
              ...(providerConfig?.options?.featureFlags || {}),
            },
          })
        },
      }
    },
    "cloudflare-workers-ai": async (input) => {
      const accountId = Env.get("CLOUDFLARE_ACCOUNT_ID")
      if (!accountId) return { autoload: false }

      const apiKey = await iife(async () => {
        const envToken = Env.get("CLOUDFLARE_API_KEY")
        if (envToken) return envToken
        const auth = await Auth.get(input.id)
        if (auth?.type === "api") return auth.key
        return undefined
      })

      return {
        autoload: !!apiKey,
        options: {
          apiKey,
          baseURL: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
        },
        async getModel(sdk: any, modelID: string) {
          return sdk.languageModel(modelID)
        },
      }
    },
    "cloudflare-ai-gateway": async (input) => {
      const accountId = Env.get("CLOUDFLARE_ACCOUNT_ID")
      const gateway = Env.get("CLOUDFLARE_GATEWAY_ID")

      if (!accountId || !gateway) return { autoload: false }

      // Get API token from env or auth - required for authenticated gateways
      const apiToken = await (async () => {
        const envToken = Env.get("CLOUDFLARE_API_TOKEN") || Env.get("CF_AIG_TOKEN")
        if (envToken) return envToken
        const auth = await Auth.get(input.id)
        if (auth?.type === "api") return auth.key
        return undefined
      })()

      if (!apiToken) {
        throw new Error(
          "CLOUDFLARE_API_TOKEN (or CF_AIG_TOKEN) is required for Cloudflare AI Gateway. " +
            "Set it via environment variable or run `opencode auth cloudflare-ai-gateway`.",
        )
      }

      // Use official ai-gateway-provider package (v2.x for AI SDK v5 compatibility)
      const { createAiGateway } = await import("ai-gateway-provider")
      const { createUnified } = await import("ai-gateway-provider/providers/unified")

      const aigateway = createAiGateway({ accountId, gateway, apiKey: apiToken })
      const unified = createUnified()

      return {
        autoload: true,
        async getModel(_sdk: any, modelID: string, _options?: Record<string, any>) {
          // Model IDs use Unified API format: provider/model (e.g., "anthropic/claude-sonnet-4-5")
          return aigateway(unified(modelID))
        },
        options: {},
      }
    },
    cerebras: async () => {
      return {
        autoload: false,
        options: {
          headers: {
            "X-Cerebras-3rd-Party-Integration": "opencode",
          },
        },
      }
    },
    kilo: async () => {
      return {
        autoload: false,
        options: {
          headers: {
            "HTTP-Referer": "https://opencode.ai/",
            "X-Title": "opencode",
          },
        },
      }
    },
  }

  export const Model = z
    .object({
      id: z.string(),
      providerID: z.string(),
      api: z.object({
        id: z.string(),
        url: z.string(),
        npm: z.string(),
      }),
      name: z.string(),
      family: z.string().optional(),
      capabilities: z.object({
        temperature: z.boolean(),
        reasoning: z.boolean(),
        attachment: z.boolean(),
        toolcall: z.boolean(),
        input: z.object({
          text: z.boolean(),
          audio: z.boolean(),
          image: z.boolean(),
          video: z.boolean(),
          pdf: z.boolean(),
        }),
        output: z.object({
          text: z.boolean(),
          audio: z.boolean(),
          image: z.boolean(),
          video: z.boolean(),
          pdf: z.boolean(),
        }),
        interleaved: z.union([
          z.boolean(),
          z.object({
            field: z.enum(["reasoning_content", "reasoning_details"]),
          }),
        ]),
      }),
      cost: z.object({
        input: z.number(),
        output: z.number(),
        cache: z.object({
          read: z.number(),
          write: z.number(),
        }),
        experimentalOver200K: z
          .object({
            input: z.number(),
            output: z.number(),
            cache: z.object({
              read: z.number(),
              write: z.number(),
            }),
          })
          .optional(),
      }),
      limit: z.object({
        context: z.number(),
        input: z.number().optional(),
        output: z.number(),
      }),
      status: z.enum(["alpha", "beta", "deprecated", "active"]),
      options: z.record(z.string(), z.any()),
      headers: z.record(z.string(), z.string()),
      release_date: z.string(),
      fallbacks: z
        .array(
          z.object({
            providerID: z.string(),
            modelID: z.string(),
          }),
        )
        .optional(),
      variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
    })
    .meta({
      ref: "Model",
    })
  export type Model = z.infer<typeof Model>

  export const Info = z
    .object({
      id: z.string(),
      name: z.string(),
      source: z.enum(["env", "config", "custom", "api"]),
      env: z.string().array(),
      key: z.string().optional(),
      options: z.record(z.string(), z.any()),
      models: z.record(z.string(), Model),
    })
    .meta({
      ref: "Provider",
    })
  export type Info = z.infer<typeof Info>

  function fromModelsDevModel(provider: ModelsDev.Provider, model: ModelsDev.Model): Model {
    const m: Model = {
      id: model.id,
      providerID: provider.id,
      name: model.name,
      family: model.family,
      api: {
        id: model.id,
        url: model.provider?.api ?? provider.api!,
        npm: model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible",
      },
      status: model.status ?? "active",
      headers: model.headers ?? {},
      options: model.options ?? {},
      cost: {
        input: model.cost?.input ?? 0,
        output: model.cost?.output ?? 0,
        cache: {
          read: model.cost?.cache_read ?? 0,
          write: model.cost?.cache_write ?? 0,
        },
        experimentalOver200K: model.cost?.context_over_200k
          ? {
              cache: {
                read: model.cost.context_over_200k.cache_read ?? 0,
                write: model.cost.context_over_200k.cache_write ?? 0,
              },
              input: model.cost.context_over_200k.input,
              output: model.cost.context_over_200k.output,
            }
          : undefined,
      },
      limit: {
        context: model.limit.context,
        input: model.limit.input,
        output: model.limit.output,
      },
      capabilities: {
        temperature: model.temperature,
        reasoning: model.reasoning,
        attachment: model.attachment,
        toolcall: model.tool_call,
        input: {
          text: model.modalities?.input?.includes("text") ?? false,
          audio: model.modalities?.input?.includes("audio") ?? false,
          image: model.modalities?.input?.includes("image") ?? false,
          video: model.modalities?.input?.includes("video") ?? false,
          pdf: model.modalities?.input?.includes("pdf") ?? false,
        },
        output: {
          text: model.modalities?.output?.includes("text") ?? false,
          audio: model.modalities?.output?.includes("audio") ?? false,
          image: model.modalities?.output?.includes("image") ?? false,
          video: model.modalities?.output?.includes("video") ?? false,
          pdf: model.modalities?.output?.includes("pdf") ?? false,
        },
        interleaved: model.interleaved ?? false,
      },
      release_date: model.release_date,
      variants: {},
    }

    m.variants = mapValues(ProviderTransform.variants(m), (v) => v)

    return m
  }

  export function fromModelsDevProvider(provider: ModelsDev.Provider): Info {
    return {
      id: provider.id,
      source: "custom",
      name: provider.name,
      env: provider.env ?? [],
      options: {},
      models: mapValues(provider.models, (model) => fromModelsDevModel(provider, model)),
    }
  }

  const state = Instance.state(async () => {
    using _ = log.time("state")
    const config = await Config.get()
    const configData = config.provider ?? {}
    const modelsDev = await ModelsDev.get()
    const database = mapValues(modelsDev, fromModelsDevProvider)

    const roots = new Map<string, string>()
    const resolved = new Map<string, Config.Provider>()

    function root(providerID: string, seen = new Set<string>()): string {
      const cached = roots.get(providerID)
      if (cached) return cached
      const current = configData[providerID]
      if (!current?.extends) {
        roots.set(providerID, providerID)
        return providerID
      }
      if (seen.has(providerID)) {
        roots.set(providerID, providerID)
        return providerID
      }
      seen.add(providerID)
      const value: string = configData[current.extends] ? root(current.extends, seen) : current.extends
      roots.set(providerID, value)
      return value
    }

    function resolve(providerID: string, seen = new Set<string>()): Config.Provider | undefined {
      const cached = resolved.get(providerID)
      if (cached) return cached
      const current = configData[providerID]
      if (!current) return undefined
      if (!current.extends) {
        resolved.set(providerID, current)
        return current
      }
      if (seen.has(providerID)) {
        resolved.set(providerID, current)
        return current
      }
      seen.add(providerID)
      const value: Config.Provider = configData[current.extends]
        ? mergeDeep(resolve(current.extends, seen) ?? {}, current)
        : current
      resolved.set(providerID, value)
      return value
    }

    for (const providerID of Object.keys(configData)) {
      root(providerID)
    }

    const disabled = new Set(config.disabled_providers ?? [])
    const enabled = config.enabled_providers ? new Set(config.enabled_providers) : null

    function isProviderAllowed(providerID: string): boolean {
      if (enabled && !enabled.has(providerID)) return false
      if (disabled.has(providerID)) return false
      return true
    }

    const providers: { [providerID: string]: Info } = {}
    const languages = new Map<string, LanguageModelV2>()
    const modelLoaders: {
      [providerID: string]: CustomModelLoader
    } = {}
    const sdk = new Map<number, SDK>()

    log.info("init")

    const configProviders = Object.keys(configData).map(
      (providerID) => [providerID, resolve(providerID) ?? configData[providerID]] as const,
    )

    // Add GitHub Copilot Enterprise provider that inherits from GitHub Copilot
    if (database["github-copilot"]) {
      const githubCopilot = database["github-copilot"]
      database["github-copilot-enterprise"] = {
        ...githubCopilot,
        id: "github-copilot-enterprise",
        name: "GitHub Copilot Enterprise",
        models: mapValues(githubCopilot.models, (model) => ({
          ...model,
          providerID: "github-copilot-enterprise",
        })),
      }
    }

    function mergeProvider(providerID: string, provider: Partial<Info>) {
      const existing = providers[providerID]
      if (existing) {
        // @ts-expect-error
        providers[providerID] = mergeDeep(existing, provider)
        return
      }
      const match = database[providerID]
      if (!match) return
      // @ts-expect-error
      providers[providerID] = mergeDeep(match, provider)
    }

    function copyModels(models: Record<string, Model>, providerID: string) {
      return mapValues(models, (model) => ({
        ...model,
        providerID,
      }))
    }

    function antigravity(providerID: string, models: Record<string, Model>) {
      const result = {
        ...models,
      }
      for (const [modelID, alias] of Object.entries(ANTIGRAVITY)) {
        if (result[modelID]) continue
        if (!shouldApplyAntigravity(providerID, alias.providers)) continue
        const source = alias.order
          .map((id) => result[id])
          .find((item): item is Model => item !== undefined)
        if (!source) continue
        result[modelID] = {
          ...source,
          id: modelID,
          name: alias.name,
          providerID,
        }
      }
      return result
    }

    function alias(providerID: string) {
      const base = providerBaseID(providerID)
      return database[base] ? base : undefined
    }

    // extend database from config
    for (const [providerID, provider] of configProviders) {
      const baseID = roots.get(providerID)
      const base = database[providerID] ?? (baseID ? database[baseID] : undefined)
      const source = modelsDev[providerID] ?? (baseID ? modelsDev[baseID] : undefined)
      const parsed: Info = {
        id: providerID,
        name: provider.name ?? base?.name ?? providerID,
        env: provider.env ?? base?.env ?? [],
        options: mergeDeep(base?.options ?? {}, provider.options ?? {}),
        source: "config",
        models: base ? copyModels(base.models, providerID) : {},
      }

      for (const [modelID, model] of Object.entries(provider.models ?? {})) {
        const existingModel = parsed.models[model.id ?? modelID]
        const name = iife(() => {
          if (model.name) return model.name
          if (model.id && model.id !== modelID) return modelID
          return existingModel?.name ?? modelID
        })
        const parsedModel: Model = {
          id: modelID,
          api: {
            id: model.id ?? existingModel?.api.id ?? modelID,
            npm:
              model.provider?.npm ??
              provider.npm ??
              existingModel?.api.npm ??
              source?.npm ??
              "@ai-sdk/openai-compatible",
            url: model.provider?.api ?? provider?.api ?? existingModel?.api.url ?? source?.api,
          },
          status: model.status ?? existingModel?.status ?? "active",
          name,
          providerID,
          capabilities: {
            temperature: model.temperature ?? existingModel?.capabilities.temperature ?? false,
            reasoning: model.reasoning ?? existingModel?.capabilities.reasoning ?? false,
            attachment: model.attachment ?? existingModel?.capabilities.attachment ?? false,
            toolcall: model.tool_call ?? existingModel?.capabilities.toolcall ?? true,
            input: {
              text: model.modalities?.input?.includes("text") ?? existingModel?.capabilities.input.text ?? true,
              audio: model.modalities?.input?.includes("audio") ?? existingModel?.capabilities.input.audio ?? false,
              image: model.modalities?.input?.includes("image") ?? existingModel?.capabilities.input.image ?? false,
              video: model.modalities?.input?.includes("video") ?? existingModel?.capabilities.input.video ?? false,
              pdf: model.modalities?.input?.includes("pdf") ?? existingModel?.capabilities.input.pdf ?? false,
            },
            output: {
              text: model.modalities?.output?.includes("text") ?? existingModel?.capabilities.output.text ?? true,
              audio: model.modalities?.output?.includes("audio") ?? existingModel?.capabilities.output.audio ?? false,
              image: model.modalities?.output?.includes("image") ?? existingModel?.capabilities.output.image ?? false,
              video: model.modalities?.output?.includes("video") ?? existingModel?.capabilities.output.video ?? false,
              pdf: model.modalities?.output?.includes("pdf") ?? existingModel?.capabilities.output.pdf ?? false,
            },
            interleaved: model.interleaved ?? false,
          },
          cost: {
            input: model?.cost?.input ?? existingModel?.cost?.input ?? 0,
            output: model?.cost?.output ?? existingModel?.cost?.output ?? 0,
            cache: {
              read: model?.cost?.cache_read ?? existingModel?.cost?.cache.read ?? 0,
              write: model?.cost?.cache_write ?? existingModel?.cost?.cache.write ?? 0,
            },
          },
          options: mergeDeep(existingModel?.options ?? {}, model.options ?? {}),
          limit: {
            context: model.limit?.context ?? existingModel?.limit?.context ?? 0,
            output: model.limit?.output ?? existingModel?.limit?.output ?? 0,
          },
          headers: mergeDeep(existingModel?.headers ?? {}, model.headers ?? {}),
          family: model.family ?? existingModel?.family ?? "",
          release_date: model.release_date ?? existingModel?.release_date ?? "",
          fallbacks: model.fallbacks ? model.fallbacks.map(parseModel) : existingModel?.fallbacks,
          variants: {},
        }
        const merged = mergeDeep(ProviderTransform.variants(parsedModel), model.variants ?? {})
        parsedModel.variants = mapValues(
          pickBy(merged, (v) => !v.disabled),
          (v) => omit(v, ["disabled"]),
        )
        parsed.models[modelID] = parsedModel
      }
      parsed.models = antigravity(providerID, parsed.models)
      database[providerID] = parsed
    }

    for (const [providerID, provider] of Object.entries(database)) {
      provider.models = antigravity(providerID, provider.models)
    }

    // load env
    const env = Env.all()
    for (const [providerID, provider] of Object.entries(database)) {
      if (disabled.has(providerID)) continue
      const apiKey = provider.env.map((item) => env[item]).find(Boolean)
      if (!apiKey) continue
      mergeProvider(providerID, {
        source: "env",
        key: provider.env.length === 1 ? apiKey : undefined,
      })
    }

    // load apikeys
    for (const [providerID, provider] of Object.entries(await Auth.all())) {
      if (disabled.has(providerID)) continue
      if (!database[providerID]) {
        const baseID = alias(providerID)
        if (baseID) {
          const base = database[baseID]
          // Derive a display name from the account suffix (e.g. "user@gmail.com" or "2")
          const suffix = providerID.slice(baseID.length + 1) // strip "baseID-"
          const label = suffix.includes("@") ? suffix : providerID
          database[providerID] = {
            ...base,
            id: providerID,
            name: `${base.name} (${label})`,
            models: copyModels(base.models, providerID),
          }
          roots.set(providerID, roots.get(baseID) ?? baseID)
          database[providerID].models = antigravity(providerID, database[providerID].models)
        }
      }
      if (provider.type === "api") {
        mergeProvider(providerID, {
          source: "api",
          key: provider.key,
        })
      }
      if (provider.type === "oauth") {
        mergeProvider(providerID, { source: "api" })
      }
    }

    for (const plugin of await Plugin.list()) {
      if (!plugin.auth) continue
      const providerID = plugin.auth.provider
      if (disabled.has(providerID)) continue

      // For github-copilot plugin, check if auth exists for either github-copilot or github-copilot-enterprise
      let hasAuth = false
      const auth = await Auth.get(providerID)
      if (auth) hasAuth = true

      // Special handling for github-copilot: also check for enterprise auth
      if (providerID === "github-copilot" && !hasAuth) {
        const enterpriseAuth = await Auth.get("github-copilot-enterprise")
        if (enterpriseAuth) hasAuth = true
      }

      if (!hasAuth) continue
      if (!plugin.auth.loader) continue

      // Load for the main provider if auth exists
      if (auth) {
        const options = await plugin.auth.loader(() => Auth.get(providerID) as any, database[plugin.auth.provider])
        const opts = options ?? {}
        const patch: Partial<Info> = providers[providerID] ? { options: opts } : { source: "custom", options: opts }
        mergeProvider(providerID, patch)
      }

      // If this is github-copilot plugin, also register for github-copilot-enterprise if auth exists
      if (providerID === "github-copilot") {
        const enterpriseProviderID = "github-copilot-enterprise"
        if (!disabled.has(enterpriseProviderID)) {
          const enterpriseAuth = await Auth.get(enterpriseProviderID)
          if (enterpriseAuth) {
            const enterpriseOptions = await plugin.auth.loader(
              () => Auth.get(enterpriseProviderID) as any,
              database[enterpriseProviderID],
            )
            const opts = enterpriseOptions ?? {}
            const patch: Partial<Info> = providers[enterpriseProviderID]
              ? { options: opts }
              : { source: "custom", options: opts }
            mergeProvider(enterpriseProviderID, patch)
          }
        }
      }
    }

    for (const [providerID, fn] of Object.entries(CUSTOM_LOADERS)) {
      if (disabled.has(providerID)) continue
      const data = database[providerID]
      if (!data) {
        log.error("Provider does not exist in model list " + providerID)
        continue
      }
      const result = await fn(data)
      if (result && (result.autoload || providers[providerID])) {
        if (result.getModel) modelLoaders[providerID] = result.getModel
        const opts = result.options ?? {}
        const patch: Partial<Info> = providers[providerID] ? { options: opts } : { source: "custom", options: opts }
        mergeProvider(providerID, patch)
      }
    }

    // load config
    for (const [providerID, provider] of configProviders) {
      const partial: Partial<Info> = { source: "config" }
      if (provider.env) partial.env = provider.env
      if (provider.name) partial.name = provider.name
      if (provider.options) partial.options = provider.options
      mergeProvider(providerID, partial)
    }

    const groups = new Map<string, string[]>()
    for (const providerID of Object.keys(providers)) {
      const base = roots.get(providerID) ?? providerID
      const list = groups.get(base) ?? []
      list.push(providerID)
      groups.set(base, list)
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    }

    for (const [providerID, provider] of Object.entries(providers)) {
      if (!isProviderAllowed(providerID)) {
        delete providers[providerID]
        continue
      }

      const configProvider = config.provider?.[providerID]
      const base = roots.get(providerID) ?? providerID

      for (const [modelID, model] of Object.entries(provider.models)) {
        model.api.id = model.api.id ?? model.id ?? modelID
        if (modelID === "gpt-5-chat-latest" || (providerID === "openrouter" && modelID === "openai/gpt-5-chat"))
          delete provider.models[modelID]
        if (model.status === "alpha" && !Flag.OPENCODE_ENABLE_EXPERIMENTAL_MODELS) delete provider.models[modelID]
        if (model.status === "deprecated") delete provider.models[modelID]
        if (
          (configProvider?.blacklist && configProvider.blacklist.includes(modelID)) ||
          (configProvider?.whitelist && !configProvider.whitelist.includes(modelID))
        )
          delete provider.models[modelID]

        model.variants = mapValues(ProviderTransform.variants(model), (v) => v)

        // Filter out disabled variants from config
        const configVariants = configProvider?.models?.[modelID]?.variants
        if (configVariants && model.variants) {
          const merged = mergeDeep(model.variants, configVariants)
          model.variants = mapValues(
            pickBy(merged, (v) => !v.disabled),
            (v) => omit(v, ["disabled"]),
          )
        }

        if (!model.fallbacks || model.fallbacks.length === 0) {
          const next = (groups.get(base) ?? [])
            .filter((item) => item !== providerID)
            .flatMap((item) => {
              if (!isProviderAllowed(item)) return []
              if (!providers[item]?.models[modelID]) return []
              return [{ providerID: item, modelID }]
            })
          if (next.length) model.fallbacks = next
        }
      }

      if (Object.keys(provider.models).length === 0) {
        delete providers[providerID]
        continue
      }

      log.info("found", { providerID })
    }

    return {
      models: languages,
      providers,
      sdk,
      modelLoaders,
    }
  })

  export async function list() {
    return state().then((state) => state.providers)
  }

  async function getSDK(model: Model) {
    try {
      using _ = log.time("getSDK", {
        providerID: model.providerID,
      })
      const s = await state()
      const provider = s.providers[model.providerID]
      const options = { ...provider.options }

      if (model.providerID === "google-vertex" && !model.api.npm.includes("@ai-sdk/openai-compatible")) {
        delete options.fetch
      }

      if (model.api.npm.includes("@ai-sdk/openai-compatible") && options["includeUsage"] !== false) {
        options["includeUsage"] = true
      }

      const baseURL = loadBaseURL(model, options)
      if (baseURL !== undefined) options["baseURL"] = baseURL

      // Fail-soft OAuth token refresh: if stored token is expired, attempt refresh.
      // On failure, fall through with the original (possibly expired) token — the
      // retry/fallback mechanism will route to another account on 401.
      if (options["apiKey"] === undefined && provider.key) {
        options["apiKey"] = provider.key
      } else if (options["apiKey"] === undefined) {
        const auth = await Auth.getWithRefresh(model.providerID)
        if (auth?.type === "oauth") options["apiKey"] = auth.access
        else if (auth?.type === "api") options["apiKey"] = auth.key
      }
      if (model.headers)
        options["headers"] = {
          ...options["headers"],
          ...model.headers,
        }

      const key = Bun.hash.xxHash32(JSON.stringify({ providerID: model.providerID, npm: model.api.npm, options }))
      const existing = s.sdk.get(key)
      if (existing) return existing

      const customFetch = options["fetch"]

      options["fetch"] = async (input: any, init?: BunFetchRequestInit) => {
        // Preserve custom fetch if it exists, wrap it with timeout logic
        const fetchFn = customFetch ?? fetch
        const opts = init ?? {}

        if (options["timeout"] !== undefined && options["timeout"] !== null) {
          const signals: AbortSignal[] = []
          if (opts.signal) signals.push(opts.signal)
          if (options["timeout"] !== false) signals.push(AbortSignal.timeout(options["timeout"]))

          const combined = signals.length > 1 ? AbortSignal.any(signals) : signals[0]

          opts.signal = combined
        }

        // Strip openai itemId metadata following what codex does
        // Codex uses #[serde(skip_serializing)] on id fields for all item types:
        // Message, Reasoning, FunctionCall, LocalShellCall, CustomToolCall, WebSearchCall
        // IDs are only re-attached for Azure with store=true
        if (model.api.npm === "@ai-sdk/openai" && opts.body && opts.method === "POST") {
          const body = JSON.parse(opts.body as string)
          const isAzure = model.providerID.includes("azure")
          const keepIds = isAzure && body.store === true
          if (!keepIds && Array.isArray(body.input)) {
            for (const item of body.input) {
              if ("id" in item) {
                delete item.id
              }
            }
            opts.body = JSON.stringify(body)
          }
        }

        return fetchFn(input, {
          ...opts,
          // @ts-ignore see here: https://github.com/oven-sh/bun/issues/16682
          timeout: false,
        })
      }

      const bundledFn = BUNDLED_PROVIDERS[model.api.npm]
      if (bundledFn) {
        log.info("using bundled provider", { providerID: model.providerID, pkg: model.api.npm })
        const loaded = bundledFn({
          name: model.providerID,
          ...options,
        })
        s.sdk.set(key, loaded)
        return loaded as SDK
      }

      let installedPath: string
      if (!model.api.npm.startsWith("file://")) {
        installedPath = await BunProc.install(model.api.npm, "latest")
      } else {
        log.info("loading local provider", { pkg: model.api.npm })
        installedPath = model.api.npm
      }

      const mod = await import(installedPath)

      const fn = mod[Object.keys(mod).find((key) => key.startsWith("create"))!]
      const loaded = fn({
        name: model.providerID,
        ...options,
      })
      s.sdk.set(key, loaded)
      return loaded as SDK
    } catch (e) {
      throw new InitError({ providerID: model.providerID }, { cause: e })
    }
  }

  export async function getProvider(providerID: string) {
    return state().then((s) => s.providers[providerID])
  }

  export async function getModel(providerID: string, modelID: string) {
    const s = await state()
    const provider = s.providers[providerID]
    if (!provider) {
      const availableProviders = Object.keys(s.providers)
      const matches = fuzzysort.go(providerID, availableProviders, { limit: 3, threshold: -10000 })
      const suggestions = matches.map((m) => m.target)
      throw new ModelNotFoundError({ providerID, modelID, suggestions })
    }

    const info = provider.models[modelID]
    if (!info) {
      const availableModels = Object.keys(provider.models)
      const matches = fuzzysort.go(modelID, availableModels, { limit: 3, threshold: -10000 })
      const suggestions = matches.map((m) => m.target)
      throw new ModelNotFoundError({ providerID, modelID, suggestions })
    }
    return info
  }

  export async function fallbacks(model: Model) {
    const seen = new Set<string>([`${model.providerID}/${model.id}`])
    const queue = [...(model.fallbacks ?? [])]
    const result: Model[] = []
    while (queue.length) {
      const item = queue.shift()!
      const key = `${item.providerID}/${item.modelID}`
      if (seen.has(key)) continue
      const next = await getModel(item.providerID, item.modelID).catch(() => undefined)
      if (!next) continue
      seen.add(key)
      result.push(next)
      queue.push(...(next.fallbacks ?? []))
    }
    return result
  }

  export async function getLanguage(model: Model): Promise<LanguageModelV2> {
    const s = await state()
    const key = `${model.providerID}/${model.id}`
    if (s.models.has(key)) return s.models.get(key)!

    const provider = s.providers[model.providerID]
    const sdk = await getSDK(model)

    try {
      const language = s.modelLoaders[model.providerID]
        ? await s.modelLoaders[model.providerID](sdk, model.api.id, provider.options)
        : sdk.languageModel(model.api.id)
      s.models.set(key, language)
      return language
    } catch (e) {
      if (e instanceof NoSuchModelError)
        throw new ModelNotFoundError(
          {
            modelID: model.id,
            providerID: model.providerID,
          },
          { cause: e },
        )
      throw e
    }
  }

  export async function closest(providerID: string, query: string[]) {
    const s = await state()
    const provider = s.providers[providerID]
    if (!provider) return undefined
    for (const item of query) {
      for (const modelID of Object.keys(provider.models)) {
        if (modelID.includes(item))
          return {
            providerID,
            modelID,
          }
      }
    }
  }

  export async function getSmallModel(providerID: string) {
    const cfg = await Config.get()

    if (cfg.small_model) {
      const parsed = parseModel(cfg.small_model)
      return getModel(parsed.providerID, parsed.modelID)
    }

    const provider = await state().then((state) => state.providers[providerID])
    if (provider) {
      let priority = [
        "claude-haiku-4-5",
        "claude-haiku-4.5",
        "3-5-haiku",
        "3.5-haiku",
        "gemini-3-flash",
        "gemini-2.5-flash",
        "gpt-5-nano",
      ]
      if (providerID.startsWith("opencode")) {
        priority = ["gpt-5-nano"]
      }
      if (providerID.startsWith("github-copilot")) {
        // prioritize free models for github copilot
        priority = ["gpt-5-mini", "claude-haiku-4.5", ...priority]
      }
      for (const item of priority) {
        if (providerID === "amazon-bedrock") {
          const crossRegionPrefixes = ["global.", "us.", "eu."]
          const candidates = Object.keys(provider.models).filter((m) => m.includes(item))

          // Model selection priority:
          // 1. global. prefix (works everywhere)
          // 2. User's region prefix (us., eu.)
          // 3. Unprefixed model
          const globalMatch = candidates.find((m) => m.startsWith("global."))
          if (globalMatch) return getModel(providerID, globalMatch)

          const region = provider.options?.region
          if (region) {
            const regionPrefix = region.split("-")[0]
            if (regionPrefix === "us" || regionPrefix === "eu") {
              const regionalMatch = candidates.find((m) => m.startsWith(`${regionPrefix}.`))
              if (regionalMatch) return getModel(providerID, regionalMatch)
            }
          }

          const unprefixed = candidates.find((m) => !crossRegionPrefixes.some((p) => m.startsWith(p)))
          if (unprefixed) return getModel(providerID, unprefixed)
        } else {
          for (const model of Object.keys(provider.models)) {
            if (model.includes(item)) return getModel(providerID, model)
          }
        }
      }
    }

    // Check if opencode provider is available before using it
    const opencodeProvider = await state().then((state) => state.providers["opencode"])
    if (opencodeProvider && opencodeProvider.models["gpt-5-nano"]) {
      return getModel("opencode", "gpt-5-nano")
    }

    return undefined
  }

  const priority = ["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"]
  export function sort(models: Model[]) {
    return sortBy(
      models,
      [(model) => priority.findIndex((filter) => model.id.includes(filter)), "desc"],
      [(model) => (model.id.includes("latest") ? 0 : 1), "asc"],
      [(model) => model.id, "desc"],
    )
  }

  export async function defaultModel() {
    const cfg = await Config.get()
    if (cfg.model) return parseModel(cfg.model)

    const providers = await list()
    const recent = (await Filesystem.readJson<{ recent?: { providerID: string; modelID: string }[] }>(
      path.join(Global.Path.state, "model.json"),
    )
      .then((x) => (Array.isArray(x.recent) ? x.recent : []))
      .catch(() => [])) as { providerID: string; modelID: string }[]
    for (const entry of recent) {
      const provider = providers[entry.providerID]
      if (!provider) continue
      if (!provider.models[entry.modelID]) continue
      return { providerID: entry.providerID, modelID: entry.modelID }
    }

    const provider = Object.values(providers).find((p) => !cfg.provider || Object.keys(cfg.provider).includes(p.id))
    if (!provider) throw new Error("no providers found")
    const [model] = sort(Object.values(provider.models))
    if (!model) throw new Error("no models found")
    return {
      providerID: provider.id,
      modelID: model.id,
    }
  }

  export function parseModel(model: string) {
    const [providerID, ...rest] = model.split("/")
    return {
      providerID: providerID,
      modelID: rest.join("/"),
    }
  }

  export const ModelNotFoundError = NamedError.create(
    "ProviderModelNotFoundError",
    z.object({
      providerID: z.string(),
      modelID: z.string(),
      suggestions: z.array(z.string()).optional(),
    }),
  )

  export const InitError = NamedError.create(
    "ProviderInitError",
    z.object({
      providerID: z.string(),
    }),
  )
}
