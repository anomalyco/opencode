import { Cause, Context, Duration, Effect, Layer, Option, Schedule, Schema, Semaphore } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
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

export const CatalogModelStatus = Schema.Literals(["alpha", "beta", "deprecated"])
export type CatalogModelStatus = typeof CatalogModelStatus.Type

type Cost = {
  readonly input: Money.USDPerMillionTokens
  readonly output: Money.USDPerMillionTokens
  readonly cache_read?: Money.USDPerMillionTokens
  readonly cache_write?: Money.USDPerMillionTokens
  readonly tiers?: readonly (Cost & { readonly tier: { readonly type: "context"; readonly size: number } })[]
  readonly context_over_200k?: Omit<Cost, "tiers" | "context_over_200k">
}

type Modality = "text" | "audio" | "image" | "video" | "pdf"

type SourceModel = {
  readonly id: string
  readonly name: string
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
  readonly provider?: { readonly npm?: string; readonly api?: string }
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
}

function nativePackage(provider: SourceProvider, model?: SourceModel) {
  const npm = model?.provider?.npm ?? provider.npm
  return AISDKNative.native(npm, { providerID: provider.id, modelID: model?.id }) ?? Provider.aisdk(npm)
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
    for (const model of Object.values(item.models)) {
      const baseCost = cost(model.cost)
      const id = Model.ID.make(model.id)
      const base = modelInfo(item, id, model, { cost: baseCost })
      const variants = Variant.resolve({ ...base, package: nativePackage(item, model) }, supports(model))
      models.push({ ...base, variants })
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
      }
    }
    providers.push({ info, models, environment: [...item.env] })
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
    ...(input?.context_over_200k
      ? [
          {
            tier: { type: "context" as const, size: 200_000 },
            input: input.context_over_200k.input,
            output: input.context_over_200k.output,
            cache: {
              read: input.context_over_200k.cache_read ?? Money.USDPerMillionTokens.zero,
              write: input.context_over_200k.cache_write ?? Money.USDPerMillionTokens.zero,
            },
          },
        ]
      : []),
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

function modeName(model: SourceModel, mode: string) {
  return `${model.name} ${mode.charAt(0).toUpperCase()}${mode.slice(1)}`
}

function supports(model: SourceModel): readonly Variant.Support[] {
  return (model.reasoning_options ?? []).map((option) =>
    option.type === "effort"
      ? { type: "effort", values: option.values.filter((value): value is string => value !== null && value !== "null") }
      : option,
  )
}

function modelInfo(
  provider: SourceProvider,
  id: Model.ID,
  model: SourceModel,
  input: {
    readonly name?: string
    readonly cost?: Model.Info["cost"]
    readonly request?: NonNullable<NonNullable<SourceModel["experimental"]>["modes"]>[string]["provider"]
    readonly variants?: NonNullable<Model.Info["variants"]>
  } = {},
): Model.Info {
  const providerID = Provider.ID.make(provider.id)
  const pkg = model.provider?.npm ? nativePackage(provider, model) : undefined
  // Per model, so it never merges into a model that overrides to a different package.
  const settings = {
    ...(model.provider?.api ? { baseURL: model.provider.api } : {}),
    ...(nativePackage(provider, model) === "@opencode/ai/providers/openai-compatible" ? { provider: providerID } : {}),
  }
  return {
    id,
    modelID: Model.ID.make(model.id),
    providerID,
    name: input.name ?? model.name,
    compatibility: Model.compatibility(model.interleaved),
    family: model.family ? Model.Family.make(model.family) : undefined,
    package: pkg,
    settings: Object.keys(settings).length === 0 ? undefined : settings,
    capabilities: {
      tools: model.tool_call,
      input: [...(model.modalities?.input ?? [])],
      output: [...(model.modalities?.output ?? [])],
    },
    variants: [...(input.variants ?? [])],
    time: { released: released(model.release_date) },
    cost: (input.cost ?? cost(model.cost)).map((item) => ({
      ...item,
      tier: item.tier && { ...item.tier },
      cache: { ...item.cache },
    })),
    status: model.status ?? "active",
    enabled: true,
    limit: { context: model.limit.context, input: model.limit.input, output: model.limit.output },
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
const decodeCatalog = (text: string) =>
  Schema.decodeUnknownEffect(CatalogJson)(text).pipe(Effect.map((catalog) => catalog as Record<string, SourceProvider>))
const Cache = Schema.Struct({
  updatedAt: Schema.Number,
  // Digest of the raw body, persisted so refresh() can skip republishing a
  // byte-identical catalog. Optional for entries written before it existed.
  digest: Schema.optional(Schema.String),
  body: CatalogJson,
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

function cacheKey(source: string) {
  if (source === defaultSource) return "models-dev:catalog"
  return `models-dev:catalog:${Hash.fast(source)}`
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
      const ttl = Duration.minutes(5)
      const lock = Semaphore.makeUnsafe(1)

      const loadFromCache = Effect.fnUntraced(function* () {
        const value = yield* kv.get(key)
        const cached = Schema.decodeUnknownOption(Cache)(value)
        if (Option.isSome(cached))
          return {
            catalog: cached.value.body as Record<string, SourceProvider>,
            updatedAt: cached.value.updatedAt,
            digest: cached.value.digest,
          }
        if (value !== undefined) yield* kv.remove(key)
      })

      const fetchApi = Effect.fn("ModelsDev.fetchApi")(function* () {
        return yield* HttpClientRequest.get(`${source}/api.json`).pipe(
          HttpClientRequest.setHeader("User-Agent", userAgent),
          http.execute,
          Effect.flatMap((res) => res.text),
          Effect.timeout("10 seconds"),
        )
      })

      const loadFromFile = options?.file
        ? fs.readJson(options.file).pipe(
            Effect.map((input) => input as Record<string, SourceProvider>),
            Effect.orElseSucceed(() => undefined),
          )
        : Effect.undefined

      // The bundled snapshot is the boot-time floor for the catalog; the
      // periodic fetch below still refreshes on top.
      const loadSnapshot = options?.snapshot === false ? Effect.undefined : bundledSnapshot

      // Best-effort: a cache-write failure must never kill catalog
      // population. The payload has outgrown some KV backends' per-value
      // limits (Durable Object SQLite caps values at 2 MB and api.json
      // passed it in Aug 2026); a boot without a cache hit just refetches.
      const writeCache = Effect.fn("ModelsDev.writeCache")(function* (text: string, digest = bodyDigest(text)) {
        yield* kv.set(key, { updatedAt: Date.now(), digest, body: text }).pipe(
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterruptsOnly(cause),
            (cause) => Effect.logWarning("Failed to cache models.dev catalog", { cause }),
          ),
        )
      })

      const fetchAndWrite = Effect.fn("ModelsDev.fetchAndWrite")(function* () {
        const text = yield* fetchApi()
        const catalog = yield* decodeCatalog(text)
        yield* writeCache(text)
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
              const stored = yield* loadFromCache()
              if (!force && stored && Date.now() - stored.updatedAt < Duration.toMillis(ttl)) return
              const text = yield* fetchApi()
              const digest = bodyDigest(text)
              // models.dev rarely changes between polls; skip the cache write,
              // invalidation, and Refreshed event for a byte-identical body so
              // downstream provider/model update listeners stay quiet.
              if (!force && stored?.digest === digest) return
              yield* decodeCatalog(text)
              yield* writeCache(text, digest)
              yield* invalidate
              yield* bus.publish(ModelsDev.Event.Refreshed, {})
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
