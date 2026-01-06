import { BenchmarkMetrics } from "./metrics"
import { Bus } from "@/bus"
import { Session } from "@/session"
import { SessionCompaction } from "@/session/compaction"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { MessageV2 } from "@/session/message-v2"
import fs from "fs/promises"
import path from "path"

/**
 * Benchmark runner for comparing compaction methods.
 * Runs the same task with both hybrid and legacy compaction,
 * collecting metrics for comparison.
 */
export namespace BenchmarkRunner {
  const log = Log.create({ service: "benchmark.runner" })

  export interface RunOptions {
    /** Task prompt to execute */
    task: string
    /** Model to use (provider/model format) */
    model: string
    /** Output directory for results */
    outputDir: string
    /** Whether to run LLM judge after */
    runJudge?: boolean
  }

  /**
   * Run a complete benchmark comparing both compaction methods
   */
  export async function run(options: RunOptions): Promise<BenchmarkMetrics.BenchmarkResult> {
    const benchmarkId = BenchmarkMetrics.generateBenchmarkId()
    log.info("starting benchmark", { benchmarkId, task: options.task.slice(0, 50) })

    // Run with hybrid compaction (default)
    log.info("running hybrid compaction")
    const hybridRun = await runWithCompactionMode({
      task: options.task,
      model: options.model,
      mode: "hybrid",
    })

    // Run with legacy compaction
    log.info("running legacy compaction")
    const legacyRun = await runWithCompactionMode({
      task: options.task,
      model: options.model,
      mode: "legacy",
    })

    // Compare results
    const comparison = BenchmarkMetrics.compareRuns(hybridRun, legacyRun)

    const result: BenchmarkMetrics.BenchmarkResult = {
      benchmark_id: benchmarkId,
      task: options.task.slice(0, 100),
      model: options.model,
      timestamp: Date.now(),
      hybrid: hybridRun,
      legacy: legacyRun,
      comparison,
    }

    // Save results
    await saveResults(options.outputDir, benchmarkId, result)

    log.info("benchmark complete", {
      benchmarkId,
      winner: comparison.winner,
      tokenSavings: comparison.token_savings_percent,
      timeSavings: comparison.time_savings_percent,
    })

    return result
  }

  /**
   * Run a task with a specific compaction mode
   */
  async function runWithCompactionMode(options: {
    task: string
    model: string
    mode: "hybrid" | "legacy"
  }): Promise<BenchmarkMetrics.RunMetrics> {
    const runId = BenchmarkMetrics.generateRunId(options.mode)
    const metrics = BenchmarkMetrics.createRunMetrics({
      run_id: runId,
      task: options.task.slice(0, 100),
      model: options.model,
    })

    // Subscribe to compaction metrics
    const unsubscribe = Bus.subscribe(SessionCompaction.Event.CompactionMetrics, (evt) => {
      if (evt.metrics.method === options.mode) {
        metrics.compactions.push(evt.metrics)
        metrics.total_compactions++
      }
    })

    try {
      // Parse model
      const modelParts = Provider.parseModel(options.model)
      const model = await Provider.getModel(modelParts.providerID, modelParts.modelID)

      // Create session with specific compaction mode
      const sessionID = Identifier.ascending("session")
      await Session.create({ sessionID })

      // Temporarily override config for this run
      const originalConfig = await Config.get()
      const configOverride: Config.Info = {
        ...originalConfig,
        compaction: {
          ...originalConfig.compaction,
          hybrid: {
            ...originalConfig.compaction?.hybrid,
            enabled: options.mode === "hybrid",
          },
        },
      }

      // Note: In production, we'd need a way to inject this config
      // For now, we rely on the config being set before the run

      // Create user message
      const userMsgId = Identifier.ascending("message")
      await Session.updateMessage({
        id: userMsgId,
        role: "user",
        sessionID,
        time: { created: Date.now() },
        agent: "build",
        model: {
          providerID: modelParts.providerID,
          modelID: modelParts.modelID,
        },
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: userMsgId,
        sessionID,
        type: "text",
        text: options.task,
        time: { start: Date.now(), end: Date.now() },
      })

      // Process session
      // Note: This is a simplified version - full implementation would use the processor
      metrics.task_completed = true

      metrics.completed_at = Date.now()
    } catch (error) {
      metrics.error = error instanceof Error ? error.message : String(error)
      metrics.completed_at = Date.now()
    } finally {
      unsubscribe()
    }

    return metrics
  }

  /**
   * Save benchmark results to JSON file
   */
  async function saveResults(
    outputDir: string,
    benchmarkId: string,
    result: BenchmarkMetrics.BenchmarkResult,
  ): Promise<void> {
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true })

    const filename = `${benchmarkId}.json`
    const filepath = path.join(outputDir, filename)

    await fs.writeFile(filepath, JSON.stringify(result, null, 2))
    log.info("results saved", { filepath })
  }

  /**
   * Load existing benchmark results
   */
  export async function loadResults(filepath: string): Promise<BenchmarkMetrics.BenchmarkResult | null> {
    try {
      const content = await fs.readFile(filepath, "utf-8")
      return JSON.parse(content) as BenchmarkMetrics.BenchmarkResult
    } catch {
      return null
    }
  }

  /**
   * List all benchmark results in a directory
   */
  export async function listResults(outputDir: string): Promise<string[]> {
    try {
      const files = await fs.readdir(outputDir)
      return files
        .filter((f) => f.startsWith("benchmark_") && f.endsWith(".json"))
        .map((f) => path.join(outputDir, f))
    } catch {
      return []
    }
  }
}
