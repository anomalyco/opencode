/**
 * CCFEngine — Counterfactual Consistency Field orchestrator.
 *
 * Pipeline:
 *   1. Simulate: run output through all World Models
 *   2. Check: run ConsistencyChecker on predictions
 *   3. Verdict: ACCEPTED if consistent, REJECTED otherwise
 */

import type { CCFEvaluation, WorldModel, ModelPrediction, ConsistencyResult } from "./types"
import { ConsistencyChecker } from "./consistency-checker"

export class CCFEngine {
  private models: WorldModel[]
  private checker: ConsistencyChecker

  constructor(models: WorldModel[], threshold = 0.7) {
    this.models = models
    this.checker = new ConsistencyChecker(threshold)
  }

  evaluate(output: string, context?: unknown): CCFEvaluation {
    const predictions: ModelPrediction[] = []

    // Step 1: Simulate — each world model independently evaluates the output
    for (const model of this.models) {
      try {
        const prediction = model.simulate(output, context)
        predictions.push(prediction)
      } catch (error) {
        // World model failure counts as invalid prediction
        predictions.push({
          modelId: model.id,
          valid: false,
          confidence: 0.0,
          stateHash: "error",
          reasoning: `World model crashed: ${error instanceof Error ? error.message : String(error)}`,
          anomalies: [`world_model_failure:${model.id}`],
        })
      }
    }

    // Step 2: Check — pairwise consistency analysis
    const consistency = this.checker.check(predictions)

    // Step 3: Verdict
    const verdict = consistency.valid ? "ACCEPTED" : "REJECTED"
    const reason = this.buildReason(consistency, predictions)

    return {
      output,
      predictions,
      consistency,
      verdict,
      reason,
      timestamp: Date.now(),
    }
  }

  private buildReason(consistency: ConsistencyResult, predictions: ModelPrediction[]): string {
    const parts: string[] = [
      `CCF evaluation complete.`,
      `Models: ${predictions.length},`,
      `Consistency: ${(consistency.overallConsistency * 100).toFixed(0)}%,`,
      `Direction: ${consistency.consensusDirection},`,
      `Verdict: ${consistency.valid ? "ACCEPTED" : "REJECTED"}.`,
    ]

    if (consistency.divergentBranches.length > 0) {
      parts.push(`Divergent: ${consistency.divergentBranches.join(", ")}.`)
    }

    const invalidModels = predictions.filter(p => !p.valid)
    if (invalidModels.length > 0) {
      parts.push(`Invalid models: ${invalidModels.map(p => `${p.modelId} (${p.reasoning})`).join("; ")}.`)
    }

    return parts.join(" ")
  }
}
