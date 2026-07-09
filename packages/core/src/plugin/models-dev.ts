import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Money } from "@opencode-ai/schema/money"
import type { ModelInfo } from "@opencode-ai/sdk/v2/types"
import { Effect, Stream } from "effect"
import { EventV2 } from "../event"
import { ModelV2 } from "../model"
import { ModelsDev } from "../models-dev"
import { ProviderV2 } from "../provider"

function released(date: string) {
  const time = Date.parse(date)
  return Number.isFinite(time) ? time : 0
}

function cost(input: ModelsDev.Model["cost"]): ModelInfo["cost"] {
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
            tier: {
              type: "context" as const,
              size: 200_000,
            },
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

function mergeCost(base: ModelInfo["cost"], override: ModelsDev.Model["cost"] | undefined) {
  if (!override) return base
  const next = cost(override)
  const [baseDefault, ...baseTiers] = base
  const [nextDefault, ...nextTiers] = next
  const tierKey = (item: ModelInfo["cost"][number]) => `${item.tier?.type ?? "base"}:${item.tier?.size ?? 0}`
  const merge = (left: ModelInfo["cost"][number], right: ModelInfo["cost"][number]) => ({
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
        cache: {
          read: Money.USDPerMillionTokens.zero,
          write: Money.USDPerMillionTokens.zero,
        },
      },
      nextDefault,
    ),
    ...tiers.values(),
  ]
}

const OPENAI_INCLUDE_ENCRYPTED_REASONING = ["reasoning.encrypted_content"]

function reasoningVariants(provider: ModelsDev.Provider, model: ModelsDev.Model): NonNullable<ModelInfo["variants"]> {
  const npm = model.provider?.npm ?? provider.npm
  const options = model.reasoning_options ?? []
  const effort = options.find((option) => option.type === "effort")
  if (effort?.type === "effort") {
    return effort.values.flatMap((value) => {
      const raw: unknown = value
      const id = raw === null ? "none" : typeof raw === "string" ? raw : undefined
      if (id === undefined) return []
      const settings = settingsForEffort(npm, id)
      return settings ? [{ id: ModelV2.VariantID.make(id), settings }] : []
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
): NonNullable<ModelInfo["variants"]> {
  const max = option.max
  const high =
    option.max === undefined
      ? Math.max(option.min ?? 0, 16_000)
      : Math.min(Math.max(option.min ?? 0, 16_000), option.max)
  return [
    { id: "high", budget: high },
    ...(max === undefined || max === high ? [] : [{ id: "max", budget: max }]),
  ].flatMap((item) => {
    const settings = settingsForBudget(npm, item.budget)
    return settings ? [{ id: ModelV2.VariantID.make(item.id), settings }] : []
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

function mergeVariants(model: ModelInfo, next: NonNullable<ModelInfo["variants"]>) {
  const variants = model.variants ?? []
  const existing = new Map(variants.map((variant) => [variant.id, variant]))
  const nextIDs = new Set(next.map((variant) => variant.id))
  model.variants = [
    ...next.map((variant) => existing.get(variant.id) ?? variant),
    ...variants.filter((variant) => !nextIDs.has(variant.id)),
  ]
}

function applyModel(
  draft: ModelInfo,
  model: ModelsDev.Model,
  input: {
    readonly name?: string
    readonly cost?: ModelInfo["cost"]
    readonly request?: NonNullable<NonNullable<ModelsDev.Model["experimental"]>["modes"]>[string]["provider"]
    readonly variants?: NonNullable<ModelInfo["variants"]>
  } = {},
) {
  draft.name = input.name ?? model.name
  draft.modelID = model.id
  draft.family = model.family ? ModelV2.Family.make(model.family) : undefined
  draft.package = model.provider?.npm ? ProviderV2.aisdk(model.provider.npm) : undefined
  draft.settings = model.provider?.api ? { ...draft.settings, baseURL: model.provider.api } : draft.settings
  draft.capabilities = {
    tools: model.tool_call,
    input: [...(model.modalities?.input ?? [])],
    output: [...(model.modalities?.output ?? [])],
  }
  mergeVariants(draft, input.variants ?? [])
  draft.time.released = released(model.release_date)
  draft.cost = (input.cost ?? cost(model.cost)).map((item) => ({
    ...item,
    tier: item.tier && { ...item.tier },
    cache: { ...item.cache },
  }))
  draft.status = model.status ?? "active"
  draft.enabled = true
  draft.limit = {
    context: model.limit.context,
    input: model.limit.input,
    output: model.limit.output,
  }
  draft.headers = { ...draft.headers, ...input.request?.headers }
  draft.body = { ...draft.body, ...input.request?.body }
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
          provider.package = item.npm ? ProviderV2.aisdk(item.npm) : ""
          provider.settings = item.api ? { ...provider.settings, baseURL: item.api } : provider.settings
        })

        for (const model of Object.values(item.models)) {
          const baseCost = cost(model.cost)
          const variants = reasoningVariants(item, model)
          catalog.model.update(providerID, ModelV2.ID.make(model.id), (draft) =>
            applyModel(draft, model, { cost: baseCost, variants }),
          )
          for (const [mode, options] of Object.entries(model.experimental?.modes ?? {})) {
            catalog.model.update(providerID, ModelV2.ID.make(`${model.id}-${mode}`), (draft) =>
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
