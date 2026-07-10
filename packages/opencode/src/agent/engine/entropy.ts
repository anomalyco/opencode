export interface EntropyMetrics {
  totalSteps: number
  retryCount: number
  consecutiveFailures: number
  cumulativeTokens: number
  executionTimeMs: number
  validationPassRate: number
  resultDivergence: number
}

export type ControlAction = "CONTINUE" | "ALERT" | "DEGRADE" | "PAUSE" | "ROLLBACK" | "TERMINATE"

export interface EntropyConfig {
  tokenBudget: number
  maxConsecutiveFailures: number
  minValidationPassRate: number
  maxResultDivergence: number
}

export class EntropyController {
  private config: EntropyConfig
  private actionHistory: Array<{ action: ControlAction; timestamp: number; reason: string }> = []

  constructor(config?: Partial<EntropyConfig>) {
    this.config = {
      tokenBudget: config?.tokenBudget ?? 1000000,
      maxConsecutiveFailures: config?.maxConsecutiveFailures ?? 3,
      minValidationPassRate: config?.minValidationPassRate ?? 0.3,
      maxResultDivergence: config?.maxResultDivergence ?? 0.5,
    }
  }

  evaluate(metrics: EntropyMetrics): ControlAction {
    const reasons: string[] = []

    if (metrics.cumulativeTokens > this.config.tokenBudget) {
      reasons.push("Token budget exceeded")
      return this.act("TERMINATE", reasons.join("; "))
    }

    if (metrics.cumulativeTokens > this.config.tokenBudget * 0.9) {
      reasons.push(`Token budget near exhaustion: ${metrics.cumulativeTokens}/${this.config.tokenBudget}`)
      return this.act("ALERT", reasons.join("; "))
    }

    if (metrics.consecutiveFailures > this.config.maxConsecutiveFailures) {
      reasons.push(`Consecutive failures: ${metrics.consecutiveFailures}`)
      return this.act("DEGRADE", reasons.join("; "))
    }

    if (
      metrics.resultDivergence > this.config.maxResultDivergence &&
      metrics.cumulativeTokens > this.config.tokenBudget * 0.5
    ) {
      reasons.push(`Result divergence: ${metrics.resultDivergence}`)
      return this.act("PAUSE", reasons.join("; "))
    }

    if (metrics.validationPassRate < this.config.minValidationPassRate) {
      reasons.push(`Low validation pass rate: ${metrics.validationPassRate}`)
      return this.act("ROLLBACK", reasons.join("; "))
    }

    return this.act("CONTINUE", reasons.join("; "))
  }

  private act(action: ControlAction, reason: string): ControlAction {
    this.actionHistory.push({ action, timestamp: Date.now(), reason })
    if (this.actionHistory.length > 100) {
      this.actionHistory = this.actionHistory.slice(-100)
    }
    return action
  }

  getActionHistory(): Array<{ action: ControlAction; timestamp: number; reason: string }> {
    return [...this.actionHistory]
  }

  reset(): void {
    this.actionHistory = []
  }

  updateConfig(config: Partial<EntropyConfig>): void {
    this.config = { ...this.config, ...config }
  }
}

export * as Entropy from "./entropy"
