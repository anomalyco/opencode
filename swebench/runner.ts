/**
 * SWE-bench Runner - Parallel Task Scheduler
 */

import path from "path"
import fs from "fs/promises"
import type { SWEInstance, RunConfig, InstanceResult, Checkpoint, Prediction } from "./types"
import { loadDataset, filterCompleted } from "./dataset"
import { processInstance } from "./worker"
import { generateReport } from "./report"

const BASE_PORT = 14096

/** Generate unique run ID */
function generateRunId(): string {
  const date = new Date().toISOString().slice(0, 10)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${date}-${rand}`
}

/** Save checkpoint */
async function saveCheckpoint(outputDir: string, checkpoint: Checkpoint): Promise<void> {
  const checkpointPath = path.join(outputDir, "checkpoint.json")
  await fs.writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2))
}

/** Load checkpoint */
async function loadCheckpoint(outputDir: string): Promise<Checkpoint | null> {
  const checkpointPath = path.join(outputDir, "checkpoint.json")
  try {
    const content = await fs.readFile(checkpointPath, "utf-8")
    return JSON.parse(content)
  } catch {
    return null
  }
}

/** Append prediction to JSONL file */
async function appendPrediction(outputDir: string, prediction: Prediction): Promise<void> {
  const predictionsPath = path.join(outputDir, "predictions.jsonl")
  await fs.appendFile(predictionsPath, JSON.stringify(prediction) + "\n")
}

/** Append log */
async function appendLog(outputDir: string, instanceId: string, content: string): Promise<void> {
  const logsDir = path.join(outputDir, "logs")
  await fs.mkdir(logsDir, { recursive: true })
  const logPath = path.join(logsDir, `${instanceId.replace(/[/\\:]/g, "_")}.log`)
  await fs.writeFile(logPath, content)
}

/** Format duration */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

/** Show progress */
function showProgress(
  completed: number,
  total: number,
  success: number,
  failed: number,
  startTime: number,
): void {
  const elapsed = Date.now() - startTime
  const rate = completed / (elapsed / 1000 / 60) // per minute
  const remaining = total - completed
  const eta = remaining > 0 && rate > 0 ? remaining / rate : 0

  const percent = ((completed / total) * 100).toFixed(1)
  const successRate = completed > 0 ? ((success / completed) * 100).toFixed(1) : "0.0"

  process.stdout.write(
    `\r[${completed}/${total}] ${percent}% | ` +
      `Success: ${success} (${successRate}%) | Failed: ${failed} | ` +
      `Elapsed: ${formatDuration(elapsed)} | ETA: ${formatDuration(eta * 60 * 1000)}   `,
  )
}


/** Run SWE-bench evaluation */
export async function run(config: RunConfig): Promise<void> {
  const runId = generateRunId()
  const outputDir = path.resolve(config.outputDir, runId)
  await fs.mkdir(outputDir, { recursive: true })

  console.log(`\n=== SWE-bench Runner ===`)
  console.log(`Run ID: ${runId}`)
  console.log(`Output: ${outputDir}`)
  console.log(`Model: ${config.model}`)
  console.log(`Dataset: ${config.dataset}`)
  console.log(`Concurrency: ${config.concurrency}`)
  console.log(`Timeout: ${config.timeout / 1000}s per instance`)
  console.log()

  // Load dataset
  console.log("Loading dataset...")
  let instances = await loadDataset(config)

  // Check for resume
  let checkpoint: Checkpoint | null = null
  if (config.resume) {
    const resumeDir = path.resolve(config.resume)
    checkpoint = await loadCheckpoint(resumeDir)
    if (checkpoint) {
      console.log(`Resuming from checkpoint with ${checkpoint.completed.length} completed instances`)
      instances = filterCompleted(instances, checkpoint.completed)
      // Copy existing results
      const srcPredictions = path.join(resumeDir, "predictions.jsonl")
      const dstPredictions = path.join(outputDir, "predictions.jsonl")
      try {
        await fs.copyFile(srcPredictions, dstPredictions)
      } catch {
        // ignore
      }
    }
  }

  if (instances.length === 0) {
    console.log("No instances to process!")
    return
  }

  console.log(`Processing ${instances.length} instances...\n`)

  const startTime = Date.now()
  const results: InstanceResult[] = checkpoint?.results || []
  const completed = new Set(checkpoint?.completed || [])
  let success = results.filter((r) => r.status === "success").length
  let failed = results.filter((r) => r.status !== "success").length

  // Allocate ports: each worker uses independent port
  const portPool = Array.from({ length: config.concurrency }, (_, i) => BASE_PORT + i)

  // Process single instance
  const processOne = async (instance: SWEInstance, idx: number): Promise<InstanceResult> => {
    const port = portPool[idx % portPool.length]
    const result = await processInstance(instance, config, port)

    results.push(result)
    completed.add(instance.instance_id)

    if (result.status === "success") {
      success++
      await appendPrediction(outputDir, {
        instance_id: instance.instance_id,
        model_name_or_path: config.model,
        model_patch: result.patch || "",
      })
    } else {
      failed++
      await appendLog(outputDir, instance.instance_id, `Status: ${result.status}\nError: ${result.error || "Unknown"}`)
    }

    await saveCheckpoint(outputDir, {
      runId,
      config,
      completed: Array.from(completed),
      results,
      startTime,
    })

    showProgress(completed.size, instances.length + (checkpoint?.completed.length || 0), success, failed, startTime)
    return result
  }

  // Concurrency control: use Promise pool
  const executing = new Set<Promise<InstanceResult>>()

  for (let i = 0; i < instances.length; i++) {
    const instance = instances[i]
    const promise = processOne(instance, i).finally(() => executing.delete(promise))
    executing.add(promise)

    if (executing.size >= config.concurrency) {
      await Promise.race(executing)
    }
  }

  await Promise.all(executing)

  console.log("\n\nGenerating report...")

  // Generate report
  const report = generateReport({
    runId,
    model: config.model,
    dataset: config.dataset,
    agent: config.agent,
    startTime,
    endTime: Date.now(),
    results,
  })

  const reportPath = path.join(outputDir, "report.json")
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2))

  console.log("\n=== Run Complete ===")
  console.log(`Total: ${report.stats.total}`)
  console.log(`Success: ${report.stats.success} (${((report.stats.success / report.stats.total) * 100).toFixed(1)}%)`)
  console.log(`Failed: ${report.stats.failed}`)
  console.log(`Timeout: ${report.stats.timeout}`)
  console.log(`Avg Duration: ${formatDuration(report.stats.avgDuration)}`)
  console.log(`\nResults saved to: ${outputDir}`)
  console.log(`  - predictions.jsonl (for SWE-bench evaluation)`)
  console.log(`  - report.json`)
  console.log(`  - logs/`)
}
