import { define } from "@opencode/plugin/effect/plugin"
import type { Entry } from "@opencode/schema/config"
import { ConfigProvider } from "@opencode/schema/config/provider"
import { NonNegativeInt, PositiveInt } from "@opencode/schema/schema"
import { Duration, Effect, Schedule, Schema, Semaphore, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Config } from "../../config.js"
import { Integration } from "../../integration.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import { Variant } from "../../variant.js"
import type { PluginInternal } from "../internal.js"

const optional = <S extends Schema.Top>(schema: S) => Schema.NullOr(schema).pipe(Schema.optional)
const RemoteModel = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/\S/)),
  context_window: optional(NonNegativeInt),
  max_input_tokens: optional(NonNegativeInt),
  max_output_tokens: optional(NonNegativeInt),
  supported_endpoints: optional(Schema.Array(Schema.String)),
  supports_function_calling: optional(Schema.Boolean),
  supports_parallel_function_calling: optional(Schema.Boolean),
  supports_reasoning: optional(Schema.Boolean),
  reasoning_effort_levels: optional(Schema.Array(Schema.String)),
  default_reasoning_effort: optional(Schema.String),
  supported_modalities: optional(Schema.Array(Schema.String)),
  supported_output_modalities: optional(Schema.Array(Schema.String)),
  request_defaults: optional(
    Schema.Struct({
      output_token_budget: optional(PositiveInt),
      output_token_budget_by_reasoning_effort: optional(Schema.Record(Schema.String, PositiveInt)),
    }),
  ),
})
const Response = Schema.Struct({ data: Schema.Array(RemoteModel) })

/** Explicitly opt in for OpenAI-compatible gateways; ordinary providers keep their existing catalog. */
export function make(interval: Duration.Input = "30 seconds") {
  return define({
    id: "opencode.provider.model-discovery",
    effect: Effect.fn(function* (ctx) {
      const config = yield* Config.Service
      const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
      const loaded = new Map<
        string,
        { source: ConfigProvider.Info; apiKey?: string; models: readonly (typeof RemoteModel.Type)[] }
      >()
      const settings = { current: configured(yield* config.entries()) }
      const generations = new Map<string, number>()
      const attempts = new Map<string, { signature: string; pending: boolean; run: Effect.Effect<void> }>()
      const loading = Semaphore.makeUnsafe(1)

      yield* ctx.provider.transform((providers) => {
        for (const [id, result] of loaded) {
          const available = new Set(result.models.map((model) => model.id))
          for (const model of providers.get(Provider.ID.make(id))?.models.values() ?? []) {
            if (!available.has(model.id)) providers.models.remove(Provider.ID.make(id), model.id)
          }
          providers.update(Provider.ID.make(id), (provider) => {
            if (!provider.package) provider.package = "@opencode/ai/providers/openai-compatible"
            provider.activation = "enabled"
          })
          for (const item of result.models) {
            providers.models.update(Provider.ID.make(id), Model.ID.make(item.id), (model) => {
              // New models have no authoritative limits until the gateway supplies them.
              if (!providers.get(Provider.ID.make(id))?.models.has(Model.ID.make(item.id)))
                model.limit = { context: 0, output: 0 }
              if (item.context_window !== undefined && item.context_window !== null)
                model.limit.context = item.context_window
              if (item.max_input_tokens !== undefined && item.max_input_tokens !== null)
                model.limit.input = item.max_input_tokens
              if (item.max_output_tokens !== undefined && item.max_output_tokens !== null)
                model.limit.output = item.max_output_tokens
              if (item.request_defaults != null)
                model.requestDefaults = {
                  ...model.requestDefaults,
                  ...(item.request_defaults.output_token_budget != null
                    ? { outputTokenBudget: item.request_defaults.output_token_budget }
                    : {}),
                  ...(item.request_defaults.output_token_budget_by_reasoning_effort != null
                    ? {
                        outputTokenBudgetByReasoningEffort: {
                          ...item.request_defaults.output_token_budget_by_reasoning_effort,
                        },
                      }
                    : {}),
                }
              if (item.supports_function_calling != null) model.capabilities.tools = item.supports_function_calling
              if (item.supports_parallel_function_calling != null)
                model.capabilities.parallelTools = item.supports_parallel_function_calling
              if (item.supports_reasoning != null) model.capabilities.reasoning = item.supports_reasoning
              if (item.supported_endpoints != null) model.capabilities.endpoints = [...item.supported_endpoints]
              if (item.supported_modalities != null) model.capabilities.input = [...item.supported_modalities]
              if (item.supported_output_modalities != null)
                model.capabilities.output = [...item.supported_output_modalities]
              const endpoints = item.supported_endpoints?.map((endpoint) => endpoint.replace(/^\/v1\//, "/"))
              const configuredPackage = result.source.models?.[item.id]?.package ?? result.source.package
              if (configuredPackage !== undefined) model.package = configuredPackage
              if (configuredPackage === undefined && endpoints != null) {
                if (endpoints.includes("/responses")) model.package = "@opencode/ai/providers/openai/responses"
                if (!endpoints.includes("/responses") && endpoints.includes("/chat/completions"))
                  model.package = "@opencode/ai/providers/openai-compatible"
                if (!endpoints.includes("/responses") && !endpoints.includes("/chat/completions")) model.enabled = false
              }
              if (item.supports_reasoning === false) {
                model.variants = []
                if (model.settings) delete model.settings.reasoningEffort
              }
              if (item.supports_reasoning !== false && item.reasoning_effort_levels != null)
                model.variants = [
                  ...Variant.resolve(
                    { ...model, package: model.package ?? providers.get(model.providerID)?.provider.package },
                    [{ type: "effort", values: item.reasoning_effort_levels }],
                  ),
                ]
              if (
                item.supports_reasoning !== false &&
                item.default_reasoning_effort != null &&
                (item.reasoning_effort_levels == null ||
                  item.reasoning_effort_levels.includes(item.default_reasoning_effort))
              )
                model.settings = Provider.mergeOverlay(model.settings, {
                  reasoningEffort: item.default_reasoning_effort,
                })
            })
          }
        }
      })

      yield* ctx.model.transform((models) => {
        models.filter((model) => {
          const catalog = loaded.get(model.providerID)
          return catalog === undefined || catalog.models.some((item) => item.id === model.id)
        })
      })

      const refresh = Effect.fn("ModelDiscovery.refresh")(function* (force = false) {
        const next = configured(yield* config.entries())
        for (const [id, source] of next) {
          const previous = settings.current.get(id)
          if (JSON.stringify(previous) === JSON.stringify(source) && previous) next.set(id, previous)
        }
        settings.current = next
        for (const id of attempts.keys()) if (!next.has(id)) attempts.delete(id)
        for (const [id, result] of loaded) {
          if (JSON.stringify(next.get(id)) === JSON.stringify(result.source)) continue
          loaded.delete(id)
          attempts.delete(id)
          yield* ctx.provider.reload()
        }
        yield* Effect.forEach(
          settings.current,
          ([id, source]) =>
            Effect.gen(function* () {
              const baseURL = source.settings?.baseURL
              if (typeof baseURL !== "string" || !URL.canParse(baseURL)) return
              const endpoint = new URL(baseURL)
              if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") return
              endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/models`
              endpoint.search = ""
              endpoint.hash = ""
              const connection = yield* ctx.integration.connection.active(Integration.ID.make(id))
              const active = connection ? yield* ctx.integration.connection.resolve(connection) : undefined
              // Configured environment methods may not be registered during plugin startup yet.
              const credential =
                active ??
                (yield* Effect.forEach(source.env ?? [], (name) =>
                  ctx.integration.connection.resolve({ type: "env", name }),
                )).find((credential) => credential !== undefined)
              const apiKey =
                typeof source.settings?.apiKey === "string"
                  ? source.settings.apiKey
                  : credential?.type === "key"
                    ? credential.key
                    : undefined
              if (settings.current.get(id) !== source) return
              const signature = JSON.stringify([source, apiKey])
              const run = yield* loading.withPermit(
                Effect.gen(function* () {
                  const previous = attempts.get(id)
                  if (previous?.signature === signature && (!force || previous.pending)) return previous.run
                  const generation = (generations.get(id) ?? 0) + 1
                  generations.set(id, generation)
                  const attempt = { signature, pending: true, run: Effect.void }
                  attempt.run = yield* Effect.cached(
                    Effect.gen(function* () {
                      if (loaded.has(id) && loaded.get(id)?.apiKey !== apiKey) {
                        loaded.delete(id)
                        yield* ctx.provider.reload()
                      }
                      const request = HttpClientRequest.get(endpoint.toString()).pipe(
                        HttpClientRequest.acceptJson,
                        HttpClientRequest.setHeaders(source.headers ?? {}),
                      )
                      const response = yield* http
                        .execute(apiKey ? HttpClientRequest.bearerToken(request, apiKey) : request)
                        .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Response)), Effect.timeout("5 seconds"))
                      if (settings.current.get(id) !== source || generations.get(id) !== generation) return
                      const models = response.data
                      if (new Set(models.map((model) => model.id)).size !== models.length) return
                      if (JSON.stringify(loaded.get(id)?.models) === JSON.stringify(models)) return
                      loaded.set(id, { source, apiKey, models })
                      yield* ctx.provider.reload()
                    }).pipe(
                      Effect.catchCause(() =>
                        Effect.logWarning("Model discovery failed; retaining the last valid inventory", {
                          providerID: id,
                        }),
                      ),
                      Effect.ensuring(
                        Effect.sync(() => {
                          attempt.pending = false
                        }),
                      ),
                    ),
                  )
                  attempts.set(id, attempt)
                  return attempt.run
                }),
              )
              yield* run
            }).pipe(
              Effect.catchCause(() =>
                Effect.logWarning("Model discovery failed; retaining the last valid inventory", { providerID: id }),
              ),
            ),
          { discard: true },
        )
      })
      // Preserve the last valid metadata during transient errors. A changed configuration starts a new catalog.
      yield* refresh()
      yield* ctx.model.beforeRead(refresh())
      yield* Effect.sleep(interval).pipe(
        Effect.andThen(refresh(true)),
        Effect.repeat(Schedule.spaced(interval)),
        Effect.forkScoped,
      )
      const bus = yield* Bus.Service
      yield* bus.subscribe([Credential.Event.Updated, Credential.Event.Switched]).pipe(
        Stream.runForEach(() => refresh()),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* ctx.event.subscribe().pipe(
        Stream.filter((event) => event.type === "config.updated" || event.type === "integration.updated"),
        Stream.runForEach(() => refresh()),
        Effect.forkScoped({ startImmediately: true }),
      )
    }),
  } satisfies PluginInternal.InternalPlugin)
}

export const ModelDiscoveryPlugin = make()

function configured(entries: readonly Entry[]) {
  const providers = new Map<string, ConfigProvider.Info>()
  for (const entry of entries) {
    if (entry.type !== "document") continue
    for (const [id, value] of Object.entries(entry.info.providers ?? {})) {
      const previous = providers.get(id)
      providers.set(id, {
        ...previous,
        ...value,
        settings: Provider.mergeOverlay(previous?.settings, value.settings),
        headers: Provider.mergeHeaders(previous?.headers, value.headers),
        models: {
          ...previous?.models,
          ...Object.fromEntries(
            Object.entries(value.models ?? {}).map(([id, model]) => [id, { ...previous?.models?.[id], ...model }]),
          ),
        },
      })
    }
  }
  return new Map([...providers].filter(([, provider]) => provider.settings?.modelDiscovery === true))
}
