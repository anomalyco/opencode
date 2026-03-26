interface Bucket {
  tokens: number
  lastRefill: number
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>()
  private readonly maxTokens: number
  private readonly refillRate: number
  private readonly refillIntervalMs: number

  constructor(opts: { maxTokens: number; refillRate: number; refillIntervalMs: number }) {
    this.maxTokens = opts.maxTokens
    this.refillRate = opts.refillRate
    this.refillIntervalMs = opts.refillIntervalMs
  }

  consume(key: string, cost = 1): boolean {
    const now = Date.now()
    this.cleanup(now)

    let bucket = this.buckets.get(key)
    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: now }
      this.buckets.set(key, bucket)
    }

    const elapsed = now - bucket.lastRefill
    const intervals = Math.floor(elapsed / this.refillIntervalMs)
    if (intervals > 0) {
      bucket.tokens = Math.min(this.maxTokens, bucket.tokens + intervals * this.refillRate)
      bucket.lastRefill = now
    }

    if (bucket.tokens < cost) return false
    bucket.tokens -= cost
    return true
  }

  private cleanup(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefill > 60_000) {
        this.buckets.delete(key)
      }
    }
  }
}
