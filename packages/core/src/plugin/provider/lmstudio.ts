import { define } from "@opencode-ai/plugin/effect/plugin"
import { Duration, Effect, Schedule, Schema, Semaphore } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Model } from "../../model.js"
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
const discovery = new Map<string, { checked: number; models?: (typeof RemoteModel.Type)[] }>()
const discoveryLock = Semaphore.makeUnsafe(1)

export function make(origin = "http://127.0.0.1:1234", interval: Duration.Input = "30 seconds") {
  const baseURL = `${origin.replace(/\/+$/, "")}/v1`
  const endpoint = `${origin.replace(/\/+$/, "")}/api/v1/models`
  return define({
    id: "opencode.provider.lmstudio",
    effect: Effect.fn(function* (ctx) {
      const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
      const loaded = { models: [] as (typeof RemoteModel.Type)[], hash: "[]" }

      yield* ctx.catalog.transform((catalog) => {
        if (loaded.models.length === 0) return
        catalog.provider.update(providerID, (provider) => {
          provider.name = "LM Studio"
          provider.package = "@opencode-ai/ai/providers/openai-compatible"
          provider.settings = { baseURL, provider: providerID }
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
        return yield* discoveryLock.withPermit(
          Effect.gen(function* () {
            const cached = discovery.get(endpoint)
            if (cached && Date.now() - cached.checked < Duration.toMillis(interval)) return cached.models
            discovery.set(endpoint, { checked: Date.now(), models: cached?.models })
            const response = yield* http
              .execute(HttpClientRequest.get(endpoint).pipe(HttpClientRequest.acceptJson))
              .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Response)), Effect.timeout("1 second"))
            const models = response.models
              .filter((model) => model.type === "llm" && model.key.length > 0)
              .toSorted((a, b) => a.key.localeCompare(b.key))
            discovery.set(endpoint, { checked: Date.now(), models })
            return models
          }),
        )
      })

      const refresh = Effect.fn("LMStudioPlugin.refresh")(function* () {
        const models = yield* discover()
        if (!models) return
        const hash = JSON.stringify(models)
        if (hash === loaded.hash) return
        loaded.models = models
        loaded.hash = hash
        yield* ctx.catalog.reload()
      })

      // Keep the last successful inventory through transient outages instead of flickering model availability.
      yield* refresh().pipe(Effect.ignore, Effect.repeat(Schedule.spaced(interval)), Effect.forkScoped)
    }),
  } satisfies PluginInternal.InternalPlugin)
}

export const LMStudioPlugin = make()
