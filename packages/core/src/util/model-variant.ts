type ModelRef = {
  providerID: string
  id: string
}

type ConfiguredModel = ModelRef & {
  variant?: string
}

type Model = ModelRef & {
  variants?: Record<string, unknown>
}

// selected: string          = user-chosen variant name
// selected: null            = user explicitly chose "default" (clears any agent-configured variant)
// selected: undefined       = no user choice yet (fall back to agent-configured variant)
type VariantInput = {
  variants: string[]
  selected: string | null | undefined
  configured: string | undefined
}

export function getConfiguredAgentVariant(input: {
  configured: ConfiguredModel | undefined
  model: Model | undefined
}) {
  if (!input.configured?.variant) return undefined
  if (!input.model?.variants) return undefined
  if (input.configured.providerID !== input.model.providerID) return undefined
  if (input.configured.id !== input.model.id) return undefined
  if (!(input.configured.variant in input.model.variants)) return undefined
  return input.configured.variant
}

export function resolveModelVariant(input: VariantInput) {
  if (input.selected === null) return undefined
  if (input.selected && input.variants.includes(input.selected)) return input.selected
  if (input.configured && input.variants.includes(input.configured)) return input.configured
  return undefined
}

export function resolveModelVariantForRequest(input: {
  selected: string | null | undefined
  current: string | undefined
}) {
  if (input.selected === null) return "default"
  return input.current
}

export function resolveModelVariantFromMessage(input: { variant: string | undefined; configured: string | undefined }) {
  if (input.variant === "default") return null
  if (input.variant === input.configured) return undefined
  return input.variant
}

export function cycleModelVariant(input: VariantInput) {
  if (input.variants.length === 0) return undefined
  if (input.selected === null) return input.variants[0]
  if (input.selected && input.variants.includes(input.selected)) {
    const index = input.variants.indexOf(input.selected)
    if (index === input.variants.length - 1) return undefined
    return input.variants[index + 1]
  }
  // No explicit selection: start cycling from the agent-configured variant.
  if (input.configured && input.variants.includes(input.configured)) {
    const index = input.variants.indexOf(input.configured)
    if (index === input.variants.length - 1) return input.variants[0]
    return input.variants[index + 1]
  }
  return input.variants[0]
}
