import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import type { ModelV2Info } from "@opencode-ai/sdk/v2/types"
import { Effect, Stream } from "effect"
import { EventV2 } from "../event"
import { ModelV2 } from "../model"
import { ModelsDev } from "../models-dev"
import { ProviderV2 } from "../provider"

function released(date: string) {
  const time = Date.parse(date)
  return Number.isFinite(time) ? time : 0
}

function cost(input: ModelsDev.Model["cost"]): ModelV2Info["cost"] {
  const base = {
    input: input?.input ?? 0,
    output: input?.output ?? 0,
    cache: {
      read: input?.cache_read ?? 0,
      write: input?.cache_write ?? 0,
    },
  }
  return [
    base,
    ...(input?.tiers?.map((item) => ({
      tier: item.tier,
      input: item.input,
      output: item.output,
      cache: {
        read: item.cache_read ?? 0,
        write: item.cache_write ?? 0,
      },
    })) ?? []),
    ...(input?.context_over_200k
      ? [
          {
            tier: {
              type: "context" as const,
              size: 200_000,
            },
            input: input.context_over_200k.input,
            output: input.context_over_200k.output,
            cache: {
              read: input.context_over_200k.cache_read ?? 0,
              write: input.context_over_200k.cache_write ?? 0,
            },
          },
        ]
      : []),
  ]
}

function mergeCost(base: ModelV2Info["cost"], override: ModelsDev.Model["cost"] | undefined) {
  if (!override) return base
  const next = cost(override)
  const [baseDefault, ...baseTiers] = base
  const [nextDefault, ...nextTiers] = next
  const tierKey = (item: ModelV2Info["cost"][number]) => `${item.tier?.type ?? "base"}:${item.tier?.size ?? 0}`
  const merge = (left: ModelV2Info["cost"][number], right: ModelV2Info["cost"][number]) => ({
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
  return [merge(baseDefault ?? { input: 0, output: 0, cache: { read: 0, write: 0 } }, nextDefault), ...tiers.values()]
}

const OPENAI_INCLUDE_ENCRYPTED_REASONING = ["reasoning.encrypted_content"]

function reasoningVariants(provider: ModelsDev.Provider, model: ModelsDev.Model): ModelV2Info["variants"] {
  const npm = model.provider?.npm ?? provider.npm
  const options = model.reasoning_options ?? []
  const effort = options.find((option) => option.type === "effort")
  if (effort?.type === "effort") {
    return effort.values.flatMap((value) => {
      const raw: unknown = value
      const id = raw === null ? "none" : typeof raw === "string" ? raw : undefined
      if (id === undefined) return []
      const settings = settingsForEffort(npm, id)
      return settings ? [{ id, settings, headers: {}, body: {} }] : []
    })
  }

  const budget = options.find((option) => option.type === "budget_tokens")
  if (budget?.type === "budget_tokens") return budgetVariants(npm, budget)

  // Toggle-only reasoning is intentionally left for a follow-up because V1 has
  // provider/model-specific behavior like MiniMax M3 adaptive thinking and
  // Qwen/GLM enable_thinking request shapes in packages/opencode.
  return []
}

function settingsForEffort(npm: string | undefined, effort: string): ProviderV2.Settings | undefined {
  if (npm === "@openrouter/ai-sdk-provider") return { reasoning: { effort } }
  if (npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/google-vertex/anthropic") {
    return { thinking: { type: "adaptive", display: "summarized" }, effort }
  }
  if (npm === "@ai-sdk/google" || npm === "@ai-sdk/google-vertex") {
    return { thinkingConfig: { includeThoughts: true, thinkingLevel: effort } }
  }
  if (npm === "@ai-sdk/azure") return { reasoningEffort: effort }
  if (npm === "@ai-sdk/openai") {
    return {
      reasoningEffort: effort,
      reasoningSummary: "auto",
      include: OPENAI_INCLUDE_ENCRYPTED_REASONING,
    }
  }
  if (npm === "@ai-sdk/openai-compatible") return { reasoningEffort: effort }
}

function budgetVariants(
  npm: string | undefined,
  option: Extract<NonNullable<ModelsDev.Model["reasoning_options"]>[number], { type: "budget_tokens" }>,
): ModelV2Info["variants"] {
  const max = option.max
  const high = option.max === undefined ? Math.max(option.min ?? 0, 16_000) : Math.min(Math.max(option.min ?? 0, 16_000), option.max)
  return [
    { id: "high", budget: high },
    ...(max === undefined || max === high ? [] : [{ id: "max", budget: max }]),
  ].flatMap((item) => {
    const settings = settingsForBudget(npm, item.budget)
    return settings ? [{ id: item.id, settings, headers: {}, body: {} }] : []
  })
}

function settingsForBudget(npm: string | undefined, budget: number): ProviderV2.Settings | undefined {
  if (npm === "@openrouter/ai-sdk-provider") return { reasoning: { max_tokens: budget } }
  if (npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/google-vertex/anthropic") {
    return { thinking: { type: "enabled", budgetTokens: budget } }
  }
  if (npm === "@ai-sdk/google" || npm === "@ai-sdk/google-vertex") {
    return { thinkingConfig: { includeThoughts: true, thinkingBudget: budget } }
  }
}

function modeName(model: ModelsDev.Model, mode: string) {
  return `${model.name} ${mode.charAt(0).toUpperCase()}${mode.slice(1)}`
}

function mergeVariants(model: ModelV2Info, next: ModelV2Info["variants"]) {
  const existing = new Map(model.variants.map((variant) => [variant.id, variant]))
  const nextIDs = new Set(next.map((variant) => variant.id))
  model.variants = [
    ...next.map((variant) => existing.get(variant.id) ?? variant),
    ...model.variants.filter((variant) => !nextIDs.has(variant.id)),
  ]
}

function applyModel(
  draft: ModelV2Info,
  model: ModelsDev.Model,
  input: {
    readonly name?: string
    readonly cost?: ModelV2Info["cost"]
    readonly request?: NonNullable<NonNullable<ModelsDev.Model["experimental"]>["modes"]>[string]["provider"]
    readonly variants?: ModelV2Info["variants"]
  } = {},
) {
  draft.name = input.name ?? model.name
  draft.family = model.family ? ModelV2.Family.make(model.family) : undefined
  draft.api = model.provider?.npm
    ? {
        id: ModelV2.ID.make(model.id),
        type: "aisdk",
        package: model.provider.npm,
        url: model.provider.api,
      }
    : {
        id: ModelV2.ID.make(model.id),
        type: "native",
        url: model.provider?.api,
        settings: {},
      }
  draft.capabilities = {
    tools: model.tool_call,
    input: [...(model.modalities?.input ?? [])],
    output: [...(model.modalities?.output ?? [])],
  }
  mergeVariants(draft, input.variants ?? [])
  draft.time.released = released(model.release_date)
  draft.cost = input.cost ?? cost(model.cost)
  draft.status = model.status ?? "active"
  draft.enabled = true
  draft.limit = {
    context: model.limit.context,
    input: model.limit.input,
    output: model.limit.output,
  }
  Object.assign(draft.request.headers, input.request?.headers ?? {})
  Object.assign(draft.request.body, input.request?.body ?? {})
}

export const ModelsDevPlugin = define({
  id: "opencode.models-dev",
  effect: Effect.fn(function* (ctx) {
    const modelsDev = yield* ModelsDev.Service
    const events = yield* EventV2.Service
    const loaded = { data: yield* modelsDev.get() }
    yield* ctx.integration.transform((integrations) => {
      for (const item of Object.values(loaded.data)) {
        if (item.env.length === 0) continue
        const integrationID = item.id
        integrations.update(integrationID, (integration) => (integration.name = item.name))
        integrations.method.update({
          integrationID,
          method: { type: "key" },
        })
        integrations.method.update({
          integrationID,
          method: { type: "env", names: [...item.env] },
        })
      }
    })
    yield* ctx.catalog.transform((catalog) => {
      for (const item of Object.values(loaded.data)) {
        const providerID = ProviderV2.ID.make(item.id)
        catalog.provider.update(providerID, (provider) => {
          provider.name = item.name
          provider.api = item.npm
            ? {
                type: "aisdk",
                package: item.npm,
                url: item.api,
              }
            : {
                type: "native",
                url: item.api,
                settings: {},
              }
        })

        for (const model of Object.values(item.models)) {
          const baseCost = cost(model.cost)
          const variants = reasoningVariants(item, model)
          catalog.model.update(providerID, model.id, (draft) => applyModel(draft, model, { cost: baseCost, variants }))
          for (const [mode, options] of Object.entries(model.experimental?.modes ?? {})) {
            catalog.model.update(providerID, `${model.id}-${mode}`, (draft) =>
              applyModel(draft, model, {
                name: modeName(model, mode),
                cost: mergeCost(baseCost, options.cost),
                request: options.provider,
                variants,
              }),
            )
          }
        }
      }
    })
    yield* events.subscribe(ModelsDev.Event.Refreshed).pipe(
      Stream.runForEach(() =>
        modelsDev.get().pipe(
          Effect.tap((data) => Effect.sync(() => (loaded.data = data))),
          Effect.andThen(ctx.integration.reload()),
          Effect.andThen(ctx.catalog.reload()),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
