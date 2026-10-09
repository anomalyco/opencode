import { define } from "@opencode/plugin/effect/plugin"
import type { Entry } from "@opencode/schema/config"
import { Duration, Effect, Schedule, type Schema, Semaphore, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Config } from "../../config.js"
import { Model } from "../../model.js"
import type { PluginInternal } from "../internal.js"
import { foldSettings } from "./configured.js"

export type LocalModel = {
  readonly id: string
  readonly name?: string
  readonly family?: string | null
  readonly tools?: boolean
  readonly vision?: boolean
  readonly context?: number | null
}

export type LocalDiscoveryClient = ReturnType<typeof createClient>

export function createLocalProviderPlugin<Discovered>(input: {
  readonly id: string
  readonly providerID: string
  readonly name: string
  readonly origin: string
  readonly stripPathSuffix?: RegExp
  readonly discover: (client: LocalDiscoveryClient) => Effect.Effect<readonly Discovered[], unknown>
  readonly model: (item: NoInfer<Discovered>) => LocalModel
}) {
  const discovery = new Map<string, { checked: number; apiKey?: string; models?: readonly Discovered[] }>()
  const discoveryLock = Semaphore.makeUnsafe(1)
  const suffix = input.stripPathSuffix ?? /\/v1$/

  return function make(origin = input.origin, interval: Duration.Input = "30 seconds") {
    return define({
      id: input.id,
      effect: Effect.fn(function* (ctx) {
        const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
        const config = yield* Config.Service
        const source = { current: configured(yield* config.entries(), input.providerID, origin, suffix) }
        const loaded = { models: [] as readonly Discovered[], hash: "[]" }

        yield* ctx.integration.transform((integrations) => {
          if (loaded.models.length === 0) return
          integrations.remove(input.providerID)
        })

        yield* ctx.provider.transform((providers) => {
          if (loaded.models.length === 0) return
          for (const model of providers.get(input.providerID)?.models.values() ?? []) {
            providers.models.remove(input.providerID, model.id)
          }
          providers.update(input.providerID, (provider) => {
            provider.name = input.name
            provider.activation = "enabled"
            provider.package = "@opencode/ai/providers/openai-compatible"
            provider.settings = {
              baseURL: source.current.baseURL,
              provider: input.providerID,
              apiKey: source.current.apiKey ?? "",
            }
            provider.integrationID = undefined
          })
          for (const item of loaded.models) {
            const spec = input.model(item)
            providers.models.update(input.providerID, spec.id, (model) => {
              model.modelID = Model.ID.make(spec.id)
              model.name = spec.name || spec.id
              model.family = spec.family ? Model.Family.make(spec.family) : undefined
              model.capabilities = {
                tools: spec.tools ?? false,
                input: ["text", ...(spec.vision ? ["image"] : [])],
                output: ["text"],
              }
              if (typeof spec.context === "number" && spec.context > 0) model.limit.context = spec.context
            })
          }
        })

        const discover = Effect.fn("LocalProviderPlugin.discover")(function* () {
          const current = source.current
          if (!current.endpoint) return undefined
          return yield* discoveryLock.withPermit(
            Effect.gen(function* () {
              const cached = discovery.get(current.root)
              if (
                cached &&
                cached.apiKey === current.apiKey &&
                Date.now() - cached.checked < Duration.toMillis(interval)
              )
                return { source: current, models: cached.models }
              discovery.set(current.root, {
                checked: Date.now(),
                apiKey: current.apiKey,
                models: cached && cached.apiKey === current.apiKey ? cached.models : undefined,
              })
              const models = yield* input.discover(createClient(http, current.root, current.apiKey, current.endpoint))
              discovery.set(current.root, { checked: Date.now(), apiKey: current.apiKey, models })
              return { source: current, models }
            }),
          )
        })

        const refresh = Effect.fn("LocalProviderPlugin.refresh")(function* () {
          const result = yield* discover()
          if (!result?.models || result.source !== source.current) return
          const hash = JSON.stringify(result.models)
          if (hash === loaded.hash) return
          loaded.models = result.models
          loaded.hash = hash
          yield* ctx.integration.reload()
          yield* ctx.provider.reload()
        })

        // Keep the last successful inventory through transient outages instead of flickering model availability.
        yield* refresh().pipe(Effect.ignore, Effect.repeat(Schedule.spaced(interval)), Effect.forkScoped)
        const reload = Effect.fn("LocalProviderPlugin.reload")(function* () {
          const next = configured(yield* config.entries(), input.providerID, origin, suffix)
          if (
            next.baseURL === source.current.baseURL &&
            next.apiKey === source.current.apiKey &&
            next.root === source.current.root
          )
            return
          source.current = next
          loaded.models = []
          loaded.hash = "[]"
          yield* ctx.integration.reload()
          yield* ctx.provider.reload()
          yield* refresh().pipe(Effect.ignore)
        })
        yield* ctx.event.subscribe().pipe(
          Stream.filter((event) => event.type === "config.updated"),
          Stream.runForEach(reload),
          Effect.forkScoped({ startImmediately: true }),
        )
      }),
    } satisfies PluginInternal.InternalPlugin)
  }
}

function createClient(
  http: HttpClient.HttpClient,
  root: string,
  apiKey: string | undefined,
  endpoint: (path: string) => string,
) {
  const auth = (request: HttpClientRequest.HttpClientRequest) =>
    apiKey
      ? request.pipe(HttpClientRequest.acceptJson, HttpClientRequest.bearerToken(apiKey))
      : request.pipe(HttpClientRequest.acceptJson)
  return {
    root,
    apiKey,
    get: (path: string) => http.execute(auth(HttpClientRequest.get(endpoint(path)))).pipe(Effect.timeout("1 second")),
    getJson: <A, I>(path: string, schema: Schema.Codec<A, I>) =>
      http
        .execute(auth(HttpClientRequest.get(endpoint(path))))
        .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)), Effect.timeout("1 second")),
    postJson: <B, BI, A, AI>(
      path: string,
      bodySchema: Schema.Codec<B, BI>,
      body: B,
      responseSchema: Schema.Codec<A, AI>,
    ) =>
      auth(HttpClientRequest.post(endpoint(path))).pipe(
        HttpClientRequest.schemaBodyJson(bodySchema)(body),
        Effect.flatMap(http.execute),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(responseSchema)),
        Effect.timeout("1 second"),
      ),
  }
}

function configured(entries: readonly Entry[], providerID: string, origin: string, suffix: RegExp) {
  const settings = foldSettings(entries, providerID, undefined)
  const baseURL = (
    typeof settings?.baseURL === "string" ? settings.baseURL : `${origin.replace(/\/+$/, "")}/v1`
  ).replace(/\/+$/, "")
  const apiKey = typeof settings?.apiKey === "string" ? settings.apiKey : undefined
  if (!URL.canParse(baseURL)) return { baseURL, apiKey }
  const url = new URL(baseURL)
  if (url.protocol !== "http:" && url.protocol !== "https:") return { baseURL, apiKey }
  const prefix = url.pathname.replace(/\/+$/, "").replace(suffix, "")
  const endpoint = (path: string) => {
    const next = new URL(url)
    next.pathname = `${prefix}${path}`
    next.search = ""
    next.hash = ""
    return next.toString()
  }
  return { baseURL, apiKey, root: endpoint(""), endpoint }
}
