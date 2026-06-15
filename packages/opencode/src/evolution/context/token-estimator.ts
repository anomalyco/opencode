// Accuracy is approximate. Budget enforcement is conservative.
// ±10-15% for English/code. Approximation layer, not an official tokenizer.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export * as TokenEstimator from "./token-estimator"
