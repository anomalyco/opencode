import type { SessionConfigOption } from "@agentclientprotocol/sdk"
import type { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Effect, Order } from "effect"
import { builtinCommands, findModel, type Catalog } from "./catalog"
import { ACPError } from "./error"

const DEFAULT_VARIANT_VALUE = "default"

export type Selection = {
  readonly model?: Model.Ref
  readonly modeID?: Agent.ID
}

export type Change = { readonly model: Model.Ref } | { readonly modeID: Agent.ID }

export function currentModel(catalog: Catalog, selection: Selection) {
  return selection.model ?? catalog.defaultModel
}

export function configOptions(catalog: Catalog, selection: Selection): SessionConfigOption[] {
  const model = currentModel(catalog, selection)
  const variants = findModel(catalog.models, model)?.variants.map((variant) => variant.id) ?? []
  return [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: `${model.providerID}/${model.id}`,
      options: catalog.models
        .toSorted((a, b) => Order.String(a.providerID, b.providerID) || a.name.localeCompare(b.name))
        .map((item) => ({ value: `${item.providerID}/${item.id}`, name: `${item.providerID}/${item.name}` })),
    },
    ...(variants.length > 0
      ? [
          {
            id: "effort",
            name: "Effort",
            description: "Available effort levels for this model",
            category: "thought_level",
            type: "select",
            currentValue: selectVariant(model.variant, variants),
            options: [...new Set([...variants, DEFAULT_VARIANT_VALUE])].map((variant) => ({
              value: variant,
              name: variant
                .split(/[_-]/)
                .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
                .join(" "),
            })),
          } satisfies SessionConfigOption,
        ]
      : []),
    {
      id: "mode",
      name: "Session Mode",
      category: "mode",
      type: "select",
      currentValue: selection.modeID ?? catalog.defaultModeID,
      options: catalog.modes.map((mode) => ({
        value: mode.id,
        name: mode.name,
        ...(mode.description ? { description: mode.description } : {}),
      })),
    },
  ]
}

export function availableCommands(catalog: Catalog) {
  return [
    ...catalog.commands.map((command) => ({ name: command.name, description: command.description ?? "" })),
    ...Array.from(builtinCommands, ([name, command]) => ({ name, description: command.description })),
  ]
}

export const resolveChange = Effect.fnUntraced(function* (
  catalog: Catalog,
  selection: Selection,
  configId: string,
  value: string,
) {
  const current = currentModel(catalog, selection)
  switch (configId) {
    case "model":
      return { model: yield* requireModel(catalog, value, current) }
    case "effort": {
      const model = findModel(catalog.models, current)
      if (!model || (value !== DEFAULT_VARIANT_VALUE && !model.variants.some((variant) => variant.id === value)))
        return yield* new ACPError.InvalidEffortError({ effort: value })
      return { model: { ...current, variant: Model.VariantID.make(value) } }
    }
    case "mode": {
      const mode = catalog.modes.find((item) => item.id === value)
      if (!mode) return yield* new ACPError.InvalidModeError({ mode: value })
      return { modeID: mode.id }
    }
    default:
      return yield* new ACPError.InvalidConfigOptionError({ configId })
  }
})

export function parseModelSelection(value: string, models: ReadonlyArray<Model.Info>): Model.Ref {
  const providerID = models
    .map((model) => model.providerID)
    .toSorted()
    .find((id) => value.startsWith(`${id}/`))
  if (!providerID) {
    const separator = value.indexOf("/")
    if (separator === -1) return { providerID: Provider.ID.make(value), id: Model.ID.make("") }
    return { providerID: Provider.ID.make(value.slice(0, separator)), id: Model.ID.make(value.slice(separator + 1)) }
  }
  const id = Model.ID.make(value.slice(providerID.length + 1))
  if (findModel(models, { providerID, id })) return { providerID, id }
  const separator = id.lastIndexOf("/")
  const baseID = Model.ID.make(separator === -1 ? id : id.slice(0, separator))
  const variant = separator === -1 ? undefined : id.slice(separator + 1)
  const model = findModel(models, { providerID, id: baseID })
  if (model && variant && model.variants.some((item) => item.id === variant))
    return { providerID, id: baseID, variant: Model.VariantID.make(variant) }
  return { providerID, id }
}

const requireModel = Effect.fnUntraced(function* (catalog: Catalog, value: string, current: Model.Ref) {
  const selected = parseModelSelection(value, catalog.models)
  const model = findModel(catalog.models, selected)
  if (!model) return yield* new ACPError.InvalidModelError({ providerId: selected.providerID, modelId: value })
  const selectedVariant = model.variants.find((variant) => variant.id === selected.variant)
  if (selected.variant && !selectedVariant) return yield* new ACPError.InvalidEffortError({ effort: selected.variant })
  const variant =
    selectedVariant?.id ??
    (current.providerID === model.providerID &&
    current.id === model.id &&
    (current.variant === DEFAULT_VARIANT_VALUE || model.variants.some((variant) => variant.id === current.variant))
      ? current.variant
      : undefined)
  return { providerID: model.providerID, id: model.id, variant } satisfies Model.Ref
})

function selectVariant(variant: string | undefined, variants: readonly string[]) {
  if (!variant || variant === DEFAULT_VARIANT_VALUE) return DEFAULT_VARIANT_VALUE
  if (variants.includes(variant)) return variant
  if (variants.includes(DEFAULT_VARIANT_VALUE)) return DEFAULT_VARIANT_VALUE
  return variants[0] ?? DEFAULT_VARIANT_VALUE
}
