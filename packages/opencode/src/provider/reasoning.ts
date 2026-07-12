import type { Provider } from "./provider"

export const INCLUDE_ENCRYPTED_REASONING = ["reasoning.encrypted_content"] as const

type Variant = Record<string, unknown>
type ReasoningOption = NonNullable<Provider.Model["reasoning_options"]>[number]
type BudgetOption = Extract<ReasoningOption, { type: "budget_tokens" }>

export function variants(model: Provider.Model): Record<string, Variant> | undefined {
  if (model.reasoning_options === undefined) return
  const effort = model.reasoning_options.find((option) => option.type === "effort")
  if (effort?.type === "effort") {
    return Object.fromEntries(
      effort.values.flatMap((value): [string, Variant][] => {
        if (value === null) return []
        const variant = effortVariant(model, value)
        return variant ? [[value, variant]] : []
      }),
    )
  }
  const budget = model.reasoning_options.find((option) => option.type === "budget_tokens")
  if (budget?.type === "budget_tokens") return budgetVariants(model, budget)
  return {}
}

function effortVariant(model: Provider.Model, effort: string): Variant | undefined {
  switch (model.api.npm) {
    case "@openrouter/ai-sdk-provider":
      return { reasoning: { effort } }
    case "@ai-sdk/anthropic":
    case "@ai-sdk/google-vertex/anthropic":
      return anthropicEffort(model.api.id, effort)
    case "@ai-sdk/google":
    case "@ai-sdk/google-vertex":
      return { thinkingConfig: { includeThoughts: true, thinkingLevel: effort } }
    case "@ai-sdk/azure":
    case "@ai-sdk/openai":
    case "@ai-sdk/amazon-bedrock/mantle":
      return { reasoningEffort: effort, reasoningSummary: "auto", include: INCLUDE_ENCRYPTED_REASONING }
    case "@ai-sdk/amazon-bedrock": {
      const adaptive = anthropicAdaptiveEfforts(model.api.id) !== null
      return {
        reasoningConfig: {
          type: adaptive ? "adaptive" : "enabled",
          maxReasoningEffort: effort,
          ...(adaptive && anthropicOmitsThinking(model.api.id) ? { display: "summarized" } : {}),
        },
      }
    }
    case "@ai-sdk/gateway":
      if (model.api.id.includes("anthropic")) return anthropicEffort(model.api.id, effort)
      if (model.api.id.includes("google")) return { includeThoughts: true, thinkingLevel: effort }
      return { reasoningEffort: effort }
    case "@jerome-benoit/sap-ai-provider-v2":
      if (model.api.id.includes("anthropic")) {
        const thinking = anthropicThinking(model.api.id)
        return { modelParams: { ...(thinking ? { thinking } : {}), output_config: { effort } } }
      }
      return { modelParams: { reasoning_effort: effort } }
    case "@ai-sdk/openai-compatible":
    case "ai-gateway-provider":
    case "@ai-sdk/github-copilot":
    case "@ai-sdk/cerebras":
    case "@ai-sdk/togetherai":
    case "@ai-sdk/xai":
    case "@ai-sdk/deepinfra":
    case "venice-ai-sdk-provider":
    case "@ai-sdk/groq":
    case "@ai-sdk/mistral":
      return { reasoningEffort: effort }
  }
}

function budgetVariants(model: Provider.Model, option: BudgetOption): Record<string, Variant> {
  const high =
    option.max === undefined
      ? Math.max(option.min ?? 0, 16_000)
      : Math.min(Math.max(option.min ?? 0, 16_000), option.max)
  return Object.fromEntries(
    [
      { id: "high", budget: high },
      ...(option.max === undefined || option.max === high ? [] : [{ id: "max", budget: option.max }]),
    ].flatMap((item): [string, Variant][] => {
      const variant = budgetVariant(model, item.budget)
      return variant ? [[item.id, variant]] : []
    }),
  )
}

function budgetVariant(model: Provider.Model, budget: number): Variant | undefined {
  switch (model.api.npm) {
    case "@openrouter/ai-sdk-provider":
      return { reasoning: { max_tokens: budget } }
    case "@ai-sdk/anthropic":
    case "@ai-sdk/google-vertex/anthropic":
      return { thinking: { type: "enabled", budgetTokens: budget } }
    case "@ai-sdk/google":
    case "@ai-sdk/google-vertex":
      return { thinkingConfig: { includeThoughts: true, thinkingBudget: budget } }
    case "@ai-sdk/amazon-bedrock":
      if (model.api.id.includes("anthropic")) return { reasoningConfig: { type: "enabled", budgetTokens: budget } }
      return
    case "@ai-sdk/gateway":
      if (model.api.id.includes("anthropic")) return { thinking: { type: "enabled", budgetTokens: budget } }
      if (model.api.id.includes("google")) return { thinkingConfig: { includeThoughts: true, thinkingBudget: budget } }
      return
    case "@jerome-benoit/sap-ai-provider-v2":
      if (model.api.id.includes("anthropic")) {
        return { modelParams: { thinking: { type: "enabled", budget_tokens: budget } } }
      }
      if (model.api.id.includes("gemini")) {
        return { modelParams: { thinkingConfig: { includeThoughts: true, thinkingBudget: budget } } }
      }
  }
}

function anthropicEffort(apiID: string, effort: string): Variant {
  const thinking = anthropicThinking(apiID)
  return {
    ...(thinking ? { thinking } : {}),
    effort,
  }
}

function anthropicThinking(apiID: string) {
  if (!anthropicAdaptiveEfforts(apiID)) return
  return { type: "adaptive", ...(anthropicOmitsThinking(apiID) ? { display: "summarized" } : {}) }
}

function anthropicOpus47OrLater(apiID: string) {
  const version = /opus-(\d+)[.-](\d+)(?:[.@-]|$)|claude-(\d+)[.-](\d+)-opus(?:[.@-]|$)/i.exec(apiID)
  if (!version) return false
  const major = Number(version[1] ?? version[3])
  const minor = Number(version[2] ?? version[4])
  return major > 4 || (major === 4 && minor >= 7)
}

function anthropicSonnet5OrLater(apiID: string) {
  const version = /sonnet-(\d+)(?:[.@-]|$)|claude-(\d+)-sonnet(?:[.@-]|$)/i.exec(apiID)
  if (!version) return false
  return Number(version[1] ?? version[2]) >= 5
}

export function anthropicAdaptiveEfforts(apiID: string): string[] | null {
  if (anthropicOpus47OrLater(apiID) || anthropicSonnet5OrLater(apiID) || apiID.includes("fable-5")) {
    return ["low", "medium", "high", "xhigh", "max"]
  }
  if (
    ["opus-4-6", "opus-4.6", "4-6-opus", "4.6-opus", "sonnet-4-6", "sonnet-4.6", "4-6-sonnet", "4.6-sonnet"].some(
      (value) => apiID.includes(value),
    )
  ) {
    return ["low", "medium", "high", "max"]
  }
  return null
}

export function anthropicOmitsThinking(apiID: string) {
  return anthropicOpus47OrLater(apiID) || anthropicSonnet5OrLater(apiID) || apiID.includes("fable-5")
}

export function wrapInSapModelParams(variants: Record<string, Variant>): Record<string, Variant> {
  return Object.fromEntries(Object.entries(variants).map(([id, variant]) => [id, { modelParams: variant }]))
}

export * as ProviderReasoning from "./reasoning"
