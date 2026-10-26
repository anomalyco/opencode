import { Cause, Context, Duration, Effect, Layer, Option, Result, Schedule, Schema, Semaphore } from "effect"
import { HttpClient, HttpClientError, HttpClientRequest } from "effect/http"
import { ConfigProvider } from "@opencode/schema/config/provider"
import { MaxTokensField } from "@opencode/schema/model-compatibility"
import { ModelsDev } from "@opencode/schema/models-dev"
import { Money } from "@opencode/schema/money"
import { App } from "./app.js"
import { Hash } from "@opencode/util/hash"
import { FSUtil } from "@opencode/util/fs-util"
import { Bus } from "./bus.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { Model } from "./model.js"
import { AISDKNative } from "./aisdk-native.js"
import { Provider } from "./provider.js"
import { Variant } from "./variant.js"
import { KV } from "./kv.js"
import snapshotText from "./models-dev/snapshot.txt" with { type: "text" }
import { isV1, toV2 } from "./models-dev/v1.js"

// Only the fields opencode reads are decoded. Unknown keys are ignored, and a model that
// doesn't match is skipped rather than failing the whole catalog.
const Price = Money.USDPerMillionTokens
const CacheWrite = Schema.Union([Price, Schema.Record(Schema.String, Price)])
const CachePrices = Schema.Struct({
  read: Schema.optional(Price),
  write: Schema.optional(CacheWrite),
  explicit: Schema.optional(Schema.Struct({ write: Schema.optional(CacheWrite) })),
})
const When = Schema.Record(Schema.String, Schema.Unknown)
// A number scales every price below it; an object scales only the prices it names.
type Factor = number | { readonly [key: string]: Factor }
const Factor: Schema.Codec<Factor> = Schema.Union([
  Schema.Finite,
  Schema.Record(
    Schema.String,
    Schema.suspend((): Schema.Codec<Factor> => Factor),
  ),
])
const SourceCost = Schema.Struct({
  text: Schema.optional(
    Schema.Struct({
      input: Schema.optional(
        Schema.Struct({
          unit: Schema.optional(Schema.String),
          price: Price,
          cache: Schema.optional(CachePrices),
          overrides: Schema.optional(
            Schema.Array(
              Schema.Struct({ when: When, price: Schema.optional(Price), cache: Schema.optional(CachePrices) }),
            ),
          ),
        }),
      ),
      output: Schema.optional(
        Schema.Struct({
          unit: Schema.optional(Schema.String),
          price: Price,
          overrides: Schema.optional(Schema.Array(Schema.Struct({ when: When, price: Schema.optional(Price) }))),
        }),
      ),
    }),
  ),
  multipliers: Schema.optional(Schema.Array(Schema.Struct({ when: When, factor: Factor }))),
})
type SourceCost = typeof SourceCost.Type

// API entries and modes are lists models.dev keeps adding to, so each is decoded on its own and an
// entry this version doesn't understand is skipped instead of failing the model.
const SourceApi = Schema.Struct({
  base_url: Schema.optional(Schema.String),
  sdk: Schema.optional(
    Schema.Struct({ aisdk: Schema.optional(Schema.String), opencodeai: Schema.optional(Schema.String) }),
  ),
  compatibility: Schema.optional(
    Schema.Struct({
      reasoning_field: Schema.optional(Schema.String),
      max_tokens_field: Schema.optional(Schema.String),
    }),
  ),
})

const SourceMode = Schema.Struct({
  service_tier: Schema.optional(Schema.String),
  cost: Schema.optional(SourceCost),
  body: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
type SourceMode = typeof SourceMode.Type

const SourceModel = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  name: Schema.String,
  family: Schema.optional(Schema.String),
  release_date: Schema.String,
  status: Schema.optional(Schema.String),
  modalities: Schema.Struct({ input: Schema.Array(Schema.String), output: Schema.Array(Schema.String) }),
  capabilities: Schema.Struct({
    tools: Schema.Struct({ supported: Schema.Boolean }),
    reasoning: ConfigProvider.Reasoning,
    temperature: Schema.optional(Schema.Boolean),
  }),
  limit: Schema.optional(
    Schema.Struct({
      context: Schema.optional(Schema.Finite),
      input: Schema.optional(Schema.Finite),
      output: Schema.optional(Schema.Finite),
    }),
  ),
  cost: Schema.optional(SourceCost),
  // Ordered: the first API is the model's default.
  api: Schema.Record(Schema.String, Schema.Unknown),
  experimental: Schema.optional(
    Schema.Struct({ modes: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)) }),
  ),
})
type SourceModel = typeof SourceModel.Type

const SourceProvider = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  env: Schema.Array(Schema.String),
  models: Schema.Record(Schema.String, Schema.Unknown),
})

// The model types opencode keeps. Only chat models are offered for sessions; the others are listed on request.
const TYPES: readonly string[] = ["chat", "decision", "image"]

const ContextCondition = Schema.Struct({ gt: Schema.optional(Schema.Finite), gte: Schema.optional(Schema.Finite) })
const decodeModel = Schema.decodeUnknownResult(SourceModel)
const decodeApi = Schema.decodeUnknownOption(SourceApi)
const decodeMode = Schema.decodeUnknownOption(SourceMode)
const decodeProvider = Schema.decodeUnknownOption(SourceProvider)
const decodeContext = Schema.decodeUnknownOption(ContextCondition)
const decodeMaxTokensField = Schema.decodeUnknownOption(MaxTokensField)
const decodeStatus = Schema.decodeUnknownOption(Schema.Literals(["alpha", "beta", "deprecated"]))

export type Snapshot = {
  readonly info: Provider.Info
  readonly models: readonly Model.Info[]
  readonly environment: readonly string[]
}

type Route = {
  readonly package: string
  readonly baseURL?: string
  readonly compatibility?: Model.Compatibility
}

// These packages build their URL from provider settings (region, resource, account, project…), which
// only happens when no baseURL is set. The catalog's URL for them is a template or SDK default.
const BUILDS_OWN_URL = new Set([
  "@opencode/ai/providers/amazon-bedrock",
  "@opencode/ai/providers/azure/chat",
  "@opencode/ai/providers/azure/responses",
  "@opencode/ai/providers/cloudflare-ai-gateway",
  "@opencode/ai/providers/cloudflare-workers-ai",
  "@opencode/ai/providers/google-vertex/gemini",
  "@opencode/ai/providers/google-vertex/messages",
  "aisdk:@jerome-benoit/sap-ai-provider-v2",
  "aisdk:watsonx-ai-provider",
])

const normalize = Effect.fnUntraced(function* (catalog: Record<string, unknown>) {
  const failed: { readonly model: string; readonly issue: unknown }[] = []
  const snapshots = Object.values(isV1(catalog) ? toV2(catalog) : catalog).flatMap((value) => {
    const item = Option.getOrUndefined(decodeProvider(value))
    if (!item) return []
    const providerID = Provider.ID.make(item.id)
    const sources = Object.entries(item.models).flatMap(([key, value]) => {
      const decoded = decodeModel(value)
      if (Result.isFailure(decoded)) failed.push({ model: `${item.id}/${key}`, issue: decoded.failure })
      const model = Result.isSuccess(decoded) ? decoded.success : undefined
      // The fetch already asks for these types, but custom files and v1 catalogs may hold any type.
      const target = model && TYPES.includes(model.type) && route(providerID, model)
      return model && target ? [{ model, route: target }] : []
    })
    if (sources.length === 0) return []
    // v2 lists APIs per model, so the provider defaults are what most of its models use. A model that
    // builds its own URL would inherit a provider baseURL, so then every model carries its own instead.
    const packageName = mostCommon(sources.map((source) => source.route.package))
    if (!packageName) return []
    const urls = sources.map((source) => source.route.baseURL)
    const baseURL = urls.every((url) => url !== undefined) ? mostCommon(urls) : undefined
    const info = {
      id: providerID,
      name: item.name,
      activation: "auto",
      package: packageName,
      ...(baseURL ? { settings: { baseURL } } : {}),
    } satisfies Provider.Info
    const models = sources.flatMap((source) => {
      const baseCost = cost(source.model.cost)
      const id = Model.ID.make(source.model.id)
      const base = modelInfo(providerID, { packageName, baseURL }, id, source, { cost: baseCost })
      const variants = Variant.resolve(
        { ...base, package: source.route.package },
        Variant.supports(source.model.capabilities.reasoning),
      )
      return [
        { ...base, variants },
        ...entries(source.model.experimental?.modes, decodeMode).map(([mode, options]) =>
          modelInfo(providerID, { packageName, baseURL }, Model.ID.make(`${source.model.id}-${mode}`), source, {
            name: `${source.model.name} ${mode.charAt(0).toUpperCase()}${mode.slice(1)}`,
            cost: modeCost(source.model, baseCost, mode, options),
            request: options,
            variants,
          }),
        ),
      ]
    })
    return [{ info, models, environment: [...item.env] }]
  })
  if (failed.length > 0)
    yield* Effect.logWarning("Skipped models.dev models that failed to parse", {
      count: failed.length,
      models: failed.slice(0, 10).map((item) => item.model),
      issue: String(failed[0]?.issue),
    })
  return snapshots as readonly Snapshot[]
})

function entries<A>(record: Record<string, unknown> | undefined, decode: (input: unknown) => Option.Option<A>) {
  return Object.entries(record ?? {}).flatMap(([key, value]) =>
    Option.match(decode(value), { onNone: () => [], onSome: (entry) => [[key, entry] as const] }),
  )
}

function route(providerID: Provider.ID, model: SourceModel): Route | undefined {
  // A chat model uses its first API with a package. Other types (image, decision…) only run through
  // opencode's own packages, so they use their first API that has one, and are skipped without one.
  const [protocol, api] =
    entries(model.api, decodeApi).find(([, entry]) =>
      model.type === "chat" ? entry.sdk?.opencodeai || entry.sdk?.aisdk : entry.sdk?.opencodeai,
    ) ?? []
  if (!protocol || !api) return undefined
  const aisdk = api.sdk?.aisdk
  const packageName =
    api.sdk?.opencodeai ??
    (aisdk &&
      (AISDKNative.native(aisdk, {
        providerID,
        modelID: model.id,
        shape: protocol === "responses" ? "responses" : protocol === "chat-completions" ? "completions" : undefined,
      }) ??
        Provider.aisdk(aisdk)))
  if (!packageName) return undefined
  const maxTokensField = Option.getOrUndefined(decodeMaxTokensField(api.compatibility?.max_tokens_field))
  const compatibility = {
    ...(api.compatibility?.reasoning_field ? { reasoningField: api.compatibility.reasoning_field } : {}),
    ...(maxTokensField ? { maxTokensField } : {}),
  }
  return {
    package: packageName,
    // An empty base_url is how models.dev says it has no URL for the API.
    ...(BUILDS_OWN_URL.has(packageName) || !api.base_url ? {} : { baseURL: api.base_url }),
    ...(Object.keys(compatibility).length > 0 ? { compatibility } : {}),
  }
}

function mostCommon<T>(values: readonly T[]) {
  const counts = new Map<T, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].reduce<[T, number] | undefined>(
    (best, entry) => (!best || entry[1] > best[1] ? entry : best),
    undefined,
  )?.[0]
}

function released(date: string) {
  const time = Date.parse(date)
  return Number.isFinite(time) ? time : 0
}

const COMPATIBLE = new Set(["@opencode/ai/providers/openai-compatible", "@opencode/ai/providers/anthropic-compatible"])

const zero = Money.USDPerMillionTokens.zero

// Only per-token text prices are kept: per-image, per-second and similar prices have
// no place in opencode's cost yet. Context overrides become tiers; other conditions
// (service tier, time of day…) are left out.
function cost(input: SourceCost | undefined): Model.Info["cost"] {
  const text = input?.text
  const perToken = (unit: string | undefined) => unit === undefined || unit === "token"
  if (!text?.input || !text.output || !perToken(text.input.unit) || !perToken(text.output.unit))
    return [{ input: zero, output: zero, cache: { read: zero, write: zero } }]
  const textInput = text.input
  const textOutput = text.output
  const base = {
    input: textInput.price,
    output: textOutput.price,
    cache: { read: textInput.cache?.read ?? zero, write: cacheWrite(textInput.cache) ?? zero },
  }
  // An override merges field by field, so a tier keeps every base price it doesn't set.
  const tiers = new Map<number, Model.Info["cost"][number]>()
  const tier = (when: Record<string, unknown>) => {
    const context = Object.keys(when).length === 1 ? Option.getOrUndefined(decodeContext(when.context)) : undefined
    const size = context?.gt ?? context?.gte
    if (size === undefined) return undefined
    const entry = tiers.get(size) ?? { ...base, tier: { type: "context" as const, size } }
    tiers.set(size, entry)
    return entry
  }
  for (const override of textInput.overrides ?? []) {
    const entry = tier(override.when)
    if (!entry) continue
    tiers.set(entry.tier!.size, {
      ...entry,
      input: override.price ?? entry.input,
      cache: {
        read: override.cache?.read ?? entry.cache.read,
        write: cacheWrite(override.cache) ?? entry.cache.write,
      },
    })
  }
  for (const override of textOutput.overrides ?? []) {
    const entry = tier(override.when)
    if (entry) tiers.set(entry.tier!.size, { ...entry, output: override.price ?? entry.output })
  }
  return [base, ...tiers.values()]
}

// opencode has one cache write price: the first TTL listed, else the explicit cache's.
function cacheWrite(cache: typeof CachePrices.Type | undefined) {
  const first = (write: typeof CacheWrite.Type | undefined) =>
    typeof write === "object" ? Object.values(write)[0] : write
  return first(cache?.write) ?? first(cache?.explicit?.write)
}

// A mode without its own cost takes the base prices scaled by its service tier's
// multiplier (the mode name by default). The base context tiers are kept unscaled.
function modeCost(model: SourceModel, base: Model.Info["cost"], name: string, mode: SourceMode): Model.Info["cost"] {
  const [baseDefault, ...baseTiers] = base
  if (mode.cost) return [cost(mode.cost)[0], ...baseTiers]
  const tier = mode.service_tier ?? name
  const factor = model.cost?.multipliers?.find(
    (multiplier) =>
      Object.keys(multiplier.when).length === 1 &&
      Option.getOrUndefined(decodeServiceTier(multiplier.when.service_tier))?.equals === tier,
  )?.factor
  if (factor === undefined || !baseDefault) return base
  const scale = (price: Money.USDPerMillionTokens, path: readonly string[]) =>
    Money.USDPerMillionTokens.make(Math.round(price * factorAt(factor, path) * 1e10) / 1e10)
  return [
    {
      input: scale(baseDefault.input, ["text", "input", "price"]),
      output: scale(baseDefault.output, ["text", "output", "price"]),
      cache: {
        read: scale(baseDefault.cache.read, ["text", "input", "cache", "read"]),
        write: scale(baseDefault.cache.write, ["text", "input", "cache", "write"]),
      },
    },
    ...baseTiers,
  ]
}

const decodeServiceTier = Schema.decodeUnknownOption(Schema.Struct({ equals: Schema.optional(Schema.String) }))

// Prices an object factor doesn't name keep factor 1.
function factorAt(factor: Factor, path: readonly string[]): number {
  const node = path.reduce<Factor | undefined>(
    (node, key) => (node === undefined || typeof node === "number" ? node : node[key]),
    factor,
  )
  if (node === undefined) return 1
  if (typeof node === "number") return node
  // A cache write factor is keyed by TTL; opencode keeps the first one.
  const first = Object.values(node)[0]
  return typeof first === "number" ? first : 1
}

// v2 lists exact MIME types; opencode's capabilities use the broad kind.
function modality(value: string) {
  if (value === "application/pdf") return "pdf"
  const kind = value.split("/")[0]
  return kind === "text" || kind === "image" || kind === "audio" || kind === "video" ? kind : value
}

function modalities(values: readonly string[]) {
  return [...new Set(values.map(modality))]
}

function modelInfo(
  providerID: Provider.ID,
  provider: { readonly packageName: string; readonly baseURL?: string },
  id: Model.ID,
  source: { readonly model: SourceModel; readonly route: Route },
  input: {
    readonly name?: string
    readonly cost?: Model.Info["cost"]
    readonly request?: { readonly body?: Provider.Settings; readonly headers?: Readonly<Record<string, string>> }
    readonly variants?: NonNullable<Model.Info["variants"]>
  } = {},
): Model.Info {
  const model = source.model
  // Per model, so it never merges into a model that overrides to a different package. Compatible
  // packages are told the real host, so requests and saved provider state carry its ID.
  const settings = {
    ...(source.route.baseURL !== undefined && source.route.baseURL !== provider.baseURL
      ? { baseURL: source.route.baseURL }
      : {}),
    ...(COMPATIBLE.has(source.route.package) ? { provider: providerID } : {}),
  }
  return {
    id,
    modelID: Model.ID.make(model.id),
    providerID,
    type: model.type,
    name: input.name ?? model.name,
    compatibility: source.route.compatibility,
    family: model.family ? Model.Family.make(model.family) : undefined,
    package: source.route.package !== provider.packageName ? source.route.package : undefined,
    settings: Object.keys(settings).length === 0 ? undefined : settings,
    capabilities: {
      tools: model.capabilities.tools.supported,
      input: modalities(model.modalities.input),
      output: modalities(model.modalities.output),
      temperature: model.capabilities.temperature,
    },
    variants: [...(input.variants ?? [])],
    time: { released: released(model.release_date) },
    cost: (input.cost ?? cost(model.cost)).map((item) => ({
      ...item,
      tier: item.tier && { ...item.tier },
      cache: { ...item.cache },
    })),
    status: Option.getOrElse(decodeStatus(model.status), () => "active" as const),
    enabled: true,
    limit: { context: model.limit?.context ?? 0, input: model.limit?.input, output: model.limit?.output ?? 0 },
    headers: input.request?.headers ? { ...input.request.headers } : undefined,
    body: input.request?.body ? { ...input.request.body } : undefined,
  }
}

export { Event } from "@opencode/schema/models-dev"

export interface Interface {
  readonly get: () => Effect.Effect<readonly Snapshot[]>
  readonly refresh: (force?: boolean) => Effect.Effect<void>
}

export const Options = Schema.Struct({
  url: Schema.optional(Schema.String),
  file: Schema.optional(Schema.String),
  fetch: Schema.optional(Schema.Boolean),
  snapshot: Schema.optional(Schema.Boolean),
})
export type Options = typeof Options.Type

export class Service extends Context.Service<Service, Interface>()("@opencode/ModelsDev") {}

const CatalogJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))
const decodeCatalog = (text: string) => Schema.decodeUnknownEffect(CatalogJson)(text)
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

// The experimental v2 API, limited to the model types opencode keeps.
export const catalogPath = `/experimental/v2.0/api.json?type=${TYPES.join(",")}`

export const decodeSnapshot = (text: string) => decodeCatalog(text).pipe(Effect.flatMap(normalize))

// Bundled snapshot of the catalog at `catalogPath`, committed at
// packages/core/src/models-dev/snapshot.txt and refreshed via
// `bun run script/update-models-snapshot.ts`. Release builds bundle the live
// catalog in its place when it can be fetched. Decoded and normalized once per
// isolate: the snapshot is a multi-MB module-level constant and one isolate can
// host many runtimes (Cloudflare colocates Durable Object instances), so
// per-runtime decoding would multiply the cost.
let bundledCache: readonly Snapshot[] | undefined
const bundledSnapshot = Effect.suspend(() =>
  bundledCache
    ? Effect.succeed(bundledCache)
    : decodeSnapshot(snapshotText).pipe(
        Effect.map((snapshot) => {
          bundledCache = snapshot
          return bundledCache
        }),
      ),
)

// Versioned so an entry cached from the v1 API is never read as v2.
function cacheKey(source: string) {
  if (source === defaultSource) return "models-dev:v2:catalog"
  return `models-dev:v2:catalog:${Hash.fast(source)}`
}

export function bodyDigest(text: string) {
  return Hash.sha256(text)
}

export const layer = (options?: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const bus = yield* Bus.Service
      const app = yield* App.Metadata
      const kv = yield* KV.Service
      const http = HttpClient.filterStatusOk(
        (yield* HttpClient.HttpClient).pipe(
          HttpClient.retryTransient({
            retryOn: "errors-and-responses",
            times: 2,
            schedule: Schedule.exponential(200).pipe(Schedule.jittered),
          }),
        ),
      )

      const source = options?.url || defaultSource
      const fetch = options?.fetch ?? true
      const userAgent = App.useragent(app)
      const key = cacheKey(source)
      const metaKey = `${key}:meta`
      const ttl = Duration.minutes(5)
      const lock = Semaphore.makeUnsafe(1)
      // The v1 catalog was cached under unversioned keys; free that multi-MB row.
      yield* kv.remove(key.replace("models-dev:v2:", "models-dev:"))
      yield* kv.remove(`${key.replace("models-dev:v2:", "models-dev:")}:meta`)

      const loadFromCache = Effect.fnUntraced(function* () {
        const value = yield* kv.get(key)
        const cached = Schema.decodeUnknownOption(Cache)(value)
        if (Option.isSome(cached))
          return {
            catalog: cached.value.body,
            updatedAt: cached.value.updatedAt,
            digest: cached.value.digest,
          }
        if (value === undefined) return
        yield* kv.remove(key)
        yield* kv.remove(metaKey)
      })

      const fetchPath = (path: string, etag?: string) =>
        HttpClientRequest.get(`${source}${path}`).pipe(
          HttpClientRequest.setHeader("User-Agent", userAgent),
          HttpClientRequest.setHeaders(etag ? { "If-None-Match": etag } : {}),
          http.execute,
          Effect.flatMap((res) => Effect.map(res.text, (text) => ({ text, etag: res.headers.etag }))),
          Effect.timeout("10 seconds"),
        )

      const fetchApi = Effect.fn("ModelsDev.fetchApi")(function* (etag?: string) {
        return yield* fetchPath(catalogPath, etag).pipe(
          // A custom mirror may only serve the v1 catalog, which is converted when decoded.
          Effect.catchIf(
            (error) =>
              source !== defaultSource && HttpClientError.isHttpClientError(error) && error.response?.status === 404,
            () => fetchPath("/api.json", etag),
          ),
        )
      })

      const loadFromFile = options?.file
        ? fs.readJson(options.file).pipe(
            Effect.flatMap((input) => Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Unknown))(input)),
            Effect.orElseSucceed(() => undefined),
          )
        : Effect.undefined

      // The bundled snapshot is the boot-time floor for the catalog; the
      // periodic fetch below still refreshes on top.
      const loadSnapshot = options?.snapshot === false ? Effect.undefined : bundledSnapshot

      const writeMeta = (updatedAt: number, digest: string | undefined, etag: string | undefined) =>
        kv.set(metaKey, { updatedAt, ...(digest ? { digest } : {}), ...(etag ? { etag } : {}) })

      // Best-effort: a cache-write failure must never kill catalog
      // population. The payload has outgrown some KV backends' per-value
      // limits (Durable Object SQLite caps values at 2 MB and the catalog
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
        if (fromFile) return yield* normalize(fromFile)
        const cached = options?.file ? undefined : yield* loadFromCache()
        if (cached) return yield* normalize(cached.catalog)
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
        return yield* normalize(catalog)
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
