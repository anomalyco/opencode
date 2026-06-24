import type { GateResult } from "./types"

const DEFAULT_THRESHOLD = 0.8
const AUTO_ACCEPT_THRESHOLD = 1.0

export class ConfidenceGate {
  private threshold: number

  constructor(threshold = DEFAULT_THRESHOLD) {
    this.threshold = threshold
  }

  evaluate(confidence: number): GateResult {
    if (confidence >= AUTO_ACCEPT_THRESHOLD)
      return { status: "ACCEPTED", reason: "Perfect confidence" }

    if (confidence >= this.threshold)
      return { status: "ACCEPTED", reason: `Confidence ${confidence.toFixed(3)} ≥ ${this.threshold}` }

    return {
      status: "FLAGGED",
      reason: `Low confidence: ${confidence.toFixed(3)} < ${this.threshold}. Human review required.`,
    }
  }

  setThreshold(t: number): void {
    this.threshold = t
  }
}
