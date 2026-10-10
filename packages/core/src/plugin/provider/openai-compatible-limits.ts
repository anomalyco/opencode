import { isRecord } from "@opencode/ai/utils/record"
import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Option, Semaphore, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { Bus } from "../../bus.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"

// Fill missing context limits for generic OpenAI-compatible providers from the
// provider's own `GET {baseURL}/models` advertisement.
//
// Custom providers on this package are not in the models.dev catalog, so their
// models carry the built-in placeholder limits and auto-compaction fires
// against a guess instead of the real window. Servers commonly publish
// `context_length` / `max_input_tokens` / `max_output_tokens` per model on
// `/models`; discovery fills the placeholder fields from that response.
//
// Precedence, highest first:
//   1. `limit` fields set in the config, applied by the config provider
//      transform registered after this plugin
//   2. limits already present from models.dev or dedicated discovery plugins
//   3. the provider's advertisement, filling placeholder fields only
//
// Fail-open: an unreachable, erroring, or malformed endpoint is skipped and
// keeps its previously discovered limits; discovery never blocks the catalog.

const FETCH_TIMEOUT = "4 seconds"
const CACHE_TTL_MS = 5 * 60_000
// Failed lookups retry at most once per minute so a dead endpoint cannot slow
// every catalog rebuild behind the fetch timeout.
const FAILURE_TTL_MS = 60_000
const OPENAI_COMPATIBLE = "@opencode/ai/providers/openai-compatible"

export interface AdvertisedLimit {
  readonly context?: number | undefined
  readonly input?: number | undefined
  readonly output?: number | undefined
}

type Endpoint = {
  readonly baseURL: string
  readonly authorization?: string | undefined
}

type CacheEntry = {
  readonly at: number
  readonly ttl: number
  readonly value: Record<string, AdvertisedLimit>
}

// Shared across Locations so every catalog rebuild reuses one fetch per endpoint.
const cache = new Map<string, CacheEntry>()

const endpointKey = (endpoint: Endpoint) => `${endpoint.baseURL}\n${endpoint.authorization ?? ""}`

const freshEntry = (endpoint: Endpoint) => {
  const entry = cache.get(endpointKey(endpoint))
  return entry !== undefined && Date.now() - entry.at < entry.ttl ? entry : undefined
}

// Model.Info's built-in limits are placeholders from catalog creation, not
// measured values, so an advertisement may replace them per field.
const placeholders: Model.Info["limit"] = Model.Info.default(
  Provider.ID.make("placeholder"),
  Model.ID.make("placeholder"),
).limit

function positiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}

/**
 * Parse an OpenAI-compatible `/models` response body into per-model limits.
 * Unknown shapes are ignored; only well-formed entries are returned.
 */
export function parseModelLimits(body: unknown): Record<string, AdvertisedLimit> {
  if (!isRecord(body) || !Array.isArray(body.data)) return {}
  return Object.fromEntries(
    body.data.flatMap((item) => {
      if (!isRecord(item) || typeof item.id !== "string" || item.id === "") return []
      const limit = {
        ...(positiveInt(item.context_length) ? { context: item.context_length } : {}),
        ...(positiveInt(item.max_input_tokens) ? { input: item.max_input_tokens } : {}),
        ...(positiveInt(item.max_output_tokens) ? { output: item.max_output_tokens } : {}),
      }
      return Object.keys(limit).length === 0 ? [] : [[item.id, limit] as const]
    }),
  )
}

/**
 * Merge one advertised limit into a model's current limit. A field is filled
 * only when the advertisement has it and the current value is absent, zero, or
 * the built-in placeholder.
 */
export function mergeAdvertisedLimit(
  current: Model.Info["limit"],
  advertised: AdvertisedLimit,
): Model.Info["limit"] | undefined {
  const next = { ...current }
  let changed = false
  for (const key of ["context", "input", "output"] as const) {
    const value = advertised[key]
    if (!positiveInt(value)) continue
    const existing = current[key]
    if (existing !== undefined && existing !== 0 && existing !== placeholders[key]) continue
    next[key] = value
    changed = true
  }
  return changed ? next : undefined
}

const authorized = (request: HttpClientRequest.HttpClientRequest, authorization: string | undefined) =>
  authorization === undefined
    ? request.pipe(HttpClientRequest.acceptJson)
    : request.pipe(HttpClientRequest.acceptJson, HttpClientRequest.setHeader("authorization", authorization))

const fetchLimits = (http: HttpClient.HttpClient, endpoint: Endpoint) =>
  Effect.gen(function* () {
    const response = yield* http.execute(
      authorized(HttpClientRequest.get(`${endpoint.baseURL.replace(/\/+$/, "")}/models`), endpoint.authorization),
    )
    return parseModelLimits(yield* response.json)
  }).pipe(Effect.timeout(FETCH_TIMEOUT))

export const OpenAICompatibleLimitsPlugin = define({
  id: "opencode.provider.openai-compatible-limits",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
    const endpoints = new Map<string, Endpoint>()
    const lock = Semaphore.makeUnsafe(1)

    yield* ctx.model.transform((models) => {
      endpoints.clear()
      for (const item of models.provider.list()) {
        for (const [id, definition] of item.models) {
          if ((definition.package ?? item.provider.package) !== OPENAI_COMPATIBLE) continue
          // Model edits cannot create providers, so this also skips unavailable ones.
          if (models.get(item.provider.id, id) === undefined) continue
          const settings = Provider.mergeOverlay(
            Provider.modelSettings(item.provider.settings),
            Provider.modelSettings(definition.settings),
          )
          const baseURL = settings?.baseURL
          if (typeof baseURL !== "string" || baseURL === "") continue
          const headers = Provider.mergeHeaders(item.provider.headers, definition.headers)
          const apiKey = typeof settings?.apiKey === "string" ? settings.apiKey : undefined
          const endpoint = {
            baseURL,
            authorization:
              (typeof headers?.authorization === "string" ? headers.authorization : undefined) ??
              (apiKey === undefined ? undefined : `Bearer ${apiKey}`),
          }
          endpoints.set(endpointKey(endpoint), endpoint)
          const advertised = freshEntry(endpoint)?.value[definition.modelID ?? id]
          if (advertised === undefined) continue
          models.update(item.provider.id, id, (model) => {
            const merged = mergeAdvertisedLimit(model.limit, advertised)
            if (merged !== undefined) model.limit = merged
          })
        }
      }
    })

    // Transforms are synchronous, so discovery runs beside the catalog and
    // reloads it once new limits land.
    const discover = Effect.fn("OpenAICompatibleLimits.discover")(function* () {
      yield* lock.withPermit(
        Effect.gen(function* () {
          const stale = [...endpoints.values()].filter((endpoint) => freshEntry(endpoint) === undefined)
          const results = yield* Effect.all(
            stale.map((endpoint) => Effect.option(fetchLimits(http, endpoint))),
            { concurrency: "unbounded" },
          )
          let changed = false
          for (const [index, endpoint] of stale.entries()) {
            const result = results[index]
            const previous = cache.get(endpointKey(endpoint))
            if (Option.isNone(result)) {
              // Keep the last successful inventory through transient outages and retry soon.
              cache.set(endpointKey(endpoint), {
                at: Date.now(),
                ttl: FAILURE_TTL_MS,
                value: previous?.value ?? {},
              })
              continue
            }
            cache.set(endpointKey(endpoint), { at: Date.now(), ttl: CACHE_TTL_MS, value: result.value })
            changed = true
          }
          if (changed) yield* ctx.model.reload()
        }),
      )
    })

    yield* discover().pipe(Effect.ignore, Effect.forkScoped)
    yield* bus
      .subscribe([Model.Event.Updated])
      .pipe(
        Stream.runForEach(() => discover().pipe(Effect.ignore)),
        Effect.forkScoped({ startImmediately: true }),
      )
  }),
})
