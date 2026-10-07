export * as ModelCost from "./model-cost"

import { ModelV2 } from "./model"

/**
 * FREE-FIRST cost policy over a model's published pricing.
 *
 * A model is free only when its first cost tier prices every metered axis at
 * zero — input, output, and both cache directions — so "free" means actual
 * zero spend, not merely zero token price. Unknown pricing (an empty `cost`
 * array, the default for models without catalog pricing) counts as paid: a
 * free-first preference must never select a model whose spend is unbounded.
 */
export const isFree = (model: ModelV2.Info): boolean => {
  const cost = model.cost[0]
  return (
    cost !== undefined &&
    cost.input === 0 &&
    cost.output === 0 &&
    cost.cache.read === 0 &&
    cost.cache.write === 0
  )
}
