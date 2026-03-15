type AgentModel = {
  providerID: string
  modelID: string
}

type Agent = {
  model?: AgentModel
  variant?: string
}

type Model = AgentModel & {
  options?: Record<string, unknown>
  variants?: Record<string, unknown>
}

type VariantInput = {
  variants: string[]
  selected: string | null | undefined
  configured: string | undefined
}

export function getConfiguredAgentVariant(input: { agent: Agent | undefined; model: Model | undefined }) {
  if (!input.agent?.variant) return undefined
  if (!input.agent.model) return undefined
  if (!input.model?.variants) return undefined
  if (input.agent.model.providerID !== input.model.providerID) return undefined
  if (input.agent.model.modelID !== input.model.modelID) return undefined
  if (!(input.agent.variant in input.model.variants)) return undefined
  return input.agent.variant
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function pick(value: unknown, path: string[]) {
  return path.reduce<unknown>((acc, key) => (record(acc) ? acc[key] : undefined), value)
}

function signal(value: unknown) {
  const keys = [
    ["reasoningEffort"],
    ["reasoning", "effort"],
    ["effort"],
    ["thinkingLevel"],
    ["thinkingBudget"],
    ["thinking_budget"],
    ["thinkingConfig", "thinkingLevel"],
    ["thinkingConfig", "thinkingBudget"],
    ["thinking", "budgetTokens"],
    ["reasoningConfig", "budgetTokens"],
    ["reasoningConfig", "maxReasoningEffort"],
  ]

  return keys.flatMap((path) => {
    const item = pick(value, path)
    return item === undefined ? [] : [[path.join("."), item] as const]
  })
}

export function getConfiguredModelVariant(input: { model: Model | undefined }) {
  if (!input.model?.variants) return undefined
  if (!input.model.options) return undefined
  const cfg = signal(input.model.options)
  if (cfg.length === 0) return undefined
  return Object.entries(input.model.variants).find(([, value]) => {
    const variant = new Map(signal(value))
    return cfg.every(([key, item]) => variant.get(key) === item)
  })?.[0]
}

export function resolveModelVariant(input: VariantInput) {
  if (input.selected === null) return undefined
  if (input.selected && input.variants.includes(input.selected)) return input.selected
  if (input.configured && input.variants.includes(input.configured)) return input.configured
  return undefined
}

export function cycleModelVariant(input: VariantInput) {
  if (input.variants.length === 0) return undefined
  if (input.selected === null) return input.variants[0]
  if (input.selected && input.variants.includes(input.selected)) {
    const index = input.variants.indexOf(input.selected)
    if (index === input.variants.length - 1) return undefined
    return input.variants[index + 1]
  }
  if (input.configured && input.variants.includes(input.configured)) {
    const index = input.variants.indexOf(input.configured)
    if (index === input.variants.length - 1) return input.variants[0]
    return input.variants[index + 1]
  }
  return input.variants[0]
}
