export namespace TimeoutManager {
  export interface TimeoutConfig {
    min: number
    max: number
    default: number
  }

  export class AdaptiveTimeout {
    private responseTimes: Map<string, number[]> = new Map()
    private readonly maxSamples = 100
    private readonly bufferMultiplier = 1.5

    constructor(private configs: Record<string, TimeoutConfig>) {}

    getTimeout(operation: string): number {
      const config = this.configs[operation]
      if (!config) {
        throw new Error(`No timeout config for operation: ${operation}`)
      }

      const times = this.responseTimes.get(operation) || []
      if (times.length === 0) {
        return config.default
      }

      // Calculate 95th percentile
      const sorted = [...times].sort((a, b) => a - b)
      const index = Math.floor(sorted.length * 0.95)
      const p95 = sorted[index]

      // Add buffer and clamp to min/max
      const timeout = Math.round(p95 * this.bufferMultiplier)
      return Math.max(config.min, Math.min(config.max, timeout))
    }

    trackResponseTime(operation: string, startTime: number): void {
      const duration = Date.now() - startTime
      let times = this.responseTimes.get(operation) || []

      // Keep last N measurements
      times.push(duration)
      if (times.length > this.maxSamples) {
        times = times.slice(-this.maxSamples)
      }

      this.responseTimes.set(operation, times)
    }

    async withTimeout<T>(
      operation: string,
      promise: Promise<T>,
      timeoutOverride?: number
    ): Promise<T> {
      const timeout = timeoutOverride || this.getTimeout(operation)
      const startTime = Date.now()

      try {
        const result = await Promise.race([
          promise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Operation '${operation}' timed out after ${timeout}ms`)), timeout)
          ),
        ])
        
        this.trackResponseTime(operation, startTime)
        return result
      } catch (error) {
        if (error instanceof Error && error.message.includes('timed out')) {
          throw error
        }
        // Track even failed operations for accurate timing
        this.trackResponseTime(operation, startTime)
        throw error
      }
    }
  }

  export const DEFAULT_CONFIGS = {
    initialize: { min: 3000, max: 15000, default: 5000 },
    diagnostics: { min: 1000, max: 10000, default: 3000 },
    completion: { min: 500, max: 5000, default: 1500 },
    hover: { min: 300, max: 3000, default: 1000 },
  }
}