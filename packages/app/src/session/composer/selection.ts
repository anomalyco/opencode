export function resolveSessionComposerSelection(
  info: { agent?: string; model?: { id: string; providerID: string; variant?: string } } | undefined,
  metadata: Record<string, unknown> | undefined,
) {
  const model = metadata?.model
  const historical =
    model &&
    typeof model === "object" &&
    !Array.isArray(model) &&
    "providerID" in model &&
    "modelID" in model &&
    typeof model.providerID === "string" &&
    typeof model.modelID === "string"
      ? {
          providerID: model.providerID,
          modelID: model.modelID,
          variant: "variant" in model && typeof model.variant === "string" ? model.variant : undefined,
        }
      : undefined
  return {
    agent: info?.agent ?? (typeof metadata?.agent === "string" ? metadata.agent : undefined),
    model: info?.model
      ? { providerID: info.model.providerID, modelID: info.model.id, variant: info.model.variant }
      : historical,
  }
}
