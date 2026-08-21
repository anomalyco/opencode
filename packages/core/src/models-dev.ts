import { Cause, Context, Duration, Effect, Layer, Option, Schedule, Schema, Semaphore } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { ModelsDev } from "@opencode-ai/schema/models-dev"
import { Money } from "@opencode-ai/schema/money"
import { App } from "./app.js"
import { Hash } from "@opencode-ai/util/hash"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Bus } from "./bus.js"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { httpClient } from "@opencode-ai/util/effect/app-node-platform"
import { Model } from "./model.js"
import { Provider } from "./provider.js"
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

type ReasoningOption =
  | { readonly type: "effort"; readonly values: readonly (string | null)[] }
  | { readonly type: "toggle" }
  | { readonly type: "budget_tokens"; readonly min?: number; readonly max?: number }

type Modality = "text" | "audio" | "image" | "video" | "pdf"

type SourceModel = {
  readonly id: string
  readonly name: string
  readonly family?: string
  readonly release_date: string
  readonly attachment: boolean
  readonly reasoning: boolean
  readonly reasoning_options?: readonly ReasoningOption[]
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

function normalize(input: Record<string, SourceProvider>): readonly Snapshot[] {
  const providers: Snapshot[] = []
  for (const item of Object.values(input)) {
    const providerID = Provider.ID.make(item.id)
    const info = {
      id: providerID,
      name: item.name,
      activation: "auto",
      package: Provider.aisdk(item.npm),
      ...(item.api ? { settings: { baseURL: item.api } } : {}),
    } satisfies Provider.Info
    const models: Model.Info[] = []
    for (const model of Object.values(item.models)) {
      const baseCost = cost(model.cost)
      const variants = reasoningVariants(item, model)
      const id = Model.ID.make(model.id)
      models.push(modelInfo(providerID, id, model, { cost: baseCost, variants }))
      for (const [mode, options] of Object.entries(model.experimental?.modes ?? {})) {
        const modeID = Model.ID.make(`${model.id}-${mode}`)
        models.push(
          modelInfo(providerID, modeID, model, {
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

const OPENAI_INCLUDE_ENCRYPTED_REASONING = ["reasoning.encrypted_content"]
const OUTPUT_TOKEN_MAX = 32_000

function reasoningVariants(provider: SourceProvider, model: SourceModel): NonNullable<Model.Info["variants"]> {
  const npm = model.provider?.npm ?? provider.npm
  const options = model.reasoning_options
  if (!options?.length) return []
  const toggle = options.some((option) => option.type === "toggle")
  const effort = options.find((option) => option.type === "effort")
  if (effort?.type === "effort") {
    const off = toggle ? toggleVariants(npm, model.id).filter((variant) => variant.id === "none") : []
    const variants = [
      ...off,
      ...effort.values.flatMap((value) => {
        const raw: unknown = value
        const id = typeof raw === "string" && raw !== "null" ? raw : undefined
        if (id === undefined) return []
        if (id === "none" && off.length > 0) return []
        const settings = settingsForEffort(npm, model.id, id)
        return settings ? [{ id: Model.VariantID.make(id), settings }] : []
      }),
    ]
    return [...new Map(variants.map((variant) => [variant.id, variant])).values()]
  }
  const budget = options.find((option) => option.type === "budget_tokens")
  if (budget?.type === "budget_tokens")
    return [
      ...(toggle ? toggleVariants(npm, model.id).filter((variant) => variant.id === "none") : []),
      ...budgetVariants(npm, model, budget),
    ]
  if (toggle) return toggleVariants(npm, model.id)
  return []
}

function settingsForEffort(npm: string, modelID: string, effort: string): Provider.Settings | undefined {
  if (npm === "@openrouter/ai-sdk-provider") return { reasoning: { effort } }
  if (npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/google-vertex/anthropic") {
    if (anthropicManualThinking(modelID)) return { effort }
    return {
      thinking: { type: "adaptive", display: "summarized" },
      effort,
    }
  }
  if (npm === "@ai-sdk/google" || npm === "@ai-sdk/google-vertex")
    return { thinkingConfig: { includeThoughts: true, thinkingLevel: effort } }
  if (npm === "@ai-sdk/amazon-bedrock") {
    if (modelID.includes("anthropic"))
      return {
        reasoningConfig: {
          ...(anthropicManualThinking(modelID) ? {} : { type: "adaptive", display: "summarized" }),
          maxReasoningEffort: effort,
        },
      }
    return { reasoningConfig: { type: "enabled", maxReasoningEffort: effort } }
  }
  if (npm === "@ai-sdk/gateway") {
    const upstream = gatewayPackage(modelID)
    if (upstream) return settingsForEffort(upstream, modelID, effort)
    return { reasoningEffort: effort }
  }
  if (npm === "@ai-sdk/github-copilot") {
    if (modelID.includes("gemini")) return
    if (modelID.includes("claude")) return { reasoningEffort: effort }
    return { reasoningEffort: effort, reasoningSummary: "auto", include: OPENAI_INCLUDE_ENCRYPTED_REASONING }
  }
  if (npm === "@ai-sdk/openai" || npm === "@ai-sdk/amazon-bedrock/mantle" || npm === "@ai-sdk/azure")
    return { reasoningEffort: effort, reasoningSummary: "auto", include: OPENAI_INCLUDE_ENCRYPTED_REASONING }
  if (npm === "@jerome-benoit/sap-ai-provider-v2") {
    if (modelID.includes("anthropic"))
      return {
        modelParams: {
          additionalModelRequestFields: {
            ...(anthropicManualThinking(modelID) ? {} : { thinking: { type: "adaptive", display: "summarized" } }),
            output_config: { effort },
          },
        },
      }
    if (modelID.includes("gemini"))
      return { modelParams: { thinkingConfig: { includeThoughts: true, thinkingLevel: effort } } }
    if (modelID.includes("amazon--nova"))
      return { modelParams: { additionalModelRequestFields: { output_config: { effort } } } }
    return { modelParams: { reasoning_effort: effort } }
  }
  if (
    [
      "@ai-sdk/openai-compatible",
      "@ai-sdk/xai",
      "@ai-sdk/mistral",
      "@ai-sdk/groq",
      "@ai-sdk/cerebras",
      "@ai-sdk/deepinfra",
      "@ai-sdk/togetherai",
      "venice-ai-sdk-provider",
      "ai-gateway-provider",
    ].includes(npm)
  )
    return { reasoningEffort: effort }
}

function budgetVariants(
  npm: string,
  model: SourceModel,
  option: Extract<NonNullable<SourceModel["reasoning_options"]>[number], { type: "budget_tokens" }>,
): NonNullable<Model.Info["variants"]> {
  const maximum = Math.min(option.max ?? OUTPUT_TOKEN_MAX - 1, model.limit.output - 1, OUTPUT_TOKEN_MAX - 1)
  if (maximum <= 0) return []
  const high = Math.min(Math.max(option.min ?? 0, Math.floor((maximum + 1) / 2)), maximum)
  return [
    { id: "high", budget: high },
    { id: "max", budget: maximum },
  ].flatMap((item) => {
    const settings = settingsForBudget(npm, model.id, item.budget)
    return settings ? [{ id: Model.VariantID.make(item.id), settings }] : []
  })
}

function toggleVariants(npm: string, modelID: string): NonNullable<Model.Info["variants"]> {
  if (npm === "@ai-sdk/gateway") {
    const upstream = gatewayPackage(modelID)
    if (upstream) return toggleVariants(upstream, modelID)
    return [
      {
        id: Model.VariantID.make("none"),
        settings: { reasoning: { enabled: false } },
      },
      {
        id: Model.VariantID.make("thinking"),
        settings: { reasoning: { enabled: true } },
      },
    ]
  }
  if (npm === "@openrouter/ai-sdk-provider")
    return [
      { id: Model.VariantID.make("none"), settings: { reasoning: { enabled: false } } },
      { id: Model.VariantID.make("thinking"), settings: { reasoning: { enabled: true } } },
    ]
  if (npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/google-vertex/anthropic")
    return [
      { id: Model.VariantID.make("none"), settings: { thinking: { type: "disabled" } } },
      {
        id: Model.VariantID.make("thinking"),
        settings: {
          thinking: { type: "adaptive", display: "summarized" },
        },
      },
    ]
  if (npm === "@ai-sdk/google" || npm === "@ai-sdk/google-vertex")
    return [
      {
        id: Model.VariantID.make("none"),
        settings: { thinkingConfig: { includeThoughts: false, thinkingBudget: 0 } },
      },
      {
        id: Model.VariantID.make("thinking"),
        settings: { thinkingConfig: { includeThoughts: true, thinkingBudget: -1 } },
      },
    ]
  if (npm === "@ai-sdk/amazon-bedrock") {
    const anthropic = modelID.includes("anthropic")
    return [
      {
        id: Model.VariantID.make("none"),
        settings: {
          additionalModelRequestFields: anthropic
            ? { thinking: { type: "disabled" } }
            : { reasoningConfig: { type: "disabled" } },
        },
      },
      {
        id: Model.VariantID.make("thinking"),
        settings: {
          additionalModelRequestFields: anthropic
            ? { thinking: { type: "adaptive", display: "summarized" } }
            : { reasoningConfig: { type: "enabled" } },
        },
      },
    ]
  }
  if (npm === "@ai-sdk/alibaba")
    return [
      { id: Model.VariantID.make("none"), settings: { enableThinking: false } },
      { id: Model.VariantID.make("thinking"), settings: { enableThinking: true } },
    ]
  if (npm === "@ai-sdk/cohere")
    return [
      { id: Model.VariantID.make("none"), settings: { thinking: { type: "disabled" } } },
      { id: Model.VariantID.make("thinking"), settings: { thinking: { type: "enabled" } } },
    ]
  if (npm === "@jerome-benoit/sap-ai-provider-v2") {
    if (modelID.includes("gemini"))
      return [
        {
          id: Model.VariantID.make("none"),
          settings: { modelParams: { thinkingConfig: { includeThoughts: false, thinkingBudget: 0 } } },
        },
        {
          id: Model.VariantID.make("thinking"),
          settings: { modelParams: { thinkingConfig: { includeThoughts: true, thinkingBudget: -1 } } },
        },
      ]
    if (modelID.includes("cohere"))
      return [
        {
          id: Model.VariantID.make("none"),
          settings: { modelParams: { thinking: { type: "disabled" } } },
        },
        {
          id: Model.VariantID.make("thinking"),
          settings: { modelParams: { thinking: { type: "enabled" } } },
        },
      ]
    if (modelID.includes("amazon--nova"))
      return [
        {
          id: Model.VariantID.make("none"),
          settings: { modelParams: { additionalModelRequestFields: { thinking: { type: "disabled" } } } },
        },
        {
          id: Model.VariantID.make("thinking"),
          settings: { modelParams: { additionalModelRequestFields: { thinking: { type: "enabled" } } } },
        },
      ]
    if (modelID.includes("anthropic"))
      return [
        {
          id: Model.VariantID.make("none"),
          settings: {
            modelParams: { additionalModelRequestFields: { thinking: { type: "disabled" } } },
          },
        },
        {
          id: Model.VariantID.make("thinking"),
          settings: {
            modelParams: {
              additionalModelRequestFields: {
                thinking: { type: "adaptive", display: "summarized" },
              },
            },
          },
        },
      ]
  }
  return []
}

function settingsForBudget(npm: string, modelID: string, budget: number): Provider.Settings | undefined {
  if (npm === "@openrouter/ai-sdk-provider") return { reasoning: { max_tokens: budget } }
  if (npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/google-vertex/anthropic")
    return { thinking: { type: "enabled", budgetTokens: budget } }
  if (npm === "@ai-sdk/google" || npm === "@ai-sdk/google-vertex")
    return { thinkingConfig: { includeThoughts: true, thinkingBudget: budget } }
  if (npm === "@ai-sdk/amazon-bedrock") return { reasoningConfig: { type: "enabled", budgetTokens: budget } }
  if (npm === "@ai-sdk/gateway") {
    const upstream = gatewayPackage(modelID)
    return upstream ? settingsForBudget(upstream, modelID, budget) : { reasoning: { max_tokens: budget } }
  }
  if (npm === "@ai-sdk/cohere") return { thinking: { type: "enabled", tokenBudget: budget } }
  if (npm === "@ai-sdk/alibaba") return { enableThinking: true, thinkingBudget: budget }
  if (npm === "@jerome-benoit/sap-ai-provider-v2") {
    if (modelID.includes("anthropic"))
      return {
        modelParams: {
          additionalModelRequestFields: { thinking: { type: "enabled", budget_tokens: budget } },
        },
      }
    if (modelID.includes("gemini"))
      return { modelParams: { thinkingConfig: { includeThoughts: true, thinkingBudget: budget } } }
    if (modelID.includes("cohere")) return { modelParams: { thinking: { type: "enabled", token_budget: budget } } }
  }
}

function gatewayPackage(modelID: string) {
  const separator = modelID.indexOf("/")
  if (separator <= 0) return
  const prefix = modelID.slice(0, separator)
  if (prefix === "anthropic") return "@ai-sdk/anthropic"
  if (prefix === "google") return "@ai-sdk/google"
  if (prefix === "amazon") return "@ai-sdk/amazon-bedrock"
  if (prefix === "alibaba") return "@ai-sdk/alibaba"
}

function anthropicManualThinking(modelID: string) {
  const familyFirst = /(?:claude-)?(?:opus|sonnet|haiku)-(\d+)(?:[.-](\d+))?/i.exec(modelID)
  const versionFirst = /claude-(\d+)(?:[.-](\d+))?-(?:opus|sonnet|haiku)/i.exec(modelID)
  const major = Number(familyFirst?.[1] ?? versionFirst?.[1])
  const rawMinor = Number(familyFirst?.[2] ?? versionFirst?.[2] ?? 0)
  if (!Number.isFinite(major)) return false
  const minor = rawMinor > 9 ? 0 : rawMinor
  return major < 4 || (major === 4 && minor < 6)
}

function modeName(model: SourceModel, mode: string) {
  return `${model.name} ${mode.charAt(0).toUpperCase()}${mode.slice(1)}`
}

function modelInfo(
  providerID: Provider.ID,
  id: Model.ID,
  model: SourceModel,
  input: {
    readonly name?: string
    readonly cost?: Model.Info["cost"]
    readonly request?: NonNullable<NonNullable<SourceModel["experimental"]>["modes"]>[string]["provider"]
    readonly variants?: NonNullable<Model.Info["variants"]>
  } = {},
): Model.Info {
  return {
    id,
    modelID: Model.ID.make(model.id),
    providerID,
    name: input.name ?? model.name,
    compatibility: Model.compatibility(model.interleaved),
    family: model.family ? Model.Family.make(model.family) : undefined,
    package: model.provider?.npm ? Provider.aisdk(model.provider.npm) : undefined,
    settings: model.provider?.api ? { baseURL: model.provider.api } : undefined,
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

export { Event } from "@opencode-ai/schema/models-dev"

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
          }
        if (value !== undefined) yield* kv.remove(key)
      })

      const fresh = Effect.fnUntraced(function* () {
        const cached = yield* loadFromCache()
        if (!cached) return false
        return Date.now() - cached.updatedAt < Duration.toMillis(ttl)
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
        : Effect.succeed(undefined)

      // The bundled snapshot is the boot-time floor for the catalog; the
      // periodic fetch below still refreshes on top.
      const loadSnapshot = options?.snapshot === false ? Effect.succeed(undefined) : bundledSnapshot

      const fetchAndWrite = Effect.fn("ModelsDev.fetchAndWrite")(function* () {
        const text = yield* fetchApi()
        const catalog = yield* decodeCatalog(text)
        // Best-effort: a cache-write failure must never kill catalog
        // population. The payload has outgrown some KV backends' per-value
        // limits (Durable Object SQLite caps values at 2 MB and api.json
        // passed it in Aug 2026); a boot without a cache hit just refetches.
        yield* kv.set(key, { updatedAt: Date.now(), body: text }).pipe(
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterruptsOnly(cause),
            (cause) => Effect.logWarning("Failed to cache models.dev catalog", { cause }),
          ),
        )
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
              if (!force && (yield* fresh())) return
              yield* fetchAndWrite()
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
