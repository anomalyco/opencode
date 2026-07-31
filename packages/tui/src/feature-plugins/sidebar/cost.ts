import type { Model } from "@opencode-ai/sdk/v2"

export function modelHasPricing(model: Model | undefined): boolean {
  const cost = model?.cost
  if (cost === undefined) return false
  return cost.input !== 0 || cost.output !== 0
}
