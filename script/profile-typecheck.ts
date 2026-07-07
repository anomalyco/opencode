#!/usr/bin/env bun

import { mkdir } from "fs/promises"
import path from "path"

if (process.platform !== "darwin") throw new Error("System typecheck profiling currently supports macOS only")

const root = path.resolve(import.meta.dir, "..")
const startedAt = new Date()
const args = Bun.argv.slice(2)
const command = [
  "bun",
  "turbo",
  "typecheck",
  ...(args.some((arg) => arg.startsWith("--concurrency")) ? [] : ["--concurrency=3"]),
  ...args,
]
const before = systemSnapshot()
const proc = Bun.spawn(command, {
  cwd: root,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})
const samples = [processTreeSnapshot(proc.pid, startedAt)]
const timer = setInterval(() => samples.push(processTreeSnapshot(proc.pid, startedAt)), 200)
const exitCode = await proc.exited
clearInterval(timer)
samples.push(processTreeSnapshot(proc.pid, startedAt))

const finishedAt = new Date()
const after = systemSnapshot()
const active = samples.filter((sample) => sample.processes > 0)
const report = {
  command,
  cwd: root,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationSeconds: (finishedAt.getTime() - startedAt.getTime()) / 1000,
  exitCode,
  summary: {
    peakCpuPercent: Math.max(0, ...active.map((sample) => sample.cpuPercent)),
    averageCpuPercent: average(active.map((sample) => sample.cpuPercent)),
    peakAggregateRssMB: Math.max(0, ...active.map((sample) => sample.aggregateRssMB)),
    peakProcesses: Math.max(0, ...active.map((sample) => sample.processes)),
    peakTsgoRelatedProcesses: Math.max(0, ...active.map((sample) => sample.tsgoRelatedProcesses)),
    swapDeltaMB: after.swapUsedMB - before.swapUsedMB,
    compressedMemoryDeltaMB: after.compressedMemoryMB - before.compressedMemoryMB,
    pageoutDelta: after.pageouts - before.pageouts,
  },
  system: { before, after },
  samples,
}

const directory = path.join(root, ".typecheck-profiles")
const file = path.join(directory, `${startedAt.toISOString().replaceAll(":", "-")}.json`)
await mkdir(directory, { recursive: true })
await Bun.write(file, JSON.stringify(report, null, 2) + "\n")

console.log(`
Typecheck profile
  Duration:       ${report.durationSeconds.toFixed(1)}s
  Average CPU:    ${report.summary.averageCpuPercent.toFixed(0)}%
  Peak CPU:       ${report.summary.peakCpuPercent.toFixed(0)}%
  Aggregate RSS:  ${report.summary.peakAggregateRssMB.toFixed(0)} MB
  Peak processes: ${report.summary.peakProcesses} (${report.summary.peakTsgoRelatedProcesses} tsgo-related)
  Swap delta:     ${signed(report.summary.swapDeltaMB)} MB
  Compressed:     ${signed(report.summary.compressedMemoryDeltaMB)} MB
  Pageouts:       ${signed(report.summary.pageoutDelta)}
  Report:         ${path.relative(root, file)}
`)

process.exit(exitCode)

function processTreeSnapshot(rootPID: number, startedAt: Date) {
  const processes = processList()
  const pids = new Set([rootPID])
  const pending = [rootPID]
  while (pending.length > 0) {
    const parent = pending.shift()
    processes
      .filter((process) => process.ppid === parent && !pids.has(process.pid))
      .forEach((process) => {
        pids.add(process.pid)
        pending.push(process.pid)
      })
  }
  const tree = processes.filter((process) => pids.has(process.pid))
  return {
    elapsedSeconds: (Date.now() - startedAt.getTime()) / 1000,
    processes: tree.length,
    tsgoRelatedProcesses: tree.filter((process) => /\btsgo\b/.test(process.command)).length,
    cpuPercent: sum(tree.map((process) => process.cpuPercent)),
    aggregateRssMB: sum(tree.map((process) => process.rssKB)) / 1024,
  }
}

function systemSnapshot() {
  const vm = text(["vm_stat"])
  const pageSize = Number(vm.match(/page size of (\d+) bytes/)?.[1] ?? 4096)
  const fields = Object.fromEntries(
    vm
      .split("\n")
      .map((line) => line.match(/^([^:]+):\s+(\d+)\.?$/))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => [match[1], Number(match[2])]),
  )
  const swap = text(["sysctl", "-n", "vm.swapusage"])
  return {
    loadAverage: text(["sysctl", "-n", "vm.loadavg"]).trim(),
    thermalState: text(["pmset", "-g", "therm"]).trim(),
    swapUsedMB: Number(swap.match(/used = ([\d.]+)M/)?.[1] ?? 0),
    freeMemoryMB: ((fields["Pages free"] ?? 0) * pageSize) / 1024 / 1024,
    compressedMemoryMB: ((fields["Pages occupied by compressor"] ?? 0) * pageSize) / 1024 / 1024,
    pageouts: fields.Pageouts ?? 0,
    relevantProcesses: processList()
      .filter((process) =>
        /opencode|tsgo|tsserver|vtsls|eslintServer|tailwindcss-language-server/.test(process.command),
      )
      .sort((a, b) => b.rssKB - a.rssKB)
      .map(processSummary),
    topCpuProcesses: processList()
      .sort((a, b) => b.cpuPercent - a.cpuPercent)
      .slice(0, 15)
      .map(processSummary),
    topMemoryProcesses: processList()
      .sort((a, b) => b.rssKB - a.rssKB)
      .slice(0, 15)
      .map(processSummary),
  }
}

function processSummary(process: ReturnType<typeof processList>[number]) {
  return {
    pid: process.pid,
    ppid: process.ppid,
    rssMB: process.rssKB / 1024,
    cpuPercent: process.cpuPercent,
    command: process.command,
  }
}

function processList() {
  return text(["ps", "-axo", "pid=,ppid=,rss=,%cpu=,command="])
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      rssKB: Number(match[3]),
      cpuPercent: Number(match[4]),
      command: match[5],
    }))
}

function text(command: string[]) {
  return Bun.spawnSync(command).stdout.toString()
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

function average(values: number[]) {
  if (values.length === 0) return 0
  return sum(values) / values.length
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(0)}`
}
