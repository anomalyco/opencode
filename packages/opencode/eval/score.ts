#!/usr/bin/env bun
// Comparison reporter: reads two result files and prints a head-to-head table.
//
// Usage:
//   bun run eval/score.ts results/fork-*.json results/upstream-*.json
//   bun run eval/score.ts --auto  (auto-find latest results per branch)

import { parseArgs } from "util"
import fs from "node:fs"
import path from "node:path"

const EVAL_DIR = import.meta.dir
const RESULTS_DIR = path.join(EVAL_DIR, "results")

type TaskResult = {
  task_id: string
  task_name: string
  branch: string
  model: string
  passed: boolean
  diff_lines: number
  wall_clock_ms: number
  tool_calls: number
  error?: string
}

function loadResults(filePath: string): TaskResult[] {
  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function findLatestResults(): { fork: string; upstream: string } | null {
  if (!fs.existsSync(RESULTS_DIR)) return null
  const files = fs.readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json"))
  if (files.length < 2) return null

  // Group by branch (first part before first dash)
  const byBranch = new Map<string, string[]>()
  for (const f of files) {
    const branch = f.split("-")[0]
    const existing = byBranch.get(branch) ?? []
    existing.push(f)
    byBranch.set(branch, existing)
  }

  // Pick the latest file per branch
  const latest = new Map<string, string>()
  for (const [branch, branchFiles] of byBranch) {
    branchFiles.sort()
    latest.set(branch, path.join(RESULTS_DIR, branchFiles.at(-1)!))
  }

  if (latest.size < 2) return null

  const branches = [...latest.keys()]
  return {
    fork: latest.get(branches[0])!,
    upstream: latest.get(branches[1])!,
  }
}

function printComparison(forkResults: TaskResult[], upstreamResults: TaskResult[]) {
  // Index by task_id
  const forkMap = new Map(forkResults.map((r) => [r.task_id, r]))
  const upstreamMap = new Map(upstreamResults.map((r) => [r.task_id, r]))

  const allTaskIds = [...new Set([...forkMap.keys(), ...upstreamMap.keys()])].sort()

  console.log("\n" + "=".repeat(120))
  console.log("HEAD-TO-HEAD COMPARISON")
  console.log("=".repeat(120))

  const forkLabel = forkResults[0]?.branch ?? "fork"
  const upstreamLabel = upstreamResults[0]?.branch ?? "upstream"

  console.log(
    `  ${"Task".padEnd(30)} ${forkLabel.padEnd(12)} ${upstreamLabel.padEnd(12)} ${"Diff Δ".padEnd(10)} ${"Time Δ".padEnd(12)} ${"Tools Δ".padEnd(10)}`,
  )
  console.log("-".repeat(120))

  let forkPassed = 0
  let upstreamPassed = 0
  let forkTotalTime = 0
  let upstreamTotalTime = 0
  let forkTotalDiff = 0
  let upstreamTotalDiff = 0

  for (const taskId of allTaskIds) {
    const fork = forkMap.get(taskId)
    const upstream = upstreamMap.get(taskId)

    const forkStatus = fork?.passed ? "PASS" : "FAIL"
    const upstreamStatus = upstream?.passed ? "PASS" : "FAIL"

    if (fork?.passed) forkPassed++
    if (upstream?.passed) upstreamPassed++

    const forkTime = (fork?.wall_clock_ms ?? 0) / 1000
    const upstreamTime = (upstream?.wall_clock_ms ?? 0) / 1000
    forkTotalTime += fork?.wall_clock_ms ?? 0
    upstreamTotalTime += upstream?.wall_clock_ms ?? 0

    const forkDiff = fork?.diff_lines ?? 0
    const upstreamDiff = upstream?.diff_lines ?? 0
    forkTotalDiff += forkDiff
    upstreamTotalDiff += upstreamDiff

    const diffDelta = forkDiff - upstreamDiff
    const timeDelta = forkTime - upstreamTime
    const toolsDelta = (fork?.tool_calls ?? 0) - (upstream?.tool_calls ?? 0)

    const name = (fork ?? upstream)?.task_name ?? taskId
    console.log(
      `  ${name.padEnd(30)} ${forkStatus.padEnd(12)} ${upstreamStatus.padEnd(12)} ${String(diffDelta >= 0 ? `+${diffDelta}` : diffDelta).padEnd(10)} ${`${timeDelta >= 0 ? "+" : ""}${timeDelta.toFixed(1)}s`.padEnd(12)} ${String(toolsDelta >= 0 ? `+${toolsDelta}` : toolsDelta).padEnd(10)}`,
    )
  }

  console.log("-".repeat(120))

  const forkRate = ((forkPassed / allTaskIds.length) * 100).toFixed(0)
  const upstreamRate = ((upstreamPassed / allTaskIds.length) * 100).toFixed(0)

  console.log(`  Pass rate:     ${forkLabel}: ${forkPassed}/${allTaskIds.length} (${forkRate}%)  |  ${upstreamLabel}: ${upstreamPassed}/${allTaskIds.length} (${upstreamRate}%)`)
  console.log(`  Total time:    ${forkLabel}: ${(forkTotalTime / 1000).toFixed(1)}s     |  ${upstreamLabel}: ${(upstreamTotalTime / 1000).toFixed(1)}s`)
  console.log(`  Total diff:    ${forkLabel}: ${forkTotalDiff} lines  |  ${upstreamLabel}: ${upstreamTotalDiff} lines`)

  // Verdict
  console.log("\n  VERDICT:")
  if (forkPassed > upstreamPassed) {
    console.log(`  ✓ ${forkLabel} wins on pass rate (+${forkPassed - upstreamPassed} tasks)`)
  } else if (upstreamPassed > forkPassed) {
    console.log(`  ✗ ${upstreamLabel} wins on pass rate (+${upstreamPassed - forkPassed} tasks)`)
  } else {
    console.log(`  = Tie on pass rate`)
  }

  if (forkTotalTime < upstreamTotalTime) {
    const speedup = ((1 - forkTotalTime / upstreamTotalTime) * 100).toFixed(0)
    console.log(`  ✓ ${forkLabel} is ${speedup}% faster`)
  } else if (upstreamTotalTime < forkTotalTime) {
    const speedup = ((1 - upstreamTotalTime / forkTotalTime) * 100).toFixed(0)
    console.log(`  ✗ ${upstreamLabel} is ${speedup}% faster`)
  } else {
    console.log(`  = Same speed`)
  }

  if (forkTotalDiff < upstreamTotalDiff) {
    console.log(`  ✓ ${forkLabel} produces ${upstreamTotalDiff - forkTotalDiff} fewer lines of diff`)
  } else if (upstreamTotalDiff < forkTotalDiff) {
    console.log(`  ✗ ${upstreamLabel} produces ${forkTotalDiff - upstreamTotalDiff} fewer lines of diff`)
  } else {
    console.log(`  = Same diff size`)
  }

  console.log("=".repeat(120))
}

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      auto: { type: "boolean", default: false },
    },
    allowPositionals: true,
  })

  let forkFile: string
  let upstreamFile: string

  if (values.auto || positionals.length === 0) {
    const latest = findLatestResults()
    if (!latest) {
      console.error("No results found. Run eval/run-eval.ts first with two different branches.")
      process.exit(1)
    }
    forkFile = latest.fork
    upstreamFile = latest.upstream
  } else if (positionals.length === 2) {
    forkFile = positionals[0]
    upstreamFile = positionals[1]
  } else {
    console.error("Usage: bun run eval/score.ts <fork-results.json> <upstream-results.json>")
    console.error("       bun run eval/score.ts --auto")
    process.exit(1)
  }

  const forkResults = loadResults(forkFile)
  const upstreamResults = loadResults(upstreamFile)

  printComparison(forkResults, upstreamResults)
}

main()
