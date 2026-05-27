import fuzzysort from "fuzzysort"
import { Config } from "@/config/config"
import { mapValues, mergeDeep, omit, pickBy, sortBy } from "remeda"
import { NoSuchModelError, type Provider as SDK } from "ai"
import * as Log from "@yunpat/core/util/log"
import { Npm } from "@yunpat/core/npm"
import { Hash } from "@yunpat/core/util/hash"
import { Plugin } from "../plugin"
import { type LanguageModelV3 } from "@ai-sdk/provider"
import * as ModelsDev from "./models"
import { Auth } from "../auth"
import { Env } from "../env"
import { Flag } from "@yunpat/core/flag/flag"
import { namedSchemaError } from "@/util/named-schema-error"
import { iife } from "@/util/iife"
import { Global } from "@yunpat/core/global"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer, Context, Schema, Types } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@yunpat/core/filesystem"
import { isRecord } from "@/util/record"

import * as ProviderTransform from "./transform"
import { ModelID, ProviderID, Model as ModelSchema, Info as InfoSchema } from "./schema"
export { Model, Info, ListResult, ConfigProvidersResult, ModelID, ProviderID } from "./schema"
type Model = Types.DeepMutable<Schema.Schema.Type<typeof ModelSchema>>
type Info = Types.DeepMutable<Schema.Schema.Type<typeof InfoSchema>>
import {
  BUNDLED_PROVIDERS,
  custom,
  type BundledSDK,
  type CustomModelLoader,
  type CustomVarsLoader,
  type CustomDiscoverModels,
} from "./custom"
export { BUNDLED_PROVIDERS, type BundledSDK, type CustomModelLoader, type CustomVarsLoader, type CustomDiscoverModels, type CustomLoader, type CustomDep } from "./custom"

const log = Log.create({ service: "provider" })
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

export class Service extends Context.Service<Service, Interface>()("@yunpat/Provider") {}

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
            const next = await models(provider, { auth: pluginAuth })
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
