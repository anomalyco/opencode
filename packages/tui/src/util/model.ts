import { Model } from "@opencode/schema/model"

export function parse(value?: string | null): { providerID: string; modelID: string; variant?: string } {
  if (typeof value !== "string" || value.length === 0) {
    return { providerID: "", modelID: "" }
  }
  try {
    const ref = Model.Ref.parse(value)
    return {
      providerID: ref.providerID,
      modelID: ref.id,
      ...(ref.variant ? { variant: ref.variant } : {}),
    }
  } catch {
    return { providerID: "", modelID: "" }
  }
}

export function formatRef(model: { providerID: string; id: string; variant?: string }) {
  return [model.providerID, model.id, model.variant].filter((value) => value !== undefined).join("/")
}

export function switchLabel(
  model: { providerID: string; id: string; variant?: string },
  models?: readonly { providerID: string; id: string; name: string }[],
  previous?: { providerID: string; id: string; variant?: string },
) {
  if (!model?.providerID || !model?.id) return ""
  if (previous?.providerID === model.providerID && previous.id === model.id)
    return `Switched variant to ${model.variant ?? "default"}`
  const display = models?.find((item) => item.providerID === model.providerID && item.id === model.id)?.name
  if (display === undefined) return `Switched model to ${formatRef(model)}`
  const variant = model.variant && model.variant !== "default" ? ` (${model.variant})` : ""
  return `Switched model to ${display}${variant}`
}
