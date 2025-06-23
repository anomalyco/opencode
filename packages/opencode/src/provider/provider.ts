import z from "zod"
import { App } from "../app/app"
import { Config } from "../config/config"
import { mergeDeep, sortBy } from "remeda"
import { NoSuchModelError, type LanguageModel, type Provider as SDK } from "ai"
import { Log } from "../util/log"
import { BunProc } from "../bun"
import { BashTool } from "../tool/bash"
import { EditTool } from "../tool/edit"
import { WebFetchTool } from "../tool/webfetch"
import { GlobTool } from "../tool/glob"
import { GrepTool } from "../tool/grep"
import { ListTool } from "../tool/ls"
import { LspDiagnosticTool } from "../tool/lsp-diagnostics"
import { LspHoverTool } from "../tool/lsp-hover"
import { PatchTool } from "../tool/patch"
import { ReadTool } from "../tool/read"
import type { Tool } from "../tool/tool"
import { WriteTool } from "../tool/write"
import { TodoReadTool, TodoWriteTool } from "../tool/todo"
import { AuthAnthropic } from "../auth/anthropic"
import { AuthGithubCopilot } from "../auth/github-copilot"
import { ModelsDev } from "./models"
import { NamedError } from "../util/error"
import { Auth } from "../auth"
import { TaskTool } from "../tool/task"

export namespace Provider {
  const log = Log.create({ service: "provider" })

  type CustomLoader = (provider: ModelsDev.Provider) => Promise<
    | {
        getModel?: (sdk: any, modelID: string) => Promise<any>
        options: Record<string, any>
      }
    | false
  >

  type Source = "env" | "config" | "custom" | "api"

  const CUSTOM_LOADERS: Record<string, CustomLoader> = {
    async anthropic(provider) {
      const access = await AuthAnthropic.access()
      if (!access) return false
      for (const model of Object.values(provider.models)) {
        model.cost = {
          input: 0,
          output: 0,
        }
      }
      return {
        options: {
          apiKey: "",
          async fetch(input: any, init: any) {
            const access = await AuthAnthropic.access()
            const headers = {
              ...init.headers,
              authorization: `Bearer ${access}`,
              "anthropic-beta": "oauth-2025-04-20",
            }
            delete headers["x-api-key"]
            return fetch(input, {
              ...init,
              headers,
            })
          },
        },
      }
    },
    "github-copilot": async (provider) => {
      const info = await AuthGithubCopilot.access()
      if (!info) return false

      if (provider && provider.models) {
        for (const model of Object.values(provider.models)) {
          model.cost = {
            input: 0,
            output: 0,
          }
        }
      }

      return {
        options: {
          apiKey: "",
          async fetch(input: any, init: any) {
            const token = await AuthGithubCopilot.access()
            if (!token) throw new Error("GitHub Copilot authentication expired")
            const headers = {
              ...init.headers,
              Authorization: `Bearer ${token}`,
              "User-Agent": "GitHubCopilotChat/0.26.7",
              "Editor-Version": "vscode/1.99.3",
              "Editor-Plugin-Version": "copilot-chat/0.26.7",
              "Copilot-Integration-Id": "vscode-chat",
              "Openai-Intent": "conversation-edits",
            }
            delete headers["x-api-key"]
            return fetch(input, {
              ...init,
              headers,
            })
          },
        },
      }
    },
    openai: async () => {
      return {
        async getModel(sdk: any, modelID: string) {
          return sdk.responses(modelID)
        },
        options: {},
      }
    },
    "amazon-bedrock": async () => {
      if (!process.env["AWS_PROFILE"] && !process.env["AWS_ACCESS_KEY_ID"])
        return false

      const region = process.env["AWS_REGION"] ?? "us-east-1"

      const { fromNodeProviderChain } = await import(
        await BunProc.install("@aws-sdk/credential-providers")
      )
      return {
        options: {
          region,
          credentialProvider: fromNodeProviderChain(),
        },
        async getModel(sdk: any, modelID: string) {
          if (modelID.includes("claude")) {
            const prefix = region.split("-")[0]
            modelID = `${prefix}.${modelID}`
          }
          return sdk.languageModel(modelID)
        },
      }
    },
  }

  const state = App.state("provider", async () => {
    const config = await Config.get()
    const database = await ModelsDev.get()

    const providers: {
      [providerID: string]: {
        source: Source
        info: ModelsDev.Provider
        getModel?: (sdk: any, modelID: string) => Promise<any>
        options: Record<string, any>
      }
    } = {}
    const models = new Map<
      string,
      { info: ModelsDev.Model; language: LanguageModel }
    >()
    const sdk = new Map<string, SDK>()

    log.info("init")

    function mergeProvider(
      id: string,
      options: Record<string, any>,
      source: Source,
      getModel?: (sdk: any, modelID: string) => Promise<any>,
    ) {
      const provider = providers[id]
      if (!provider) {
        const info = database[id]
        if (!info) return
        if (info.api) options["baseURL"] = info.api
        providers[id] = {
          source,
          info,
          options,
        }
        return
      }
      provider.options = mergeDeep(provider.options, options)
      provider.source = source
      provider.getModel = getModel ?? provider.getModel
    }

    const configProviders = Object.entries(config.provider ?? {})

    for (const [providerID, provider] of configProviders) {
      const existing = database[providerID]
      const parsed: ModelsDev.Provider = {
        id: providerID,
        npm: provider.npm ?? existing?.npm,
        name: provider.name ?? existing?.name ?? providerID,
        env: provider.env ?? existing?.env ?? [],
        models: existing?.models ?? {},
      }

      for (const [modelID, model] of Object.entries(provider.models ?? {})) {
        const existing = parsed.models[modelID]
        const parsedModel: ModelsDev.Model = {
          id: modelID,
          name: model.name ?? existing?.name ?? modelID,
          attachment: model.attachment ?? existing?.attachment ?? false,
          reasoning: model.reasoning ?? existing?.reasoning ?? false,
          temperature: model.temperature ?? existing?.temperature ?? false,
          tool_call: model.tool_call ?? existing?.tool_call ?? true,
          cost: {
            ...existing?.cost,
            ...model.cost,
            input: 0,
            output: 0,
            cache_read: 0,
            cache_write: 0,
          },
          options: {
            ...existing?.options,
            ...model.options,
          },
          limit: model.limit ??
            existing?.limit ?? {
              context: 0,
              output: 0,
            },
        }
        parsed.models[modelID] = parsedModel
      }
      database[providerID] = parsed
    }

    const disabled = await Config.get().then(
      (cfg) => new Set(cfg.disabled_providers ?? []),
    )
    // load env
    for (const [providerID, provider] of Object.entries(database)) {
      if (disabled.has(providerID)) continue
      if (provider.env.some((item) => process.env[item])) {
        mergeProvider(providerID, {}, "env")
      }
    }

    // load apikeys
    for (const [providerID, provider] of Object.entries(await Auth.all())) {
      if (disabled.has(providerID)) continue
      if (provider.type === "api") {
        mergeProvider(providerID, { apiKey: provider.key }, "api")
      }
    }

    // load custom
    for (const [providerID, fn] of Object.entries(CUSTOM_LOADERS)) {
      if (disabled.has(providerID)) continue
      const result = await fn(database[providerID])
      if (result) {
        mergeProvider(providerID, result.options, "custom", result.getModel)
      }
    }

    // load config
    for (const [providerID, provider] of configProviders) {
      mergeProvider(providerID, provider.options ?? {}, "config")
    }

    for (const [providerID, provider] of Object.entries(providers)) {
      if (Object.keys(provider.info.models).length === 0) {
        delete providers[providerID]
        continue
      }
      log.info("found", { providerID })
    }

    return {
      models,
      providers,
      sdk,
    }
  })

  export async function list() {
    return state().then((state) => state.providers)
  }

  async function getSDK(provider: ModelsDev.Provider) {
    return (async () => {
      using _ = log.time("getSDK", {
        providerID: provider.id,
      })
      const s = await state()
      const existing = s.sdk.get(provider.id)
      if (existing) return existing
      const pkg = provider.npm ?? provider.id
      const mod = await import(await BunProc.install(pkg, "latest"))
      const fn = mod[Object.keys(mod).find((key) => key.startsWith("create"))!]
      const loaded = fn(s.providers[provider.id]?.options)
      s.sdk.set(provider.id, loaded)
      return loaded as SDK
    })().catch((e) => {
      throw new InitError({ providerID: provider.id }, { cause: e })
    })
  }

  export async function getModel(providerID: string, modelID: string) {
    const key = `${providerID}/${modelID}`
    const s = await state()
    if (s.models.has(key)) return s.models.get(key)!

    log.info("getModel", {
      providerID,
      modelID,
    })

    const provider = s.providers[providerID]
    if (!provider) throw new ModelNotFoundError({ providerID, modelID })
    const info = provider.info.models[modelID]
    if (!info) throw new ModelNotFoundError({ providerID, modelID })
    const sdk = await getSDK(provider.info)

    try {
      const language = provider.getModel
        ? await provider.getModel(sdk, modelID)
        : sdk.languageModel(modelID)
      log.info("found", { providerID, modelID })
      s.models.set(key, {
        info,
        language,
      })
      return {
        info,
        language,
      }
    } catch (e) {
      if (e instanceof NoSuchModelError)
        throw new ModelNotFoundError(
          {
            modelID: modelID,
            providerID,
          },
          { cause: e },
        )
      throw e
    }
  }

  const priority = ["gemini-2.5-pro-preview", "codex-mini", "claude-sonnet-4"]
  export function sort(models: ModelsDev.Model[]) {
    return sortBy(
      models,
      [
        (model) => priority.findIndex((filter) => model.id.includes(filter)),
        "desc",
      ],
      [(model) => (model.id.includes("latest") ? 0 : 1), "asc"],
      [(model) => model.id, "desc"],
    )
  }

  export async function defaultModel() {
    const cfg = await Config.get()
    if (cfg.model) return parseModel(cfg.model)
    const provider = await list()
      .then((val) => Object.values(val))
      .then((x) =>
        x.find(
          (p) => !cfg.provider || Object.keys(cfg.provider).includes(p.info.id),
        ),
      )
    if (!provider) throw new Error("no providers found")
    const [model] = sort(Object.values(provider.info.models))
    if (!model) throw new Error("no models found")
    return {
      providerID: provider.info.id,
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

  const TOOLS = [
    BashTool,
    EditTool,
    WebFetchTool,
    GlobTool,
    GrepTool,
    ListTool,
    LspDiagnosticTool,
    LspHoverTool,
    PatchTool,
    ReadTool,
    EditTool,
    // MultiEditTool,
    WriteTool,
    TodoWriteTool,
    TaskTool,
    TodoReadTool,
  ]

  const TOOL_MAPPING: Record<string, Tool.Info[]> = {
    anthropic: TOOLS.filter((t) => t.id !== "patch"),
    openai: TOOLS.map((t) => ({
      ...t,
      parameters: optionalToNullable(t.parameters),
    })),
    azure: TOOLS.map((t) => ({
      ...t,
      parameters: optionalToNullable(t.parameters),
    })),
    google: TOOLS,
  }

  export async function tools(providerID: string) {
    /*
    const cfg = await Config.get()
    if (cfg.tool?.provider?.[providerID])
      return cfg.tool.provider[providerID].map(
        (id) => TOOLS.find((t) => t.id === id)!,
      )
        */
    return TOOL_MAPPING[providerID] ?? TOOLS
  }

  function optionalToNullable(schema: z.ZodTypeAny): z.ZodTypeAny {
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape
      const newShape: Record<string, z.ZodTypeAny> = {}

      for (const [key, value] of Object.entries(shape)) {
        const zodValue = value as z.ZodTypeAny
        if (zodValue instanceof z.ZodOptional) {
          newShape[key] = zodValue.unwrap().nullable()
        } else {
          newShape[key] = optionalToNullable(zodValue)
        }
      }

      return z.object(newShape)
    }

    if (schema instanceof z.ZodArray) {
      return z.array(optionalToNullable(schema.element))
    }

    if (schema instanceof z.ZodUnion) {
      return z.union(
        schema.options.map((option: z.ZodTypeAny) =>
          optionalToNullable(option),
        ) as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]],
      )
    }

    return schema
  }

  export const ModelNotFoundError = NamedError.create(
    "ProviderModelNotFoundError",
    z.object({
      providerID: z.string(),
      modelID: z.string(),
    }),
  )

  export const InitError = NamedError.create(
    "ProviderInitError",
    z.object({
      providerID: z.string(),
    }),
  )

  export const AuthError = NamedError.create(
    "ProviderAuthError",
    z.object({
      providerID: z.string(),
      message: z.string(),
    }),
  )
}
