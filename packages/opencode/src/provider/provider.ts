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
    metadata?: Info["metadata"]
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
    databricks: async (input) => {
      const {
        Config: DatabricksConfig,
        isAnyAuthConfigured,
        WorkspaceClient,
      } = await import("@databricks/sdk-experimental")

      const opencodeConfig = await Config.get()
      const providerConfig = opencodeConfig.provider?.["databricks"]
      const auth = await Auth.get("databricks")
      const authProfile = auth?.type === "databricks-profile" ? auth.profile : undefined
      const profile = authProfile ?? providerConfig?.options?.profile

      // Build Databricks SDK Config with all available credential sources.
      // The SDK handles the full auth chain: PAT, OAuth M2M, Databricks CLI,
      // Azure CLI/MSI/AD, GCP credentials, and ~/.databrickscfg profiles.
      const dbConfig = new DatabricksConfig({
        // Use opencode's per-instance env so the SDK reads DATABRICKS_HOST,
        // DATABRICKS_TOKEN, etc. from the correct isolated environment.
        env: Env.all(),
        // Host: stored auth > opencode config > SDK reads from env/databrickscfg
        host:
          (auth?.type === "api" ? auth.host : undefined) ??
          providerConfig?.options?.baseURL ??
          providerConfig?.options?.host ??
          undefined,
        // Token from stored auth (SDK reads DATABRICKS_TOKEN from env itself)
        token: auth?.type === "api" ? auth.key : undefined,
        // OAuth M2M from opencode config (SDK reads DATABRICKS_CLIENT_ID/SECRET from env)
        clientId: providerConfig?.options?.clientId,
        clientSecret: providerConfig?.options?.clientSecret,
        // Azure AD from opencode config (SDK reads ARM_CLIENT_ID/SECRET/TENANT_ID from env)
        azureClientId: providerConfig?.options?.azureClientId,
        azureClientSecret: providerConfig?.options?.azureClientSecret,
        azureTenantId: providerConfig?.options?.azureTenantId,
        // Profile from stored auth selection first, then config.
        // SDK still falls back to DATABRICKS_CONFIG_PROFILE from env.
        profile,
      })

      const source = profile ? `profile "${profile}"` : dbConfig.host ? `host ${dbConfig.host}` : "default config"

      // Resolve config (loads ~/.databrickscfg, env vars, etc.)
      try {
        await dbConfig.ensureResolved()
      } catch (e) {
        const msg = `Databricks auth failed to resolve (${source}): ${e instanceof Error ? e.message : "unknown error"}`
        log.warn(msg)
        return { autoload: false, metadata: { profile, error: msg } }
      }

      if (!dbConfig.host || !isAnyAuthConfigured(dbConfig)) {
        const msg = !dbConfig.host
          ? `Databricks: no host configured. Set DATABRICKS_HOST, add host to ~/.databrickscfg, or run /connect.`
          : `Databricks: no authentication configured for ${dbConfig.host}. Set DATABRICKS_TOKEN, configure a profile, or run /connect.`
        log.warn(msg)
        return { autoload: false, metadata: { host: dbConfig.host, profile, error: msg } }
      }

      // Verify auth works by authenticating a test request
      try {
        const testHeaders = new Headers()
        await dbConfig.authenticate(testHeaders)
        if (!testHeaders.has("Authorization")) {
          const msg = `Databricks: authentication produced no credentials for ${dbConfig.host} (${source}). Token may be expired - try running /connect or "databricks auth login".`
          log.warn(msg)
          return { autoload: false, metadata: { host: dbConfig.host, profile, error: msg } }
        }
      } catch (e) {
        const msg = `Databricks: authentication failed for ${dbConfig.host} (${source}): ${e instanceof Error ? e.message : "unknown error"}`
        log.warn(msg)
        return { autoload: false, metadata: { host: dbConfig.host, profile, error: msg } }
      }

      const normalizedHost = (await dbConfig.getHost()).origin
      const baseURL = `${normalizedHost}/serving-endpoints`
      const anthropicBaseURL = `${normalizedHost}/serving-endpoints/anthropic/v1`

      // Authenticate requests using the Databricks SDK credential chain.
      // This handles token refresh for all auth methods (PAT, OAuth, CLI, Azure, GCP).
      const authenticateHeaders = async (headers: Headers) => {
        await dbConfig.authenticate(headers)
      }

      // Dynamic model discovery via Databricks SDK.
      // Lists serving endpoints to find foundation models automatically.
      // No hardcoded models - all models come from the workspace's serving endpoints.

      // Transform ModelsDev.Model to Provider.Model format
      function toProviderModel(model: ModelsDev.Model): Model {
        const idLower = model.id.toLowerCase()
        const isClaude = model.family?.includes("claude") || idLower.includes("claude")
        const isGPT = model.family?.includes("gpt") || idLower.includes("gpt") || idLower.includes("codex")

        // Determine which SDK and URL to use per model family:
        // - Claude models: native Anthropic API for full feature support
        // - GPT/Codex models: OpenAI Responses API (required by Databricks for Codex)
        // - Others (Gemini, OSS): OpenAI-compatible chat completions
        const apiNpm = isClaude ? "@ai-sdk/anthropic" : isGPT ? "@ai-sdk/openai" : "@ai-sdk/openai-compatible"
        const apiUrl = isClaude ? anthropicBaseURL : baseURL

        return {
          id: model.id,
          providerID: "databricks",
          name: model.name,
          family: model.family,
          api: {
            id: model.id,
            url: apiUrl,
            npm: apiNpm,
          },
          status: "active",
          headers: {},
          options: model.options ?? {},
          cost: {
            input: model.cost?.input ?? 0,
            output: model.cost?.output ?? 0,
            cache: {
              read: model.cost?.cache_read ?? 0,
              write: model.cost?.cache_write ?? 0,
            },
          },
          limit: {
            context: model.limit.context,
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
            interleaved: false,
          },
          release_date: model.release_date,
          variants: {},
        }
      }

      // Discover models dynamically via Databricks SDK serving endpoints.
      try {
        const client = new WorkspaceClient(dbConfig)

        {
          // Known model families that reliably support tool calling
          const toolCapableFamilies = ["claude", "gpt", "codex", "gemini"]

          // Default context windows and capabilities per model family
          const familyDefaults: Record<
            string,
            { context: number; output: number; reasoning: boolean; attachment: boolean }
          > = {
            claude: { context: 200000, output: 64000, reasoning: false, attachment: true },
            gpt: { context: 400000, output: 128000, reasoning: true, attachment: true },
            codex: { context: 400000, output: 128000, reasoning: true, attachment: true },
            gemini: { context: 1000000, output: 65536, reasoning: true, attachment: true },
          }

          for await (const endpoint of client.servingEndpoints.list()) {
            const endpointName = endpoint.name
            if (!endpointName) continue
            // Skip if already defined in user config
            if (input.models[endpointName]) continue

            // Only include foundation model endpoints with chat task
            const foundationModel = endpoint.config?.served_entities?.[0]?.foundation_model
            if (!foundationModel) continue
            if (endpoint.task && endpoint.task !== "llm/v1/chat") continue

            // Determine model family from endpoint name
            const nameLower = endpointName.toLowerCase()
            const family = toolCapableFamilies.find((f) => nameLower.includes(f))

            // Only include models from known tool-capable families
            if (!family) continue

            const defaults = familyDefaults[family] ?? {
              context: 128000,
              output: 16000,
              reasoning: false,
              attachment: false,
            }

            const discoveredModel: ModelsDev.Model = {
              id: endpointName,
              name: foundationModel.display_name ?? endpointName,
              family,
              attachment: defaults.attachment,
              reasoning: defaults.reasoning,
              tool_call: true,
              temperature: true,
              release_date: new Date().toISOString().split("T")[0],
              modalities: {
                input: defaults.attachment ? ["text", "image"] : ["text"],
                output: ["text"],
              },
              cost: { input: 0, output: 0 },
              limit: { context: defaults.context, output: defaults.output },
              options: {},
            }

            input.models[endpointName] = toProviderModel(discoveredModel)
          }
        }
      } catch (e) {
        // API discovery is best-effort; if it fails, no models will be available
        log.warn("Failed to discover Databricks serving endpoints - no models will be available", {
          error: e instanceof Error ? e.message : "Unknown error",
        })
      }

      // Custom fetch that authenticates requests via SDK and fixes model-specific quirks
      const databricksFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers)
        await authenticateHeaders(headers)

        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        const isResponsesAPI = url.endsWith("/responses")

        // Fix empty content issue: Databricks API rejects messages with empty string content
        // The AI SDK sends content: "" for assistant messages with only tool calls
        let body = init?.body
        let isGeminiModel = false
        if (body && typeof body === "string") {
          try {
            const parsed = JSON.parse(body)
            // Detect if this is a Gemini model request
            isGeminiModel = parsed.model?.includes("gemini") ?? false

            if (parsed.messages && Array.isArray(parsed.messages)) {
              parsed.messages = parsed.messages.map((msg: any) => {
                // For assistant messages with tool_calls but empty content, set content to null
                if (msg.role === "assistant" && msg.tool_calls && msg.content === "") {
                  return { ...msg, content: null }
                }
                return msg
              })
              body = JSON.stringify(parsed)
            }
          } catch {
            // If parsing fails, use original body
          }
        }

        const response = await fetch(input, { ...init, body, headers })

        // For Responses API requests (GPT/Codex), fix mismatched item IDs in the SSE stream.
        // Databricks' proxy uses different IDs in output_item.added (short ID) vs
        // content_part/output_text events (long ID). The AI SDK maps text-start using
        // the item.id from output_item.added, then looks up text-delta using item_id
        // from output_text.delta — if these don't match, it errors with
        // "text part <id> not found". We normalize by rewriting item_id in content/delta
        // events to match the item.id from the corresponding output_item.added event.
        if (isResponsesAPI && response.body) {
          const originalBody = response.body
          // Map output_index → item.id from output_item.added events
          const itemIdByIndex: Record<number, string> = {}

          const transformStream = new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              const text = new TextDecoder().decode(chunk)
              const lines = text.split("\n")
              const transformedLines = lines.map((line) => {
                if (!line.startsWith("data: ") || line === "data: [DONE]") {
                  return line
                }

                try {
                  const jsonStr = line.slice(6)
                  if (!jsonStr.trim()) return line

                  const data = JSON.parse(jsonStr)

                  // Track item IDs from output_item.added events
                  if (data.type === "response.output_item.added" && data.item?.id && data.output_index != null) {
                    itemIdByIndex[data.output_index] = data.item.id
                  }

                  // Rewrite item_id in content/delta events to match the output_item.added ID
                  if (data.item_id && data.output_index != null && itemIdByIndex[data.output_index]) {
                    const expected = itemIdByIndex[data.output_index]
                    if (data.item_id !== expected) {
                      data.item_id = expected
                      return "data: " + JSON.stringify(data)
                    }
                  }
                } catch {
                  // If parsing fails, return original line
                }
                return line
              })

              controller.enqueue(new TextEncoder().encode(transformedLines.join("\n")))
            },
          })

          const transformedBody = originalBody.pipeThrough(transformStream)
          return new Response(transformedBody, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          })
        }

        // For Gemini models, transform streaming responses
        // Gemini returns content as array [{type:"text", text:"..."}] but AI SDK expects string
        if (isGeminiModel && response.body) {
          const originalBody = response.body
          const transformStream = new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              const text = new TextDecoder().decode(chunk)
              const lines = text.split("\n")
              const transformedLines = lines.map((line) => {
                if (!line.startsWith("data: ") || line === "data: [DONE]") {
                  return line
                }

                try {
                  const jsonStr = line.slice(6) // Remove "data: " prefix
                  if (!jsonStr.trim()) return line

                  const data = JSON.parse(jsonStr)

                  // Transform choices[].delta.content from array to string
                  if (data.choices && Array.isArray(data.choices)) {
                    for (const choice of data.choices) {
                      if (choice.delta && Array.isArray(choice.delta.content)) {
                        // Extract text from content array
                        const textParts = choice.delta.content
                          .filter((part: any) => part.type === "text" && part.text)
                          .map((part: any) => part.text)
                        choice.delta.content = textParts.join("")
                      }
                    }
                    return "data: " + JSON.stringify(data)
                  }
                } catch {
                  // If parsing fails, return original line
                }
                return line
              })

              controller.enqueue(new TextEncoder().encode(transformedLines.join("\n")))
            },
          })

          const transformedBody = originalBody.pipeThrough(transformStream)
          return new Response(transformedBody, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          })
        }

        return response
      }

      log.info("Databricks authenticated", { host: normalizedHost, profile })

      return {
        autoload: true,
        metadata: { host: normalizedHost, profile },
        async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
          const modelLower = modelID.toLowerCase()
          // GPT/Codex models use the OpenAI Responses API
          // Codex models *require* it - Databricks rejects Chat Completions for them
          if (modelLower.includes("gpt") || modelLower.includes("codex")) {
            const openaiSdk = createOpenAI({
              baseURL,
              apiKey: "databricks", // placeholder - real auth via databricksFetch
              headers: {
                "User-Agent": "opencode",
                "x-databricks-disable-beta-headers": "true",
              },
              fetch: databricksFetch as typeof fetch,
            })
            return openaiSdk.responses(modelID)
          }
          // Claude models use native Anthropic API for full feature support
          // (extended thinking, prompt caching, native tool use format)
          if (modelLower.includes("claude")) {
            const anthropicSdk = createAnthropic({
              baseURL: anthropicBaseURL,
              apiKey: "databricks", // placeholder - real auth via databricksFetch
              headers: {
                "User-Agent": "opencode",
                "anthropic-beta": "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
              },
              fetch: databricksFetch as typeof fetch,
            })
            return anthropicSdk.languageModel(modelID)
          }
          return sdk.languageModel(modelID)
        },
        options: {
          baseURL,
          apiKey: "databricks", // placeholder - real auth via databricksFetch
          // Disable stream_options to prevent "unknown field" errors with Databricks OSS models
          includeUsage: false,
          headers: {
            "User-Agent": "opencode",
            // Prevent Claude beta headers from breaking Databricks Model Serving
            "x-databricks-disable-beta-headers": "true",
          },
          // Use custom fetch that authenticates via Databricks SDK
          fetch: databricksFetch as typeof fetch,
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
      metadata: z
        .object({
          host: z.string().optional(),
          profile: z.string().optional(),
          error: z.string().optional(),
        })
        .optional(),
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
    const modelsDev = await ModelsDev.get()
    const database = mapValues(modelsDev, fromModelsDevProvider)

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

    const configProviders = Object.entries(config.provider ?? {})

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

    // Add Databricks provider for Foundation Model APIs
    // This provider is not in models.dev so we create it programmatically
    if (!database["databricks"]) {
      database["databricks"] = {
        id: "databricks",
        name: "Databricks",
        source: "custom",
        env: ["DATABRICKS_TOKEN"],
        options: {},
        models: {},
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

    // extend database from config
    for (const [providerID, provider] of configProviders) {
      const existing = database[providerID]
      const parsed: Info = {
        id: providerID,
        name: provider.name ?? existing?.name ?? providerID,
        env: provider.env ?? existing?.env ?? [],
        options: mergeDeep(existing?.options ?? {}, provider.options ?? {}),
        source: "config",
        models: existing?.models ?? {},
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
              modelsDev[providerID]?.npm ??
              "@ai-sdk/openai-compatible",
            url: model.provider?.api ?? provider?.api ?? existingModel?.api.url ?? modelsDev[providerID]?.api,
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
          variants: {},
        }
        const merged = mergeDeep(ProviderTransform.variants(parsedModel), model.variants ?? {})
        parsedModel.variants = mapValues(
          pickBy(merged, (v) => !v.disabled),
          (v) => omit(v, ["disabled"]),
        )
        parsed.models[modelID] = parsedModel
      }
      database[providerID] = parsed
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
      if (provider.type === "api") {
        mergeProvider(providerID, {
          source: "api",
          key: provider.key,
        })
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

    const failedProviders: { [providerID: string]: Info["metadata"] } = {}

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
        if (result.metadata) patch.metadata = result.metadata
        mergeProvider(providerID, patch)
      } else if (result?.metadata?.error) {
        failedProviders[providerID] = result.metadata
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

    for (const [providerID, provider] of Object.entries(providers)) {
      if (!isProviderAllowed(providerID)) {
        delete providers[providerID]
        continue
      }

      const configProvider = config.provider?.[providerID]

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
      failedProviders,
      sdk,
      modelLoaders,
    }
  })

  export async function list() {
    return state().then((state) => state.providers)
  }

  export async function failed() {
    return state().then((state) => state.failedProviders)
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
      if (options["apiKey"] === undefined && provider.key) options["apiKey"] = provider.key
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
