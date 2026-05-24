// Full-suite timing harness for the test-speed research in ../../perf/test-suite.md.
// Use this for periodic sanity checks; use profile-test-files.ts for discovery.
// Env: BENCH_WARMUPS=0 BENCH_RUNS=1 bun run bench:test
const warmups = Number(Bun.env.BENCH_WARMUPS ?? 0)
const runs = Number(Bun.env.BENCH_RUNS ?? 1)
const timings: number[] = []

if (!Number.isInteger(warmups) || warmups < 0) {
  console.error("BENCH_WARMUPS must be a non-negative integer")
  process.exit(1)
}
if (!Number.isInteger(runs) || runs < 1) {
  console.error("BENCH_RUNS must be a positive integer")
  process.exit(1)
}

for (const index of Array.from({ length: warmups + runs }, (_, index) => index)) {
  const measured = index >= warmups
  const label = measured ? `run ${index - warmups + 1}/${runs}` : `warmup ${index + 1}/${warmups}`
  const start = performance.now()
  console.log(`bench:test ${label}`)

  const proc = Bun.spawn(["bun", "test", "--timeout", "30000"], {
    cwd: import.meta.dir + "/..",
    stdout: "inherit",
    stderr: "inherit",
    env: Bun.env,
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    console.error(`bench:test failed during ${label} with exit code ${exitCode}`)
    process.exit(exitCode)
  }

  const seconds = (performance.now() - start) / 1000
  console.log(`bench:test ${label} ${seconds.toFixed(3)}s`)
  if (measured) timings.push(seconds)
}

const sorted = timings.toSorted((a, b) => a - b)
const median = sorted[Math.floor(sorted.length / 2)]
const mean = timings.reduce((sum, timing) => sum + timing, 0) / timings.length
const best = sorted[0] ?? median
const worst = sorted.at(-1) ?? median

console.log(
  `bench:test median=${median.toFixed(3)}s mean=${mean.toFixed(3)}s best=${best.toFixed(3)}s worst=${worst.toFixed(3)}s`,
)
console.log(`METRIC test_suite_seconds=${median.toFixed(3)}`)
console.log(`METRIC test_suite_best_seconds=${best.toFixed(3)}`)
console.log(`METRIC test_suite_worst_seconds=${worst.toFixed(3)}`)
