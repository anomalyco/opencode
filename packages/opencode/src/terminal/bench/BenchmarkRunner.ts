import os from "os"
import fs from "fs"
import path from "path"

export interface BenchmarkResult {
  name: string
  mean: number
  stddev: number
  cv: number
  p95: number
  median: number
  min: number
  max: number
  baselineMean: number
  baselineRatio: number
  samples: number[]
  baselineSamples: number[]
  env: EnvInfo
}

export interface EnvInfo {
  platform: string
  arch: string
  cpuModel: string
  cpuSpeed: number
  ram: string
  bunVersion: string
  nodeVersion: string
}

export class BenchmarkVarianceError extends Error {
  cv: number
  constructor(cv: number) {
    super(`Benchmark variance too high (CV: ${(cv * 100).toFixed(2)}%). Threats to validity detected.`)
    this.name = "BenchmarkVarianceError"
    this.cv = cv
  }
}

declare global {
  // Bun.gc is not in standard lib types — declared here for type safety
  namespace Bun {
    function gc(force: boolean): void
  }
}

function forceGc(): void {
  if (typeof Bun !== "undefined" && "gc" in Bun) {
    Bun.gc(true)
    Bun.gc(true)
    Bun.gc(true)
  }
}

function flushAndStabilize(): void {
  if (typeof Bun !== "undefined" && "gc" in Bun) {
    Bun.gc(true)
    Bun.gc(true)
    Bun.gc(true)
  }
}

function captureEnv(): EnvInfo {
  const cpus = os.cpus()
  return {
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpus.length > 0 ? cpus[0]!.model : "unknown",
    cpuSpeed: cpus.length > 0 ? cpus[0]!.speed : 0,
    ram: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB`,
    bunVersion: typeof Bun !== "undefined" ? Bun.version : "N/A",
    nodeVersion: process.version,
  }
}

let envCache: EnvInfo | null = null

export function getEnv(): EnvInfo {
  if (!envCache) envCache = captureEnv()
  return envCache
}

export interface BenchmarkConfig {
  name: string
  baseline: () => void
  optimized: () => void
  warmup?: number
  iterations?: number
  maxCV?: number
  trimOutliers?: number
}

const WARMUP = 15
const ITERATIONS = 25
const MAX_CV = 0.15
const TRIM_OUTLIERS = 5

export function runBenchmark(config: BenchmarkConfig): BenchmarkResult {
  const warmup = config.warmup ?? WARMUP
  const iterations = config.iterations ?? ITERATIONS
  const maxCV = config.maxCV ?? MAX_CV
  const trimOutliers = config.trimOutliers ?? TRIM_OUTLIERS

  flushAndStabilize()

  for (let i = 0; i < warmup; i++) {
    config.baseline()
    config.optimized()
  }

  const gc = forceGc

  const baselineTimes: bigint[] = []
  for (let i = 0; i < iterations; i++) {
    gc()
    const start = process.hrtime.bigint()
    config.baseline()
    baselineTimes.push(process.hrtime.bigint() - start)
  }

  // Stabilize heap between phases: flush baseline garbage before optimized measurements
  gc()
  const dummy: number[] = []
  for (let i = 0; i < 1000; i++) dummy.push(i)
  dummy.length = 0
  gc()

  const optimizedTimes: bigint[] = []
  for (let i = 0; i < iterations; i++) {
    gc()
    const start = process.hrtime.bigint()
    config.optimized()
    optimizedTimes.push(process.hrtime.bigint() - start)
  }

  const optNs = optimizedTimes.map(t => Number(t)).sort((a, b) => a - b)
  const baseNs = baselineTimes.map(t => Number(t)).sort((a, b) => a - b)

  const trimCount = Math.min(trimOutliers, Math.floor(optNs.length / 4))
  const trimmedOpt = trimCount > 0 ? optNs.slice(trimCount, -trimCount) : optNs
  const trimmedBase = trimCount > 0 ? baseNs.slice(trimCount, -trimCount) : baseNs

  const mean = trimmedOpt.reduce((a, b) => a + b, 0) / trimmedOpt.length
  const baselineMean = trimmedBase.reduce((a, b) => a + b, 0) / trimmedBase.length
  const variance = trimmedOpt.reduce((a, b) => a + (b - mean) ** 2, 0) / trimmedOpt.length
  const stddev = Math.sqrt(variance)
  const cv = stddev / mean

  if (cv > maxCV) {
    throw new BenchmarkVarianceError(cv)
  }

  const p95 = optNs[Math.floor((optNs.length - 1) * 0.95)]
  const median = optNs[Math.floor(optNs.length * 0.5)]
  const min = optNs[0]!
  const max = optNs[optNs.length - 1]!

  return {
    name: config.name,
    mean, stddev, cv, p95, median, min, max,
    baselineMean, baselineRatio: mean / baselineMean,
    samples: optNs, baselineSamples: baseNs,
    env: getEnv(),
  }
}

let allResults: BenchmarkResult[] = []

export function publishResult(result: BenchmarkResult): void {
  allResults.push(result)
}

export function writeResults(): void {
  if (allResults.length === 0) return
  const output = {
    timestamp: new Date().toISOString(),
    environment: getEnv(),
    benchmarks: allResults.map(r => ({
      name: r.name,
      meanNs: r.mean,
      stddevNs: r.stddev,
      cv: r.cv,
      p95Ns: r.p95,
      medianNs: r.median,
      minNs: r.min,
      maxNs: r.max,
      baselineMeanNs: r.baselineMean,
      baselineRatio: r.baselineRatio,
      verdict: r.baselineRatio < 1.0 ? "PASS" : r.baselineRatio < 2.0 ? "INFO" : "TRADEOFF",
    })),
  }
  const outPath = path.resolve(process.cwd(), "benchmarks-results.json")
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log(`[harness] Results written to ${outPath}`)
}
