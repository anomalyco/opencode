import { Cause, Context, Duration, Effect, Layer, Option, Schedule, Schema, Semaphore } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { ModelsDev } from "@opencode/schema/models-dev"
import { Money } from "@opencode/schema/money"
import { AISDKNative } from "./aisdk-native.js"
import { App } from "./app.js"
import { Hash } from "@opencode/util/hash"
import { FSUtil } from "@opencode/util/fs-util"
import { Bus } from "./bus.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
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
      ...packageInfo(item.npm, undefined, item.api),
    } satisfies Provider.Info
    const models: Model.Info[] = []
    for (const model of Object.values(item.models)) {
      const baseCost = cost(model.cost)
      const npm = model.provider?.npm ?? item.npm
      const own = packageInfo(npm, model.id, model.provider?.api)
      const request = {
        ...own,
        // Models inherit the provider package unless theirs differs, e.g. Mantle gpt-oss selecting chat.
        package: own.package === info.package ? undefined : own.package,
        variants: reasoningVariants(own.package, model),
      }
      const id = Model.ID.make(model.id)
      models.push(modelInfo(providerID, id, model, { ...request, cost: baseCost }))
      for (const [mode, options] of Object.entries(model.experimental?.modes ?? {})) {
        const modeID = Model.ID.make(`${model.id}-${mode}`)
        models.push(
          modelInfo(providerID, modeID, model, {
            ...request,
            name: modeName(model, mode),
            cost: mergeCost(baseCost, options.cost),
            headers: Provider.mergeHeaders(own.headers, options.provider?.headers),
            body: Provider.mergeOverlay(own.body, options.provider?.body),
          }),
        )
      }
    }
    providers.push({ info, models, environment: [...item.env] })
  }
  return providers
}

/** The catalog package for a models.dev npm package: native where one exists, otherwise the AI SDK runtime. */
function packageInfo(
  npm: string,
  modelID: string | undefined,
  api: string | undefined,
): { readonly package: string } & AISDKNative.Overlay {
  const native = AISDKNative.nativePackage(npm, modelID)
  const overlay = api === undefined ? {} : { settings: { baseURL: api } }
  if (!native) return { package: Provider.aisdk(npm), ...overlay }
  return { package: native, ...AISDKNative.translate(native, overlay, modelID) }
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

type Variant = NonNullable<Model.Info["variants"]>[number]
type Overlay = Omit<Variant, "id">

const NATIVE = "@opencode/ai/providers/"
const OPENAI_FAMILY = [
  `${NATIVE}openai`,
  `${NATIVE}azure/responses`,
  `${NATIVE}amazon-bedrock/mantle/chat`,
  `${NATIVE}amazon-bedrock/mantle/responses`,
]
const CHAT_FAMILY = [
  `${NATIVE}openai-compatible`,
  `${NATIVE}xai`,
  `${NATIVE}mistral`,
  `${NATIVE}groq`,
  `${NATIVE}cerebras`,
  `${NATIVE}deepinfra`,
  `${NATIVE}togetherai`,
  Provider.aisdk("venice-ai-sdk-provider"),
  Provider.aisdk("ai-gateway-provider"),
]
// The Vercel gateway runs on the AI SDK and spells upstream options the AI SDK way, so its upstream keys stay legacy.
const ANTHROPIC_FAMILY = [`${NATIVE}anthropic`, `${NATIVE}google-vertex/messages`, Provider.aisdk("@ai-sdk/anthropic")]
const GEMINI_FAMILY = [`${NATIVE}google`, `${NATIVE}google-vertex`, Provider.aisdk("@ai-sdk/google")]
const BEDROCK = `${NATIVE}amazon-bedrock`
const LEGACY_BEDROCK = Provider.aisdk("@ai-sdk/amazon-bedrock")
const OPENROUTER = `${NATIVE}openrouter`
const GATEWAY = Provider.aisdk("@ai-sdk/gateway")
const SAP = Provider.aisdk("@jerome-benoit/sap-ai-provider-v2")
const ALIBABA = Provider.aisdk("@ai-sdk/alibaba")
const COHERE = Provider.aisdk("@ai-sdk/cohere")

function reasoningVariants(pkg: string, model: SourceModel): NonNullable<Model.Info["variants"]> {
  const options = model.reasoning_options
  if (!options?.length) return []
  const toggle = options.some((option) => option.type === "toggle")
  const effort = options.find((option) => option.type === "effort")
  if (effort?.type === "effort") {
    const off = toggle ? toggleVariants(pkg, model.id).filter((variant) => variant.id === "none") : []
    const variants = [
      ...off,
      ...effort.values.flatMap((value) => {
        const raw: unknown = value
        const id = typeof raw === "string" && raw !== "null" ? raw : undefined
        if (id === undefined) return []
        if (id === "none" && off.length > 0) return []
        const overlay = effortVariant(pkg, model.id, id)
        return overlay ? [{ id: Model.VariantID.make(id), ...overlay }] : []
      }),
    ]
    return [...new Map(variants.map((variant) => [variant.id, variant])).values()]
  }
  const budget = options.find((option) => option.type === "budget_tokens")
  if (budget?.type === "budget_tokens")
    return [
      ...(toggle ? toggleVariants(pkg, model.id).filter((variant) => variant.id === "none") : []),
      ...budgetVariants(pkg, model, budget),
    ]
  if (toggle) return toggleVariants(pkg, model.id)
  return []
}

function effortVariant(pkg: string, modelID: string, effort: string): Overlay | undefined {
  if (pkg === OPENROUTER) return { settings: { reasoning: { effort } } }
  if (ANTHROPIC_FAMILY.includes(pkg))
    return anthropicManualThinking(modelID)
      ? { settings: { effort } }
      : { settings: { thinking: { type: "adaptive", display: "summarized" }, effort } }
  if (GEMINI_FAMILY.includes(pkg))
    return { settings: { thinkingConfig: { includeThoughts: true, thinkingLevel: effort } } }
  if (pkg === BEDROCK) return { body: { additionalModelRequestFields: bedrockEffort(modelID, effort) } }
  if (pkg === LEGACY_BEDROCK)
    return {
      settings: {
        reasoningConfig: modelID.includes("anthropic")
          ? {
              ...(anthropicManualThinking(modelID) ? {} : { type: "adaptive", display: "summarized" }),
              maxReasoningEffort: effort,
            }
          : { type: "enabled", maxReasoningEffort: effort },
      },
    }
  if (pkg === GATEWAY) {
    const upstream = gatewayPackage(modelID)
    if (upstream) return effortVariant(upstream, modelID, effort)
    return { settings: { reasoningEffort: effort } }
  }
  if (OPENAI_FAMILY.includes(pkg))
    return {
      settings: { reasoningEffort: effort, reasoningSummary: "auto", include: OPENAI_INCLUDE_ENCRYPTED_REASONING },
    }
  if (pkg === SAP) {
    if (modelID.includes("anthropic"))
      return {
        settings: {
          modelParams: {
            additionalModelRequestFields: {
              ...(anthropicManualThinking(modelID) ? {} : { thinking: { type: "adaptive", display: "summarized" } }),
              output_config: { effort },
            },
          },
        },
      }
    if (modelID.includes("gemini"))
      return { settings: { modelParams: { thinkingConfig: { includeThoughts: true, thinkingLevel: effort } } } }
    if (modelID.includes("amazon--nova"))
      return { settings: { modelParams: { additionalModelRequestFields: { output_config: { effort } } } } }
    return { settings: { modelParams: { reasoning_effort: effort } } }
  }
  if (CHAT_FAMILY.includes(pkg)) return { settings: { reasoningEffort: effort } }
}

// Converse spells reasoning per model family inside `additionalModelRequestFields`.
function bedrockEffort(modelID: string, effort: string) {
  if (modelID.includes("anthropic"))
    return {
      ...(anthropicManualThinking(modelID) ? {} : { thinking: { type: "adaptive", display: "summarized" } }),
      output_config: { effort },
    }
  // gpt-oss (Harmony) takes the flat chat-completions `reasoning_effort`; GPT-5.6+ take Responses-style `reasoning.effort`.
  if (modelID.includes("openai.gpt-oss")) return { reasoning_effort: effort }
  if (modelID.includes("openai.")) return { reasoning: { effort } }
  return { reasoningConfig: { type: "enabled", maxReasoningEffort: effort } }
}

function budgetVariants(
  pkg: string,
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
    const overlay = budgetVariant(pkg, model.id, item.budget)
    return overlay ? [{ id: Model.VariantID.make(item.id), ...overlay }] : []
  })
}

function toggleVariants(pkg: string, modelID: string): NonNullable<Model.Info["variants"]> {
  const none = Model.VariantID.make("none")
  const thinking = Model.VariantID.make("thinking")
  if (pkg === GATEWAY) {
    const upstream = gatewayPackage(modelID)
    if (upstream) return toggleVariants(upstream, modelID)
    return [
      { id: none, settings: { reasoning: { enabled: false } } },
      { id: thinking, settings: { reasoning: { enabled: true } } },
    ]
  }
  if (pkg === OPENROUTER)
    return [
      { id: none, settings: { reasoning: { enabled: false } } },
      { id: thinking, settings: { reasoning: { enabled: true } } },
    ]
  if (ANTHROPIC_FAMILY.includes(pkg))
    return [
      { id: none, settings: { thinking: { type: "disabled" } } },
      { id: thinking, settings: { thinking: { type: "adaptive", display: "summarized" } } },
    ]
  if (GEMINI_FAMILY.includes(pkg))
    return [
      { id: none, settings: { thinkingConfig: { includeThoughts: false, thinkingBudget: 0 } } },
      { id: thinking, settings: { thinkingConfig: { includeThoughts: true, thinkingBudget: -1 } } },
    ]
  if (pkg === BEDROCK || pkg === LEGACY_BEDROCK) {
    const anthropic = modelID.includes("anthropic")
    const off = anthropic ? { thinking: { type: "disabled" } } : { reasoningConfig: { type: "disabled" } }
    const on = anthropic
      ? { thinking: { type: "adaptive", display: "summarized" } }
      : { reasoningConfig: { type: "enabled" } }
    if (pkg === LEGACY_BEDROCK)
      return [
        { id: none, settings: { additionalModelRequestFields: off } },
        { id: thinking, settings: { additionalModelRequestFields: on } },
      ]
    return [
      { id: none, body: { additionalModelRequestFields: off } },
      { id: thinking, body: { additionalModelRequestFields: on } },
    ]
  }
  if (pkg === ALIBABA)
    return [
      { id: none, settings: { enableThinking: false } },
      { id: thinking, settings: { enableThinking: true } },
    ]
  if (pkg === COHERE)
    return [
      { id: none, settings: { thinking: { type: "disabled" } } },
      { id: thinking, settings: { thinking: { type: "enabled" } } },
    ]
  if (pkg === SAP) {
    if (modelID.includes("gemini"))
      return [
        { id: none, settings: { modelParams: { thinkingConfig: { includeThoughts: false, thinkingBudget: 0 } } } },
        { id: thinking, settings: { modelParams: { thinkingConfig: { includeThoughts: true, thinkingBudget: -1 } } } },
      ]
    if (modelID.includes("cohere"))
      return [
        { id: none, settings: { modelParams: { thinking: { type: "disabled" } } } },
        { id: thinking, settings: { modelParams: { thinking: { type: "enabled" } } } },
      ]
    if (modelID.includes("amazon--nova"))
      return [
        { id: none, settings: { modelParams: { additionalModelRequestFields: { thinking: { type: "disabled" } } } } },
        {
          id: thinking,
          settings: { modelParams: { additionalModelRequestFields: { thinking: { type: "enabled" } } } },
        },
      ]
    if (modelID.includes("anthropic"))
      return [
        { id: none, settings: { modelParams: { additionalModelRequestFields: { thinking: { type: "disabled" } } } } },
        {
          id: thinking,
          settings: {
            modelParams: { additionalModelRequestFields: { thinking: { type: "adaptive", display: "summarized" } } },
          },
        },
      ]
  }
  return []
}

function budgetVariant(pkg: string, modelID: string, budget: number): Overlay | undefined {
  if (pkg === OPENROUTER) return { settings: { reasoning: { max_tokens: budget } } }
  if (ANTHROPIC_FAMILY.includes(pkg)) return { settings: { thinking: { type: "enabled", budgetTokens: budget } } }
  if (GEMINI_FAMILY.includes(pkg))
    return { settings: { thinkingConfig: { includeThoughts: true, thinkingBudget: budget } } }
  if (pkg === BEDROCK) return { body: { additionalModelRequestFields: bedrockBudget(modelID, budget) } }
  if (pkg === LEGACY_BEDROCK) return { settings: { reasoningConfig: { type: "enabled", budgetTokens: budget } } }
  if (pkg === GATEWAY) {
    const upstream = gatewayPackage(modelID)
    return upstream ? budgetVariant(upstream, modelID, budget) : { settings: { reasoning: { max_tokens: budget } } }
  }
  if (pkg === COHERE) return { settings: { thinking: { type: "enabled", tokenBudget: budget } } }
  if (pkg === ALIBABA) return { settings: { enableThinking: true, thinkingBudget: budget } }
  if (pkg === SAP) {
    if (modelID.includes("anthropic"))
      return {
        settings: {
          modelParams: { additionalModelRequestFields: { thinking: { type: "enabled", budget_tokens: budget } } },
        },
      }
    if (modelID.includes("gemini"))
      return { settings: { modelParams: { thinkingConfig: { includeThoughts: true, thinkingBudget: budget } } } }
    if (modelID.includes("cohere"))
      return { settings: { modelParams: { thinking: { type: "enabled", token_budget: budget } } } }
  }
}

function bedrockBudget(modelID: string, budget: number) {
  if (modelID.includes("anthropic")) return { thinking: { type: "enabled", budget_tokens: budget } }
  return { reasoningConfig: { type: "enabled", budgetTokens: budget } }
}

function gatewayPackage(modelID: string) {
  const separator = modelID.indexOf("/")
  if (separator <= 0) return
  const prefix = modelID.slice(0, separator)
  if (prefix === "anthropic") return Provider.aisdk("@ai-sdk/anthropic")
  if (prefix === "google") return Provider.aisdk("@ai-sdk/google")
  if (prefix === "amazon") return LEGACY_BEDROCK
  if (prefix === "alibaba") return ALIBABA
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
  input: AISDKNative.Overlay & {
    readonly name?: string
    readonly package?: string
    readonly cost?: Model.Info["cost"]
    readonly variants?: NonNullable<Model.Info["variants"]>
  },
): Model.Info {
  return {
    id,
    modelID: Model.ID.make(model.id),
    providerID,
    name: input.name ?? model.name,
    compatibility: Model.compatibility(model.interleaved),
    family: model.family ? Model.Family.make(model.family) : undefined,
    package: input.package,
    settings: input.settings,
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
    headers: input.headers,
    body: input.body,
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
              // downstream catalog.updated listeners stay quiet.
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
