// Startup-time benchmark for the CLI entrypoint. Guards the fast paths
// (--version, --help, completion) against module-graph regressions: these
// commands must not pull the session/database/provider graph at import time.
//
// The budget is intentionally a realistic measured ceiling, not the aspirational
// sub-50ms target: running the unbundled TypeScript entrypoint through bun costs
// ~150ms for a bare `bun -e "1"` alone, so the compiled-binary target does not
// apply here. Override with STARTUP_BUDGET_MS; tune runs with STARTUP_RUNS.
// Env: STARTUP_BUDGET_MS=2000 STARTUP_RUNS=5 bun run script/bench-startup.ts
import path from "node:path"

const budget = Number(Bun.env.STARTUP_BUDGET_MS ?? 2000)
const runs = Number(Bun.env.STARTUP_RUNS ?? 5)

if (!Number.isFinite(budget) || budget <= 0) {
  console.error("STARTUP_BUDGET_MS must be a positive number")
  process.exit(1)
}
if (!Number.isInteger(runs) || runs < 1) {
  console.error("STARTUP_RUNS must be a positive integer")
  process.exit(1)
}

const entry = path.join(import.meta.dir, "..", "src", "index.ts")
const commands = [["--version"], ["--help"], ["completion"]]

export function median(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2
  return sorted[mid]
}

async function measure(args: string[]) {
  const timings: number[] = []
  // One untimed warmup run absorbs bun's transpile cache population.
  for (const index of Array.from({ length: runs + 1 }, (_, index) => index)) {
    const start = performance.now()
    const proc = Bun.spawn([process.execPath, "run", entry, ...args], {
      stdout: "ignore",
      stderr: "ignore",
      env: { ...process.env, BOLT_DISABLE_AUTOUPDATE: "1" },
    })
    const code = await proc.exited
    const elapsed = performance.now() - start
    if (code !== 0) {
      console.error(`bolt ${args.join(" ")} exited with code ${code}`)
      process.exit(1)
    }
    if (index > 0) timings.push(elapsed)
  }
  return timings
}

if (import.meta.main) {
  const failures: string[] = []
  for (const args of commands) {
    const timings = await measure(args)
    const value = median(timings)
    const status = value <= budget ? "ok" : "OVER BUDGET"
    console.log(`bolt ${args.join(" ")}: median ${value.toFixed(0)}ms over ${runs} runs (budget ${budget}ms) ${status}`)
    if (value > budget) failures.push(`bolt ${args.join(" ")} took ${value.toFixed(0)}ms, budget is ${budget}ms`)
  }
  if (failures.length) {
    console.error(failures.join("\n"))
    console.error("Startup budget exceeded. Check for new eager imports in src/index.ts command modules.")
    process.exit(1)
  }
}
