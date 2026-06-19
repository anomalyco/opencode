import path from "path"
import { Context, Duration, Effect, Layer, Option, Schedule, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Global } from "./global"
import { Flag } from "./flag/flag"
import { Flock } from "./util/flock"
import { Hash } from "./util/hash"
import { FSUtil } from "./fs-util"
import { InstallationChannel, InstallationVersion } from "./installation/version"
import { EventV2 } from "./event"
import { LayerNode } from "./effect/layer-node"
import { httpClient } from "./effect/layer-node-platform"

export const CatalogModelStatus = Schema.Literals(["alpha", "beta", "deprecated"])
export type CatalogModelStatus = typeof CatalogModelStatus.Type

const USER_AGENT = `opencode/${InstallationChannel}/${InstallationVersion}/${Flag.OPENCODE_CLIENT}`

const CostTier = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cache_read: Schema.optional(Schema.Finite),
  cache_write: Schema.optional(Schema.Finite),
  tier: Schema.Struct({
    type: Schema.Literal("context"),
    size: Schema.Finite,
  }),
})

const Cost = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cache_read: Schema.optional(Schema.Finite),
  cache_write: Schema.optional(Schema.Finite),
  tiers: Schema.optional(Schema.Array(CostTier)),
  context_over_200k: Schema.optional(
    Schema.Struct({
      input: Schema.Finite,
      output: Schema.Finite,
      cache_read: Schema.optional(Schema.Finite),
      cache_write: Schema.optional(Schema.Finite),
    }),
  ),
})

export const Model = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  family: Schema.optional(Schema.String),
  release_date: Schema.String,
  attachment: Schema.Boolean,
  reasoning: Schema.Boolean,
  temperature: Schema.Boolean,
  tool_call: Schema.Boolean,
  interleaved: Schema.optional(
    Schema.Union([
      Schema.Literal(true),
      Schema.Struct({
        field: Schema.Literals(["reasoning", "reasoning_content", "reasoning_details"]),
      }),
    ]),
  ),
  cost: Schema.optional(Cost),
  limit: Schema.Struct({
    context: Schema.Finite,
    input: Schema.optional(Schema.Finite),
    output: Schema.Finite,
  }),
  modalities: Schema.optional(
    Schema.Struct({
      input: Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])),
      output: Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])),
    }),
  ),
  experimental: Schema.optional(
    Schema.Struct({
      modes: Schema.optional(
        Schema.Record(
          Schema.String,
          Schema.Struct({
            cost: Schema.optional(Cost),
            provider: Schema.optional(
              Schema.Struct({
                body: Schema.optional(Schema.Record(Schema.String, Schema.MutableJson)),
                headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
              }),
            ),
          }),
        ),
      ),
    }),
  ),
  status: Schema.optional(CatalogModelStatus),
  provider: Schema.optional(
    Schema.Struct({ npm: Schema.optional(Schema.String), api: Schema.optional(Schema.String) }),
  ),
})
export type Model = Schema.Schema.Type<typeof Model>

export const Provider = Schema.Struct({
  api: Schema.optional(Schema.String),
  name: Schema.String,
  env: Schema.Array(Schema.String),
  id: Schema.String,
  npm: Schema.optional(Schema.String),
  models: Schema.Record(Schema.String, Model),
})

export type Provider = Schema.Schema.Type<typeof Provider>

// --- Mammouth AI dynamic model catalog (fork) ---
// The Mammouth API exposes its available models at /public/model/info; we fetch
// and fold them into the models.dev catalog under a synthetic "mammouth-ai"
// provider so the rest of the provider system treats them like any other.
const MAMMOUTH_API_BASE = "https://api.mammouth.ai"

const ALLOWED_MODEL_FAMILIES = [
  "claude",
  "gpt",
  "o4",
  "gemini",
  "mistral",
  "codestral",
  "deepseek",
  "grok",
  "llama",
  "kimi",
  "qwen",
  "glm",
  "minimax",
]

function isAllowedModel(name: string): boolean {
  const lower = name.toLowerCase()
  return ALLOWED_MODEL_FAMILIES.some((family) => lower.startsWith(family))
}

function capitalize(word: string): string {
  return word ? word[0].toUpperCase() + word.slice(1) : word
}

function humanizeModelName(name: string): string {
  const parts = name.split(/[-_]+/)
  if (parts.length === 0) return name

  const DIGITS_ONLY = /^\d+$/
  const VERSION_PART = /^\d+(\.\d+)*$/
  const isDateSuffix = (p: string) => p.length === 8 && p.startsWith("20") && DIGITS_ONLY.test(p)

  if (parts[0].toLowerCase() === "claude") {
    const filtered = parts.filter((p) => !isDateSuffix(p))
    if (DIGITS_ONLY.test(filtered[1] ?? "")) {
      const versionParts: string[] = []
      let idx = 1
      while (idx < filtered.length && DIGITS_ONLY.test(filtered[idx])) {
        versionParts.push(filtered[idx])
        idx++
      }
      const version = versionParts.join(".")
      const modelType = capitalize(filtered[idx] ?? "")
      return `Claude ${version} ${modelType}`.trim()
    }
    const modelType = capitalize(filtered[1] ?? "")
    const versionParts = filtered.slice(2).filter((p) => VERSION_PART.test(p))
    return versionParts.length > 0 ? `Claude ${modelType} ${versionParts.join(".")}` : `Claude ${modelType}`
  }

  const specialCases: Record<string, string> = { gpt: "GPT", o4: "o4" }
  return parts.map((p) => specialCases[p.toLowerCase()] ?? capitalize(p)).join(" ")
}

function transformApiResponse(data: any): Model[] {
  if (!data?.data || !Array.isArray(data.data)) return []

  return data.data
    .filter((item: any) => isAllowedModel(item.model_name || ""))
    .map((item: any): Model => {
      const info = item.model_info || {}
      const inputModalities: ("text" | "audio" | "image" | "video" | "pdf")[] = ["text"]
      const outputModalities: ("text" | "audio" | "image" | "video" | "pdf")[] = ["text"]

      if (info.supports_vision) inputModalities.push("image")
      if (info.supports_pdf_input) inputModalities.push("pdf")
      if (info.supports_audio_input) inputModalities.push("audio")
      if (info.supports_audio_output) outputModalities.push("audio")

      return {
        id: info.key || item.model_name,
        name: humanizeModelName(item.model_name || ""),
        family: info.litellm_provider ?? undefined,
        release_date: "",
        attachment: info.supports_vision || info.supports_pdf_input || false,
        reasoning: info.supports_reasoning || false,
        temperature: true,
        tool_call: info.supports_function_calling || info.supports_tool_choice || false,
        cost: {
          input: (info.input_cost_per_token || 0) * 1_000_000,
          output: (info.output_cost_per_token || 0) * 1_000_000,
          cache_read: (info.cache_read_input_token_cost || 0) * 1_000_000,
          cache_write: (info.cache_creation_input_token_cost || 0) * 1_000_000,
        },
        limit: {
          context: (info.max_input_tokens || 0) + (info.max_output_tokens || 0),
          input: info.max_input_tokens ?? undefined,
          output: info.max_output_tokens || 0,
        },
        modalities: {
          input: inputModalities,
          output: outputModalities,
        },
      }
    })
}

export const MAMMOUTH_PROVIDER: Provider = {
  id: "mammouth-ai",
  name: "Mammouth AI",
  api: `${MAMMOUTH_API_BASE}/v1`,
  npm: "@ai-sdk/openai-compatible",
  env: ["MAMMOUTH_API_KEY"],
  models: {},
}

const fetchMammouthModels = Effect.tryPromise(async () => {
  const response = await fetch(`${MAMMOUTH_API_BASE}/public/model/info`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) return [] as Model[]
  return transformApiResponse(await response.json())
}).pipe(Effect.catch(() => Effect.succeed([] as Model[])))

const withMammouthProvider = (base: Record<string, Provider>): Effect.Effect<Record<string, Provider>> =>
  Flag.OPENCODE_DISABLE_MODELS_FETCH
    ? Effect.succeed({ ...base, [MAMMOUTH_PROVIDER.id]: { ...MAMMOUTH_PROVIDER } })
    : fetchMammouthModels.pipe(
        Effect.map((models) => ({
          ...base,
          [MAMMOUTH_PROVIDER.id]: {
            ...MAMMOUTH_PROVIDER,
            models: Object.fromEntries(models.map((m) => [m.id, m])),
          },
        })),
      )

export const Event = {
  Refreshed: EventV2.define({
    type: "models-dev.refreshed",
    schema: {},
  }),
}

declare const OPENCODE_MODELS_DEV: Record<string, Provider> | undefined

export interface Interface {
  readonly get: () => Effect.Effect<Record<string, Provider>>
  readonly refresh: (force?: boolean) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ModelsDev") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const events = yield* EventV2.Service
    const http = HttpClient.filterStatusOk(
      (yield* HttpClient.HttpClient).pipe(
        HttpClient.retryTransient({
          retryOn: "errors-and-responses",
          times: 2,
          schedule: Schedule.exponential(200).pipe(Schedule.jittered),
        }),
      ),
    )

    const source = Flag.OPENCODE_MODELS_URL || "https://models.dev"
    const filepath = path.join(
      Global.Path.cache,
      source === "https://models.dev" ? "models.json" : `models-${Hash.fast(source)}.json`,
    )
    const ttl = Duration.minutes(5)
    const lockKey = `models-dev:${filepath}`

    const fresh = Effect.fnUntraced(function* () {
      const stat = yield* fs.stat(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!stat) return false
      const mtime = Option.getOrElse(stat.mtime, () => new Date(0)).getTime()
      return Date.now() - mtime < Duration.toMillis(ttl)
    })

    const fetchApi = Effect.fn("ModelsDev.fetchApi")(function* () {
      return yield* HttpClientRequest.get(`${source}/api.json`).pipe(
        HttpClientRequest.setHeader("User-Agent", USER_AGENT),
        http.execute,
        Effect.flatMap((res) => res.text),
        Effect.timeout("10 seconds"),
      )
    })

    const loadFromDisk = fs.readJson(Flag.OPENCODE_MODELS_PATH ?? filepath).pipe(
      Effect.catch((error) => {
        if (
          Flag.OPENCODE_MODELS_PATH === undefined &&
          error._tag === "FileSystemError" &&
          error.method === "readJson"
        ) {
          return fs.remove(filepath, { force: true }).pipe(Effect.ignore, Effect.as(undefined))
        }
        return Effect.succeed(undefined)
      }),
      Effect.map((v) => v as Record<string, Provider> | undefined),
    )

    const loadSnapshot = Effect.sync(() =>
      typeof OPENCODE_MODELS_DEV === "undefined" ? undefined : OPENCODE_MODELS_DEV,
    )

    const fetchAndWrite = Effect.fn("ModelsDev.fetchAndWrite")(function* () {
      const text = yield* fetchApi()
      const tempfile = `${filepath}.${process.pid}.${Date.now()}.tmp`
      yield* fs.writeWithDirs(tempfile, text).pipe(
        Effect.andThen(fs.rename(tempfile, filepath)),
        Effect.catch((error) =>
          Effect.gen(function* () {
            yield* fs.remove(tempfile, { force: true }).pipe(Effect.ignore)
            return yield* Effect.fail(error)
          }),
        ),
      )
      return text
    })

    const populate = Effect.gen(function* () {
      const fromDisk = yield* loadFromDisk
      if (fromDisk) return fromDisk
      const snapshot = yield* loadSnapshot
      if (snapshot) return snapshot
      if (Flag.OPENCODE_DISABLE_MODELS_FETCH) return {}
      // Flock is cross-process: concurrent opencode CLIs can race on this cache file.
      const text = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Flock.effect(lockKey)
          return yield* fetchAndWrite()
        }),
      )
      return JSON.parse(text) as Record<string, Provider>
    }).pipe(Effect.withSpan("ModelsDev.populate"), Effect.flatMap(withMammouthProvider), Effect.orDie)

    const [cachedGet, invalidate] = yield* Effect.cachedInvalidateWithTTL(populate, Duration.infinity)

    const get = (): Effect.Effect<Record<string, Provider>> => cachedGet

    const refresh = Effect.fn("ModelsDev.refresh")(function* (force = false) {
      if (!force && (yield* fresh())) return
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Flock.effect(lockKey)
          // Re-check under the lock: another process may have refreshed between
          // our outer check and lock acquisition.
          if (!force && (yield* fresh())) return
          yield* fetchAndWrite()
          yield* invalidate
          yield* events.publish(Event.Refreshed, {})
        }),
      ).pipe(
        Effect.tapCause((cause) => Effect.logError("Failed to fetch models.dev", { cause: cause })),
        Effect.ignore,
      )
    })

    if (!Flag.OPENCODE_DISABLE_MODELS_FETCH && !process.argv.includes("--get-yargs-completions")) {
      // Schedule.spaced runs the effect once, then waits between completions.
      yield* Effect.forkScoped(refresh().pipe(Effect.repeat(Schedule.spaced("60 minutes")), Effect.ignore))
    }

    return Service.of({ get, refresh })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(EventV2.defaultLayer),
)
export const node = LayerNode.make(layer, [FSUtil.node, EventV2.node, httpClient])

export * as ModelsDev from "./models-dev"
