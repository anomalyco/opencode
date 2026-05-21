/**
 * 速率限制器
 *
 * 令牌桶算法，用于外部 API（Google Patents、Semantic Scholar）调用限流。
 * 防止高频请求被封禁。
 */

export class RateLimiter {
  private tokens: number
  private readonly maxTokens: number
  private readonly refillRate: number
  private lastRefill: number

  constructor(options?: { maxRequests?: number; perSeconds?: number }) {
    this.maxTokens = options?.maxRequests ?? 5
    this.refillRate = this.maxTokens / (options?.perSeconds ?? 1)
    this.tokens = this.maxTokens
    this.lastRefill = Date.now()
  }

  async acquire(): Promise<void> {
    this.refill()
    if (this.tokens >= 1) {
      this.tokens--
      return
    }

    const waitMs = Math.ceil((1 - this.tokens) / this.refillRate * 1000)
    await new Promise(resolve => setTimeout(resolve, waitMs))
    this.refill()
    this.tokens--
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = (now - this.lastRefill) / 1000
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate)
    this.lastRefill = now
  }
}

/** Google Patents 速率限制器：每秒最多 2 次 */
export const googlePatentsLimiter = new RateLimiter({ maxRequests: 2, perSeconds: 1 })

/** Semantic Scholar 速率限制器：每秒最多 1 次 */
export const semanticScholarLimiter = new RateLimiter({ maxRequests: 1, perSeconds: 1 })

/**
 * Circuit Breaker（熔断器）
 *
 * 连续失败 N 次后熔断，一段时间后半开试探。
 * 防止对不可用的服务持续发起请求。
 */
export class CircuitBreaker {
  private failures = 0
  private state: "closed" | "open" | "half-open" = "closed"
  private openedAt = 0

  constructor(
    private readonly threshold = 3,
    private readonly resetMs = 60_000,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.openedAt < this.resetMs) {
        throw new Error("Circuit breaker is open")
      }
      this.state = "half-open"
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  get isOpen(): boolean {
    return this.state === "open" && Date.now() - this.openedAt < this.resetMs
  }

  private onSuccess(): void {
    this.failures = 0
    this.state = "closed"
  }

  private onFailure(): void {
    this.failures++
    if (this.failures >= this.threshold) {
      this.state = "open"
      this.openedAt = Date.now()
    }
  }
}

export const googlePatentsBreaker = new CircuitBreaker(3, 60_000)
export const semanticScholarBreaker = new CircuitBreaker(3, 60_000)
