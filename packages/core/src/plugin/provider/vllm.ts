import { define } from "@opencode-ai/plugin/effect/plugin"
import type { Entry } from "@opencode-ai/schema/config"
import { Duration, Effect, Schedule, Schema, Semaphore, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Config } from "../../config.js"
import { Model } from "../../model.js"
import type { PluginInternal } from "../internal.js"
import { foldSettings } from "./configured.js"

const providerID = "vllm"

const RemoteModel = Schema.Struct({
  id: Schema.String,
  owned_by: Schema.String,
  max_model_len: Schema.NullOr(Schema.Int),
})

const Response = Schema.Struct({ data: Schema.Array(RemoteModel) })
const discovery = new Map<string, { checked: number; apiKey?: string; models?: (typeof RemoteModel.Type)[] }>()
const discoveryLock = Semaphore.makeUnsafe(1)

export function make(origin = "http://127.0.0.1:8000", interval: Duration.Input = "30 seconds") {
  return define({
    id: "opencode.provider.vllm",
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
          provider.name = "vLLM"
          provider.package = "@opencode-ai/ai/providers/openai-compatible"
          provider.settings = {
            baseURL: source.current.baseURL,
            provider: providerID,
            apiKey: source.current.apiKey ?? "",
          }
          provider.integrationID = undefined
          provider.activation = "enabled"
        })
        for (const item of loaded.models) {
          catalog.model.update(providerID, item.id, (model) => {
            model.modelID = Model.ID.make(item.id)
            model.name = item.id
            // Tool calling depends on vLLM server flags and parsers that model discovery does not report.
            model.capabilities = { tools: false, input: ["text"], output: ["text"] }
            if (typeof item.max_model_len === "number" && item.max_model_len > 0)
              model.limit.context = item.max_model_len
          })
        }
      })

      const discover = Effect.fn("VLLMPlugin.discover")(function* () {
        const current = source.current
        if (!current.healthEndpoint || !current.modelsEndpoint) return undefined
        return yield* discoveryLock.withPermit(
          Effect.gen(function* () {
            const endpoint = `${current.healthEndpoint}\n${current.modelsEndpoint}`
            const cached = discovery.get(endpoint)
            if (cached && cached.apiKey === current.apiKey && Date.now() - cached.checked < Duration.toMillis(interval))
              return { source: current, models: cached.models }
            discovery.set(endpoint, {
              checked: Date.now(),
              apiKey: current.apiKey,
              models: cached && cached.apiKey === current.apiKey ? cached.models : undefined,
            })
            const request = (endpoint: string) =>
              current.apiKey
                ? HttpClientRequest.get(endpoint).pipe(
                    HttpClientRequest.acceptJson,
                    HttpClientRequest.bearerToken(current.apiKey),
                  )
                : HttpClientRequest.get(endpoint).pipe(HttpClientRequest.acceptJson)
            yield* http.execute(request(current.healthEndpoint)).pipe(Effect.timeout("1 second"))
            const response = yield* http
              .execute(request(current.modelsEndpoint))
              .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Response)), Effect.timeout("1 second"))
            const models = response.data
              .filter((model) => model.owned_by === providerID && model.id.length > 0)
              .toSorted((a, b) => a.id.localeCompare(b.id))
            discovery.set(endpoint, { checked: Date.now(), apiKey: current.apiKey, models })
            return { source: current, models }
          }),
        )
      })

      const refresh = Effect.fn("VLLMPlugin.refresh")(function* () {
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
      const reload = Effect.fn("VLLMPlugin.reload")(function* () {
        const next = configured(yield* config.entries(), origin)
        if (
          next.baseURL === source.current.baseURL &&
          next.apiKey === source.current.apiKey &&
          next.healthEndpoint === source.current.healthEndpoint &&
          next.modelsEndpoint === source.current.modelsEndpoint
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

export const VLLMPlugin = make()

function configured(entries: readonly Entry[], origin: string) {
  const settings = foldSettings(entries, providerID, undefined)
  const baseURL = (
    typeof settings?.baseURL === "string" ? settings.baseURL : `${origin.replace(/\/+$/, "")}/v1`
  ).replace(/\/+$/, "")
  const apiKey = typeof settings?.apiKey === "string" ? settings.apiKey : undefined
  if (!URL.canParse(baseURL)) return { baseURL, apiKey }
  const models = new URL(baseURL)
  if (models.protocol !== "http:" && models.protocol !== "https:") return { baseURL, apiKey }
  models.pathname = `${models.pathname.replace(/\/+$/, "")}/models`
  models.search = ""
  models.hash = ""
  const health = new URL(baseURL)
  const path = health.pathname.replace(/\/+$/, "")
  const prefix = path.endsWith("/v1") ? path.slice(0, -3) : path
  health.pathname = `${prefix}/health`
  health.search = ""
  health.hash = ""
  return { baseURL, apiKey, healthEndpoint: health.toString(), modelsEndpoint: models.toString() }
}
