#!/usr/bin/env bun

// Empirical micro-benchmark. Measures real wall-clock time of a command across N runs and reports
// min/median/p95/mean. This replaces LLM Big-O guesses (BigO(Bench): ~4.8%) with measurement.
// To reason about complexity, bench the same command at growing input sizes and compare.
//
//   bun run script/bench.ts --runs 30 -- bun run script/coverage-baseline.ts
//   bun run script/bench.ts --runs 100 --json -- sleep 0.01

const argv = process.argv.slice(2)
const separator = argv.indexOf("--")
if (separator === -1 || separator === argv.length - 1) {
  console.error("usage: bench.ts [--runs N] [--json] -- <command> [args...]")
  process.exit(2)
}

const flags = argv.slice(0, separator)
const command = argv.slice(separator + 1)
const runsIndex = flags.indexOf("--runs")
const runs = runsIndex !== -1 ? Number(flags[runsIndex + 1]) : 20
const json = flags.includes("--json")

const durations: number[] = []
for (let run = 0; run < runs; run++) {
  const started = Bun.nanoseconds()
  await Bun.spawn(command, { stdout: "ignore", stderr: "ignore" }).exited
  durations.push((Bun.nanoseconds() - started) / 1e6)
}
durations.sort((a, b) => a - b)

const percentile = (p: number) => durations[Math.min(durations.length - 1, Math.floor((p / 100) * durations.length))]
const round = (value: number) => Number(value.toFixed(2))
const stats = {
  command: command.join(" "),
  runs,
  min_ms: round(durations[0]),
  median_ms: round(percentile(50)),
  p95_ms: round(percentile(95)),
  mean_ms: round(durations.reduce((sum, d) => sum + d, 0) / durations.length),
  max_ms: round(durations[durations.length - 1]),
}

if (json) console.log(JSON.stringify(stats, null, 2))
else
  console.log(
    `${stats.command}\n  runs=${runs} min=${stats.min_ms}ms median=${stats.median_ms}ms p95=${stats.p95_ms}ms mean=${stats.mean_ms}ms max=${stats.max_ms}ms`,
  )
