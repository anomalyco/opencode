// Runs the performance scenarios (`crates/tui/tests/all/perf.rs`) and compares two runs.
//
//   bun run perf [--runs N] [--out FILE] [scenario...]   build the optimized test binaries, run every scenario (or the
//                                                         named ones) N times (default 5), each run in a process of
//                                                         its own, print a table and write the runs to FILE
//                                                         (default target/perf-runs/<commit>.json)
//   bun run perf --sites N [scenario...]                  sample the stack of every Nth allocation of the measured
//                                                         thread and print the top allocation sites per scenario
//   bun run perf compare BASE.json HEAD.json [--allocations PCT] [--instructions PCT] [--peak PCT]
//                                                         compare two such files; exits 1 on a regression
//
// Allocation counts and bytes are deterministic up to the timing of the fake server's answers, so they get a strict
// threshold: by default a regression is a median more than 0.1% above the base's, or the spread of the base's runs if
// that is larger. Instructions (the measured thread's, from a hardware counter) repeat within 0.1% for one binary but
// move by up to 3% between two builds of the same code, as the code's layout changes, so they get 3%; peaks get 1%,
// including the malloc peak of the scenarios that sample it (OpenTUI's native memory with Rust's). Wall and CPU time,
// and the bytes still held at the end (`kept`, `malloc kept`), are printed for information only.
import os from "node:os"

const root = new URL("..", import.meta.url).pathname
const args = process.argv.slice(2)

type Record = {
  scenario: string
  units: number
  allocations: number
  bytes: number
  peak: number
  kept: number
  all_allocations: number
  all_bytes: number
  all_peak: number
  /** Process-wide malloc, OpenTUI's native memory included; only the scenarios that sample it have it. */
  malloc_peak?: number | null
  malloc_kept?: number | null
  instructions: number | null
  wall_ms: number
  cpu_ms: number | null
}

type Run = {
  commit: string
  branch: string
  date: string
  machine: { cpu: string; cores: number; kernel: string; load: number[] }
  runs: { [scenario: string]: Record[] }
}

const metrics = [
  ["allocations", "allocs", "exact"],
  ["bytes", "bytes", "bytes"],
  ["peak", "peak", "bytes"],
  ["all_allocations", "allocs (all)", "exact"],
  ["all_bytes", "bytes (all)", "bytes"],
  ["all_peak", "peak (all)", "bytes"],
  ["kept", "kept", "bytes"],
  ["malloc_peak", "malloc peak", "bytes"],
  ["malloc_kept", "malloc kept", "bytes"],
  ["instructions", "instructions", "count"],
  ["wall_ms", "wall ms", "ms"],
  ["cpu_ms", "cpu ms", "ms"],
] as const

type Metric = (typeof metrics)[number][0]

if (args[0] === "compare") await compare(args.slice(1))
else await measure(args)

async function measure(args: string[]) {
  const runs = Number(option(args, "--runs") ?? 5)
  const wanted = args.filter((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"))
  // Each scenario's binary, by name.
  const binaries = new Map(
    build().flatMap((binary) =>
      run([binary, "--list", "--ignored", "perf::"])
        .split("\n")
        .filter((line) => line.endsWith(": test"))
        .map((line) => [line.slice("perf::".length, -": test".length), binary] as const),
    ),
  )
  const listed = [...binaries.keys()].sort()
  const scenarios = wanted.length ? listed.filter((name) => wanted.includes(name)) : listed
  if (!scenarios.length) throw new Error(`no scenario matches ${wanted.join(", ")}; there are ${listed.join(", ")}`)
  const commit = run(["git", "rev-parse", "--short=10", "HEAD"]).trim()
  const result: Run = {
    commit: commit + (run(["git", "status", "--porcelain", "--untracked-files=no"]).trim() ? "+dirty" : ""),
    branch: run(["git", "rev-parse", "--abbrev-ref", "HEAD"]).trim(),
    date: new Date().toISOString(),
    machine: {
      cpu: os.cpus()[0]?.model ?? "unknown",
      cores: os.cpus().length,
      kernel: os.release(),
      load: os.loadavg(),
    },
    runs: {},
  }
  const sites = option(args, "--sites")
  if (sites) {
    // Sampling slows the regions down and its own allocations are not counted, so its runs are not recorded.
    for (const scenario of scenarios) {
      const output = run(
        [binaries.get(scenario)!, `perf::${scenario}`, "--exact", "--ignored", "--nocapture", "--test-threads=1"],
        {
          TZ: "UTC",
          OPENCODE_PERF_SITES: sites,
        },
      )
      const lines = output.split("\n").filter((line) => line.startsWith("PERF-SITE "))
      console.log(`${scenario}:\n${lines.map((line) => `  ${line.slice("PERF-SITE ".length)}`).join("\n")}\n`)
    }
    return
  }
  // Rounds, not one scenario after another, so a burst of load spreads over all of them.
  for (let round = 0; round < runs; round++) {
    for (const scenario of scenarios) {
      const output = run(
        [binaries.get(scenario)!, `perf::${scenario}`, "--exact", "--ignored", "--nocapture", "--test-threads=1"],
        {
          TZ: "UTC",
        },
      )
      // The test harness prints the test's name on the same line, before it.
      const line = output.match(/PERF (\{.*\})$/m)
      if (!line) throw new Error(`perf::${scenario} printed no PERF line:\n${output}`)
      ;(result.runs[scenario] ??= []).push(JSON.parse(line[1]))
      process.stderr.write(`round ${round + 1}/${runs} ${scenario}\n`)
    }
  }
  result.machine.load = os.loadavg().map((load, index) => Math.max(load, result.machine.load[index]))
  const out = option(args, "--out") ?? `${root}target/perf-runs/${commit}.json`
  await Bun.write(out, JSON.stringify(result, null, 2) + "\n")
  console.log(table(result))
  console.log(`\nwritten to ${out}`)
}

async function compare(args: string[]) {
  const [basePath, headPath] = args.filter((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"))
  if (!basePath || !headPath) throw new Error("usage: bun run perf compare BASE.json HEAD.json")
  const base: Run = await Bun.file(basePath).json()
  const head: Run = await Bun.file(headPath).json()
  const tolerance: { [metric in Metric]?: number } = {
    allocations: Number(option(args, "--allocations") ?? 0.1) / 100,
    bytes: Number(option(args, "--allocations") ?? 0.1) / 100,
    all_allocations: Number(option(args, "--allocations") ?? 0.1) / 100,
    all_bytes: Number(option(args, "--allocations") ?? 0.1) / 100,
    peak: Number(option(args, "--peak") ?? 1) / 100,
    all_peak: Number(option(args, "--peak") ?? 1) / 100,
    malloc_peak: Number(option(args, "--peak") ?? 1) / 100,
    instructions: Number(option(args, "--instructions") ?? 3) / 100,
  }
  console.log(`base ${base.commit} (${base.branch}), head ${head.commit} (${head.branch})\n`)
  const rows: string[][] = []
  const regressions: string[] = []
  for (const scenario of Object.keys(head.runs)) {
    const before = base.runs[scenario]
    if (!before) {
      rows.push([scenario, "new", ...metrics.map(() => "")])
      continue
    }
    const cells = metrics.map(([metric, , unit]) => {
      const was = median(values(before, metric))
      const now = median(values(head.runs[scenario], metric))
      if (was === null || now === null) return "–"
      const change = was === 0 ? (now === 0 ? 0 : Infinity) : (now - was) / was
      const limit = tolerance[metric]
      const allowed = limit === undefined ? undefined : Math.max(limit, spread(values(before, metric)))
      const mark = allowed === undefined ? "" : change > allowed ? " ▲" : change < -allowed ? " ▼" : ""
      if (mark === " ▲") regressions.push(`${scenario} ${metric}: ${format(was, unit)} → ${format(now, unit)}`)
      return `${format(now, unit)} ${signed(change)}${mark}`
    })
    rows.push([scenario, ...cells])
  }
  console.log(markdown(["scenario", ...metrics.map(([, label]) => label)], rows))
  console.log("\n▲ regression beyond the threshold, ▼ improvement beyond it; wall and CPU time are not judged.")
  if (regressions.length) {
    console.log(`\n${regressions.length} regression(s):\n${regressions.map((line) => `- ${line}`).join("\n")}`)
    process.exit(1)
  }
  console.log("\nno regression")
}

function table(result: Run) {
  const rows = Object.entries(result.runs).map(([scenario, records]) => [
    scenario,
    String(records[0].units),
    ...metrics.map(([metric, , unit]) => {
      const list = values(records, metric)
      const middle = median(list)
      if (middle === null) return "–"
      const wobble = spread(list)
      return format(middle, unit) + (unit !== "ms" && wobble > 0 ? ` ±${(wobble * 100).toFixed(2)}%` : "")
    }),
  ])
  const machine = result.machine
  return [
    `commit ${result.commit} (${result.branch}), ${result.date}`,
    `${machine.cpu}, ${machine.cores} threads, Linux ${machine.kernel}, peak load ${machine.load.map((load) => load.toFixed(1)).join(" ")}`,
    `medians of ${Object.values(result.runs)[0]?.length ?? 0} runs; ± is the spread (max − min) / median`,
    "",
    markdown(["scenario", "units", ...metrics.map(([, label]) => label)], rows),
  ].join("\n")
}

function values(records: Record[], metric: Metric) {
  return records.map((record) => record[metric]).filter((value): value is number => typeof value === "number")
}

function median(list: number[]) {
  if (!list.length) return null
  const sorted = [...list].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** (max − min) / median: how much the runs disagree. */
function spread(list: number[]) {
  const middle = median(list)
  if (!middle) return 0
  return (Math.max(...list) - Math.min(...list)) / middle
}

function format(value: number, unit: string) {
  if (unit === "ms") return value.toFixed(value < 10 ? 2 : 0)
  if (unit === "exact") return Math.round(value).toLocaleString("en-US")
  if (unit === "bytes") return scaled(value, 1024, ["B", "KiB", "MiB", "GiB"])
  return scaled(value, 1000, ["", "k", "M", "G"])
}

function scaled(value: number, step: number, units: string[]) {
  let index = 0
  while (Math.abs(value) >= step * 10 && index < units.length - 1) {
    value /= step
    index++
  }
  return `${index ? value.toFixed(value < 100 ? 1 : 0) : Math.round(value)}${units[index] ? ` ${units[index]}` : ""}`
}

function signed(change: number) {
  if (!Number.isFinite(change)) return "(new)"
  const percent = change * 100
  if (Math.abs(percent) < 0.005) return "(=)"
  return `(${percent > 0 ? "+" : ""}${percent.toFixed(2)}%)`
}

function markdown(header: string[], rows: string[][]) {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`
  return [line(header), line(header.map((_, index) => (index ? "---:" : "---"))), ...rows.map(line)].join("\n")
}

function option(args: string[], name: string) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

/**
 * Builds the test binaries that hold scenarios, the TUI's integration tests and mini's and ACP's unit tests, with the `perf`
 * profile (release code generation), and returns their paths.
 */
function build() {
  const targets = [
    ["opencode-tui", "--test", "all"],
    ["opencode-mini", "--lib"],
    ["opencode-acp", "--lib"],
  ]
  return targets.map(([pkg, ...target]) => {
    const command = ["bun", "run", "cargo", "test", "--profile", "perf", "-p", pkg, ...target]
    const output = run([...command, "--no-run", "--message-format=json"], {}, "inherit")
    // The TUI's integration tests also build its binaries, which cargo may report first.
    const binary = output
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line))
      .find((message) => message.reason === "compiler-artifact" && message.executable && message.profile.test)
    if (!binary) throw new Error(`cargo built no test binary for ${pkg}`)
    return binary.executable as string
  })
}

function run(command: string[], env: { [name: string]: string } = {}, stderr: "pipe" | "inherit" = "pipe") {
  const result = Bun.spawnSync(command, { cwd: root, env: { ...process.env, ...env }, stdout: "pipe", stderr })
  const stdout = result.stdout.toString()
  if (result.exitCode !== 0)
    throw new Error(
      `${command.join(" ")} exited with ${result.exitCode}:\n${stdout}\n${result.stderr?.toString() ?? ""}`,
    )
  return stdout
}
