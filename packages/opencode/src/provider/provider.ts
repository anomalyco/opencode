import os from "os"
import fuzzysort from "fuzzysort"
import { Config } from "@/config/config"
import { mapValues, mergeDeep, omit, pickBy, sortBy } from "remeda"
import { NoSuchModelError, type Provider as SDK } from "ai"
import * as Log from "@opencode-ai/core/util/log"
import { Npm } from "@opencode-ai/core/npm"
import { Hash } from "@opencode-ai/core/util/hash"
import { Plugin } from "../plugin"
import { type LanguageModelV3 } from "@ai-sdk/provider"
import * as ModelsDev from "./models"
import { Auth } from "../auth"
import { Env } from "../env"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Flag } from "@opencode-ai/core/flag/flag"
import { zod } from "@/util/effect-zod"
import { namedSchemaError } from "@/util/named-schema-error"
import { iife } from "@/util/iife"
import { Global } from "@opencode-ai/core/global"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer, Context, Schema, Types } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { isRecord } from "@/util/record"
import { optionalOmitUndefined, withStatics } from "@/util/schema"

import * as ProviderTransform from "./transform"
import { ModelID, ProviderID } from "./schema"

const log = Log.create({ service: "provider" })

function shouldUseCopilotResponsesApi(modelID: string): boolean {
  const match = /^gpt-(\d+)/.exec(modelID)
  if (!match) return false
  return Number(match[1]) >= 5 && !modelID.startsWith("gpt-5-mini")
}

function wrapSSE(res: Response, ms: number, ctl: AbortController) {
  if (typeof ms !== "number" || ms <= 0) return res
  if (!res.body) return res
  if (!res.headers.get("content-type")?.includes("text/event-stream")) return res

  const reader = res.body.getReader()
  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const part = await new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
        const id = setTimeout(() => {
          const err = new Error("SSE read timed out")
          ctl.abort(err)
          void reader.cancel(err)
          reject(err)
        }, ms)

        reader.read().then(
          (part) => {
            clearTimeout(id)
            resolve(part)
          },
          (err) => {
            clearTimeout(id)
            reject(err)
          },
        )
      })

      if (part.done) {
        ctrl.close()
        return
      }

      ctrl.enqueue(part.value)
    },
    async cancel(reason) {
      ctl.abort(reason)
      await reader.cancel(reason)
    },
  })

  return new Response(body, {
    headers: new Headers(res.headers),
    status: res.status,
    statusText: res.statusText,
  })
}

type BundledSDK = {
  languageModel(modelId: string): LanguageModelV3
}

const BUNDLED_PROVIDERS: Record<string, () => Promise<(opts: any) => BundledSDK>> = {
  "@ai-sdk/amazon-bedrock": () => import("@ai-sdk/amazon-bedrock").then((m) => m.createAmazonBedrock),
  "@ai-sdk/anthropic": () => import("@ai-sdk/anthropic").then((m) => m.createAnthropic),
  "@ai-sdk/azure": () => import("@ai-sdk/azure").then((m) => m.createAzure),
  "@ai-sdk/google": () => import("@ai-sdk/google").then((m) => m.createGoogleGenerativeAI),
  "@ai-sdk/google-vertex": () => import("@ai-sdk/google-vertex").then((m) => m.createVertex),
  "@ai-sdk/google-vertex/anthropic": () =>
    import("@ai-sdk/google-vertex/anthropic").then((m) => m.createVertexAnthropic),
  "@ai-sdk/openai": () => import("@ai-sdk/openai").then((m) => m.createOpenAI),
  "@ai-sdk/openai-compatible": () => import("@ai-sdk/openai-compatible").then((m) => m.createOpenAICompatible),
  "@openrouter/ai-sdk-provider": () => import("@openrouter/ai-sdk-provider").then((m) => m.createOpenRouter),
  "@ai-sdk/xai": () => import("@ai-sdk/xai").then((m) => m.createXai),
  "@ai-sdk/mistral": () => import("@ai-sdk/mistral").then((m) => m.createMistral),
  "@ai-sdk/groq": () => import("@ai-sdk/groq").then((m) => m.createGroq),
  "@ai-sdk/deepinfra": () => import("@ai-sdk/deepinfra").then((m) => m.createDeepInfra),
  "@ai-sdk/cerebras": () => import("@ai-sdk/cerebras").then((m) => m.createCerebras),
  "@ai-sdk/cohere": () => import("@ai-sdk/cohere").then((m) => m.createCohere),
  "@ai-sdk/gateway": () => import("@ai-sdk/gateway").then((m) => m.createGateway),
  "@ai-sdk/togetherai": () => import("@ai-sdk/togetherai").then((m) => m.createTogetherAI),
  "@ai-sdk/perplexity": () => import("@ai-sdk/perplexity").then((m) => m.createPerplexity),
  "@ai-sdk/vercel": () => import("@ai-sdk/vercel").then((m) => m.createVercel),
  "@ai-sdk/alibaba": () => import("@ai-sdk/alibaba").then((m) => m.createAlibaba),
  "gitlab-ai-provider": () => import("gitlab-ai-provider").then((m) => m.createGitLab),
  "@ai-sdk/github-copilot": () => import("./sdk/copilot/copilot-provider").then((m) => m.createOpenaiCompatible),
  "venice-ai-sdk-provider": () => import("venice-ai-sdk-provider").then((m) => m.createVenice),
}

type CustomModelLoader = (sdk: any, modelID: string, options?: Record<string, any>) => Promise<any>
type CustomVarsLoader = (options: Record<string, any>) => Record<string, string>
type CustomDiscoverModels = () => Promise<Record<string, Model>>
type CustomLoader = (provider: Info) => Effect.Effect<{
  autoload: boolean
  getModel?: CustomModelLoader
  vars?: CustomVarsLoader
  options?: Record<string, any>
  discoverModels?: CustomDiscoverModels
}>

type CustomDep = {
  auth: (id: string) => Effect.Effect<Auth.Info | undefined>
  config: () => Effect.Effect<Config.Info>
  env: () => Effect.Effect<Record<string, string | undefined>>
  get: (key: string) => Effect.Effect<string | undefined>
}

function useLanguageModel(sdk: any) {
  return sdk.responses === undefined && sdk.chat === undefined
}

function selectAzureLanguageModel(sdk: any, modelID: string, useChat: boolean) {
  if (useChat && sdk.chat) return sdk.chat(modelID)
  if (sdk.responses) return sdk.responses(modelID)
  if (sdk.messages) return sdk.messages(modelID)
  if (sdk.chat) return sdk.chat(modelID)
  return sdk.languageModel(modelID)
}

function custom(dep: CustomDep): Record<string, CustomLoader> {
  return {
    anthropic: () =>
      Effect.succeed({
        autoload: false,
        options: {
          headers: {
            "anthropic-beta": "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
          },
        },
      }),
    opencode: Effect.fnUntraced(function* (input: Info) {
      const env = yield* dep.env()
      const hasKey = iife(() => {
        if (input.env.some((item) => env[item])) return true
        return false
      })
      const ok =
        hasKey ||
        Boolean(yield* dep.auth(input.id)) ||
        Boolean((yield* dep.config()).provider?.["opencode"]?.options?.apiKey)

      if (!ok) {
        for (const [key, value] of Object.entries(input.models)) {
          if (value.cost.input === 0) continue
          delete input.models[key]
        }
      }

      return {
        autoload: Object.keys(input.models).length > 0,
        options: ok ? {} : { apiKey: "public" },
      }
    }),
    openai: () =>
      Effect.succeed({
        autoload: false,
        async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
          return sdk.responses(modelID)
        },
        options: {},
      }),
    xai: () =>
      Effect.succeed({
        autoload: false,
        async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
          return sdk.responses(modelID)
        },
        options: {},
      }),
    "github-copilot": () =>
      Effect.succeed({
        autoload: false,
        async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
          if (useLanguageModel(sdk)) return sdk.languageModel(modelID)
          return shouldUseCopilotResponsesApi(modelID) ? sdk.responses(modelID) : sdk.chat(modelID)
        },
        options: {},
      }),
    azure: Effect.fnUntraced(function* (provider: Info) {
      const env = yield* dep.env()
      const auth = yield* dep.auth(provider.id)
      const resource = iife(() => {
        return [
          provider.options?.resourceName,
          auth?.type === "api" ? auth.metadata?.resourceName : undefined,
          env["AZURE_RESOURCE_NAME"],
        ].find((name) => typeof name === "string" && name.trim() !== "")
      })

      if (!resource && !provider.options?.baseURL) {
        return {
          autoload: false,
          async getModel() {
            throw new Error(
              "AZURE_RESOURCE_NAME is missing, set it using env var or reconnecting the azure provider and setting it",
            )
          },
        }
      }

      return {
        autoload: false,
        async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
          return selectAzureLanguageModel(sdk, modelID, Boolean(options?.["useCompletionUrls"]))
        },
        options: {
          resourceName: resource,
        },
        vars(_options): Record<string, string> {
          if (resource) {
            return {
              AZURE_RESOURCE_NAME: resource,
            }
          }
          return {}
        },
      }
    }),
    "azure-cognitive-services": Effect.fnUntraced(function* () {
      const resourceName = yield* dep.get("AZURE_COGNITIVE_SERVICES_RESOURCE_NAME")
      return {
        autoload: false,
        async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
          return selectAzureLanguageModel(sdk, modelID, Boolean(options?.["useCompletionUrls"]))
        },
        options: {
          baseURL: resourceName ? `https://${resourceName}.cognitiveservices.azure.com/openai` : undefined,
        },
      }
    }),
    "amazon-bedrock": Effect.fnUntraced(function* () {
      const providerConfig = (yield* dep.config()).provider?.["amazon-bedrock"]
      const auth = yield* dep.auth("amazon-bedrock")
      const env = yield* dep.env()

      // Region precedence: 1) config file, 2) env var, 3) default
      const configRegion = providerConfig?.options?.region
      const envRegion = env["AWS_REGION"]
      const defaultRegion = configRegion ?? envRegion ?? "us-east-1"

      // Profile: config file takes precedence over env var
      const configProfile = providerConfig?.options?.profile
      const envProfile = env["AWS_PROFILE"]
      const profile = configProfile ?? envProfile

      const awsAccessKeyId = env["AWS_ACCESS_KEY_ID"]

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

      const awsWebIdentityTokenFile = env["AWS_WEB_IDENTITY_TOKEN_FILE"]

      const containerCreds = Boolean(
        process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI,
      )

      if (!profile && !awsAccessKeyId && !awsBearerToken && !awsWebIdentityTokenFile && !containerCreds)
        return { autoload: false }

      const { fromNodeProviderChain } = yield* Effect.promise(() => import("@aws-sdk/credential-providers"))

      const providerOptions: Record<string, any> = {
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
    }),
    llmgateway: () =>
      Effect.succeed({
        autoload: false,
        options: {
          headers: {
            "HTTP-Referer": "https://opencode.ai/",
            "X-Title": "opencode",
            "X-Source": "opencode",
          },
        },
      }),
    openrouter: () =>
      Effect.succeed({
        autoload: false,
        options: {
          headers: {
            "HTTP-Referer": "https://opencode.ai/",
            "X-Title": "opencode",
          },
        },
      }),
    nvidia: () =>
      Effect.succeed({
        autoload: false,
        options: {
          headers: {
            "HTTP-Referer": "https://opencode.ai/",
            "X-Title": "opencode",
          },
        },
      }),
    vercel: () =>
      Effect.succeed({
        autoload: false,
        options: {
          headers: {
            "http-referer": "https://opencode.ai/",
            "x-title": "opencode",
          },
        },
      }),
    "google-vertex": Effect.fnUntraced(function* (provider: Info) {
      const env = yield* dep.env()
      const project =
        provider.options?.project ?? env["GOOGLE_CLOUD_PROJECT"] ?? env["GCP_PROJECT"] ?? env["GCLOUD_PROJECT"]

      const location = String(
        provider.options?.location ??
          env["GOOGLE_VERTEX_LOCATION"] ??
          env["GOOGLE_CLOUD_LOCATION"] ??
          env["VERTEX_LOCATION"] ??
          "us-central1",
      )

      const autoload = Boolean(project)
      if (!autoload) return { autoload: false }
      return {
        autoload: true,
        vars(_options: Record<string, any>) {
          const endpoint = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`
          return {
            ...(project && { GOOGLE_VERTEX_PROJECT: project }),
            GOOGLE_VERTEX_LOCATION: location,
            GOOGLE_VERTEX_ENDPOINT: endpoint,
          }
        },
        options: {
          project,
          location,
          fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
            const { GoogleAuth } = await import("google-auth-library")
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
    }),
    "google-vertex-anthropic": Effect.fnUntraced(function* () {
      const env = yield* dep.env()
      const project = env["GOOGLE_CLOUD_PROJECT"] ?? env["GCP_PROJECT"] ?? env["GCLOUD_PROJECT"]
      const location = env["GOOGLE_CLOUD_LOCATION"] ?? env["VERTEX_LOCATION"] ?? "global"
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
    }),
    "sap-ai-core": Effect.fnUntraced(function* () {
      const auth = yield* dep.auth("sap-ai-core")
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
    }),
    zenmux: () =>
      Effect.succeed({
        autoload: false,
        options: {
          headers: {
            "HTTP-Referer": "https://opencode.ai/",
            "X-Title": "opencode",
          },
        },
      }),
    gitlab: Effect.fnUntraced(function* (input: Info) {
      const {
        VERSION: GITLAB_PROVIDER_VERSION,
        isWorkflowModel,
        discoverWorkflowModels,
      } = yield* Effect.promise(() => import("gitlab-ai-provider"))

      const instanceUrl = (yield* dep.get("GITLAB_INSTANCE_URL")) || "https://gitlab.com"

      const auth = yield* dep.auth(input.id)
      const apiKey = yield* Effect.sync(() => {
        if (auth?.type === "oauth") return auth.access
        if (auth?.type === "api") return auth.key
        return undefined
      })
      const token = apiKey ?? (yield* dep.get("GITLAB_TOKEN"))

      const providerConfig = (yield* dep.config()).provider?.["gitlab"]
      const directory = yield* InstanceState.directory

      const aiGatewayHeaders = {
        "User-Agent": `opencode/${InstallationVersion} gitlab-ai-provider/${GITLAB_PROVIDER_VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
        "anthropic-beta": "context-1m-2025-08-07",
        ...providerConfig?.options?.aiGatewayHeaders,
      }

      const featureFlags = {
        duo_agent_platform_agentic_chat: true,
        duo_agent_platform: true,
        ...providerConfig?.options?.featureFlags,
      }

      return {
        autoload: !!token,
        options: {
          instanceUrl,
          apiKey: token,
          aiGatewayHeaders,
          featureFlags,
        },
        async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
          if (modelID.startsWith("duo-workflow-")) {
            const workflowRef = typeof options?.workflowRef === "string" ? options.workflowRef : undefined
            // Use the static mapping if it exists, otherwise use duo-workflow with selectedModelRef
            const sdkModelID = isWorkflowModel(modelID) ? modelID : "duo-workflow"
            const workflowDefinition =
              typeof options?.workflowDefinition === "string" ? options.workflowDefinition : undefined
            const model = sdk.workflowChat(sdkModelID, {
              featureFlags,
              workflowDefinition,
            })
            if (workflowRef) {
              model.selectedModelRef = workflowRef
            }
            return model
          }
          return sdk.agenticChat(modelID, {
            aiGatewayHeaders,
            featureFlags,
          })
        },
        async discoverModels(): Promise<Record<string, Model>> {
          if (!apiKey) {
            log.info("gitlab model discovery skipped: no apiKey")
            return {}
          }

          try {
            const token = apiKey
            const getHeaders = (): Record<string, string> =>
              auth?.type === "api" ? { "PRIVATE-TOKEN": token } : { Authorization: `Bearer ${token}` }

            log.info("gitlab model discovery starting", { instanceUrl })
            const result = await discoverWorkflowModels({ instanceUrl, getHeaders }, { workingDirectory: directory })

            if (!result.models.length) {
              log.info("gitlab model discovery skipped: no models found", {
                project: result.project
                  ? {
                      id: result.project.id,
                      path: result.project.pathWithNamespace,
                    }
                  : null,
              })
              return {}
            }

            const models: Record<string, Model> = {}
            for (const m of result.models) {
              if (!input.models[m.id]) {
                models[m.id] = {
                  id: ModelID.make(m.id),
                  providerID: ProviderID.make("gitlab"),
                  name: `Agent Platform (${m.name})`,
                  family: "",
                  api: {
                    id: m.id,
                    url: instanceUrl,
                    npm: "gitlab-ai-provider",
                  },
                  status: "active",
                  headers: {},
                  options: { workflowRef: m.ref },
                  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                  limit: { context: m.context, output: m.output },
                  capabilities: {
                    temperature: false,
                    reasoning: true,
                    attachment: true,
                    toolcall: true,
                    input: {
                      text: true,
                      audio: false,
                      image: true,
                      video: false,
                      pdf: true,
                    },
                    output: {
                      text: true,
                      audio: false,
                      image: false,
                      video: false,
                      pdf: false,
                    },
                    interleaved: false,
                  },
                  release_date: "",
                  variants: {},
                }
              }
            }

            log.info("gitlab model discovery complete", {
              count: Object.keys(models).length,
              models: Object.keys(models),
            })
            return models
          } catch (e) {
            log.warn("gitlab model discovery failed", { error: e })
            return {}
          }
        },
      }
    }),
    "cloudflare-workers-ai": Effect.fnUntraced(function* (input: Info) {
      // When baseURL is already configured (e.g. corporate config routing through a proxy/gateway),
      // skip the account ID check because the URL is already fully specified.
      if (input.options?.baseURL) return { autoload: false }

      const auth = yield* dep.auth(input.id)
      const env = yield* dep.env()
      const accountId = env["CLOUDFLARE_ACCOUNT_ID"] || (auth?.type === "api" ? auth.metadata?.accountId : undefined)
      if (!accountId)
        return {
          autoload: false,
          async getModel() {
            throw new Error(
              "CLOUDFLARE_ACCOUNT_ID is missing. Set it with: export CLOUDFLARE_ACCOUNT_ID=<your-account-id>",
            )
          },
        }

      const apiKey = yield* Effect.gen(function* () {
        const envToken = env["CLOUDFLARE_API_KEY"]
        if (envToken) return envToken
        if (auth?.type === "api") return auth.key
        return undefined
      })

      return {
        autoload: !!apiKey,
        options: {
          apiKey,
          headers: {
            "User-Agent": `opencode/${InstallationVersion} cloudflare-workers-ai (${os.platform()} ${os.release()}; ${os.arch()})`,
          },
        },
        async getModel(sdk: any, modelID: string) {
          return sdk.languageModel(modelID)
        },
        vars(_options) {
          return {
            CLOUDFLARE_ACCOUNT_ID: accountId,
          }
        },
      }
    }),
    "cloudflare-ai-gateway": Effect.fnUntraced(function* (input: Info) {
      // When baseURL is already configured (e.g. corporate config), skip the ID checks.
      if (input.options?.baseURL) return { autoload: false }

      const auth = yield* dep.auth(input.id)
      const env = yield* dep.env()
      const accountId = env["CLOUDFLARE_ACCOUNT_ID"] || (auth?.type === "api" ? auth.metadata?.accountId : undefined)
      const gateway = env["CLOUDFLARE_GATEWAY_ID"] || (auth?.type === "api" ? auth.metadata?.gatewayId : undefined)

      if (!accountId || !gateway) {
        const missing = [
          !accountId ? "CLOUDFLARE_ACCOUNT_ID" : undefined,
          !gateway ? "CLOUDFLARE_GATEWAY_ID" : undefined,
        ].filter((x): x is string => Boolean(x))
        return {
          autoload: false,
          async getModel() {
            throw new Error(
              `${missing.join(" and ")} missing. Set with: ${missing.map((x) => `export ${x}=<value>`).join(" && ")}`,
            )
          },
        }
      }

      // Get API token from env or auth - required for authenticated gateways
      const apiToken = yield* Effect.gen(function* () {
        const envToken = env["CLOUDFLARE_API_TOKEN"] || env["CF_AIG_TOKEN"]
        if (envToken) return envToken
        if (auth?.type === "api") return auth.key
        return undefined
      })

      if (!apiToken) {
        throw new Error(
          "CLOUDFLARE_API_TOKEN (or CF_AIG_TOKEN) is required for Cloudflare AI Gateway. " +
            "Set it via environment variable or run `opencode auth cloudflare-ai-gateway`.",
        )
      }

      // Use official ai-gateway-provider package (v2.x for AI SDK v5 compatibility)
      const { createAiGateway } = yield* Effect.promise(() => import("ai-gateway-provider"))
      const { createUnified } = yield* Effect.promise(() => import("ai-gateway-provider/providers/unified"))

      const metadata = iife(() => {
        if (input.options?.metadata) return input.options.metadata
        try {
          return JSON.parse(input.options?.headers?.["cf-aig-metadata"])
        } catch {
          return undefined
        }
      })
      const opts = {
        metadata,
        cacheTtl: input.options?.cacheTtl,
        cacheKey: input.options?.cacheKey,
        skipCache: input.options?.skipCache,
        collectLog: input.options?.collectLog,
        headers: {
          "User-Agent": `opencode/${InstallationVersion} cloudflare-ai-gateway (${os.platform()} ${os.release()}; ${os.arch()})`,
        },
      }

      const aigateway = createAiGateway({
        accountId,
        gateway,
        apiKey: apiToken,
        ...(Object.values(opts).some((v) => v !== undefined) ? { options: opts } : {}),
      })
      const unified = createUnified()

      return {
        autoload: true,
        async getModel(_sdk: any, modelID: string, _options?: Record<string, any>) {
          // Model IDs use Unified API format: provider/model (e.g., "anthropic/claude-sonnet-4-5")
          return aigateway(unified(modelID))
        },
        options: {},
      }
    }),
    cerebras: () =>
      Effect.succeed({
        autoload: false,
        options: {
          headers: {
            "X-Cerebras-3rd-Party-Integration": "opencode",
          },
        },
      }),
    kilo: () =>
      Effect.succeed({
        autoload: false,
        options: {
          headers: {
            "HTTP-Referer": "https://opencode.ai/",
            "X-Title": "opencode",
          },
        },
      }),
    databricks: Effect.fnUntraced(function* (input: Info) {
      const {
        Config: DatabricksConfig,
        isAnyAuthConfigured,
        WorkspaceClient,
      } = yield* Effect.promise(() => import("@databricks/sdk-experimental"))

      const opencodeConfig = yield* dep.config()
      const providerConfig = opencodeConfig.provider?.["databricks"]
      const auth = yield* dep.auth("databricks")
      const env = yield* dep.env()
      const hasEnvAuth = !!(env.DATABRICKS_HOST && env.DATABRICKS_TOKEN)
      const authProfile =
        !hasEnvAuth && auth?.type === "databricks-profile" ? (auth as any).profile : undefined
      const profile = hasEnvAuth
        ? undefined
        : (authProfile ?? providerConfig?.options?.profile)

      const envCopy = { ...env }
      if (profile) {
        delete envCopy.DATABRICKS_HOST
        delete envCopy.DATABRICKS_TOKEN
      }
      const dbConfig = new DatabricksConfig({
        env: envCopy,
        host:
          (auth?.type === "api" ? auth.metadata?.host : undefined) ??
          providerConfig?.options?.baseURL ??
          providerConfig?.options?.host ??
          undefined,
        token: auth?.type === "api" ? auth.key : undefined,
        clientId: providerConfig?.options?.clientId,
        clientSecret: providerConfig?.options?.clientSecret,
        azureClientId: providerConfig?.options?.azureClientId,
        azureClientSecret: providerConfig?.options?.azureClientSecret,
        azureTenantId: providerConfig?.options?.azureTenantId,
        profile,
      })

      const source = profile
        ? `profile "${profile}"`
        : dbConfig.host
          ? `host ${dbConfig.host}`
          : "default config"

      const resolveResult = yield* Effect.promise(async () => {
        try {
          await dbConfig.ensureResolved()
          return { ok: true as const }
        } catch (e) {
          return { ok: false as const, error: e instanceof Error ? e.message : "unknown error" }
        }
      })
      if (!resolveResult.ok) {
        log.warn(`Databricks auth failed to resolve (${source}): ${resolveResult.error}`)
        return { autoload: false }
      }

      if (!dbConfig.host || !isAnyAuthConfigured(dbConfig)) {
        log.warn(
          !dbConfig.host
            ? "Databricks: no host configured"
            : `Databricks: no auth for ${dbConfig.host}`,
        )
        return { autoload: false }
      }

      const authResult = yield* Effect.promise(async () => {
        try {
          const testHeaders = new Headers()
          await dbConfig.authenticate(testHeaders)
          if (!testHeaders.has("Authorization")) {
            return { ok: false as const, reason: "no-credentials" as const }
          }
          return { ok: true as const }
        } catch (e) {
          return { ok: false as const, reason: "error" as const, error: e instanceof Error ? e.message : "unknown" }
        }
      })
      if (!authResult.ok) {
        if (authResult.reason === "no-credentials") {
          log.warn(`Databricks: auth produced no credentials for ${dbConfig.host}`)
        } else {
          log.warn(`Databricks: auth failed for ${dbConfig.host}: ${authResult.error}`)
        }
        return { autoload: false }
      }

      const hostResult = yield* Effect.promise(async () => {
        try {
          return { ok: true as const, host: (await dbConfig.getHost()).origin }
        } catch (e) {
          return { ok: false as const, error: e instanceof Error ? e.message : "unknown" }
        }
      })
      if (!hostResult.ok) {
        log.warn(`Databricks: getHost failed: ${hostResult.error}`)
        return { autoload: false }
      }
      const normalizedHost = hostResult.host

      // Surface selection. Default is "auto" — probe AI Gateway, fall back to
      // /serving-endpoints if disabled. AI Gateway is the strategic Databricks
      // surface; the per-family adapters (@ai-sdk/anthropic, /google, /openai)
      // hit it natively, bypassing @databricks/ai-sdk-provider entirely.
      const surfacePref: "auto" | "ai-gateway" | "model-serving" =
        providerConfig?.options?.surface ?? "auto"
      const useAiGateway = yield* Effect.promise(async () => {
        if (surfacePref === "model-serving") return false
        try {
          const headers = new Headers({ accept: "application/json" })
          await dbConfig.authenticate(headers)
          const r = await fetch(`${normalizedHost}/ai-gateway/anthropic/v1/models`, { headers })
          if (r.ok) return true
          if (surfacePref === "ai-gateway") {
            log.warn(`Databricks: surface forced to ai-gateway but probe returned ${r.status}; using it anyway`)
            return true
          }
          return false
        } catch (e) {
          if (surfacePref === "ai-gateway") {
            log.warn(`Databricks: surface forced to ai-gateway but probe threw: ${e instanceof Error ? e.message : "unknown"}`)
            return true
          }
          return false
        }
      })
      log.info("Databricks surface", { surface: useAiGateway ? "ai-gateway" : "model-serving", host: normalizedHost })

      const baseURL = useAiGateway
        ? `${normalizedHost}/ai-gateway`
        : `${normalizedHost}/serving-endpoints`

      // Diagnostic switch: when DATABRICKS_BARE_FETCH=1, perform auth only and
      // skip every outgoing body / incoming SSE workaround. Used to A/B which
      // quirks AI Gateway still requires vs which the bundled provider hides.
      const bareFetch = process.env.DATABRICKS_BARE_FETCH === "1"

      const databricksFetch = async (url: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers)
        await dbConfig.authenticate(headers)

        if (!bareFetch && init?.body && typeof init.body === "string") {
          try {
            const body = JSON.parse(init.body)
            if (Array.isArray(body.tools)) {
              let modified = false
              for (const t of body.tools) {
                const params = t.function?.parameters
                if (params && !params.type) {
                  params.type = "object"
                  modified = true
                }
              }
              if (modified) init = { ...init, body: JSON.stringify(body) }
            }
          } catch {}
        }

        const urlStr = typeof url === "string" ? url : url.toString()
        const isResponsesApi = !bareFetch && urlStr.includes("/responses")

        const response = await fetch(url, { ...init, headers })

        if (
          isResponsesApi &&
          response.body &&
          response.headers.get("content-type")?.includes("text/event-stream")
        ) {
          const decoder = new TextDecoder()
          const encoder = new TextEncoder()
          let buffer = ""
          // State that must persist across `transform` invocations (one per
          // network chunk batch), not be reset on every call:
          //   - `itemIdByOutputIndex` accumulates across the whole stream so
          //     content_part.added arriving in a later chunk than its
          //     output_item.added still gets rewritten correctly.
          const itemIdByOutputIndex: Record<number, string> = {}

          const transform = new TransformStream({
            transform(value: Uint8Array, controller) {
              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split("\n")
              buffer = lines.pop()!

              // Databricks emits Responses item IDs up to ~192 chars; OpenAI's
              // Responses backend (and our consumer SDK) cap at 64. Truncate
              // any id/item_id/call_id field deterministically so cross-event
              // correlation still works (same long id → same 64-char prefix).
              const truncateIds = (o: any): any => {
                if (Array.isArray(o)) {
                  for (let i = 0; i < o.length; i++) o[i] = truncateIds(o[i])
                  return o
                }
                if (o && typeof o === "object") {
                  for (const k of Object.keys(o)) {
                    const v = o[k]
                    if (
                      typeof v === "string" &&
                      v.length > 64 &&
                      (k === "id" || k === "item_id" || k === "call_id")
                    ) {
                      o[k] = v.slice(0, 64)
                    } else {
                      o[k] = truncateIds(v)
                    }
                  }
                }
                return o
              }

              // AI Gateway sometimes emits `response.output_item.added` with
              // one item id (e.g. msg_073e...) and the subsequent
              // `response.content_part.added` / `response.output_text.delta`
              // events for the SAME output_index with a different item_id
              // (e.g. msg_0177...). @ai-sdk/openai correlates text parts by
              // id, so the mismatch breaks the stream with "text part not
              // found". The map (declared in the outer scope) accumulates
              // item ids per output_index across all chunk batches so
              // dependent events arriving in later batches are rewritten.

              for (const line of lines) {
                if (line.startsWith("data: ") && line !== "data: [DONE]") {
                  try {
                    const chunk = JSON.parse(line.slice(6))
                    truncateIds(chunk)
                    if (
                      chunk.type === "response.output_item.added" &&
                      typeof chunk.output_index === "number" &&
                      typeof chunk.item?.id === "string"
                    ) {
                      itemIdByOutputIndex[chunk.output_index] = chunk.item.id
                    } else if (
                      typeof chunk.output_index === "number" &&
                      typeof chunk.item_id === "string" &&
                      itemIdByOutputIndex[chunk.output_index] != null &&
                      itemIdByOutputIndex[chunk.output_index] !== chunk.item_id
                    ) {
                      chunk.item_id = itemIdByOutputIndex[chunk.output_index]
                    }
                    if (chunk.type === "response.completed") {
                      chunk.type = "responses.completed"
                      if (chunk.response?.usage && chunk.response.usage.total_tokens == null) {
                        chunk.response.usage.total_tokens =
                          (chunk.response.usage.input_tokens ?? 0) +
                          (chunk.response.usage.output_tokens ?? 0)
                      }
                    }
                    controller.enqueue(encoder.encode("data: " + JSON.stringify(chunk) + "\n"))
                  } catch {
                    controller.enqueue(encoder.encode(line + "\n"))
                  }
                } else if (line.startsWith("event: response.completed")) {
                  controller.enqueue(encoder.encode("event: responses.completed\n"))
                } else {
                  controller.enqueue(encoder.encode(line + "\n"))
                }
              }
            },
            flush(controller) {
              if (buffer.length > 0) {
                controller.enqueue(encoder.encode(buffer))
              }
            },
          })

          return new Response(response.body.pipeThrough(transform), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          })
        }

        return response
      }

      function toProviderModel(model: ModelsDev.Model): Model {
        return {
          id: model.id as any,
          providerID: "databricks" as any,
          name: model.name,
          family: model.family,
          api: {
            id: model.id,
            url: baseURL,
            npm: "@databricks/ai-sdk-provider",
          },
          status: "active",
          headers: {},
          options: (model as any).options ?? {},
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

      const DISCOVERY_TIMEOUT_MS = 10_000
      yield* Effect.promise(async () => {
        try {
          const client = new WorkspaceClient(dbConfig)

          await Promise.race([
          (async () => {
            const toolCapableFamilies = [
              "claude",
              "codex",
              "gpt",
              "gemini",
              "llama",
              "qwen",
              "gemma",
            ]

            const familyDefaults: Record<
              string,
              {
                context: number
                output: number
                reasoning: boolean
                attachment: boolean
                maxTools?: number
              }
            > = {
              claude: { context: 200000, output: 64000, reasoning: true, attachment: true },
              gpt: { context: 400000, output: 128000, reasoning: true, attachment: true, maxTools: 16 },
              codex: {
                context: 400000,
                output: 128000,
                reasoning: true,
                attachment: true,
                maxTools: 10,
              },
              gemini: { context: 1000000, output: 65536, reasoning: true, attachment: true },
              llama: {
                context: 128000,
                output: 8192,
                reasoning: false,
                attachment: false,
                maxTools: 32,
              },
              qwen: {
                context: 128000,
                output: 16000,
                reasoning: false,
                attachment: false,
                maxTools: 32,
              },
              gemma: {
                context: 128000,
                output: 8192,
                reasoning: false,
                attachment: false,
                maxTools: 32,
              },
            }

            for await (const endpoint of client.servingEndpoints.list()) {
              const endpointName = endpoint.name
              if (!endpointName) continue
              const task = endpoint.task

              if (input.models[endpointName]) {
                const configNameLower = endpointName.toLowerCase()
                const configFamily = toolCapableFamilies.find((f) =>
                  configNameLower.includes(f),
                )
                const configNativeApiSurface = (() => {
                  switch (configFamily) {
                    case "claude":
                      return "anthropic" as const
                    case "gemini":
                      return "gemini" as const
                    case "gpt":
                    case "codex":
                      return "openai-responses" as const
                    default:
                      return "chat-completions" as const
                  }
                })()
                const npm =
                  configNativeApiSurface === "anthropic"
                    ? "@ai-sdk/anthropic"
                    : configNativeApiSurface === "gemini"
                      ? "@ai-sdk/google"
                      : configNativeApiSurface === "openai-responses" && useAiGateway
                        ? "@ai-sdk/openai"
                        : "@databricks/ai-sdk-provider"
                input.models[endpointName].api = {
                  ...input.models[endpointName].api,
                  npm,
                }
                const configResponses =
                  configNativeApiSurface === "openai-responses" &&
                  (task === "llm/v1/responses" || configFamily === "gpt")
                input.models[endpointName].options = {
                  ...input.models[endpointName].options,
                  nativeApiSurface: configNativeApiSurface,
                  ...(configResponses ? { useResponsesApi: true } : {}),
                }
                continue
              }

              const foundationModel =
                endpoint.config?.served_entities?.[0]?.foundation_model
              if (!foundationModel) continue
              if (task && task !== "llm/v1/chat" && task !== "llm/v1/responses") continue

              const nameLower = endpointName.toLowerCase()
              const family = toolCapableFamilies.find((f) => nameLower.includes(f))
              if (!family) {
                log.info("Skipping endpoint - unknown model family", {
                  endpoint: endpointName,
                })
                continue
              }

              const familyDefault = familyDefaults[family] ?? {
                context: 128000,
                output: 16000,
                reasoning: false,
                attachment: false,
              }
              // Quirk #8 (per-endpoint active-tools cap) is enforced on
              // /serving-endpoints but NOT on AI Gateway — verified empirically
              // 2026-05-06 (script/probe-aigw-quirks.ts: 89 tools accepted on
              // Claude/GPT/Gemini). On the gateway path drop the gpt-family
              // cap that was added for the model-serving 89-tool rejection.
              const defaults =
                useAiGateway && (family === "gpt" || family === "codex")
                  ? { ...familyDefault, maxTools: undefined }
                  : familyDefault

              const nativeApiSurface = (() => {
                switch (family) {
                  case "claude":
                    return "anthropic" as const
                  case "gemini":
                    return "gemini" as const
                  case "gpt":
                  case "codex":
                    return "openai-responses" as const
                  default:
                    return "chat-completions" as const
                }
              })()

              const useResponsesApi =
                nativeApiSurface === "openai-responses" &&
                (task === "llm/v1/responses" || family === "gpt")

              const discoveredModel = {
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
                options: {
                  nativeApiSurface,
                  ...(useResponsesApi ? { useResponsesApi: true } : {}),
                  ...(defaults.maxTools ? { maxTools: defaults.maxTools } : {}),
                },
              } as any as ModelsDev.Model

              const model = toProviderModel(discoveredModel)
              if (nativeApiSurface === "anthropic")
                model.api = { ...model.api, npm: "@ai-sdk/anthropic" }
              else if (nativeApiSurface === "gemini")
                model.api = { ...model.api, npm: "@ai-sdk/google" }
              else if (nativeApiSurface === "openai-responses" && useAiGateway)
                model.api = { ...model.api, npm: "@ai-sdk/openai" }
              input.models[endpointName] = model
            }
          })(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(`Discovery timed out after ${DISCOVERY_TIMEOUT_MS}ms`),
                ),
              DISCOVERY_TIMEOUT_MS,
            ),
          ),
        ])
        } catch (e) {
          log.warn("Failed to discover Databricks serving endpoints", {
            error: e instanceof Error ? e.message : "Unknown error",
          })
        }
      })

      log.info("Databricks authenticated", { host: normalizedHost, profile })

      const anthropicBase = useAiGateway
        ? `${normalizedHost}/ai-gateway/anthropic/v1`
        : `${normalizedHost}/serving-endpoints/anthropic/v1`
      const geminiBase = useAiGateway
        ? `${normalizedHost}/ai-gateway/gemini/v1beta`
        : `${normalizedHost}/serving-endpoints/gemini/v1beta`
      const openaiResponsesBase = useAiGateway
        ? `${normalizedHost}/ai-gateway/codex/v1`
        : null // model-serving path uses the bundled provider, not @ai-sdk/openai

      let anthropicSdk: any = null
      let geminiSdk: any = null
      let openaiSdk: any = null

      return {
        autoload: true,
        async getModel(_sdk: any, modelID: string, options?: Record<string, any>) {
          const surface = options?.nativeApiSurface

          if (surface === "anthropic") {
            if (!anthropicSdk) {
              const { createAnthropic } = await import("@ai-sdk/anthropic")
              anthropicSdk = createAnthropic({
                baseURL: anthropicBase,
                apiKey: "unused",
                fetch: databricksFetch as typeof fetch,
                headers: { "User-Agent": "opencode" },
              })
            }
            return anthropicSdk(modelID)
          }

          if (surface === "gemini") {
            if (!geminiSdk) {
              const { createGoogleGenerativeAI } = await import("@ai-sdk/google")
              geminiSdk = createGoogleGenerativeAI({
                baseURL: geminiBase,
                apiKey: "databricks",
                fetch: databricksFetch as typeof fetch,
                headers: { "User-Agent": "opencode" },
              })
            }
            return geminiSdk(modelID)
          }

          // GPT/Codex on AI Gateway: use @ai-sdk/openai's Responses adapter
          // pointed at /ai-gateway/codex/v1. Bypasses @databricks/ai-sdk-provider
          // entirely, so the lifecycle/flush bugs (#9, #10) don't apply on this
          // path and the middleware in session/llm.ts is inert.
          if (surface === "openai-responses" && openaiResponsesBase) {
            if (!openaiSdk) {
              const { createOpenAI } = await import("@ai-sdk/openai")
              openaiSdk = createOpenAI({
                baseURL: openaiResponsesBase,
                apiKey: "databricks",
                fetch: databricksFetch as typeof fetch,
                headers: { "User-Agent": "opencode" },
              })
            }
            return openaiSdk.responses(modelID)
          }

          if (options?.useResponsesApi) return _sdk.responses(modelID)
          return _sdk.chatCompletions(modelID)
        },
        options: {
          baseURL,
          headers: { "User-Agent": "opencode" },
          fetch: databricksFetch as typeof fetch,
        },
      }
    }),
  }
}

const ProviderApiInfo = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  npm: Schema.String,
})

const ProviderModalities = Schema.Struct({
  text: Schema.Boolean,
  audio: Schema.Boolean,
  image: Schema.Boolean,
  video: Schema.Boolean,
  pdf: Schema.Boolean,
})

const ProviderInterleaved = Schema.Union([
  Schema.Boolean,
  Schema.Struct({
    field: Schema.Literals(["reasoning_content", "reasoning_details"]),
  }),
])

const ProviderCapabilities = Schema.Struct({
  temperature: Schema.Boolean,
  reasoning: Schema.Boolean,
  attachment: Schema.Boolean,
  toolcall: Schema.Boolean,
  input: ProviderModalities,
  output: ProviderModalities,
  interleaved: ProviderInterleaved,
})

const ProviderCacheCost = Schema.Struct({
  read: Schema.Finite,
  write: Schema.Finite,
})

const ProviderCost = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cache: ProviderCacheCost,
  experimentalOver200K: optionalOmitUndefined(
    Schema.Struct({
      input: Schema.Finite,
      output: Schema.Finite,
      cache: ProviderCacheCost,
    }),
  ),
})

const ProviderLimit = Schema.Struct({
  context: Schema.Finite,
  input: optionalOmitUndefined(Schema.Finite),
  output: Schema.Finite,
})

export const Model = Schema.Struct({
  id: ModelID,
  providerID: ProviderID,
  api: ProviderApiInfo,
  name: Schema.String,
  family: optionalOmitUndefined(Schema.String),
  capabilities: ProviderCapabilities,
  cost: ProviderCost,
  limit: ProviderLimit,
  status: Schema.Literals(["alpha", "beta", "deprecated", "active"]),
  options: Schema.Record(Schema.String, Schema.Any),
  headers: Schema.Record(Schema.String, Schema.String),
  release_date: Schema.String,
  variants: optionalOmitUndefined(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Any))),
})
  .annotate({ identifier: "Model" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Model = Types.DeepMutable<Schema.Schema.Type<typeof Model>>

export const Info = Schema.Struct({
  id: ProviderID,
  name: Schema.String,
  source: Schema.Literals(["env", "config", "custom", "api"]),
  env: Schema.Array(Schema.String),
  key: optionalOmitUndefined(Schema.String),
  options: Schema.Record(Schema.String, Schema.Any),
  models: Schema.Record(Schema.String, Model),
})
  .annotate({ identifier: "Provider" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

const DefaultModelIDs = Schema.Record(Schema.String, Schema.String)

export const ListResult = Schema.Struct({
  all: Schema.Array(Info),
  default: DefaultModelIDs,
  connected: Schema.Array(Schema.String),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type ListResult = Types.DeepMutable<Schema.Schema.Type<typeof ListResult>>

export const ConfigProvidersResult = Schema.Struct({
  providers: Schema.Array(Info),
  default: DefaultModelIDs,
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type ConfigProvidersResult = Types.DeepMutable<Schema.Schema.Type<typeof ConfigProvidersResult>>

export function defaultModelIDs<T extends { models: Record<string, { id: string }> }>(providers: Record<string, T>) {
  return mapValues(providers, (item) => sort(Object.values(item.models))[0].id)
}

export interface Interface {
  readonly list: () => Effect.Effect<Record<ProviderID, Info>>
  readonly getProvider: (providerID: ProviderID) => Effect.Effect<Info>
  readonly getModel: (providerID: ProviderID, modelID: ModelID) => Effect.Effect<Model>
  readonly getLanguage: (model: Model) => Effect.Effect<LanguageModelV3>
  readonly closest: (
    providerID: ProviderID,
    query: string[],
  ) => Effect.Effect<{ providerID: ProviderID; modelID: string } | undefined>
  readonly getSmallModel: (providerID: ProviderID) => Effect.Effect<Model | undefined>
  readonly defaultModel: () => Effect.Effect<{ providerID: ProviderID; modelID: ModelID }>
}

interface State {
  models: Map<string, LanguageModelV3>
  providers: Record<ProviderID, Info>
  sdk: Map<string, BundledSDK>
  modelLoaders: Record<string, CustomModelLoader>
  varsLoaders: Record<string, CustomVarsLoader>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Provider") {}

function cost(c: ModelsDev.Model["cost"]): Model["cost"] {
  const result: Model["cost"] = {
    input: c?.input ?? 0,
    output: c?.output ?? 0,
    cache: {
      read: c?.cache_read ?? 0,
      write: c?.cache_write ?? 0,
    },
  }
  if (c?.context_over_200k) {
    result.experimentalOver200K = {
      cache: {
        read: c.context_over_200k.cache_read ?? 0,
        write: c.context_over_200k.cache_write ?? 0,
      },
      input: c.context_over_200k.input,
      output: c.context_over_200k.output,
    }
  }
  return result
}

function fromModelsDevModel(provider: ModelsDev.Provider, model: ModelsDev.Model): Model {
  const base: Model = {
    id: ModelID.make(model.id),
    providerID: ProviderID.make(provider.id),
    name: model.name,
    family: model.family,
    api: {
      id: model.id,
      url: model.provider?.api ?? provider.api ?? "",
      npm: model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible",
    },
    status: model.status ?? "active",
    headers: {},
    options: {},
    cost: cost(model.cost),
    limit: {
      context: model.limit.context,
      input: model.limit.input,
      output: model.limit.output,
    },
    capabilities: {
      temperature: model.temperature ?? false,
      reasoning: model.reasoning ?? false,
      attachment: model.attachment ?? false,
      toolcall: model.tool_call ?? true,
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
    release_date: model.release_date ?? "",
    variants: {},
  }

  return {
    ...base,
    variants: mapValues(ProviderTransform.variants(base), (v) => v),
  }
}

export function fromModelsDevProvider(provider: ModelsDev.Provider): Info {
  const models: Record<string, Model> = {}
  for (const [key, model] of Object.entries(provider.models)) {
    models[key] = fromModelsDevModel(provider, model)
    for (const [mode, opts] of Object.entries(model.experimental?.modes ?? {})) {
      const id = `${model.id}-${mode}`
      const base = fromModelsDevModel(provider, model)
      models[id] = {
        ...base,
        id: ModelID.make(id),
        name: `${model.name} ${mode[0].toUpperCase()}${mode.slice(1)}`,
        cost: opts.cost ? mergeDeep(base.cost, cost(opts.cost)) : base.cost,
        options: opts.provider?.body
          ? Object.fromEntries(
              Object.entries(opts.provider.body).map(([k, v]) => [
                k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
                v,
              ]),
            )
          : base.options,
        headers: opts.provider?.headers ?? base.headers,
      }
    }
  }
  return {
    id: ProviderID.make(provider.id),
    source: "custom",
    name: provider.name,
    env: [...(provider.env ?? [])],
    options: {},
    models,
  }
}

const layer: Layer.Layer<
  Service,
  never,
  Config.Service | Auth.Service | Plugin.Service | AppFileSystem.Service | Env.Service | ModelsDev.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const config = yield* Config.Service
    const auth = yield* Auth.Service
    const env = yield* Env.Service
    const plugin = yield* Plugin.Service
    const modelsDevSvc = yield* ModelsDev.Service

    const state = yield* InstanceState.make<State>(() =>
      Effect.gen(function* () {
        using _ = log.time("state")
        const bridge = yield* EffectBridge.make()
        const cfg = yield* config.get()
        const modelsDev = yield* modelsDevSvc.get()
        const database = mapValues(modelsDev, fromModelsDevProvider)

        const providers: Record<ProviderID, Info> = {} as Record<ProviderID, Info>
        const languages = new Map<string, LanguageModelV3>()
        const modelLoaders: {
          [providerID: string]: CustomModelLoader
        } = {}
        const varsLoaders: {
          [providerID: string]: CustomVarsLoader
        } = {}
        const sdk = new Map<string, BundledSDK>()
        const discoveryLoaders: {
          [providerID: string]: CustomDiscoverModels
        } = {}
        const dep = {
          auth: (id: string) => auth.get(id).pipe(Effect.orDie),
          config: () => config.get(),
          env: () => env.all(),
          get: (key: string) => env.get(key),
        }

        log.info("init")

        function mergeProvider(providerID: ProviderID, provider: Partial<Info>) {
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

        // load plugins first so config() hook runs before reading cfg.provider
        const plugins = yield* plugin.list()

        // now read config providers - includes any modifications from plugin config() hook
        const configProviders = Object.entries(cfg.provider ?? {})
        const disabled = new Set(cfg.disabled_providers ?? [])
        const enabled = cfg.enabled_providers ? new Set(cfg.enabled_providers) : null

        function isProviderAllowed(providerID: ProviderID): boolean {
          if (enabled && !enabled.has(providerID)) return false
          if (disabled.has(providerID)) return false
          return true
        }

        for (const hook of plugins) {
          const p = hook.provider
          const models = p?.models
          if (!p || !models) continue

          const providerID = ProviderID.make(p.id)
          if (disabled.has(providerID)) continue

          const provider = database[providerID]
          if (!provider) continue
          const pluginAuth = yield* auth.get(providerID).pipe(Effect.orDie)

          provider.models = yield* Effect.promise(async () => {
            // databricks-profile is an internal-only auth type and is never
            // attached to a plugin-driven provider; safe to narrow here.
            const next = await models(provider, { auth: pluginAuth as Parameters<typeof models>[1]["auth"] })
            return Object.fromEntries(
              Object.entries(next).map(([id, model]) => [
                id,
                {
                  ...model,
                  id: ModelID.make(id),
                  providerID,
                },
              ]),
            )
          })
        }

        // extend database from config
        for (const [providerID, provider] of configProviders) {
          const existing = database[providerID]
          const parsed: Info = {
            id: ProviderID.make(providerID),
            name: provider.name ?? existing?.name ?? providerID,
            env: provider.env ?? existing?.env ?? [],
            options: mergeDeep(existing?.options ?? {}, provider.options ?? {}),
            source: "config",
            models: existing?.models ?? {},
          }

          for (const [modelID, model] of Object.entries(provider.models ?? {})) {
            const existingModel = parsed.models[model.id ?? modelID]
            const apiID = model.id ?? existingModel?.api.id ?? modelID
            const apiNpm =
              model.provider?.npm ??
              provider.npm ??
              existingModel?.api.npm ??
              modelsDev[providerID]?.npm ??
              "@ai-sdk/openai-compatible"
            const name = iife(() => {
              if (model.name) return model.name
              if (model.id && model.id !== modelID) return modelID
              return existingModel?.name ?? modelID
            })
            const parsedModel: Model = {
              id: ModelID.make(modelID),
              api: {
                id: apiID,
                npm: apiNpm,
                url: model.provider?.api ?? provider?.api ?? existingModel?.api.url ?? modelsDev[providerID]?.api ?? "",
              },
              status: model.status ?? existingModel?.status ?? "active",
              name,
              providerID: ProviderID.make(providerID),
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
                  audio:
                    model.modalities?.output?.includes("audio") ?? existingModel?.capabilities.output.audio ?? false,
                  image:
                    model.modalities?.output?.includes("image") ?? existingModel?.capabilities.output.image ?? false,
                  video:
                    model.modalities?.output?.includes("video") ?? existingModel?.capabilities.output.video ?? false,
                  pdf: model.modalities?.output?.includes("pdf") ?? existingModel?.capabilities.output.pdf ?? false,
                },
                interleaved:
                  model.interleaved ??
                  existingModel?.capabilities.interleaved ??
                  (!existingModel && apiNpm === "@ai-sdk/openai-compatible" && apiID.includes("deepseek")
                    ? { field: "reasoning_content" }
                    : false),
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
                input: model.limit?.input ?? existingModel?.limit?.input,
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
        const envs = yield* env.all()
        for (const [id, provider] of Object.entries(database)) {
          const providerID = ProviderID.make(id)
          if (disabled.has(providerID)) continue
          const apiKey = provider.env.map((item) => envs[item]).find(Boolean)
          if (!apiKey) continue
          mergeProvider(providerID, {
            source: "env",
            key: provider.env.length === 1 ? apiKey : undefined,
          })
        }

        // load apikeys
        const auths = yield* auth.all().pipe(Effect.orDie)
        for (const [id, provider] of Object.entries(auths)) {
          const providerID = ProviderID.make(id)
          if (disabled.has(providerID)) continue
          if (provider.type === "api") {
            mergeProvider(providerID, {
              source: "api",
              key: provider.key,
            })
          }
        }

        // plugin auth loader - database now has entries for config providers
        for (const plugin of plugins) {
          if (!plugin.auth) continue
          const providerID = ProviderID.make(plugin.auth.provider)
          if (disabled.has(providerID)) continue

          const stored = yield* auth.get(providerID).pipe(Effect.orDie)
          if (!stored) continue
          if (!plugin.auth.loader) continue

          const options = yield* Effect.promise(() =>
            plugin.auth!.loader!(
              () => bridge.promise(auth.get(providerID).pipe(Effect.orDie)) as any,
              database[plugin.auth!.provider],
            ),
          )
          const opts = options ?? {}
          const patch: Partial<Info> = providers[providerID] ? { options: opts } : { source: "custom", options: opts }
          mergeProvider(providerID, patch)
        }

        for (const [id, fn] of Object.entries(custom(dep))) {
          const providerID = ProviderID.make(id)
          if (disabled.has(providerID)) continue
          const data = database[providerID]
          if (!data) {
            log.error("Provider does not exist in model list " + providerID)
            continue
          }
          const result = yield* fn(data)
          if (result && (result.autoload || providers[providerID])) {
            if (result.getModel) modelLoaders[providerID] = result.getModel
            if (result.vars) varsLoaders[providerID] = result.vars
            if (result.discoverModels) discoveryLoaders[providerID] = result.discoverModels
            const opts = result.options ?? {}
            const patch: Partial<Info> = providers[providerID] ? { options: opts } : { source: "custom", options: opts }
            mergeProvider(providerID, patch)
          }
        }

        // load config - re-apply with updated data
        for (const [id, provider] of configProviders) {
          const providerID = ProviderID.make(id)
          const partial: Partial<Info> = { source: "config" }
          if (provider.env) partial.env = provider.env
          if (provider.name) partial.name = provider.name
          if (provider.options) partial.options = provider.options
          mergeProvider(providerID, partial)
        }

        const gitlab = ProviderID.make("gitlab")
        if (discoveryLoaders[gitlab] && providers[gitlab] && isProviderAllowed(gitlab)) {
          yield* Effect.promise(async () => {
            try {
              const discovered = await discoveryLoaders[gitlab]()
              for (const [modelID, model] of Object.entries(discovered)) {
                if (!providers[gitlab].models[modelID]) {
                  providers[gitlab].models[modelID] = model
                }
              }
            } catch (e) {
              log.warn("state discovery error", { id: "gitlab", error: e })
            }
          })
        }

        for (const [id, provider] of Object.entries(providers)) {
          const providerID = ProviderID.make(id)
          if (!isProviderAllowed(providerID)) {
            delete providers[providerID]
            continue
          }

          const configProvider = cfg.provider?.[providerID]

          for (const [modelID, model] of Object.entries(provider.models)) {
            model.api.id = model.api.id ?? model.id ?? modelID
            if (
              modelID === "gpt-5-chat-latest" ||
              (providerID === ProviderID.openrouter && modelID === "openai/gpt-5-chat")
            )
              delete provider.models[modelID]
            if (model.status === "alpha" && !Flag.OPENCODE_ENABLE_EXPERIMENTAL_MODELS) delete provider.models[modelID]
            if (model.status === "deprecated") delete provider.models[modelID]
            if (
              (configProvider?.blacklist && configProvider.blacklist.includes(modelID)) ||
              (configProvider?.whitelist && !configProvider.whitelist.includes(modelID))
            )
              delete provider.models[modelID]

            if (!model.variants || Object.keys(model.variants).length === 0) {
              model.variants = mapValues(ProviderTransform.variants(model), (v) => v)
            }

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
          sdk,
          modelLoaders,
          varsLoaders,
        }
      }),
    )

    const list = Effect.fn("Provider.list")(() => InstanceState.use(state, (s) => s.providers))

    async function resolveSDK(model: Model, s: State, envs: Record<string, string | undefined>) {
      try {
        using _ = log.time("getSDK", {
          providerID: model.providerID,
        })
        const provider = s.providers[model.providerID]
        const options = { ...provider.options }

        if (model.providerID === "google-vertex" && !model.api.npm.includes("@ai-sdk/openai-compatible")) {
          delete options.fetch
        }

        if (model.api.npm.includes("@ai-sdk/openai-compatible") && options["includeUsage"] !== false) {
          options["includeUsage"] = true
        }

        const baseURL = iife(() => {
          let url =
            typeof options["baseURL"] === "string" && options["baseURL"] !== "" ? options["baseURL"] : model.api.url
          if (!url) return

          const loader = s.varsLoaders[model.providerID]
          if (loader) {
            const vars = loader(options)
            for (const [key, value] of Object.entries(vars)) {
              const field = "${" + key + "}"
              url = url.replaceAll(field, value)
            }
          }

          url = url.replace(/\$\{([^}]+)\}/g, (item, key) => {
            const val = envs[String(key)]
            return val ?? item
          })
          return url
        })

        if (baseURL !== undefined) options["baseURL"] = baseURL
        if (options["apiKey"] === undefined && provider.key) options["apiKey"] = provider.key
        if (model.headers)
          options["headers"] = {
            ...options["headers"],
            ...model.headers,
          }

        const key = Hash.fast(
          JSON.stringify({
            providerID: model.providerID,
            npm: model.api.npm,
            options,
          }),
        )
        const existing = s.sdk.get(key)
        if (existing) return existing

        const customFetch = options["fetch"]
        const chunkTimeout = options["chunkTimeout"]
        delete options["chunkTimeout"]

        options["fetch"] = async (input: any, init?: BunFetchRequestInit) => {
          const fetchFn = customFetch ?? fetch
          const opts = init ?? {}
          const chunkAbortCtl = typeof chunkTimeout === "number" && chunkTimeout > 0 ? new AbortController() : undefined
          const signals: AbortSignal[] = []

          if (opts.signal) signals.push(opts.signal)
          if (chunkAbortCtl) signals.push(chunkAbortCtl.signal)
          if (options["timeout"] !== undefined && options["timeout"] !== null && options["timeout"] !== false)
            signals.push(AbortSignal.timeout(options["timeout"]))

          const combined = signals.length === 0 ? null : signals.length === 1 ? signals[0] : AbortSignal.any(signals)
          if (combined) opts.signal = combined

          // Strip openai itemId metadata following what codex does
          if (
            (model.api.npm === "@ai-sdk/openai" || model.api.npm === "@ai-sdk/azure") &&
            opts.body &&
            opts.method === "POST"
          ) {
            const body = JSON.parse(opts.body as string)
            const keepIds = body.store === true
            if (!keepIds && Array.isArray(body.input)) {
              for (const item of body.input) {
                if ("id" in item) {
                  delete item.id
                }
              }
              opts.body = JSON.stringify(body)
            }
          }

          const res = await fetchFn(input, {
            ...opts,
            // @ts-ignore see here: https://github.com/oven-sh/bun/issues/16682
            timeout: false,
          })

          if (!chunkAbortCtl) return res
          return wrapSSE(res, chunkTimeout, chunkAbortCtl)
        }

        const bundledLoader = BUNDLED_PROVIDERS[model.api.npm]
        if (bundledLoader) {
          log.info("using bundled provider", {
            providerID: model.providerID,
            pkg: model.api.npm,
          })
          const factory = await bundledLoader()
          const loaded = factory({
            name: model.providerID,
            ...options,
          })
          s.sdk.set(key, loaded)
          return loaded as SDK
        }

        let installedPath: string
        if (!model.api.npm.startsWith("file://")) {
          const item = await Npm.add(model.api.npm)
          if (!item.entrypoint) throw new Error(`Package ${model.api.npm} has no import entrypoint`)
          installedPath = item.entrypoint
        } else {
          log.info("loading local provider", { pkg: model.api.npm })
          installedPath = model.api.npm
        }

        // `installedPath` is a local entry path or an existing `file://` URL. Normalize
        // only path inputs so Node on Windows accepts the dynamic import.
        const importSpec = installedPath.startsWith("file://") ? installedPath : pathToFileURL(installedPath).href
        const mod = await import(importSpec)

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

    const getProvider = Effect.fn("Provider.getProvider")((providerID: ProviderID) =>
      InstanceState.use(state, (s) => s.providers[providerID]),
    )

    const getModel = Effect.fn("Provider.getModel")(function* (providerID: ProviderID, modelID: ModelID) {
      const s = yield* InstanceState.get(state)
      const provider = s.providers[providerID]
      if (!provider) {
        const available = Object.keys(s.providers)
        const matches = fuzzysort.go(providerID, available, { limit: 3, threshold: -10000 })
        throw new ModelNotFoundError({ providerID, modelID, suggestions: matches.map((m) => m.target) })
      }

      const info = provider.models[modelID]
      if (!info) {
        const available = Object.keys(provider.models)
        const matches = fuzzysort.go(modelID, available, { limit: 3, threshold: -10000 })
        throw new ModelNotFoundError({ providerID, modelID, suggestions: matches.map((m) => m.target) })
      }
      return info
    })

    const getLanguage = Effect.fn("Provider.getLanguage")(function* (model: Model) {
      const s = yield* InstanceState.get(state)
      const envs = yield* env.all()
      const key = `${model.providerID}/${model.id}`
      if (s.models.has(key)) return s.models.get(key)!

      return yield* Effect.promise(async () => {
        const provider = s.providers[model.providerID]
        const sdk = await resolveSDK(model, s, envs)

        try {
          const language = s.modelLoaders[model.providerID]
            ? await s.modelLoaders[model.providerID](sdk, model.api.id, {
                ...provider.options,
                ...model.options,
              })
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
      })
    })

    const closest = Effect.fn("Provider.closest")(function* (providerID: ProviderID, query: string[]) {
      const s = yield* InstanceState.get(state)
      const provider = s.providers[providerID]
      if (!provider) return undefined
      for (const item of query) {
        for (const modelID of Object.keys(provider.models)) {
          if (modelID.includes(item)) return { providerID, modelID }
        }
      }
      return undefined
    })

    const getSmallModel = Effect.fn("Provider.getSmallModel")(function* (providerID: ProviderID) {
      const cfg = yield* config.get()

      if (cfg.small_model) {
        const parsed = parseModel(cfg.small_model)
        return yield* getModel(parsed.providerID, parsed.modelID)
      }

      const s = yield* InstanceState.get(state)
      const provider = s.providers[providerID]
      if (!provider) return undefined

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
        priority = ["gpt-5-mini", "claude-haiku-4.5", ...priority]
      }
      for (const item of priority) {
        if (providerID === ProviderID.amazonBedrock) {
          const crossRegionPrefixes = ["global.", "us.", "eu."]
          const candidates = Object.keys(provider.models).filter((m) => m.includes(item))

          const globalMatch = candidates.find((m) => m.startsWith("global."))
          if (globalMatch) return yield* getModel(providerID, ModelID.make(globalMatch))

          const region = provider.options?.region
          if (region) {
            const regionPrefix = region.split("-")[0]
            if (regionPrefix === "us" || regionPrefix === "eu") {
              const regionalMatch = candidates.find((m) => m.startsWith(`${regionPrefix}.`))
              if (regionalMatch) return yield* getModel(providerID, ModelID.make(regionalMatch))
            }
          }

          const unprefixed = candidates.find((m) => !crossRegionPrefixes.some((p) => m.startsWith(p)))
          if (unprefixed) return yield* getModel(providerID, ModelID.make(unprefixed))
        } else {
          for (const model of Object.keys(provider.models)) {
            if (model.includes(item)) return yield* getModel(providerID, ModelID.make(model))
          }
        }
      }

      return undefined
    })

    const defaultModel = Effect.fn("Provider.defaultModel")(function* () {
      const cfg = yield* config.get()
      if (cfg.model) return parseModel(cfg.model)

      const s = yield* InstanceState.get(state)
      const recent = yield* fs.readJson(path.join(Global.Path.state, "model.json")).pipe(
        Effect.map((x): { providerID: ProviderID; modelID: ModelID }[] => {
          if (!isRecord(x) || !Array.isArray(x.recent)) return []
          return x.recent.flatMap((item) => {
            if (!isRecord(item)) return []
            if (typeof item.providerID !== "string") return []
            if (typeof item.modelID !== "string") return []
            return [{ providerID: ProviderID.make(item.providerID), modelID: ModelID.make(item.modelID) }]
          })
        }),
        Effect.catch(() => Effect.succeed([] as { providerID: ProviderID; modelID: ModelID }[])),
      )
      for (const entry of recent) {
        const provider = s.providers[entry.providerID]
        if (!provider) continue
        if (!provider.models[entry.modelID]) continue
        return { providerID: entry.providerID, modelID: entry.modelID }
      }

      const provider = Object.values(s.providers).find((p) => !cfg.provider || Object.keys(cfg.provider).includes(p.id))
      if (!provider) throw new Error("no providers found")
      const [model] = sort(Object.values(provider.models))
      if (!model) throw new Error("no models found")
      return {
        providerID: provider.id,
        modelID: model.id,
      }
    })

    return Service.of({ list, getProvider, getModel, getLanguage, closest, getSmallModel, defaultModel })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(Env.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Auth.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(ModelsDev.defaultLayer),
  ),
)

const priority = ["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"]
export function sort<T extends { id: string }>(models: T[]) {
  return sortBy(
    models,
    [(model) => priority.findIndex((filter) => model.id.includes(filter)), "desc"],
    [(model) => (model.id.includes("latest") ? 0 : 1), "asc"],
    [(model) => model.id, "desc"],
  )
}

export function parseModel(model: string) {
  const [providerID, ...rest] = model.split("/")
  return {
    providerID: ProviderID.make(providerID),
    modelID: ModelID.make(rest.join("/")),
  }
}

export const ModelNotFoundError = namedSchemaError("ProviderModelNotFoundError", {
  providerID: ProviderID,
  modelID: ModelID,
  suggestions: Schema.optional(Schema.Array(Schema.String)),
})

export const InitError = namedSchemaError("ProviderInitError", {
  providerID: ProviderID,
})

export * as Provider from "./provider"
