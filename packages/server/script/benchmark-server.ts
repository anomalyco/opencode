/**
 * Server benchmark: launches `opencode serve --stdio` from a source tree with isolated opencode state,
 * then replays what a client does when it opens a location.
 *
 *   bun run script/benchmark-server.ts [--source <repo root>] [--directory <project>] [--runs 5] [--warmups 1]
 *     [--iterations 20] [--reopens 5] [--json out.json] [--compare base.json] [--profile <dir>] [--keep]
 *
 * --source picks the opencode checkout to launch (default: this one), so the same driver can time a
 * baseline worktree and a change: save one run with --json and pass it to the other with --compare.
 * Without --directory a synthetic project shaped like a clone is generated once under
 * $SERVER_BENCH_ROOT (default $TMPDIR)/opencode-server-bench. Unmeasured warm-up launches create the
 * database and caches first. --profile writes a CPU profile of each measured server; --keep leaves its
 * state, including the server log, in place.
 *
 * Phases per launch:
 *   boot     spawn until the server prints its URL (routes built, ready for requests)
 *   open     first location open: location.get, then the client's parallel location sync
 *   warm     each endpoint against the loaded location, one request at a time
 *   busy     /api/info round trips while review diffs run back to back
 *   reopen   evict the location and open it again
 * Every phase also reports how many processes the server spawned, read from its log.
 */
import { $ } from "bun"
import fs from "fs/promises"
import os from "os"
import path from "path"

const args = process.argv.slice(2)
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? undefined : args[index + 1]
}
const source = path.resolve(flag("source") ?? path.join(import.meta.dir, "..", "..", ".."))
const runs = Number(flag("runs") ?? 5)
const warmups = Number(flag("warmups") ?? 1)
const iterations = Number(flag("iterations") ?? 20)
const reopens = Number(flag("reopens") ?? 5)
const jsonOut = flag("json")
const compare = flag("compare")
// Writes a CPU profile (.cpuprofile and markdown) of each measured server process into this directory.
const profile = flag("profile")
const root = path.join(process.env.SERVER_BENCH_ROOT ?? os.tmpdir(), "opencode-server-bench")
const password = "bench"

// The client's location sync (packages/client/src/solid/data.ts) plus the global session lists.
const sync = {
  vcs: "/api/vcs",
  agent: "/api/agent",
  command: "/api/command",
  integration: "/api/integration",
  mcp: "/api/mcp",
  "mcp.resource": "/api/mcp/resource",
  model: "/api/model",
  provider: "/api/provider",
  reference: "/api/reference",
  skill: "/api/skill",
  shell: "/api/shell",
  form: "/api/form",
  session: "/api/session",
  "session.active": "/api/session/active",
}

// Requests a client makes while someone works in the location. `fs.read` reads a file of the project.
const interactive: Record<string, string> = {
  info: "/api/info",
  location: "/api/location",
  "vcs.status": "/api/vcs/status",
  // As the review panel asks for them.
  "vcs.diff": "/api/vcs/diff?mode=working&untracked=folders",
  "vcs.diff branch": "/api/vcs/diff?mode=branch&untracked=folders",
  "vcs.branch": "/api/vcs/branch",
  "fs.list": "/api/fs/list",
  "fs.find": "/api/fs/find?query=index",
  config: "/api/config",
}

// ---------- fixture ----------

async function generate() {
  const dir = path.join(root, "fixture")
  if (await Bun.file(path.join(dir, ".bench-ready")).exists()) return dir
  await fs.rm(dir, { recursive: true, force: true })
  console.error(`generating fixture in ${dir}`)
  const files: Array<[string, string]> = [
    ...Array.from({ length: 3_000 }, (_, index): [string, string] => [
      path.join("src", `d${index % 40}`, `f${index}.ts`),
      `export const value${index} = ${index}\n`.repeat(8),
    ]),
    ...Array.from({ length: 2_000 }, (_, index): [string, string] => [
      path.join("node_modules", `pkg${index % 100}`, `f${index}.js`),
      `module.exports = ${index}\n`,
    ]),
    [".gitignore", "node_modules\ndist\n"],
    ["AGENTS.md", "# Fixture\n\nUse the existing patterns.\n"],
    ["package.json", JSON.stringify({ name: "fixture", private: true }, null, 2)],
    [path.join(".opencode", "opencode.jsonc"), "{}\n"],
    ...Array.from({ length: 3 }, (_, index): [string, string] => [
      path.join(".opencode", "command", `command-${index}.md`),
      `---\ndescription: Command ${index}\n---\nDo task ${index}.\n`,
    ]),
    ...Array.from({ length: 2 }, (_, index): [string, string] => [
      path.join(".opencode", "agent", `agent-${index}.md`),
      `---\ndescription: Agent ${index}\nmode: subagent\n---\nYou are agent ${index}.\n`,
    ]),
    ...Array.from({ length: 3 }, (_, index): [string, string] => [
      path.join(".opencode", "skills", `skill-${index}`, "SKILL.md"),
      `---\nname: skill-${index}\ndescription: Use for task ${index}\n---\nSteps for task ${index}.\n`,
    ]),
  ]
  await Promise.all(
    [...new Set(files.map(([file]) => path.dirname(path.join(dir, file))))].map((d) =>
      fs.mkdir(d, { recursive: true }),
    ),
  )
  for (let index = 0; index < files.length; index += 256)
    await Promise.all(
      files.slice(index, index + 256).map(([file, content]) => Bun.write(path.join(dir, file), content)),
    )
  await $`git init -q -b main`.cwd(dir).quiet()
  await Bun.write(path.join(dir, ".git", "info", "exclude"), ".bench-ready\n")
  await $`git -c core.fsmonitor=false add -A`.cwd(dir).quiet()
  await $`git -c user.email=bench@opencode.test -c user.name=Bench commit -q --no-gpg-sign -m initial`.cwd(dir).quiet()
  // Shaped like a clone: an origin remote whose HEAD names the default branch. Nothing here reaches the network.
  await $`git remote add origin https://example.com/fixture.git`.cwd(dir).quiet()
  await $`git update-ref refs/remotes/origin/main HEAD`.cwd(dir).quiet()
  await $`git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main`.cwd(dir).quiet()
  // A working copy with a little in progress, so status and diff have something to report.
  await Bun.write(path.join(dir, "src", "d1", "f1.ts"), "export const edited = true\n")
  await Bun.write(path.join(dir, "src", "d2", "f2.ts"), "export const edited = true\n")
  await Bun.write(path.join(dir, "src", "new.ts"), "export const added = true\n")
  await Bun.write(path.join(dir, ".bench-ready"), "")
  return dir
}

// ---------- server process ----------

type Server = Awaited<ReturnType<typeof launch>>

async function launch(state: string, profiled: boolean) {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith("OPENCODE"),
    ),
  )
  const profiling =
    profiled && profile ? ["--cpu-prof", "--cpu-prof-md", `--cpu-prof-dir=${path.resolve(profile)}`] : []
  const started = performance.now()
  const proc = Bun.spawn(["bun", ...profiling, "run", "src/index.ts", "serve", "--stdio", "--port", "0"], {
    cwd: path.join(source, "packages", "cli"),
    env: {
      ...env,
      XDG_DATA_HOME: path.join(state, "data"),
      XDG_CONFIG_HOME: path.join(state, "config"),
      XDG_CACHE_HOME: path.join(state, "cache"),
      XDG_STATE_HOME: path.join(state, "state"),
      OPENCODE_PASSWORD: password,
      OPENCODE_DISABLE_MODELS_FETCH: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  const reader = proc.stdout.getReader()
  let buffered = ""
  while (!buffered.includes("\n")) {
    const chunk = await reader.read()
    if (chunk.done) throw new Error(`server exited before printing its URL: ${await new Response(proc.stderr).text()}`)
    buffered += new TextDecoder().decode(chunk.value)
  }
  const boot = performance.now() - started
  reader.releaseLock()
  const url: string = JSON.parse(buffered.split("\n")[0]!).url
  return { proc, url, boot, log: path.join(state, "data", "opencode", "log", "opencode-local.log") }
}

async function stop(server: Server) {
  server.proc.stdin.end()
  const exited = await Promise.race([server.proc.exited, Bun.sleep(15_000).then(() => undefined)])
  if (exited === undefined) server.proc.kill()
  await server.proc.exited
}

const headers = { authorization: `Basic ${btoa(`opencode:${password}`)}` }

async function request(server: Server, route: string, directory: string, method = "GET") {
  const url = new URL(route, server.url)
  url.searchParams.set("location[directory]", directory)
  const started = performance.now()
  const response = await fetch(url, { method, headers })
  await response.arrayBuffer()
  const ms = performance.now() - started
  if (response.status >= 400) throw new Error(`${method} ${route} failed with ${response.status}`)
  return ms
}

// ---------- phases ----------

type Phase = { name: string; start: number; end: number }

async function open(server: Server, directory: string) {
  const started = performance.now()
  const location = await request(server, "/api/location", directory)
  const synced = await Promise.all(
    Object.entries(sync).map(async ([name, route]) => [name, await request(server, route, directory)] as const),
  )
  return { location, sync: Object.fromEntries(synced), total: performance.now() - started }
}

async function run(state: string, directory: string, profiled = false) {
  const phases: Phase[] = []
  const mark = async <A>(name: string, body: () => Promise<A>) => {
    const start = Date.now()
    const value = await body()
    phases.push({ name, start, end: Date.now() })
    return value
  }
  const launchStart = Date.now()
  const server = await launch(state, profiled)
  phases.push({ name: "boot", start: launchStart, end: Date.now() })
  try {
    const first = await mark("open", () => open(server, directory))
    const warm = await mark("warm", async () => {
      const samples: Record<string, number[]> = {}
      for (let index = 0; index < iterations; index++)
        for (const [name, route] of Object.entries({ ...sync, ...interactive }))
          (samples[name] ??= []).push(await request(server, route, directory))
      return samples
    })
    // A trivial request's latency while review diffs run back to back: spawning blocks the event loop.
    const busy = await mark("busy", async () => {
      const pings: number[] = []
      const done = { value: false }
      const diffs = (async () => {
        for (let index = 0; index < iterations; index++) await request(server, interactive["vcs.diff"]!, directory)
        done.value = true
      })()
      while (!done.value) pings.push(await request(server, "/api/info", directory))
      await diffs
      return pings
    })
    const reopened = await mark("reopen", async () => {
      const samples: Array<Awaited<ReturnType<typeof open>>> = []
      for (let index = 0; index < reopens; index++) {
        await request(server, "/api/debug/location", directory, "DELETE")
        samples.push(await open(server, directory))
      }
      return samples
    })
    return { boot: server.boot, first, warm, busy, reopened, phases, log: server.log }
  } finally {
    await stop(server)
  }
}

async function spawnsByPhase(log: string, phases: Phase[]) {
  const text = await Bun.file(log)
    .text()
    .catch(() => "")
  const counts = Object.fromEntries(phases.map((phase) => [phase.name, 0]))
  for (const line of text.split("\n")) {
    if (!line.includes('message="spawning process"')) continue
    const time = Date.parse(line.slice("timestamp=".length, line.indexOf(" ")))
    const phase = phases.find((phase) => time >= phase.start && time <= phase.end)
    if (phase) counts[phase.name]!++
  }
  return counts
}

// ---------- report ----------

const median = (samples: number[]) => {
  const sorted = samples.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}
const percentile = (samples: number[], quantile: number) => {
  const sorted = samples.toSorted((a, b) => a - b)
  return sorted[Math.min(Math.ceil(sorted.length * quantile) - 1, sorted.length - 1)]!
}

type Metric = { median: number; p95: number; samples: number }
type Report = { source: string; directory: string; metrics: Record<string, Metric> }

const metric = (samples: number[]): Metric => ({
  median: median(samples),
  p95: percentile(samples, 0.95),
  samples: samples.length,
})

function summarize(results: Array<Awaited<ReturnType<typeof run>> & { spawns: Record<string, number> }>) {
  const metrics: Record<string, Metric> = {
    "boot (ms)": metric(results.map((result) => result.boot)),
    "open total (ms)": metric(results.map((result) => result.first.total)),
    "open location.get (ms)": metric(results.map((result) => result.first.location)),
    "reopen total (ms)": metric(results.flatMap((result) => result.reopened.map((sample) => sample.total))),
    "reopen location.get (ms)": metric(results.flatMap((result) => result.reopened.map((sample) => sample.location))),
  }
  for (const name of Object.keys(sync))
    metrics[`open ${name} (ms)`] = metric(results.map((result) => result.first.sync[name]!))
  for (const name of Object.keys({ ...sync, ...interactive }))
    metrics[`warm ${name} (ms)`] = metric(results.flatMap((result) => result.warm[name]!))
  // Few pings overlap a spawn, so the tail per launch shows the stalls.
  metrics["busy info (ms)"] = metric(results.flatMap((result) => result.busy))
  metrics["busy info p99 (ms)"] = metric(results.map((result) => percentile(result.busy, 0.99)))
  metrics["busy info max (ms)"] = metric(results.map((result) => result.busy.reduce((a, b) => Math.max(a, b), 0)))
  for (const phase of ["boot", "open", "warm", "busy", "reopen"])
    metrics[`spawns ${phase}`] = metric(results.map((result) => result.spawns[phase] ?? 0))
  return metrics
}

function print(report: Report, base?: Report) {
  console.log(`source     ${report.source}`)
  console.log(`directory  ${report.directory}`)
  if (base) console.log(`baseline   ${base.source}`)
  console.log("")
  const header = base
    ? `${"metric".padEnd(28)} ${"base p50".padStart(10)} ${"p50".padStart(10)} ${"change".padStart(9)} ${"base p95".padStart(10)} ${"p95".padStart(10)}`
    : `${"metric".padEnd(28)} ${"p50".padStart(10)} ${"p95".padStart(10)} ${"n".padStart(5)}`
  console.log(header)
  for (const [name, value] of Object.entries(report.metrics)) {
    const before = base?.metrics[name]
    if (!before) {
      console.log(
        `${name.padEnd(28)} ${value.median.toFixed(1).padStart(10)} ${value.p95.toFixed(1).padStart(10)} ${String(value.samples).padStart(5)}`,
      )
      continue
    }
    const change = before.median === 0 ? 0 : ((value.median - before.median) / before.median) * 100
    console.log(
      `${name.padEnd(28)} ${before.median.toFixed(1).padStart(10)} ${value.median.toFixed(1).padStart(10)} ${`${change > 0 ? "+" : ""}${change.toFixed(0)}%`.padStart(9)} ${before.p95.toFixed(1).padStart(10)} ${value.p95.toFixed(1).padStart(10)}`,
    )
  }
}

await fs.mkdir(root, { recursive: true })
const directory = path.resolve(flag("directory") ?? (await generate()))
const readable = flag("directory")
  ? (await fs.readdir(directory, { withFileTypes: true })).find((entry) => entry.isFile())?.name
  : "src/d1/f1.ts"
if (readable) interactive["fs.read"] = `/api/fs/read/${readable}`
const state = await fs.mkdtemp(path.join(root, "state-"))
try {
  for (let index = 0; index < warmups; index++) {
    console.error(`warm-up ${index + 1}/${warmups}`)
    await run(state, directory)
  }
  const results = []
  for (let index = 0; index < runs; index++) {
    console.error(`run ${index + 1}/${runs}`)
    const result = await run(state, directory, true)
    results.push({ ...result, spawns: await spawnsByPhase(result.log, result.phases) })
  }
  const report: Report = { source, directory, metrics: summarize(results) }
  print(report, compare ? await Bun.file(compare).json() : undefined)
  if (jsonOut) await Bun.write(jsonOut, JSON.stringify(report, null, 2))
} finally {
  if (args.includes("--keep")) console.error(`kept server state in ${state}`)
  else await fs.rm(state, { recursive: true, force: true })
}
