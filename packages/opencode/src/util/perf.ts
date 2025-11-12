/**
 * Performance monitoring utilities for OpenTUI
 * Tracks execution times and call frequencies for optimization insights
 */

export namespace Perf {
  interface Metric {
    name: string
    count: number
    totalTime: number
    avgTime: number
    minTime: number
    maxTime: number
    lastCall: number
  }

  const metrics = new Map<string, Metric>()
  const enabled = process.env.OPENCODE_PERF === "1"

  /**
   * Wrap a function with performance tracking
   */
  export function track<T extends (...args: any[]) => any>(name: string, fn: T): T {
    if (!enabled) return fn

    return ((...args: any[]) => {
      const start = performance.now()
      try {
        const result = fn(...args)

        // Handle async functions
        if (result instanceof Promise) {
          return result.finally(() => {
            recordMetric(name, performance.now() - start)
          })
        }

        recordMetric(name, performance.now() - start)
        return result
      } catch (error) {
        recordMetric(name, performance.now() - start)
        throw error
      }
    }) as T
  }

  /**
   * Track a code block execution time
   */
  export function measure(name: string): { stop: () => void; [Symbol.dispose]: () => void } {
    if (!enabled) {
      return {
        stop: () => {},
        [Symbol.dispose]: () => {},
      }
    }

    const start = performance.now()
    const stop = () => {
      recordMetric(name, performance.now() - start)
    }

    return {
      stop,
      [Symbol.dispose]: stop,
    }
  }

  /**
   * Record a metric measurement
   */
  function recordMetric(name: string, duration: number) {
    const existing = metrics.get(name)

    if (existing) {
      existing.count++
      existing.totalTime += duration
      existing.avgTime = existing.totalTime / existing.count
      existing.minTime = Math.min(existing.minTime, duration)
      existing.maxTime = Math.max(existing.maxTime, duration)
      existing.lastCall = Date.now()
    } else {
      metrics.set(name, {
        name,
        count: 1,
        totalTime: duration,
        avgTime: duration,
        minTime: duration,
        maxTime: duration,
        lastCall: Date.now(),
      })
    }
  }

  /**
   * Get current metrics snapshot
   */
  export function getMetrics(): Metric[] {
    return Array.from(metrics.values()).sort((a, b) => b.totalTime - a.totalTime)
  }

  /**
   * Get a specific metric
   */
  export function getMetric(name: string): Metric | undefined {
    return metrics.get(name)
  }

  /**
   * Clear all metrics
   */
  export function clear() {
    metrics.clear()
  }

  /**
   * Print metrics summary to console
   */
  export function report() {
    if (!enabled) {
      console.log("Performance monitoring disabled. Set OPENCODE_PERF=1 to enable.")
      return
    }

    const sorted = getMetrics()

    console.log("\n=== OpenTUI Performance Report ===\n")
    console.log("Name".padEnd(40), "Calls".padEnd(10), "Avg(ms)".padEnd(12), "Total(ms)".padEnd(12), "Min/Max(ms)")
    console.log("-".repeat(100))

    for (const metric of sorted) {
      console.log(
        metric.name.padEnd(40),
        metric.count.toString().padEnd(10),
        metric.avgTime.toFixed(2).padEnd(12),
        metric.totalTime.toFixed(2).padEnd(12),
        `${metric.minTime.toFixed(2)} / ${metric.maxTime.toFixed(2)}`,
      )
    }

    console.log("-".repeat(100))
    console.log(`Total tracked operations: ${sorted.reduce((sum, m) => sum + m.count, 0)}`)
    console.log(`Total time: ${sorted.reduce((sum, m) => sum + m.totalTime, 0).toFixed(2)}ms`)
    console.log("\n")
  }

  /**
   * Automatically log report on process exit
   */
  if (enabled) {
    process.on("exit", () => {
      report()
    })
  }
}
