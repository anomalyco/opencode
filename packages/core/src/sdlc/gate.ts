import { Effect, Schema } from "effect"
import { SDLCPhase } from "./phase"

export class QualityGateMetrics extends Schema.Class<QualityGateMetrics>("QualityGateMetrics")({
  buildPassing: Schema.Boolean,
  typecheckPassing: Schema.Boolean,
  testPassingRate: Schema.Number,
  securityPassing: Schema.Boolean,
}) {}

export class QualityGateResult extends Schema.Class<QualityGateResult>("QualityGateResult")({
  phaseId: Schema.Number,
  phaseName: Schema.String,
  score: Schema.Number,
  passed: Schema.Boolean,
  thresholdRequired: Schema.Number,
  failures: Schema.Array(Schema.String),
}) {}

export namespace QualityGateEvaluator {
  export function evaluate(phase: SDLCPhase, metrics: QualityGateMetrics): QualityGateResult {
    const failures: string[] = []

    if (!metrics.buildPassing) {
      failures.push("Build failure detected.")
    }
    if (!metrics.typecheckPassing) {
      failures.push("Typecheck failure detected.")
    }
    if (!metrics.securityPassing) {
      failures.push("Security or secrets leakage vulnerability detected.")
    }

    let score = metrics.testPassingRate * 0.4
    if (metrics.buildPassing) score += 20
    if (metrics.typecheckPassing) score += 20
    if (metrics.securityPassing) score += 20

    const passed = failures.length === 0 && score >= phase.requiredPassingPercentage

    return new QualityGateResult({
      phaseId: phase.id,
      phaseName: phase.name,
      score,
      passed,
      thresholdRequired: phase.requiredPassingPercentage,
      failures,
    })
  }

  export function evaluateEffect(phase: SDLCPhase, metrics: QualityGateMetrics) {
    return Effect.sync(() => evaluate(phase, metrics))
  }
}
