/**
 * Comprehensive benchmarking and performance monitoring system
 */

import { EOL } from "os"
import { UI } from "./ui"
import { RichUI } from "./rich-ui"
import path from "path"
import { xdgData } from "xdg-basedir"

export namespace Benchmark {
  const BENCHMARK_FILE = path.join(xdgData || "~/.local/share", "opencode", "benchmarks.json")

  export type Metric = {
    name: string
    duration: number
    timestamp: number
    memory?: number
    metadata?: Record<string, any>
  }

  export type BenchmarkResult = {
    command: string
    metrics: Metric[]
    startTime: number
    endTime: number
    totalDuration: number
    peakMemory: number
    averageCpu?: number
  }

  /**
   * Performance timer for measuring operations
   */
  export class Timer {
    private startTime: number = 0
    private endTime: number = 0
    private marks: Map<string, number> = new Map()
    private metrics: Metric[] = []

    start(): void {
      this.startTime = performance.now()
      this.marks.clear()
      this.metrics = []
    }

    mark(name: string): void {
      this.marks.set(name, performance.now())
    }

    measure(name: string, startMark?: string): number {
      const now = performance.now()
      const start = startMark ? this.marks.get(startMark) || this.startTime : this.startTime
      const duration = now - start

      const metric: Metric = {
        name,
        duration,
        timestamp: Date.now(),
        memory: this.getMemoryUsage(),
      }

      this.metrics.push(metric)
      return duration
    }

    end(): number {
      this.endTime = performance.now()
      return this.endTime - this.startTime
    }

    getMetrics(): Metric[] {
      return [...this.metrics]
    }

    getDuration(): number {
      return this.endTime > 0 ? this.endTime - this.startTime : performance.now() - this.startTime
    }

    private getMemoryUsage(): number {
      return process.memoryUsage().heapUsed
    }
  }

  /**
   * Resource monitor for tracking CPU and memory
   */
  export class ResourceMonitor {
    private samples: Array<{ timestamp: number; cpu: number; memory: number }> = []
    private interval?: NodeJS.Timeout
    private lastCpuUsage = process.cpuUsage()
    private lastTime = performance.now()

    start(intervalMs: number = 100): void {
      this.samples = []
      this.interval = setInterval(() => {
        this.sample()
      }, intervalMs)
    }

    stop(): void {
      if (this.interval) {
        clearInterval(this.interval)
        this.interval = undefined
      }
    }

    private sample(): void {
      const now = performance.now()
      const cpuUsage = process.cpuUsage(this.lastCpuUsage)
      const elapsed = (now - this.lastTime) * 1000 // Convert to microseconds

      const cpuPercent = ((cpuUsage.user + cpuUsage.system) / elapsed) * 100
      const memoryMB = process.memoryUsage().heapUsed / 1024 / 1024

      this.samples.push({
        timestamp: Date.now(),
        cpu: cpuPercent,
        memory: memoryMB,
      })

      this.lastCpuUsage = process.cpuUsage()
      this.lastTime = now
    }

    getStats(): {
      avgCpu: number
      maxCpu: number
      avgMemory: number
      maxMemory: number
    } {
      if (this.samples.length === 0) {
        return { avgCpu: 0, maxCpu: 0, avgMemory: 0, maxMemory: 0 }
      }

      const cpus = this.samples.map((s) => s.cpu)
      const memories = this.samples.map((s) => s.memory)

      return {
        avgCpu: cpus.reduce((a, b) => a + b, 0) / cpus.length,
        maxCpu: Math.max(...cpus),
        avgMemory: memories.reduce((a, b) => a + b, 0) / memories.length,
        maxMemory: Math.max(...memories),
      }
    }
  }

  /**
   * Benchmark a function
   */
  export async function measure<T>(
    name: string,
    fn: () => Promise<T>,
    options: { warmup?: boolean; iterations?: number } = {},
  ): Promise<{ result: T; duration: number; stats: any }> {
    const { warmup = false, iterations = 1 } = options

    // Warmup run
    if (warmup) {
      await fn()
    }

    const durations: number[] = []
    const monitor = new ResourceMonitor()
    let result: T

    monitor.start()

    for (let i = 0; i < iterations; i++) {
      const timer = new Timer()
      timer.start()
      result = await fn()
      const duration = timer.end()
      durations.push(duration)
    }

    monitor.stop()
    const resourceStats = monitor.getStats()

    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length
    const minDuration = Math.min(...durations)
    const maxDuration = Math.max(...durations)

    return {
      result: result!,
      duration: avgDuration,
      stats: {
        iterations,
        avgDuration,
        minDuration,
        maxDuration,
        ...resourceStats,
      },
    }
  }

  /**
   * Save benchmark results
   */
  export async function saveResults(results: BenchmarkResult): Promise<void> {
    try {
      let existingResults: BenchmarkResult[] = []

      const file = Bun.file(BENCHMARK_FILE)
      if (await file.exists()) {
        const content = await file.text()
        existingResults = JSON.parse(content)
      }

      existingResults.push(results)

      // Keep only last 100 results
      if (existingResults.length > 100) {
        existingResults = existingResults.slice(-100)
      }

      await Bun.write(BENCHMARK_FILE, JSON.stringify(existingResults, null, 2))
    } catch (error) {
      // Silently fail if can't save benchmarks
    }
  }

  /**
   * Load benchmark results
   */
  export async function loadResults(): Promise<BenchmarkResult[]> {
    try {
      const file = Bun.file(BENCHMARK_FILE)
      if (!(await file.exists())) {
        return []
      }
      const content = await file.text()
      return JSON.parse(content)
    } catch {
      return []
    }
  }

  /**
   * Compare current performance with historical data
   */
  export async function compareWithHistory(
    command: string,
    currentDuration: number,
  ): Promise<{ faster: boolean; percentage: number; avgDuration: number } | null> {
    const results = await loadResults()
    const historical = results.filter((r) => r.command === command)

    if (historical.length === 0) {
      return null
    }

    const avgDuration = historical.reduce((sum, r) => sum + r.totalDuration, 0) / historical.length

    const percentage = ((avgDuration - currentDuration) / avgDuration) * 100

    return {
      faster: currentDuration < avgDuration,
      percentage: Math.abs(percentage),
      avgDuration,
    }
  }

  /**
   * Display benchmark results in a nice format
   */
  export function displayResults(results: BenchmarkResult): void {
    UI.println()
    UI.println(
      RichUI.box(
        `${UI.Style.TEXT_HIGHLIGHT_BOLD}Performance Report${UI.Style.TEXT_NORMAL}${EOL}${EOL}${RichUI.keyValue({
          Command: results.command,
          Duration: RichUI.formatDuration(results.totalDuration),
          "Peak Memory": RichUI.formatBytes(results.peakMemory),
          "Avg CPU": results.averageCpu ? `${results.averageCpu.toFixed(2)}%` : "N/A",
        })}`,
        { title: "Benchmark", style: "TEXT_INFO" },
      ),
    )

    if (results.metrics.length > 0) {
      UI.println()
      UI.println(UI.Style.TEXT_DIM + "Detailed Metrics:" + UI.Style.TEXT_NORMAL)
      UI.println()

      const headers = ["Operation", "Duration", "Memory"]
      const rows = results.metrics.map((m) => [
        m.name,
        RichUI.formatDuration(m.duration),
        m.memory ? RichUI.formatBytes(m.memory) : "N/A",
      ])

      UI.println(RichUI.table(headers, rows))
    }

    UI.println()
  }

  /**
   * Display performance comparison
   */
  export async function displayComparison(command: string, duration: number): Promise<void> {
    const comparison = await compareWithHistory(command, duration)

    if (!comparison) {
      UI.println(UI.Style.TEXT_DIM + "No historical data for comparison" + UI.Style.TEXT_NORMAL)
      return
    }

    const icon = comparison.faster ? RichUI.Icons.success : RichUI.Icons.warning
    const color = comparison.faster ? UI.Style.TEXT_SUCCESS : UI.Style.TEXT_WARNING
    const direction = comparison.faster ? "faster" : "slower"

    UI.println()
    UI.println(
      `${color}${icon}${UI.Style.TEXT_NORMAL} ${comparison.percentage.toFixed(2)}% ${direction} than average (${RichUI.formatDuration(comparison.avgDuration)})`,
    )
  }

  /**
   * Profile async operations
   */
  export async function profile<T>(
    operations: Array<{ name: string; fn: () => Promise<T> }>,
  ): Promise<Map<string, number>> {
    const results = new Map<string, number>()

    for (const op of operations) {
      const timer = new Timer()
      timer.start()
      await op.fn()
      const duration = timer.end()
      results.set(op.name, duration)
    }

    return results
  }

  /**
   * Get system information
   */
  export function getSystemInfo(): Record<string, string> {
    return {
      Platform: process.platform,
      Arch: process.arch,
      "Node Version": process.version,
      "Bun Version": Bun.version,
      "Memory Total": RichUI.formatBytes(require("os").totalmem()),
      "Memory Free": RichUI.formatBytes(require("os").freemem()),
      CPUs: require("os").cpus().length.toString(),
    }
  }

  /**
   * Display system information
   */
  export function displaySystemInfo(): void {
    UI.println()
    UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "System Information" + UI.Style.TEXT_NORMAL)
    UI.println()
    UI.println(RichUI.keyValue(getSystemInfo()))
    UI.println()
  }
}
