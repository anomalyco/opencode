import { define } from "@opencode-ai/plugin/effect/plugin"
import { Document, type Entry } from "@opencode-ai/schema/config"
import { Duration, Effect, Schedule, Schema, Semaphore, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Config } from "../../config.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import type { PluginInternal } from "../internal.js"
import { LocalReasoning } from "./local-reasoning.js"

const providerID = "ollama"

const Details = Schema.Struct({
  parent_model: Schema.String.pipe(Schema.optional),
  format: Schema.String,
  family: Schema.String,
  families: Schema.Array(Schema.String).pipe(Schema.optional),
  parameter_size: Schema.String,
  quantization_level: Schema.String,
})

const RemoteModel = Schema.Struct({
  name: Schema.String,
  model: Schema.String,
  remote_model: Schema.String.pipe(Schema.optional),
  remote_host: Schema.String.pipe(Schema.optional),
  modified_at: Schema.String,
  size: Schema.Int,
  digest: Schema.String,
  details: Details,
})

const TagsResponse = Schema.Struct({ models: Schema.Array(RemoteModel) })
const ShowRequest = Schema.Struct({ model: Schema.String })
const ShowResponse = Schema.Struct({
  parameters: Schema.String.pipe(Schema.optional),
  license: Schema.String.pipe(Schema.optional),
  modified_at: Schema.String.pipe(Schema.optional),
  details: Details.pipe(Schema.optional),
  template: Schema.String.pipe(Schema.optional),
  capabilities: Schema.Array(Schema.String).pipe(Schema.optional),
  model_info: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
})

type DiscoveredModel = typeof RemoteModel.Type & { show: typeof ShowResponse.Type }
type Discovery = {
  checked: number
  apiKey?: string
  models?: DiscoveredModel[]
  shows: Map<string, { digest: string; info: typeof ShowResponse.Type }>
}

const discovery = new Map<string, Discovery>()
const discoveryLock = Semaphore.makeUnsafe(1)

export function make(origin = "http://127.0.0.1:11434", interval: Duration.Input = "30 seconds") {
  return define({
    id: "opencode.provider.ollama",
    effect: Effect.fn(function* (ctx) {
      const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
      const config = yield* Config.Service
      const source = { current: configured(yield* config.entries(), origin) }
      const loaded = { models: [] as DiscoveredModel[], hash: "[]" }

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
          provider.name = "Ollama"
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
          catalog.model.update(providerID, item.model, (model) => {
            model.modelID = Model.ID.make(item.model)
            model.name = item.name || item.model
            model.family = item.show.details?.family
              ? Model.Family.make(item.show.details.family)
              : item.details.family
                ? Model.Family.make(item.details.family)
                : undefined
            model.capabilities = {
              tools: item.show.capabilities?.includes("tools") ?? false,
              input: ["text", ...(item.show.capabilities?.includes("vision") ? ["image"] : [])],
              output: ["text"],
            }
            model.variants = item.show.capabilities?.includes("thinking")
              ? LocalReasoning.infer("ollama", `${item.model} ${model.family ?? ""}`)
              : []
            model.limit = {
              context:
                Object.entries(item.show.model_info ?? {}).flatMap(([key, value]) =>
                  key.endsWith(".context_length") && typeof value === "number" && value > 0 ? [value] : [],
                )[0] ?? 0,
              output: 0,
            }
          })
        }
      })

      const discover = Effect.fn("OllamaPlugin.discover")(function* () {
        const current = source.current
        if (!current.tagsEndpoint || !current.showEndpoint) return undefined
        return yield* discoveryLock.withPermit(
          Effect.gen(function* () {
            const cached = discovery.get(current.tagsEndpoint)
            if (cached && cached.apiKey === current.apiKey && Date.now() - cached.checked < Duration.toMillis(interval))
              return { source: current, models: cached.models }
            const previous: Discovery =
              cached && cached.apiKey === current.apiKey
                ? cached
                : { checked: 0, apiKey: current.apiKey, shows: new Map() }
            discovery.set(current.tagsEndpoint, { ...previous, checked: Date.now(), apiKey: current.apiKey })
            const tagsRequest = current.apiKey
              ? HttpClientRequest.get(current.tagsEndpoint).pipe(
                  HttpClientRequest.acceptJson,
                  HttpClientRequest.bearerToken(current.apiKey),
                )
              : HttpClientRequest.get(current.tagsEndpoint).pipe(HttpClientRequest.acceptJson)
            const response = yield* http
              .execute(tagsRequest)
              .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(TagsResponse)), Effect.timeout("1 second"))
            const summaries = response.models
              .filter((model) => model.model.length > 0)
              .toSorted((a, b) => a.model.localeCompare(b.model))
            const shows = new Map<string, { digest: string; info: typeof ShowResponse.Type }>()
            const models = yield* Effect.forEach(
              summaries,
              (model) =>
                Effect.gen(function* () {
                  const saved = previous.shows.get(model.model)
                  const info =
                    saved?.digest === model.digest
                      ? saved.info
                      : yield* HttpClientRequest.post(current.showEndpoint).pipe(
                          HttpClientRequest.acceptJson,
                          current.apiKey ? HttpClientRequest.bearerToken(current.apiKey) : (request) => request,
                          HttpClientRequest.schemaBodyJson(ShowRequest)({ model: model.model }),
                          Effect.flatMap(http.execute),
                          Effect.flatMap(HttpClientResponse.schemaBodyJson(ShowResponse)),
                          Effect.timeout("1 second"),
                        )
                  shows.set(model.model, { digest: model.digest, info })
                  return { ...model, show: info }
                }).pipe(Effect.catch(() => Effect.succeed(undefined))),
              { concurrency: 4 },
            )
            const filtered = models.filter(
              (model): model is DiscoveredModel =>
                model !== undefined && (model.show.capabilities?.includes("completion") ?? false),
            )
            discovery.set(current.tagsEndpoint, {
              checked: Date.now(),
              apiKey: current.apiKey,
              models: filtered,
              shows,
            })
            return { source: current, models: filtered }
          }),
        )
      })

      const refresh = Effect.fn("OllamaPlugin.refresh")(function* () {
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
      const reload = Effect.fn("OllamaPlugin.reload")(function* () {
        const next = configured(yield* config.entries(), origin)
        if (
          next.baseURL === source.current.baseURL &&
          next.apiKey === source.current.apiKey &&
          next.tagsEndpoint === source.current.tagsEndpoint
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

export const OllamaPlugin = make()

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
  url.pathname = `${prefix}/api/tags`
  url.search = ""
  url.hash = ""
  const tagsEndpoint = url.toString()
  url.pathname = `${prefix}/api/show`
  return { baseURL, apiKey, tagsEndpoint, showEndpoint: url.toString() }
}
