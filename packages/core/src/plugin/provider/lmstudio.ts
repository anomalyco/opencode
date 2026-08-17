import { define } from "@opencode-ai/plugin/effect/plugin"
import { Document, type Entry } from "@opencode-ai/schema/config"
import { Duration, Effect, Schedule, Schema, Semaphore, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Config } from "../../config.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import type { PluginInternal } from "../internal.js"

const providerID = "lmstudio"

const RemoteModel = Schema.Struct({
  type: Schema.Literals(["llm", "embedding"]),
  key: Schema.String,
  display_name: Schema.String,
  architecture: Schema.NullOr(Schema.String).pipe(Schema.optional),
  loaded_instances: Schema.Array(
    Schema.Struct({
      config: Schema.Struct({ context_length: Schema.Int }),
    }),
  ),
  max_context_length: Schema.Int,
  capabilities: Schema.Struct({
    vision: Schema.Boolean,
    trained_for_tool_use: Schema.Boolean,
  }).pipe(Schema.optional),
})

const Response = Schema.Struct({ models: Schema.Array(RemoteModel) })
const discovery = new Map<string, { checked: number; apiKey?: string; models?: (typeof RemoteModel.Type)[] }>()
const discoveryLock = Semaphore.makeUnsafe(1)

export function make(origin = "http://127.0.0.1:1234", interval: Duration.Input = "30 seconds") {
  return define({
    id: "opencode.provider.lmstudio",
    effect: Effect.fn(function* (ctx) {
      const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
      const config = yield* Config.Service
      const source = { current: configured(yield* config.entries(), origin) }
      const loaded = { models: [] as (typeof RemoteModel.Type)[], hash: "[]" }

      yield* ctx.integration.transform((integrations) => {
        if (loaded.models.length === 0) return
        integrations.remove(providerID)
      })

      yield* ctx.catalog.transform((catalog) => {
        if (loaded.models.length === 0) return
        for (const model of catalog.provider.get(providerID)?.models.values() ?? []) {
          catalog.model.remove(providerID, model.id)
        }
        catalog.provider.update(providerID, (provider) => {
          provider.name = "LM Studio"
          provider.activation = "enabled"
          provider.package = "@opencode-ai/ai/providers/openai-compatible"
          provider.settings = {
            baseURL: source.current.baseURL,
            provider: providerID,
            apiKey: source.current.apiKey ?? "",
          }
          provider.integrationID = undefined
        })
        for (const item of loaded.models) {
          catalog.model.update(providerID, item.key, (model) => {
            model.modelID = Model.ID.make(item.key)
            model.name = item.display_name || item.key
            model.family = item.architecture ? Model.Family.make(item.architecture) : undefined
            model.capabilities = {
              tools: item.capabilities?.trained_for_tool_use ?? false,
              input: ["text", ...(item.capabilities?.vision ? ["image"] : [])],
              output: ["text"],
            }
            model.limit = {
              context:
                item.loaded_instances.length === 0
                  ? item.max_context_length
                  : Math.min(...item.loaded_instances.map((instance) => instance.config.context_length)),
              output: 0,
            }
          })
        }
      })

      const discover = Effect.fn("LMStudioPlugin.discover")(function* () {
        const current = source.current
        if (!current.endpoint) return undefined
        return yield* discoveryLock.withPermit(
          Effect.gen(function* () {
            const cached = discovery.get(current.endpoint)
            if (cached && cached.apiKey === current.apiKey && Date.now() - cached.checked < Duration.toMillis(interval))
              return { source: current, models: cached.models }
            discovery.set(current.endpoint, {
              checked: Date.now(),
              apiKey: current.apiKey,
              models: cached && cached.apiKey === current.apiKey ? cached.models : undefined,
            })
            const request = current.apiKey
              ? HttpClientRequest.get(current.endpoint).pipe(
                  HttpClientRequest.acceptJson,
                  HttpClientRequest.bearerToken(current.apiKey),
                )
              : HttpClientRequest.get(current.endpoint).pipe(HttpClientRequest.acceptJson)
            const response = yield* http
              .execute(request)
              .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Response)), Effect.timeout("1 second"))
            const models = response.models
              .filter((model) => model.type === "llm" && model.key.length > 0)
              .toSorted((a, b) => a.key.localeCompare(b.key))
            discovery.set(current.endpoint, { checked: Date.now(), apiKey: current.apiKey, models })
            return { source: current, models }
          }),
        )
      })

      const refresh = Effect.fn("LMStudioPlugin.refresh")(function* () {
        const result = yield* discover()
        if (!result?.models || result.source !== source.current) return
        const hash = JSON.stringify(result.models)
        if (hash === loaded.hash) return
        loaded.models = result.models
        loaded.hash = hash
        yield* ctx.integration.reload()
        yield* ctx.catalog.reload()
      })

      // Keep the last successful inventory through transient outages instead of flickering model availability.
      yield* refresh().pipe(Effect.ignore, Effect.repeat(Schedule.spaced(interval)), Effect.forkScoped)
      const reload = Effect.fn("LMStudioPlugin.reload")(function* () {
        const next = configured(yield* config.entries(), origin)
        if (
          next.baseURL === source.current.baseURL &&
          next.apiKey === source.current.apiKey &&
          next.endpoint === source.current.endpoint
        )
          return
        source.current = next
        loaded.models = []
        loaded.hash = "[]"
        yield* ctx.integration.reload()
        yield* ctx.catalog.reload()
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

export const LMStudioPlugin = make()

function configured(entries: readonly Entry[], origin: string) {
  const settings = entries
    .filter((entry): entry is Document => entry.type === "document")
    .flatMap((entry) => {
      const settings = entry.info.providers?.[providerID]?.settings
      return settings ? [settings] : []
    })
    .reduce<Provider.Settings | undefined>((result, item) => Provider.mergeOverlay(result, item), undefined)
  const baseURL = (
    typeof settings?.baseURL === "string" ? settings.baseURL : `${origin.replace(/\/+$/, "")}/v1`
  ).replace(/\/+$/, "")
  const apiKey = typeof settings?.apiKey === "string" ? settings.apiKey : undefined
  if (!URL.canParse(baseURL)) return { baseURL, apiKey }
  const url = new URL(baseURL)
  if (url.protocol !== "http:" && url.protocol !== "https:") return { baseURL, apiKey }
  const prefix = url.pathname.endsWith("/v1") ? url.pathname.slice(0, -3) : url.pathname.replace(/\/+$/, "")
  url.pathname = `${prefix}/api/v1/models`
  url.search = ""
  url.hash = ""
  return { baseURL, apiKey, endpoint: url.toString() }
}
