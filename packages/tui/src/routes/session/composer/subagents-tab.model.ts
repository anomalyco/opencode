import type { ModelInfo, ModelRef } from "@opencode/client"

export function subagentModelDisplay(
  model: ModelRef | undefined,
  models: readonly Pick<ModelInfo, "providerID" | "id" | "name">[] | undefined,
) {
  if (!model) return
  const name = models?.find((item) => item.providerID === model.providerID && item.id === model.id)?.name
  return {
    name: name ?? `${model.providerID}/${model.id}`,
    variant: model.variant,
  }
}
