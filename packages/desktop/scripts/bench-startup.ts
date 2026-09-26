#!/usr/bin/env bun
// Attach-latency benchmark for a packaged desktop build.
//
//   bun run bench:startup -- [--exe <path>] [--compare <path>] [--runs 5] [--warmup 1] [--timeout 60000]
//                            [--fresh] [--offline] [--seed <userData dir>] [--out <dir>] [--home <dir>]
//
// The desktop attaches to an external opencode server instead of spawning its own sidecar, so this
// measures attach latency: the elapsed time from launching the packaged app until its main process
// first reaches the server, i.e. until its own GET /api/info returns 200. The app logs
// "external server is ready" at exactly that moment (packages/desktop/src/main/service/background-service.ts),
// so the metric is read from that log line's timestamp. The app retries forever and never fails on its
// own, so the benchmark enforces --timeout and exits non-zero if the line never appears. The server is
// external: the benchmark never starts or stops it, and records whether it answered before launch so
// the number is interpretable.
//
// The app runs in an isolated home directory (its own %APPDATA%, XDG dirs, OpenCode DB and config) so
// it never reads the developer's live app state; the external server's credential file is copied into
// that home so the attach can authenticate. `--fresh` wipes the profile before each launch. `--compare`
// alternates launches of a second build so machine drift affects both equally, and `--warmup` launches
// are discarded (the first launch of a new binary pays the antivirus scan).
import { spawn } from "node:child_process"
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { basename, dirname, join, relative, resolve } from "node:path"
import { parseArgs } from "node:util"
import { externalServerConfig } from "../src/main/service/external-server"
import { probe } from "../src/main/service/external-server-probe"

const args = parseArgs({
  args: process.argv.slice(2),
  options: {
    exe: { type: "string" },
    compare: { type: "string" },
    runs: { type: "string", default: "5" },
    warmup: { type: "string", default: "1" },
    timeout: { type: "string", default: "60000" },
    fresh: { type: "boolean", default: false },
    offline: { type: "boolean", default: false },
    seed: { type: "string" },
    home: { type: "string" },
    out: { type: "string" },
  },
  allowPositionals: true,
})
const packageDir = resolve(import.meta.dirname, "..")
const builds = [
  { label: args.values.compare ? "A" : "", exe: resolve(args.values.exe ?? defaultExe()) },
  ...(args.values.compare ? [{ label: "B", exe: resolve(args.values.compare) }] : []),
]
const runs = Number(args.values.runs)
const warmup = Number(args.values.warmup)
const timeout = Number(args.values.timeout)
const outDir = resolve(args.values.out ?? join(packageDir, "dist", "bench-startup"))
const home = resolve(args.values.home ?? join(tmpdir(), "opencode-bench-startup"))
// app.setPath("userData", path.join(app.getPath("appData"), APP_ID)) (lifecycle/configure.ts), and
// appData follows the platform: %APPDATA%, ~/Library/Application Support or $XDG_CONFIG_HOME.
const appData =
  process.platform === "win32"
    ? join(home, "AppData", "Roaming")
    : process.platform === "darwin"
      ? join(home, "Library", "Application Support")
      : join(home, ".config")
for (const build of builds) {
  if (!existsSync(build.exe))
    throw new Error(`Packaged executable not found: ${build.exe}. Run 'bun run build && bun run package:win' (or pass --exe).`)
}
if (!Number.isSafeInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer")
if (!Number.isSafeInteger(warmup) || warmup < 0) throw new Error("--warmup must be a non-negative integer")
if (!Number.isSafeInteger(timeout) || timeout < 1) throw new Error("--timeout must be a positive integer")
mkdirSync(outDir, { recursive: true })

const appId = appIdFor(builds[0].exe)
if (builds.some((build) => appIdFor(build.exe) !== appId)) throw new Error("Compared builds must be the same channel")
const userData = join(appData, appId)
const paths = {
  home,
  appData,
  localAppData: join(home, "AppData", "Local"),
  temp: join(home, "AppData", "Local", "Temp"),
  db: join(home, ".local", "share", "opencode", "opencode.db"),
  config: join(home, ".config", "opencode"),
  logs: join(userData, "logs"),
}
// external-server.ts resolves the credential under HOME, not XDG_CONFIG_HOME, so the source is the
// developer's real file and the copy below makes the isolated home self-sufficient.
const realEnvFile = join(process.env.HOME ?? homedir(), ".config", "opencode", "external-server.env")
const external = externalServerConfig()
prepareHome()
// The desktop reloads the developer's login-shell environment, so stripping the child env is
// best-effort isolation from parent-process OPENCODE_* toggles and OTEL_*/SENTRY_* telemetry. The
// attach target no longer comes from the environment (it is the file read above), so this is no
// longer sidecar isolation.
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(OPENCODE_|OTEL_|SENTRY_)/.test(key))),
  USERPROFILE: home,
  HOME: home,
  APPDATA: paths.appData,
  LOCALAPPDATA: paths.localAppData,
  TEMP: paths.temp,
  TMP: paths.temp,
  XDG_DATA_HOME: join(home, ".local", "share"),
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_CACHE_HOME: join(home, ".cache"),
  OPENCODE_DB: paths.db,
  OPENCODE_CONFIG_DIR: paths.config,
  // Beta and prod builds check for updates on start; a closed proxy port fails that fast and offline.
  ...(args.values.offline || appId !== "ai.opencode.desktop.dev" ? { HTTPS_PROXY: "http://127.0.0.1:9" } : {}),
}
let appPid: number | undefined

type Sample = {
  build: string
  run: number
  attachMs: number
  serverUpAtLaunch: boolean
  teardown: string
  teardownMs: number
}

await benchmark().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error))
  await killApp()
  process.exit(1)
})

async function benchmark() {
  for (const build of builds) console.log(`bench${build.label ? ` ${build.label}` : ""}: ${build.exe}`)
  console.log(`home:  ${home}`)
  console.log(`server: ${external.url}, runs: ${runs} (+${warmup} warm-up), timeout ${timeout} ms${args.values.fresh ? ", fresh profile per launch" : ""}`)
  const samples: Sample[] = []
  for (let run = 1 - warmup; run <= runs; run++) {
    for (const build of builds) {
      const sample = await launch(build, run)
      if (run < 1) {
        console.log(`warm-up${build.label ? ` ${build.label}` : ""}: attach ${sample.attachMs} ms (server ${sample.serverUpAtLaunch ? "up" : "down"} at launch)`)
        continue
      }
      samples.push(sample)
      console.log(JSON.stringify(sample))
    }
  }
  await killApp()

  const labels = builds.map((build) => build.label || "A")
  const summaries = Object.fromEntries(
    builds.map((build) => [build.label || "A", summarize(samples.filter((sample) => sample.build === build.label))]),
  )
  const reportPath = join(outDir, `attach-${Date.now()}.json`)
  writeFileSync(
    reportPath,
    JSON.stringify(
      { builds, runs, warmup, fresh: args.values.fresh, home, server: external.url, timeout, summaries, samples },
      null,
      2,
    ),
  )
  const header = `${"".padEnd(24)}${labels.map((label) => (labels.length > 1 ? label : "").padStart(8).padEnd(22)).join("")}`
  console.log(`\nattach latency — median (min…max) ms since spawn over ${runs} runs`)
  console.log(header)
  console.log(
    `${"attach".padEnd(24)}${labels
      .map((label) => {
        const summary = summaries[label]
        if (!summary) return "".padEnd(22)
        return `${String(summary.median).padStart(8)}  (${summary.min}…${summary.max})`.padEnd(22)
      })
      .join("")}`,
  )
  const up = samples.filter((sample) => sample.serverUpAtLaunch).length
  const teardown = [...new Set(samples.map((sample) => sample.teardown))]
    .map((mode) => `${mode} ${samples.filter((sample) => sample.teardown === mode).length}`)
    .join(", ")
  console.log(`\nserver up at launch: ${up}/${samples.length} runs`)
  console.log(`teardown: ${teardown}`)
  console.log(`report: ${reportPath}`)
  process.exit(0)
}

async function launch(build: { label: string; exe: string }, run: number): Promise<Sample> {
  await killApp()
  if (args.values.fresh) rmSync(userData, { recursive: true, force: true })
  prepareHome()
  const serverUpAtLaunch = (await probe(external.url, external.password, 2_000)).ready
  const spawnAt = Date.now()
  const child = spawn(build.exe, [], { env, detached: true, stdio: "ignore" })
  child.unref()
  appPid = child.pid
  const attachMs = await waitForAttach(spawnAt)
  const teardown = await killApp()
  return { build: build.label, run, attachMs, serverUpAtLaunch, teardown: teardown.mode, teardownMs: teardown.ms }
}

// The app retries the probe forever, so the benchmark owns the deadline: no attach line by then means
// the server never answered and the run is a failure, not a hang.
async function waitForAttach(spawnAt: number) {
  const deadline = spawnAt + timeout
  while (Date.now() < deadline) {
    const attachAt = attachFromLog(spawnAt)
    if (attachAt) return attachAt - spawnAt
    // A short grace avoids racing process registration right after spawn.
    if (appPid && Date.now() - spawnAt > 3_000 && !(await processRunning(appPid)))
      throw new Error("The desktop exited before reaching the external server")
    await sleep(25)
  }
  throw new Error(
    `The desktop did not reach ${external.url} within ${timeout} ms; is the server running? ` +
      `The app retries forever, so the benchmark stopped it.`,
  )
}

// The line is emitted once, when the app's own probe first returns 200. Its embedded timestamp is when
// the app reached the server, not when electron-log flushed it, so the file poll does not skew the
// metric. Only the current run's log directory (created at or after spawn) is considered.
function attachFromLog(spawnAt: number) {
  if (!existsSync(paths.logs)) return
  const dir = readdirSync(paths.logs)
    .map((name) => join(paths.logs, name))
    .filter((candidate) => existsSync(join(candidate, "main.log")) && statSync(candidate).mtimeMs >= spawnAt - 1_000)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
  if (!dir) return
  for (const entry of readFileSync(join(dir, "main.log"), "utf8").split(/\r?\n(?=\[\d{4}-)/)) {
    const line = entry.split(/\r?\n/)[0]
    const match = line.match(/^\[(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3})\]\s+\[\w+\]\s+(?:\([\w-]+\)\s+)?(.*)$/)
    if (!match) continue
    if (!match[2].startsWith("external server is ready")) continue
    const at = new Date(match[1].replace(" ", "T")).getTime()
    if (at < spawnAt - 1_000) continue
    return at
  }
  return
}

function defaultExe() {
  const unpacked = join(packageDir, "dist", process.platform === "win32" ? "win-unpacked" : process.platform === "darwin" ? "mac" : "linux-unpacked")
  if (!existsSync(unpacked)) return join(unpacked, "OpenCode Dev.exe")
  const candidate = readdirSync(unpacked).find((f) => (process.platform === "win32" ? f.endsWith(".exe") : f.endsWith(".app") || !f.includes(".")))
  return join(unpacked, candidate ?? "OpenCode Dev.exe")
}

function appIdFor(executable: string) {
  const name = basename(executable, ".exe")
  if (/beta/i.test(name)) return "ai.opencode.desktop.beta"
  if (/dev/i.test(name)) return "ai.opencode.desktop.dev"
  return "ai.opencode.desktop"
}

function prepareHome() {
  for (const dir of [paths.appData, paths.temp, dirname(paths.db), paths.config, join(home, ".cache")]) mkdirSync(dir, { recursive: true })
  if (args.values.seed && !existsSync(userData)) {
    // Seed only the app's own state (tabs, drafts, settings, window placement); Chromium profile
    // data, caches, logs and the staged CLI are recreated by the app.
    const seed = resolve(args.values.seed)
    const keep = /^(drafts\.sqlite(-wal|-shm)?|opencode\.[a-z]+|\.?window-state.*\.json|opencode)$/
    cpSync(seed, userData, {
      recursive: true,
      filter: (source) => source === seed || keep.test(relative(seed, source).split(/[\\/]/)[0] ?? ""),
    })
  }
  mkdirSync(paths.logs, { recursive: true })
  if (existsSync(realEnvFile) && realEnvFile !== join(paths.config, "external-server.env"))
    copyFileSync(realEnvFile, join(paths.config, "external-server.env"))
}

function summarize(list: Sample[]) {
  const values = list.map((sample) => sample.attachMs).sort((a, b) => a - b)
  if (!values.length) return undefined
  return { median: values[Math.floor(values.length / 2)], min: values[0], max: values[values.length - 1] }
}

function processRunning(pid: number) {
  return new Promise<boolean>((done) => {
    const check =
      process.platform === "win32"
        ? spawn("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], { stdio: ["ignore", "pipe", "ignore"] })
        : spawn("kill", ["-0", String(pid)], { stdio: "ignore" })
    let out = ""
    check.stdout?.on("data", (chunk) => (out += chunk))
    check.on("close", (code) => done(process.platform === "win32" ? out.includes(String(pid)) : code === 0))
  })
}

// Only ever touches the process this run spawned (a prod-channel build shares its executable name
// with the developer's installed app). Ask it to quit first so it exits the way a user's session
// ends; force-kill the tree if it lingers. The mode is reported as the app's teardown behavior.
async function killApp(): Promise<{ mode: string; ms: number }> {
  const pid = appPid
  if (!pid) return { mode: "none", ms: 0 }
  appPid = undefined
  const startedAt = Date.now()
  if (!(await processRunning(pid))) return { mode: "exited", ms: Date.now() - startedAt }
  const terminate = (force: boolean) => {
    if (process.platform === "win32")
      return spawn("taskkill", ["/PID", String(pid), ...(force ? ["/F", "/T"] : [])], { stdio: "ignore" })
    return process.kill(pid, force ? "SIGKILL" : "SIGTERM")
  }
  terminate(false)
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && (await processRunning(pid))) await sleep(100)
  if (!(await processRunning(pid))) return { mode: "quit", ms: Date.now() - startedAt }
  terminate(true)
  await sleep(1000)
  return { mode: "killed", ms: Date.now() - startedAt }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
