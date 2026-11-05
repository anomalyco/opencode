type AgentModel = {
  providerID: string
  modelID: string
}

type Agent = {
  model?: AgentModel
  variant?: string
}

type Model = AgentModel & {
  variants?: Record<string, unknown>
}

/** What a selection says about the variant: follow preferences and configuration, the explicit Default, or a name. */
export type VariantSelection =
  | { readonly type: "inherit" }
  | { readonly type: "default" }
  | { readonly type: "named"; readonly value: string }

export const INHERIT_VARIANT: VariantSelection = Object.freeze({ type: "inherit" })

export const DEFAULT_VARIANT: VariantSelection = Object.freeze({ type: "default" })

type VariantInput = {
  variants: readonly string[]
  selected: VariantSelection
  configured: string | undefined
  preferred?: string
}

/** Reads the composer prompt's mirror, where `null` is the explicit Default and `undefined` inherits. */
export function variantSelectionFrom(value: string | null | undefined): VariantSelection {
  if (value === null) return DEFAULT_VARIANT

  if (value === undefined) return INHERIT_VARIANT

  return { type: "named", value }
}

/** A committed variant: the server records the Default as no variant. */
export function durableVariantSelection(value: string | undefined): VariantSelection {
  return value === undefined ? DEFAULT_VARIANT : { type: "named", value }
}

export function getConfiguredAgentVariant(input: { agent: Agent | undefined; model: Model | undefined }) {
  if (!input.agent?.variant) return undefined

  if (!input.agent.model) return undefined

  if (!input.model?.variants) return undefined

  if (input.agent.model.providerID !== input.model.providerID) return undefined

  if (input.agent.model.modelID !== input.model.modelID) return undefined

  return input.agent.variant
}

export function resolveModelVariant(input: VariantInput) {
  if (input.selected.type === "default") return undefined
  const value = input.selected.type === "named" ? input.selected.value : (input.preferred ?? input.configured)

  return value && value !== "default" && input.variants.includes(value) ? value : undefined
}

export function cycleModelVariant(input: VariantInput) {
  const current = resolveModelVariant(input)

  return input.variants[current ? input.variants.indexOf(current) + 1 : 0]
}
