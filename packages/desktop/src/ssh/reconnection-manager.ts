export interface ReconnectionConfig {
  maxAttempts?: number
  initialDelayMs?: number
  maxDelayMs?: number
  backoffMultiplier?: number
  jitter?: boolean
}

export interface ReconnectionAttempt {
  attempt: number
  delayMs: number
  timestamp: number
}

export class ReconnectionManager {
  private config: Required<ReconnectionConfig>
  private attempts = new Map<string, ReconnectionAttempt[]>()

  constructor(config?: ReconnectionConfig) {
    this.config = {
      maxAttempts: config?.maxAttempts ?? 5,
      initialDelayMs: config?.initialDelayMs ?? 1000,
      maxDelayMs: config?.maxDelayMs ?? 30000,
      backoffMultiplier: config?.backoffMultiplier ?? 2,
      jitter: config?.jitter ?? true,
    }
  }

  calculateDelay(attempt: number): number {
    const baseDelay = Math.min(
      this.config.initialDelayMs * Math.pow(this.config.backoffMultiplier, attempt),
      this.config.maxDelayMs
    )

    if (this.config.jitter) {
      const jitterAmount = baseDelay * 0.1
      const jitter = (Math.random() - 0.5) * 2 * jitterAmount
      return Math.max(0, baseDelay + jitter)
    }

    return baseDelay
  }

  async waitForAttempt(connectionId: string, attempt: number): Promise<boolean> {
    if (attempt >= this.config.maxAttempts) {
      return false
    }

    const delay = this.calculateDelay(attempt)
    const timestamp = Date.now()

    this.attempts.set(connectionId, [
      ...(this.attempts.get(connectionId) ?? []),
      { attempt, delayMs: delay, timestamp },
    ])

    await new Promise((resolve) => setTimeout(resolve, delay))
    return true
  }

  getAttempts(connectionId: string): ReconnectionAttempt[] {
    return this.attempts.get(connectionId) ?? []
  }

  reset(connectionId: string): void {
    this.attempts.delete(connectionId)
  }

  shouldRetry(connectionId: string): boolean {
    const attempts = this.getAttempts(connectionId)
    return attempts.length < this.config.maxAttempts
  }

  getNextAttemptNumber(connectionId: string): number {
    return this.getAttempts(connectionId).length
  }
}
