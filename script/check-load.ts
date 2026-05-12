#!/usr/bin/env bun
import { cpus, totalmem, freemem } from "node:os"

interface LoadMetrics {
  cpuUsage: number
  cpuCores: number
  memoryUsage: number
  maxParallel: number
}

function cpuTimes() {
  return cpus().map(c => c.times)
}

function cpuDeltas(sample1: ReturnType<typeof cpuTimes>, sample2: ReturnType<typeof cpuTimes>) {
  let totalDelta = 0
  let idleDelta = 0
  for (let i = 0; i < sample1.length; i++) {
    const s1 = sample1[i]
    const s2 = sample2[i]
    const dTotal = (s2.user - s1.user) + (s2.nice - s1.nice) + (s2.sys - s1.sys) + (s2.idle - s1.idle) + (s2.irq - s1.irq)
    const dIdle = s2.idle - s1.idle
    totalDelta += dTotal
    idleDelta += dIdle
  }
  return { totalDelta, idleDelta }
}

function calculateCpuUsage(sample1: ReturnType<typeof cpuTimes>, sample2: ReturnType<typeof cpuTimes>): number {
  const { totalDelta, idleDelta } = cpuDeltas(sample1, sample2)
  if (totalDelta === 0) return 0
  return Math.round(((totalDelta - idleDelta) / totalDelta) * 100)
}

async function getLoadMetrics(): Promise<LoadMetrics> {
  const sample1 = cpuTimes()
  await Bun.sleep(100)
  const sample2 = cpuTimes()

  const cpuUsage = calculateCpuUsage(sample1, sample2)
  const cores = cpus().length
  const memUsed = totalmem() - freemem()
  const memoryUsage = Math.round((memUsed / totalmem()) * 100)

  const headroom = 1 - cpuUsage / 100
  const maxParallel = Math.max(1, Math.floor(cores * headroom * 2))

  return { cpuUsage, cpuCores: cores, memoryUsage, maxParallel }
}

function getConcurrencyLimit(level: "XS" | "S" | "M" | "L" | "XL", metrics: LoadMetrics): number {
  const headroom = 1 - metrics.cpuUsage / 100
  const base = level === "XS" || level === "S" ? metrics.cpuCores * 0.5 : metrics.cpuCores * 0.25
  return Math.max(1, Math.floor(base * headroom))
}

const metrics = await getLoadMetrics()

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(metrics, null, 2))
} else {
  const barLen = 20
  const cpuBar = "█".repeat(Math.round(metrics.cpuUsage / 100 * barLen))
  const memBar = "█".repeat(Math.round(metrics.memoryUsage / 100 * barLen))
  const cpuEmpty = "░".repeat(barLen - cpuBar.length)
  const memEmpty = "░".repeat(barLen - memBar.length)

  console.log(`📊 Load Metrics`)
  console.log(`   CPU:    ${cpuBar}${cpuEmpty} ${metrics.cpuUsage}%`)
  console.log(`   Memory: ${memBar}${memEmpty} ${metrics.memoryUsage}%`)
  console.log(`   Cores:  ${metrics.cpuCores}`)
  console.log(`   Max Parallel Tasks: ${metrics.maxParallel}`)
  console.log()

  const overloaded = metrics.cpuUsage > 80 || metrics.memoryUsage > 90
  if (overloaded) {
    console.log("⚠️  System is overloaded — reduce parallel concurrency")
  } else {
    console.log("✅ System is OK — safe to parallelize")
  }
}

const isOverloaded = metrics.cpuUsage > 80 || metrics.memoryUsage > 90
process.exit(isOverloaded ? 1 : 0)
