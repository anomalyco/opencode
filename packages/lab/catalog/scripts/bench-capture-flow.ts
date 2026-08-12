const flow = process.argv[2] ?? "search-lifecycle"
const revision = process.argv[3] ?? "HEAD"
const opencode = process.argv[4] ?? new URL("../../../../", import.meta.url).pathname
const runs = 8
const measured: Array<{ prepare: number; total: number }> = []

for (let index = 0; index < runs; index++) {
  const child = Bun.spawn([
    process.execPath,
    "./scripts/capture-opencode-drive.ts",
    "--opencode",
    opencode,
    "--revision",
    revision,
    "--flow",
    flow,
  ], { cwd: import.meta.dir + "/..", stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exit !== 0) throw new Error(`Capture benchmark failed:\n${stdout}\n${stderr}`)
  const prepare = metric(stdout, "capture_prepare_ms")
  const total = metric(stdout, "capture_total_ms")
  console.log(`${index === 0 ? "warmup" : `run ${index}`}: prepare=${prepare}ms total=${total}ms`)
  if (index > 0) measured.push({ prepare, total })
}

const prepare = measured.map((run) => run.prepare)
const total = measured.map((run) => run.total)
console.log(`METRIC capture_flow_prepare_median_ms=${median(prepare)}`)
console.log(`METRIC capture_flow_total_median_ms=${median(total)}`)
console.log(`METRIC capture_flow_total_mad_ms=${median(total.map((value) => Math.abs(value - median(total))))}`)
console.log(`METRIC capture_flow_total_best_ms=${Math.min(...total)}`)
console.log(`METRIC capture_flow_total_worst_ms=${Math.max(...total)}`)

function metric(output: string, name: string) {
  const match = output.match(new RegExp(`^METRIC ${name}=(\\d+)$`, "m"))
  if (!match?.[1]) throw new Error(`Missing ${name} in capture output`)
  return Number(match[1])
}

function median(values: ReadonlyArray<number>) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
    : sorted[middle]!
}
