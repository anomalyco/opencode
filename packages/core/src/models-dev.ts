import path from "path"
import { Context, Duration, Effect, Layer, Option, Schedule, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { ModelsDev } from "@bolt-ai/schema/models-dev"
import { Global } from "./global"
import { Flag } from "./flag/flag"
import { Flock } from "./util/flock"
import { Hash } from "./util/hash"
import { FSUtil } from "./fs-util"
import { InstallationChannel, InstallationVersion } from "./installation/version"
import { EventV2 } from "./event"
import { makeGlobalNode } from "./effect/app-node"
import { httpClient } from "./effect/app-node-platform"

export const CatalogModelStatus = Schema.Literals(["alpha", "beta", "deprecated"])
export type CatalogModelStatus = typeof CatalogModelStatus.Type

// models.dev treats a model without a type as a chat model.
export const CatalogModelType = Schema.Literals([
  "chat",
  "image",
  "video",
  "embedding",
  "reranking",
  "decision",
  "transcription",
  "speech",
  "realtime",
])
export type CatalogModelType = typeof CatalogModelType.Type

const USER_AGENT = `opencode/${InstallationChannel}/${InstallationVersion}/${Flag.BOLT_CLIENT}`

type Modality = "text" | "audio" | "image" | "video" | "pdf"

type SourceModel = {
  readonly id: string
  readonly name: string
  readonly type?: CatalogModelType
  readonly family?: string
  readonly release_date: string
  readonly attachment: boolean
  readonly reasoning: boolean
  readonly reasoning_options?: readonly (
    | { readonly type: "effort"; readonly values: readonly (string | null)[] }
    | Exclude<Variant.Support, { type: "effort" }>
  )[]
  readonly temperature?: boolean
  readonly tool_call: boolean
  readonly interleaved?: boolean | string | { readonly field: string }
  readonly cost?: Cost
  readonly limit: { readonly context: number; readonly input?: number; readonly output: number }
  readonly modalities?: { readonly input: readonly Modality[]; readonly output: readonly Modality[] }
  readonly experimental?: {
    readonly modes?: Readonly<
      Record<
        string,
        {
          readonly cost?: Cost
          readonly provider?: {
            readonly body?: Provider.Settings
            readonly headers?: Readonly<Record<string, string>>
          }
        }
      >
    >
  }
  readonly status?: CatalogModelStatus
  readonly provider?: {
    readonly npm?: string
    readonly api?: string
    readonly shape?: "responses" | "completions"
  }
}

type SourceProvider = {
  readonly api?: string
  readonly name: string
  readonly env: readonly string[]
  readonly id: string
  readonly npm: string
  readonly models: Readonly<Record<string, SourceModel>>
}

export type Snapshot = {
  readonly info: Provider.Info
  readonly models: readonly Model.Info[]
  readonly environment: readonly string[]
  /** The models.dev type of each typed model, by catalog model ID. */
  readonly types?: ReadonlyMap<Model.ID, CatalogModelType>
}

function nativePackage(provider: SourceProvider, model?: SourceModel) {
  const npm = model?.provider?.npm ?? provider.npm
  return (
    AISDKNative.native(npm, {
      providerID: provider.id,
      modelID: model?.id,
      shape: model?.provider?.shape,
    }) ?? Provider.aisdk(npm)
  )
}

function normalize(input: Record<string, SourceProvider>): readonly Snapshot[] {
  const providers: Snapshot[] = []
  for (const item of Object.values(input)) {
    const providerID = Provider.ID.make(item.id)
    const packageName = nativePackage(item)
    const info = {
      id: providerID,
      name: item.name,
      activation: "auto",
      package: packageName,
      ...(item.api && packageName !== "@opencode/ai/providers/cloudflare-workers-ai"
        ? { settings: { baseURL: item.api } }
        : {}),
    } satisfies Provider.Info
    const models: Model.Info[] = []
    const types = new Map<Model.ID, CatalogModelType>()
    for (const model of Object.values(item.models)) {
      const baseCost = cost(model.cost)
      const id = Model.ID.make(model.id)
      const base = modelInfo(item, id, model, { cost: baseCost })
      const variants = Variant.resolve({ ...base, package: nativePackage(item, model) }, supports(model))
      models.push({ ...base, variants })
      if (model.type) types.set(id, model.type)
      for (const [mode, options] of Object.entries(model.experimental?.modes ?? {})) {
        const modeID = Model.ID.make(`${model.id}-${mode}`)
        models.push(
          modelInfo(item, modeID, model, {
            name: modeName(model, mode),
            cost: mergeCost(baseCost, options.cost),
            request: options.provider,
            variants,
          }),
        )
        if (model.type) types.set(modeID, model.type)
      }
    }
    providers.push({ info, models, environment: [...item.env], types })
  }
  return providers
}

function released(date: string) {
  const time = Date.parse(date)
  return Number.isFinite(time) ? time : 0
}

function cost(input: SourceModel["cost"]): Model.Info["cost"] {
  const base = {
    input: input?.input ?? Money.USDPerMillionTokens.zero,
    output: input?.output ?? Money.USDPerMillionTokens.zero,
    cache: {
      read: input?.cache_read ?? Money.USDPerMillionTokens.zero,
      write: input?.cache_write ?? Money.USDPerMillionTokens.zero,
    },
  }
  return [
    base,
    ...(input?.tiers?.map((item) => ({
      tier: item.tier,
      input: item.input,
      output: item.output,
      cache: {
        read: item.cache_read ?? Money.USDPerMillionTokens.zero,
        write: item.cache_write ?? Money.USDPerMillionTokens.zero,
      },
    })) ?? []),
  ]
}

function mergeCost(base: Model.Info["cost"], override: SourceModel["cost"] | undefined) {
  if (!override) return base
  const next = cost(override)
  const [baseDefault, ...baseTiers] = base
  const [nextDefault, ...nextTiers] = next
  const tierKey = (item: Model.Info["cost"][number]) => `${item.tier?.type ?? "base"}:${item.tier?.size ?? 0}`
  const merge = (left: Model.Info["cost"][number], right: Model.Info["cost"][number]) => ({
    ...left,
    ...right,
    tier: right.tier ?? left.tier,
    cache: { ...left.cache, ...right.cache },
  })
  const tiers = new Map(baseTiers.map((item) => [tierKey(item), item]))
  for (const item of nextTiers) {
    const current = tiers.get(tierKey(item))
    tiers.set(tierKey(item), current ? merge(current, item) : item)
  }
  return [
    merge(
      baseDefault ?? {
        input: Money.USDPerMillionTokens.zero,
        output: Money.USDPerMillionTokens.zero,
        cache: { read: Money.USDPerMillionTokens.zero, write: Money.USDPerMillionTokens.zero },
      },
      nextDefault,
    ),
    ...tiers.values(),
  ]
}

declare const BOLT_MODELS_DEV: Record<string, Provider> | undefined

export interface Interface {
  readonly get: () => Effect.Effect<readonly Snapshot[]>
  readonly refresh: (force?: boolean) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@bolt/ModelsDev") {}

const CatalogJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))
const decodeCatalog = (text: string) =>
  Schema.decodeUnknownEffect(CatalogJson)(text).pipe(Effect.map((catalog) => catalog as Record<string, SourceProvider>))
const Cache = Schema.Struct({
  updatedAt: Schema.Number,
  // Digest of the raw body, persisted so refresh() can skip republishing a
  // byte-identical catalog. Optional for entries written before it existed.
  digest: Schema.optional(Schema.String),
  body: CatalogJson,
})
const CacheMeta = Schema.Struct({
  updatedAt: Schema.Number,
  digest: Schema.optional(Schema.String),
  etag: Schema.optional(Schema.String),
})
const defaultSource = "https://models.opencode.ai"

// Bundled snapshot of https://models.opencode.ai/api.json, committed at
// packages/core/src/models-dev/snapshot.txt and refreshed via
// `bun run script/update-models-snapshot.ts`. Decoded and normalized once per
// isolate: the snapshot is a multi-MB module-level constant and one isolate can
// host many runtimes (Cloudflare colocates Durable Object instances), so
// per-runtime decoding would multiply the cost.
let bundledCache: readonly Snapshot[] | undefined
const bundledSnapshot = Effect.suspend(() =>
  bundledCache
    ? Effect.succeed(bundledCache)
    : decodeCatalog(snapshotText).pipe(
        Effect.map((catalog) => {
          bundledCache = normalize(catalog)
          return bundledCache
        }),
      ),
)

    const source = Flag.BOLT_MODELS_URL || "https://models.bolt.ai"
    const filepath = path.join(
      Global.Path.cache,
      source === "https://models.bolt.ai" ? "models.json" : `models-${Hash.fast(source)}.json`,
    )
    const ttl = Duration.minutes(5)
    const lockKey = `models-dev:${filepath}`

export function bodyDigest(text: string) {
  return Hash.sha256(text)
}

    const fetchApi = Effect.fn("ModelsDev.fetchApi")(function* () {
      return yield* HttpClientRequest.get(`${source}/api.json`).pipe(
        HttpClientRequest.setHeader("User-Agent", USER_AGENT),
        http.execute,
        Effect.flatMap((res) => res.text),
        Effect.timeout("10 seconds"),
      )
    })

    const loadFromDisk = fs.readJson(Flag.BOLT_MODELS_PATH ?? filepath).pipe(
      Effect.catch((error) => {
        if (Flag.BOLT_MODELS_PATH === undefined && error._tag === "FileSystemError" && error.method === "readJson") {
          return fs.remove(filepath, { force: true }).pipe(Effect.ignore, Effect.as(undefined))
        }
        return Effect.succeed(undefined)
      }),
      Effect.map((v) => v as Record<string, Provider> | undefined),
    )

    const loadSnapshot = Effect.sync(() => (typeof BOLT_MODELS_DEV === "undefined" ? undefined : BOLT_MODELS_DEV))

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

    const populate = Effect.gen(function* () {
      const fromDisk = yield* loadFromDisk
      if (fromDisk) return fromDisk
      const snapshot = yield* loadSnapshot
      if (snapshot) return snapshot
      if (Flag.BOLT_DISABLE_MODELS_FETCH) return {}
      // Flock is cross-process: concurrent opencode CLIs can race on this cache file.
      const text = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Flock.effect(lockKey)
          return yield* fetchAndWrite()
        }),
      )
      return JSON.parse(text) as Record<string, Provider>
    }).pipe(Effect.withSpan("ModelsDev.populate"), Effect.orDie)

      const loadFromCache = Effect.fnUntraced(function* () {
        const value = yield* kv.get(key)
        const cached = Schema.decodeUnknownOption(Cache)(value)
        if (Option.isSome(cached))
          return {
            catalog: cached.value.body as Record<string, SourceProvider>,
            updatedAt: cached.value.updatedAt,
            digest: cached.value.digest,
          }
        if (value === undefined) return
        yield* kv.remove(key)
        yield* kv.remove(metaKey)
      })

      const fetchApi = Effect.fn("ModelsDev.fetchApi")(function* (etag?: string) {
        return yield* HttpClientRequest.get(`${source}/api.json`).pipe(
          HttpClientRequest.setHeader("User-Agent", userAgent),
          HttpClientRequest.setHeaders(etag ? { "If-None-Match": etag } : {}),
          http.execute,
          Effect.flatMap((res) => Effect.map(res.text, (text) => ({ text, etag: res.headers.etag }))),
          Effect.timeout("10 seconds"),
        )
      })

      const loadFromFile = options?.file
        ? fs.readJson(options.file).pipe(
            Effect.map((input) => input as Record<string, SourceProvider>),
            Effect.orElseSucceed(() => undefined),
          )
        : Effect.undefined

    if (!Flag.BOLT_DISABLE_MODELS_FETCH && !process.argv.includes("--get-yargs-completions")) {
      // Schedule.spaced runs the effect once, then waits between completions.
      yield* Effect.forkScoped(refresh().pipe(Effect.repeat(Schedule.spaced("60 minutes")), Effect.ignore))
    }

      const writeMeta = (updatedAt: number, digest: string | undefined, etag: string | undefined) =>
        kv.set(metaKey, { updatedAt, ...(digest ? { digest } : {}), ...(etag ? { etag } : {}) })

      // Best-effort: a cache-write failure must never kill catalog
      // population. The payload has outgrown some KV backends' per-value
      // limits (Durable Object SQLite caps values at 2 MB and api.json
      // passed it in Aug 2026); a boot without a cache hit just refetches.
      const writeCache = Effect.fn("ModelsDev.writeCache")(function* (
        text: string,
        etag: string | undefined,
        digest = bodyDigest(text),
      ) {
        const updatedAt = Date.now()
        yield* kv.set(key, { updatedAt, digest, body: text }).pipe(
          Effect.andThen(writeMeta(updatedAt, digest, etag)),
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterruptsOnly(cause),
            (cause) => Effect.logWarning("Failed to cache models.dev catalog", { cause }),
          ),
        )
      })

      const fetchAndWrite = Effect.fn("ModelsDev.fetchAndWrite")(function* () {
        const response = yield* fetchApi()
        const catalog = yield* decodeCatalog(response.text)
        yield* writeCache(response.text, response.etag)
        return catalog
      })

      const populate = Effect.gen(function* () {
        const fromFile = yield* loadFromFile
        if (fromFile) return normalize(fromFile)
        const cached = options?.file ? undefined : yield* loadFromCache()
        if (cached) return normalize(cached.catalog)
        const bundled = yield* loadSnapshot
        if (bundled) return bundled
        if (!fetch) return []
        const catalog = yield* lock.withPermit(
          Effect.gen(function* () {
            const stored = options?.file ? undefined : yield* loadFromCache()
            if (stored) return stored.catalog
            return yield* fetchAndWrite()
          }),
        )
        return normalize(catalog)
      }).pipe(Effect.withSpan("ModelsDev.populate"), Effect.orDie)

      const [cachedGet, invalidate] = yield* Effect.cachedInvalidateWithTTL(populate, Duration.infinity)

      const get = (): Effect.Effect<readonly Snapshot[]> => cachedGet

      const refresh = Effect.fn("ModelsDev.refresh")(function* (force = false) {
        yield* lock
          .withPermit(
            Effect.gen(function* () {
              const stored = Option.getOrUndefined(
                Schema.decodeUnknownOption(CacheMeta)((yield* kv.get(metaKey)) ?? (yield* kv.get(key))),
              )
              if (!force && stored && Date.now() - stored.updatedAt < Duration.toMillis(ttl)) return
              const response = yield* fetchApi(force ? undefined : stored?.etag).pipe(
                Effect.catchIf(
                  (error) => HttpClientError.isHttpClientError(error) && error.response?.status === 304,
                  () => Effect.undefined,
                ),
              )
              const digest = response && bodyDigest(response.text)
              // models.dev rarely changes between polls; skip invalidation and
              // the Refreshed event for a byte-identical body so downstream
              // provider/model update listeners stay quiet.
              if (!force && stored && (!response || stored.digest === digest)) {
                yield* writeMeta(Date.now(), stored.digest, response?.etag ?? stored.etag)
                return
              }
              if (!response) return
              yield* decodeCatalog(response.text)
              yield* writeCache(response.text, response.etag, digest)
              yield* invalidate
              yield* bus.publish(ModelsDev.Event.Refreshed, {}, { global: true })
            }),
          )
          .pipe(
            Effect.tapCause((cause) => Effect.logError("Failed to fetch models.dev", { cause: cause })),
            Effect.ignore,
          )
      })

      if (fetch && !process.argv.includes("--get-yargs-completions")) {
        // Schedule.spaced runs the effect once, then waits between completions.
        yield* Effect.forkScoped(refresh().pipe(Effect.repeat(Schedule.spaced(ttl)), Effect.ignore))
      }

      return Service.of({ get, refresh })
    }),
  )

export function configured(options?: Options) {
  return makeGlobalNode({
    service: Service,
    layer: layer(options),
    deps: [FSUtil.node, Bus.node, App.node, KV.node, httpClient],
  })
}

export const node = configured()

export * as ModelsDev from "./models-dev.js"
