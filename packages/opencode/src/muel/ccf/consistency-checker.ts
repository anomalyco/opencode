/**
 * ConsistencyChecker — pairwise agreement engine for CCF.
 *
 * Formal definition:
 *   overallConsistency = agreeingPairs / totalPairs
 *   where a pair (i,j) agrees iff predictions[i].valid === predictions[j].valid
 *
 * Threshold 0.7 means: with 5 models, need at least 7/10 agreeing pairs
 * to ACCEPT. This implements the ∀ quantifier from formal validity spec:
 *   Validity(a) = 1  iff  ∀ w_i, w_j : P(M(w_i|a)) ≈ P(M(w_j|a))
 */

import type { ModelPrediction, ConsistencyResult } from "./types"

export class ConsistencyChecker {
  constructor(private threshold = 0.7) {}

  check(predictions: ModelPrediction[]): ConsistencyResult {
    if (predictions.length === 0) {
      return {
        overallConsistency: 0,
        valid: false,
        modelAgreements: {},
        divergentBranches: [],
        consensusDirection: "AMBIGUOUS",
        formalValidity: 0,
      }
    }

    const totalPairs = (predictions.length * (predictions.length - 1)) / 2
    let agreeingPairs = 0
    const divergentBranches: string[] = []
    const modelAgreements: ConsistencyResult["modelAgreements"] = {}

    for (let i = 0; i < predictions.length; i++) {
      for (let j = i + 1; j < predictions.length; j++) {
        const a = predictions[i]!
        const b = predictions[j]!
        const agrees = a.valid === b.valid
        if (agrees) {
          agreeingPairs++
        } else {
          divergentBranches.push(`${a.modelId} <-> ${b.modelId}`)
        }
        // Record per-model agreement summary
        if (!modelAgreements[a.modelId]) {
          modelAgreements[a.modelId] = { agrees: true, confidence: a.confidence, reasoning: a.reasoning }
        }
        if (!modelAgreements[b.modelId]) {
          modelAgreements[b.modelId] = { agrees: true, confidence: b.confidence, reasoning: b.reasoning }
        }
      }
    }

    const overallConsistency = totalPairs > 0 ? agreeingPairs / totalPairs : 0
    const validCount = predictions.filter(p => p.valid).length
    const invalidCount = predictions.filter(p => !p.valid).length

    let consensusDirection: ConsistencyResult["consensusDirection"]
    if (validCount / predictions.length > 2 / 3) {
      consensusDirection = "VALID"
    } else if (invalidCount / predictions.length > 2 / 3) {
      consensusDirection = "INVALID"
    } else {
      consensusDirection = "AMBIGUOUS"
    }

    return {
      overallConsistency,
      valid: overallConsistency >= this.threshold && consensusDirection === "VALID",
      modelAgreements,
      divergentBranches,
      consensusDirection,
      formalValidity: overallConsistency,
    }
  }
}
