export function parse(value?: string | null): { providerID: string; modelID: string; variant?: string } {
  if (typeof value !== "string" || value.length === 0) {
    return { providerID: "", modelID: "" }
  }
  const variantIndex = value.indexOf("#")
  const rawRef = variantIndex === -1 ? value : value.slice(0, variantIndex)
  const variant = variantIndex === -1 ? undefined : value.slice(variantIndex + 1) || undefined
  const [providerID, ...rest] = rawRef.split("/")
  return {
    providerID: providerID ?? "",
    modelID: rest.join("/"),
    ...(variant ? { variant } : {}),
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
