import { discoverServer, ServerDiscoveryConfig } from "./server-discovery"

export interface HealthCheckConfig {
  intervalMs?: number
  timeoutMs?: number
  maxFailures?: number
}

export interface HealthCheckResult {
  healthy: boolean
  timestamp: number
  error?: string
}

export type HealthStatusListener = (connectionId: string, healthy: boolean, result: HealthCheckResult) => void

export class HealthMonitor {
  private config: Required<HealthCheckConfig>
  private intervals = new Map<string, NodeJS.Timeout>()
  private listeners = new Set<HealthStatusListener>()
  private failureCounts = new Map<string, number>()
  private lastResults = new Map<string, HealthCheckResult>()

  constructor(config?: HealthCheckConfig) {
    this.config = {
      intervalMs: config?.intervalMs ?? 30000,
      timeoutMs: config?.timeoutMs ?? 5000,
      maxFailures: config?.maxFailures ?? 3,
    }
  }

  onHealthChange(listener: HealthStatusListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notifyListeners(connectionId: string, healthy: boolean, result: HealthCheckResult): void {
    for (const listener of this.listeners) {
      try {
        listener(connectionId, healthy, result)
      } catch (error) {
        console.error("Error in health status listener:", error)
      }
    }
  }

  startMonitoring(connectionId: string, baseUrl: string, discoveryConfig?: Omit<ServerDiscoveryConfig, "baseUrl">): void {
    this.stopMonitoring(connectionId)

    const checkHealth = async (): Promise<void> => {
      const result = await this.performHealthCheck(baseUrl, discoveryConfig)
      this.lastResults.set(connectionId, result)

      if (result.healthy) {
        this.failureCounts.delete(connectionId)
        this.notifyListeners(connectionId, true, result)
      } else {
        const failures = (this.failureCounts.get(connectionId) ?? 0) + 1
        this.failureCounts.set(connectionId, failures)

        if (failures >= this.config.maxFailures) {
          this.notifyListeners(connectionId, false, result)
        }
      }
    }

    checkHealth()

    const interval = setInterval(checkHealth, this.config.intervalMs)
    this.intervals.set(connectionId, interval)
  }

  stopMonitoring(connectionId: string): void {
    const interval = this.intervals.get(connectionId)
    if (interval) {
      clearInterval(interval)
      this.intervals.delete(connectionId)
      this.failureCounts.delete(connectionId)
      this.lastResults.delete(connectionId)
    }
  }

  private async performHealthCheck(
    baseUrl: string,
    discoveryConfig?: Omit<ServerDiscoveryConfig, "baseUrl">
  ): Promise<HealthCheckResult> {
    const timestamp = Date.now()

    try {
      const result = await discoverServer({
        baseUrl,
        timeoutMs: this.config.timeoutMs,
        ...discoveryConfig,
      })

      if (result.success && result.compatible) {
        return {
          healthy: true,
          timestamp,
        }
      }

      return {
        healthy: false,
        timestamp,
        error: result.success ? result.reason : result.message,
      }
    } catch (error) {
      return {
        healthy: false,
        timestamp,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  getLastResult(connectionId: string): HealthCheckResult | null {
    return this.lastResults.get(connectionId) ?? null
  }

  getFailureCount(connectionId: string): number {
    return this.failureCounts.get(connectionId) ?? 0
  }

  isHealthy(connectionId: string): boolean {
    const result = this.lastResults.get(connectionId)
    return result?.healthy ?? false
  }

  stopAll(): void {
    for (const connectionId of this.intervals.keys()) {
      this.stopMonitoring(connectionId)
    }
  }
}
