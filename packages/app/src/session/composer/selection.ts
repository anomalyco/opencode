import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
export function resolveSessionComposerSelection(
  info: { agent?: Agent.ID; model?: { id: Model.ID; providerID: Provider.ID; variant?: Model.VariantID } } | undefined,
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
          providerID: Provider.ID.make(model.providerID),
          modelID: Model.ID.make(model.modelID),
          variant:
            "variant" in model && typeof model.variant === "string" ? Model.VariantID.make(model.variant) : undefined,
        }
      : undefined
  return {
    agent: info?.agent ?? (typeof metadata?.agent === "string" ? Agent.ID.make(metadata.agent) : undefined),
    model: info?.model
      ? { providerID: info.model.providerID, modelID: info.model.id, variant: info.model.variant }
      : historical,
  }
}
