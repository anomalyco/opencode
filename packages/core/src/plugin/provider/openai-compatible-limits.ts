import { createHash } from "node:crypto"
import { isRecord } from "@opencode/util/record"
import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Option, Schedule, Semaphore, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import type { Value as CredentialValue } from "@opencode/schema/credential"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { IntegrationConnection } from "../../integration/connection.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import { localProviderIDs } from "./local.js"

// Fill missing context limits for generic OpenAI-compatible providers from the
// provider's own `GET {baseURL}/models` advertisement.
//
// Custom models synthesized without a models.dev catalog entry carry the
// built-in placeholder limits, so auto-compaction fires against a guess
// instead of the real window. Catalog-backed models — bundled providers,
// config models inherited from a canonical catalog provider, integration
// models with their own cost rows, and providers a dedicated discovery
// plugin owns (LM Studio, Ollama, vLLM) — keep their real values and are
// neither probed nor filled.
//
// Auth for the probe, highest first: a configured `authorization` header, the
// provider's active connection credential (keys added via `opencode auth` or
// integrations live in connections and resolve at request time), then
// `settings.apiKey`.
//
// Precedence, highest first:
//   1. `limit` fields set in the config, applied by the config provider
//      transform registered after this plugin
//   2. limits already present from models.dev or dedicated discovery plugins
//   3. the provider's advertisement, filling placeholder fields only
//
// Fail-open: an unreachable, erroring, or malformed endpoint is skipped and
// keeps its previously discovered limits; discovery never blocks the catalog.
// Discovery runs at startup, whenever the catalog or the active credential
// changes, and on the schedule below, so failed endpoints retry once a
// minute and successes refresh at their TTL instead of waiting for a catalog
// change.

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
  readonly providerID: Provider.ID
  readonly baseURL: string
  // A configured authorization header outranks the connection credential and the settings key.
  readonly authorization?: string | undefined
  readonly apiKey?: string | undefined
}

type CacheEntry = {
  readonly at: number
  readonly ttl: number
  /** Fingerprint of the connection credential the cached fetch ran under; `""` when none was active. */
  readonly connection: string
  readonly value: Record<string, AdvertisedLimit>
}

// Shared across Locations so every catalog rebuild reuses one fetch per endpoint.
const cache = new Map<string, CacheEntry>()

const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 16)

// The key covers everything known synchronously: provider, URL, and the auth
// set directly in settings, so a rotated `apiKey` or `authorization` header
// never reuses the previous credential's result. The active connection's
// identity rides in the entry and is compared at discovery time.
const endpointKey = (endpoint: Endpoint) =>
  `${endpoint.providerID}\n${endpoint.baseURL}\n${
    endpoint.authorization ?? (endpoint.apiKey ? digest(endpoint.apiKey) : "")
  }`

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

// Models.dev entries carry a release date and cost rows; models synthesized
// from config or an integration without catalog backing do not.
const fromCatalog = (model: Model.Info) => model.time.released !== 0 || model.cost.length > 0

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

const fetchLimits = (http: HttpClient.HttpClient, baseURL: string, authorization: string | undefined) =>
  Effect.gen(function* () {
    const response = yield* http.execute(
      authorized(HttpClientRequest.get(`${baseURL.replace(/\/+$/, "")}/models`), authorization),
    )
    return parseModelLimits(yield* response.json)
  }).pipe(Effect.timeout(FETCH_TIMEOUT))

// The active connection credential materializes as a bearer token for this
// package; `external` credentials cannot, so they fall through to the
// settings key like a missing credential.
const bearerFrom = (credential: CredentialValue | undefined) => {
  if (!credential) return undefined
  if (credential.type === "key") return `Bearer ${credential.key}`
  if (credential.type === "oauth") return `Bearer ${credential.access}`
  return undefined
}

// An empty key is absent, matching local providers, so the probe sends no bare `Bearer ` header.
const bearerKey = (apiKey: string | undefined) => (apiKey ? `Bearer ${apiKey}` : undefined)

// Identifies which connection the cached fetch ran under. The connection's
// identity (not a rotating OAuth access token) keys the cache, plus the stored
// key value for key credentials, which can be edited in place under the same id.
const connectionFingerprint = (
  connection: Parameters<typeof IntegrationConnection.key>[0],
  credential: CredentialValue | undefined,
) => {
  const identity = IntegrationConnection.key(connection) ?? ""
  return credential?.type === "key" ? `${identity}:${digest(credential.key)}` : identity
}

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
        // A dedicated discovery plugin owns this provider's inventory and probes
        // its own endpoints; a second /models request here would be redundant.
        if (localProviderIDs.has(item.provider.id)) continue
        for (const [id, definition] of item.models) {
          if ((definition.package ?? item.provider.package) !== OPENAI_COMPATIBLE) continue
          if (fromCatalog(definition)) continue
          // Model edits cannot create providers, so this also skips unavailable ones.
          const current = models.get(item.provider.id, id)
          if (current === undefined) continue
          // The merged draft can inherit catalog values even when the provider
          // record still shows a synthesized model; either provenance wins.
          if (fromCatalog(current)) continue
          const settings = Provider.mergeOverlay(
            Provider.modelSettings(item.provider.settings),
            Provider.modelSettings(definition.settings),
          )
          const baseURL = settings?.baseURL
          if (typeof baseURL !== "string" || baseURL === "") continue
          const headers = Provider.mergeHeaders(item.provider.headers, definition.headers)
          const apiKey = typeof settings?.apiKey === "string" ? settings.apiKey : undefined
          const endpoint = {
            providerID: item.provider.id,
            baseURL,
            authorization:
              typeof headers?.authorization === "string" ? headers.authorization : undefined,
            apiKey,
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
          // Resolve the active connection first: an entry cached under a
          // different credential (for example after `opencode auth login`) is
          // stale no matter its TTL.
          const stale: Array<{
            endpoint: Endpoint
            connection: string
            authorization: string | undefined
          }> = []
          for (const endpoint of endpoints.values()) {
            const connection = yield* ctx.integration.connection
              .active(endpoint.providerID)
              .pipe(Effect.orElseSucceed(() => undefined))
            const credential = connection
              ? yield* ctx.integration.connection
                  .resolve(connection)
                  .pipe(Effect.orElseSucceed(() => undefined))
              : undefined
            const fingerprint = connectionFingerprint(connection, credential)
            const entry = cache.get(endpointKey(endpoint))
            if (entry !== undefined && Date.now() - entry.at < entry.ttl && entry.connection === fingerprint)
              continue
            stale.push({
              endpoint,
              connection: fingerprint,
              authorization:
                endpoint.authorization ?? bearerFrom(credential) ?? bearerKey(endpoint.apiKey),
            })
          }
          if (stale.length === 0) return
          const results = yield* Effect.all(
            stale.map((item) => Effect.option(fetchLimits(http, item.endpoint.baseURL, item.authorization))),
            { concurrency: "unbounded" },
          )
          let changed = false
          for (const [index, item] of stale.entries()) {
            const result = results[index]
            const key = endpointKey(item.endpoint)
            const previous = cache.get(key)
            if (Option.isNone(result)) {
              // Keep the last successful inventory through transient outages and retry soon.
              cache.set(key, {
                at: Date.now(),
                ttl: FAILURE_TTL_MS,
                connection: item.connection,
                value: previous?.value ?? {},
              })
              continue
            }
            cache.set(key, {
              at: Date.now(),
              ttl: CACHE_TTL_MS,
              connection: item.connection,
              value: result.value,
            })
            if (previous === undefined || !sameLimits(previous.value, result.value)) changed = true
          }
          if (changed) yield* ctx.model.reload()
        }),
      )
    })

    // Failed endpoints retry once a minute and successes refresh at their TTL,
    // on a schedule like the local provider plugins, instead of only when the
    // catalog changes.
    yield* discover().pipe(Effect.ignore, Effect.repeat(Schedule.spaced(FAILURE_TTL_MS)), Effect.forkScoped)
    yield* bus
      .subscribe([Model.Event.Updated])
      .pipe(
        Stream.runForEach(() => discover().pipe(Effect.ignore)),
        Effect.forkScoped({ startImmediately: true }),
      )
    // A credential switch can change what /models advertises; revalidate at
    // once instead of waiting out the cache TTL.
    yield* bus
      .subscribe(Credential.Event.Switched)
      .pipe(
        Stream.filter((event) =>
          [...endpoints.values()].some(
            (endpoint) => endpoint.providerID === Provider.ID.make(event.data.integrationID),
          ),
        ),
        Stream.runForEach(() => discover().pipe(Effect.ignore)),
        Effect.forkScoped({ startImmediately: true }),
      )
  }),
})

const sameLimits = (left: Record<string, AdvertisedLimit>, right: Record<string, AdvertisedLimit>) => {
  const ids = Object.keys(left)
  if (ids.length !== Object.keys(right).length) return false
  return ids.every((id) => {
    const a = left[id]
    const b = right[id]
    if (b === undefined) return false
    return a.context === b.context && a.input === b.input && a.output === b.output
  })
}
