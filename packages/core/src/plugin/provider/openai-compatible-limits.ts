import { Config } from "../../config"
import { Effect, Option } from "effect"
import { define } from "../internal"

/**
 * Fill missing context limits for custom OpenAI-compatible providers from the
 * provider's own `GET {baseURL}/models` advertisement.
 *
 * Custom `@ai-sdk/openai-compatible` providers are not in the models.dev
 * catalog, so without a manual `limit` in the config their models carry no
 * context window at all. Auto-compaction then never triggers and long
 * sessions grow until the upstream rejects them with `context_length_exceeded`.
 *
 * Most OpenAI-compatible servers (vLLM, LM Studio, LiteLLM, Ollama, OpenRouter,
 * …) advertise `context_length` / `max_input_tokens` / `max_output_tokens` per
 * model on `/models`. This plugin reads that once per provider and fills the
 * missing limit fields before the catalog is used.
 *
 * Precedence (highest wins):
 *   1. explicit `limit` in the user's config
 *   2. values already present from models.dev (never overwritten)
 *   3. the provider's advertisement (only fills empty fields)
 *
 * Fail-open: a provider that cannot be reached, errors, or returns malformed
 * data is skipped — discovery must never break startup.
 */

const FETCH_TIMEOUT_MS = 4_000
const CACHE_TTL_MS = 5 * 60_000
// Failed lookups are retried at most once per minute so an unreachable
// endpoint cannot slow every catalog rebuild by the full fetch timeout.
const FAILURE_TTL_MS = 60_000

export interface AdvertisedLimit {
  readonly context?: number
  readonly input?: number
  readonly output?: number
}

interface CacheEntry {
  readonly at: number
  readonly ttl: number
  readonly value: Record<string, AdvertisedLimit>
}

const cache = new Map<string, CacheEntry>()

function cachedModelLimits(
  key: string,
  load: () => Promise<Record<string, AdvertisedLimit>>,
): Promise<Record<string, AdvertisedLimit>> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < hit.ttl) return Promise.resolve(hit.value)
  return load().then(
    (value) => {
      cache.set(key, { at: Date.now(), ttl: CACHE_TTL_MS, value })
      return value
    },
    (error) => {
      // Negative cache: remember the failure briefly so catalog rebuilds do
      // not re-pay the fetch timeout for a dead endpoint.
      cache.set(key, { at: Date.now(), ttl: FAILURE_TTL_MS, value: {} })
      throw error
    },
  )
}

function positiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * Parse an OpenAI-compatible `/models` response body into per-model limits.
 * Unknown shapes are ignored — only well-formed entries are returned.
 */
export function parseModelLimits(body: unknown): Record<string, AdvertisedLimit> {
  if (!isRecord(body) || !Array.isArray(body.data)) return {}
  const out: Record<string, AdvertisedLimit> = {}
  for (const item of body.data) {
    if (!isRecord(item)) continue
    if (typeof item.id !== "string" || item.id === "") continue
    const limit: Record<string, number> = {}
    if (positiveInt(item.context_length)) limit.context = item.context_length
    if (positiveInt(item.max_input_tokens)) limit.input = item.max_input_tokens
    if (positiveInt(item.max_output_tokens)) limit.output = item.max_output_tokens
    if (Object.keys(limit).length > 0) out[item.id] = limit
  }
  return out
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/**
 * Fetch and parse `{baseURL}/models`. Throws on non-2xx or network failure so
 * callers can fail open per provider.
 */
export async function fetchModelLimits(input: {
  readonly baseURL: string
  readonly apiKey?: string | undefined
  readonly authorization?: string | undefined
  readonly fetchImpl?: FetchLike | undefined
}): Promise<Record<string, AdvertisedLimit>> {
  const url = `${input.baseURL.replace(/\/+$/, "")}/models`
  const headers: Record<string, string> = { accept: "application/json" }
  const authorization = input.authorization ?? (input.apiKey ? `Bearer ${input.apiKey}` : undefined)
  if (authorization) headers.authorization = authorization
  const doFetch = input.fetchImpl ?? fetch
  const res = await doFetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`GET ${url} responded ${res.status}`)
  return parseModelLimits(await res.json())
}

/**
 * Merge one advertised limit into a model's current limit. A field is filled
 * only when the advertisement has it, the current value is empty (0 or
 * undefined), and the user did not set that field explicitly in the config.
 * `explicit` holds the per-model field names configured by the user.
 */
export function mergeAdvertisedLimit(input: {
  readonly current: { context: number; input?: number | undefined; output: number }
  readonly advertised: AdvertisedLimit
  readonly explicit: ReadonlySet<"context" | "input" | "output">
  readonly keys: readonly ("context" | "input" | "output")[]
}): { context: number; input?: number | undefined; output: number } | undefined {
  const next: { context: number; input?: number | undefined; output: number } = { ...input.current }
  let changed = false
  for (const key of input.keys) {
    const value = input.advertised[key]
    if (!positiveInt(value)) continue
    if (input.explicit.has(key)) continue
    if (positiveInt(input.current[key])) continue
    next[key] = value
    changed = true
  }
  return changed ? next : undefined
}

export const OpenAICompatibleLimitsPlugin = define({
  id: "openai-compatible-limits",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    yield* ctx.catalog.transform(
      Effect.fn(function* (catalog) {
        const entries = yield* config.entries()
        const documents = entries.filter((entry): entry is Config.Document => entry.type === "document")

        // Fields the user set explicitly in the config always win, regardless
        // of transform ordering (the config-provider transform merges config
        // limits into the same catalog).
        const explicit = new Set<string>()
        for (const document of documents) {
          for (const [providerID, provider] of Object.entries(document.info.providers ?? {})) {
            for (const [modelID, model] of Object.entries(provider.models ?? {})) {
              for (const key of ["context", "input", "output"] as const) {
                if (model.limit?.[key] !== undefined) explicit.add(`${providerID}/${modelID}/${key}`)
              }
            }
          }
        }

        for (const provider of catalog.provider.list()) {
          // Group fetches by endpoint credentials; models of one provider may
          // point at different baseURLs through per-model `api` overrides.
          const groups = new Map<
            string,
            {
              readonly baseURL: string
              readonly apiKey?: string | undefined
              readonly authorization?: string | undefined
              readonly models: string[]
            }
          >()

          for (const [modelID, model] of provider.models) {
            const api = model.api
            if (api.type !== "aisdk" || api.package !== "@ai-sdk/openai-compatible") continue
            const settings = isRecord(api.settings) ? api.settings : {}
            const baseURL = typeof settings.baseURL === "string" ? settings.baseURL : api.url
            if (!baseURL) continue
            const apiKey = typeof settings.apiKey === "string" ? settings.apiKey : undefined
            const headers = isRecord(settings.headers) ? settings.headers : {}
            const authorization =
              typeof headers.Authorization === "string"
                ? headers.Authorization
                : typeof headers.authorization === "string"
                  ? headers.authorization
                  : undefined
            const key = `${baseURL}\n${apiKey ?? ""}\n${authorization ?? ""}`
            const group = groups.get(key)
            if (group) {
              group.models.push(modelID)
            } else {
              groups.set(key, { baseURL, apiKey, authorization, models: [modelID] })
            }
          }

          // Fetch every endpoint of this provider in parallel; each lookup
          // fails open on its own.
          const endpoints = [...groups.values()]
          const results = yield* Effect.all(
            endpoints.map((group) =>
              Effect.tryPromise(() =>
                cachedModelLimits(`${group.baseURL}\n${group.apiKey ?? ""}\n${group.authorization ?? ""}`, () =>
                  fetchModelLimits(group),
                ),
              ).pipe(Effect.option),
            ),
            { concurrency: "unbounded" },
          )
          for (const [index, group] of endpoints.entries()) {
            const limits = results[index]
            if (Option.isNone(limits)) {
              yield* Effect.logDebug("openai-compatible-limits: discovery failed, skipping provider endpoint", {
                baseURL: group.baseURL,
              })
              continue
            }
            for (const modelID of group.models) {
              const advertised = limits.value[modelID]
              if (advertised === undefined) continue
              const explicitFields = new Set(
                (["context", "input", "output"] as const).filter((key) =>
                  explicit.has(`${provider.provider.id}/${modelID}/${key}`),
                ),
              )
              catalog.model.update(provider.provider.id, modelID, (model) => {
                const merged = mergeAdvertisedLimit({
                  current: model.limit,
                  advertised,
                  explicit: explicitFields,
                  keys: ["context", "input", "output"],
                })
                if (merged !== undefined) model.limit = merged
              })
            }
          }
        }
      }),
    )
  }),
})
