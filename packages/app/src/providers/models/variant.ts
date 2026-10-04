type AgentModel = {
  providerID: string
  modelID: string
}

type Agent<V extends string> = {
  model?: AgentModel
  variant?: V
}

type Model = AgentModel & {
  variants?: Record<string, unknown>
}

type VariantInput<V extends string> = {
  variants: V[]
  selected: V | null | undefined
  configured: V | undefined
  preferred?: V
}

export function getConfiguredAgentVariant<V extends string>(input: {
  agent: Agent<V> | undefined
  model: Model | undefined
}) {
  if (!input.agent?.variant) return undefined
  if (!input.agent.model) return undefined
  if (!input.model?.variants) return undefined
  if (input.agent.model.providerID !== input.model.providerID) return undefined
  if (input.agent.model.modelID !== input.model.modelID) return undefined
  return input.agent.variant
}

export function resolveModelVariant<V extends string>(input: VariantInput<V>) {
  if (input.selected === null) return undefined
  const value = input.selected ?? input.preferred ?? input.configured
  return value && value !== "default" && input.variants.includes(value) ? value : undefined
}

export function cycleModelVariant<V extends string>(input: VariantInput<V>) {
  const current = resolveModelVariant(input)
  return input.variants[current ? input.variants.indexOf(current) + 1 : 0]
}
