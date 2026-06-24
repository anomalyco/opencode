/**
 * Asymmetry Engine — The missing component that unifies all 6 ideas.
 *
 * Every iteration, reads available signals and outputs exactly one thing:
 * WHERE to push pressure in the next iteration.
 *
 * Designed for incremental signal addition — works with 2, will work with 6.
 * New signals plug in via registerSignal() without changing core logic.
 */

export type SignalId =
  | 'boundaryFractalDimension'   // Idea #3 — ACTIVE in v1
  | 'channelLoss'                 // Idea #5 — ACTIVE in v1
  | 'evaluatorFamiliarity'        // Idea #1 — plug in when instrumented
  | 'contradictionAge'            // Idea #2 — plug in when instrumented
  | 'versionDisagreementRate'     // Idea #4 — plug in when instrumented
  | 'observerInfluence'           // Idea #6 — plug in when instrumented

export interface AsymmetrySignal {
  id: SignalId
  value: number       // normalized 0.0–1.0
  weight: number      // influence on final decision
  available: boolean  // false = slot exists, not yet instrumented
}

export type PushTarget =
  | 'EXPLORE_FAILURE_BOUNDARY'      // fractal dim high — mine internal structure
  | 'STABILIZE_KNOWLEDGE'           // channel loss moderate — slow down, retain
  | 'EMERGENCY_KNOWLEDGE_RECOVERY'  // channel loss critical — halt, diagnose
  | 'INCREASE_EVALUATOR_PRESSURE'   // evaluator too familiar — make it harder
  | 'RESOLVE_CONTRADICTION'         // contradiction held too long
  | 'INVESTIGATE_DIVERGENCE'        // versions diverging — find why
  | 'BLIND_SPOT_REMOVAL'            // evaluator shaping agent — run blind test
  | 'BALANCED_ITERATION'            // no dominant signal — proceed normally

export interface IterationTarget {
  iteration: number
  pushTarget: PushTarget
  urgency: number              // 0.0–1.0
  dominantSignal: SignalId
  asymmetryScore: number       // system-wide asymmetry (0 = balanced, 1 = critical)
  rationale: string
  recommendation: string       // one concrete next action
  signals: AsymmetrySignal[]
  availableSignals: number
  totalSignalSlots: number
}

// Thresholds
const EMERGENCY_CHANNEL_LOSS = 0.80
const HIGH_FRACTAL_DIM = 0.65      // 0.65 normalized maps to D ≈ 1.63

// Normalize fractal dimension (D in [1.0, 2.0]) to [0.0, 1.0]
export function normalizeFractalDimension(D: number): number {
  return Math.max(0, Math.min(1, (D - 1.0) / 1.0))
}

const DEFAULT_WEIGHTS: Record<SignalId, number> = {
  boundaryFractalDimension: 1.2,  // slightly higher — structure detection is most actionable
  channelLoss:              1.5,  // highest — knowledge loss must be caught early
  evaluatorFamiliarity:     1.0,
  contradictionAge:         0.8,
  versionDisagreementRate:  1.0,
  observerInfluence:        0.9,
}

export class AsymmetryEngine {
  private signals: Map<SignalId, AsymmetrySignal> = new Map()
  private iteration = 0

  constructor() {
    // Pre-register all signal slots (available=false until instrumented)
    const allIds: SignalId[] = [
      'boundaryFractalDimension',
      'channelLoss',
      'evaluatorFamiliarity',
      'contradictionAge',
      'versionDisagreementRate',
      'observerInfluence',
    ]
    for (const id of allIds) {
      this.signals.set(id, {
        id,
        value: 0,
        weight: DEFAULT_WEIGHTS[id] ?? 1.0,
        available: false,
      })
    }
  }

  updateSignal(id: SignalId, value: number): void {
    const existing = this.signals.get(id)!
    this.signals.set(id, { ...existing, value: Math.max(0, Math.min(1, value)), available: true })
  }

  compute(): IterationTarget {
    this.iteration++
    const available = [...this.signals.values()].filter(s => s.available)

    if (available.length === 0) {
      return this.unavailableTarget()
    }

    // Emergency override — channel loss is existential for RSI
    const cl = this.signals.get('channelLoss')
    if (cl?.available && cl.value >= EMERGENCY_CHANNEL_LOSS) {
      return this.emergencyTarget(cl)
    }

    // Weighted asymmetry score
    const totalWeight = available.reduce((s, sig) => s + sig.weight, 0)
    const asymmetryScore = available.reduce((s, sig) => s + sig.value * sig.weight, 0) / totalWeight

    // Find dominant signal
    const dominant = available.reduce((max, sig) =>
      sig.value * sig.weight > max.value * max.weight ? sig : max
    )

    return this.buildTarget(dominant, asymmetryScore, available)
  }

  private buildTarget(
    dominant: AsymmetrySignal,
    asymmetryScore: number,
    available: AsymmetrySignal[]
  ): IterationTarget {
    const base = {
      iteration: this.iteration,
      asymmetryScore,
      signals: [...this.signals.values()],
      availableSignals: available.length,
      totalSignalSlots: this.signals.size,
      dominantSignal: dominant.id,
    }

    if (asymmetryScore < 0.001) {
      return {
        ...base,
        pushTarget: 'BALANCED_ITERATION',
        urgency: 0,
        rationale: `No dominant asymmetry signal. System is balanced.`,
        recommendation: `Proceed with standard RSI iteration. Continue monitoring all ${this.signals.size} signal slots.`,
      }
    }

    switch (dominant.id) {
      case 'boundaryFractalDimension':
        return {
          ...base,
          pushTarget: 'EXPLORE_FAILURE_BOUNDARY',
          urgency: dominant.value,
          rationale: `Failure boundary fractal dimension (normalized: ${dominant.value.toFixed(3)}) indicates exploitable internal structure. Improvement is possible without new data.`,
          recommendation: `Target fuzz clusters with highest internalVariance. Run deep fuzz within those cluster centroids ±0.1 radius. Map sub-clusters that emerge.`,
        }

      case 'channelLoss':
        return {
          ...base,
          pushTarget: 'STABILIZE_KNOWLEDGE',
          urgency: dominant.value,
          rationale: `${(dominant.value * 100).toFixed(1)}% knowledge loss between last two versions. Compounding loss will collapse RSI loop.`,
          recommendation: `Before next iteration: serialize top-10 strategies from vN into vN+1 initial context. Re-measure channelLoss. Do not advance until loss < 0.3.`,
        }

      case 'evaluatorFamiliarity':
        return {
          ...base,
          pushTarget: 'INCREASE_EVALUATOR_PRESSURE',
          urgency: dominant.value,
          rationale: `Evaluator familiarity score ${dominant.value.toFixed(3)} — agent can predict test structure, enabling reward hacking.`,
          recommendation: `Rotate 30% of fuzz input domains. Add one new errorType category that evaluator has never seen. Measure if pass rate drops (it should).`,
        }

      case 'contradictionAge':
        return {
          ...base,
          pushTarget: 'RESOLVE_CONTRADICTION',
          urgency: dominant.value,
          rationale: `Contradiction age signal ${dominant.value.toFixed(3)} — information is decaying in held contradiction state.`,
          recommendation: `Force-resolve oldest contradiction. Document: (a) what tension existed, (b) what resolution was chosen, (c) what was learned during hold period.`,
        }

      case 'versionDisagreementRate':
        return {
          ...base,
          pushTarget: 'INVESTIGATE_DIVERGENCE',
          urgency: dominant.value,
          rationale: `Version disagreement rate ${dominant.value.toFixed(3)} — parallel evolution to different local optima detected.`,
          recommendation: `Run behavioral diff on highest-disagreement test cases. Identify which hidden objective each version is optimizing for.`,
        }

      case 'observerInfluence':
        return {
          ...base,
          pushTarget: 'BLIND_SPOT_REMOVAL',
          urgency: dominant.value,
          rationale: `Observer influence ${dominant.value.toFixed(3)} — evaluator is shaping agent development, not measuring it.`,
          recommendation: `Run holdout evaluation on 20 tasks evaluator has never seen. Compare gap between observed vs holdout performance. Large gap = evaluator distortion.`,
        }

      default:
        return {
          ...base,
          pushTarget: 'BALANCED_ITERATION',
          urgency: asymmetryScore,
          rationale: `No dominant asymmetry signal. System is balanced.`,
          recommendation: `Proceed with standard RSI iteration. Continue monitoring all ${this.signals.size} signal slots.`,
        }
    }
  }

  private emergencyTarget(cl: AsymmetrySignal): IterationTarget {
    return {
      iteration: this.iteration,
      pushTarget: 'EMERGENCY_KNOWLEDGE_RECOVERY',
      urgency: 1.0,
      dominantSignal: 'channelLoss',
      asymmetryScore: 1.0,
      rationale: `CRITICAL: ${(cl.value * 100).toFixed(1)}% knowledge lost between last two versions. RSI loop is destroying more than it creates.`,
      recommendation: `HALT iteration. (1) Audit agent-archive for transfer breakdown. (2) Check LLM context window — is it truncating strategy payloads? (3) Do not resume until channelLoss < 0.5.`,
      signals: [...this.signals.values()],
      availableSignals: [...this.signals.values()].filter(s => s.available).length,
      totalSignalSlots: this.signals.size,
    }
  }

  private unavailableTarget(): IterationTarget {
    return {
      iteration: this.iteration,
      pushTarget: 'BALANCED_ITERATION',
      urgency: 0,
      dominantSignal: 'channelLoss',
      asymmetryScore: 0,
      rationale: 'No signals instrumented. Cannot compute asymmetry.',
      recommendation: 'Instrument boundaryFractalDimension and channelLoss before running.',
      signals: [...this.signals.values()],
      availableSignals: 0,
      totalSignalSlots: this.signals.size,
    }
  }
}
