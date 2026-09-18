#!/usr/bin/env bun
// Cold-start benchmark for a packaged desktop build.
//
//   bun run bench:startup -- [--exe <path>] [--runs 5] [--service warm|cold] [--seed <userData dir>]
//                            [--profile-main] [--profile-renderer] [--trace] [--out <dir>] [--home <dir>]
//
// The app runs in an isolated home directory (its own %APPDATA%, XDG dirs, OpenCode DB, config and
// service registration), so it never attaches to, restarts or reads the developer's live service or
// state. `warm` starts one service from the bundled CLI before the runs and lets every launch reuse
// it; `cold` stops it before each run so the desktop has to spawn it. Milestones come from the main
// log, the renderer's performance timeline and DOM readiness polled over CDP. `--profile-main`
// records a main-process CPU profile from the first statement (via --inspect-brk) on the first run,
// `--profile-renderer` records the renderer main thread from the moment its debug target appears,
// and `--trace` records Chromium's startup trace on the last run. Raw samples are written as JSON.
import { spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { homedir, tmpdir } from "node:os"
import { basename, dirname, join, relative, resolve } from "node:path"
import { parseArgs } from "node:util"

const args = parseArgs({
  args: process.argv.slice(2),
  options: {
    exe: { type: "string" },
    runs: { type: "string", default: "5" },
    service: { type: "string", default: "warm" },
    seed: { type: "string" },
    home: { type: "string" },
    out: { type: "string" },
    "profile-main": { type: "boolean", default: false },
    "profile-renderer": { type: "boolean", default: false },
    trace: { type: "boolean", default: false },
    "settle-ms": { type: "string", default: "1500" },
  },
  allowPositionals: true,
})
const packageDir = resolve(import.meta.dirname, "..")
const exe = resolve(args.values.exe ?? defaultExe())
const runs = Number(args.values.runs)
const service = args.values.service === "cold" ? "cold" : "warm"
const settleMs = Number(args.values["settle-ms"])
const outDir = resolve(args.values.out ?? join(packageDir, "dist", "bench-startup"))
const home = resolve(args.values.home ?? join(tmpdir(), "opencode-bench-startup"))
if (!existsSync(exe)) throw new Error(`Packaged executable not found: ${exe}. Run 'bun run build && bun run package:win' (or pass --exe).`)
if (!Number.isSafeInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer")
mkdirSync(outDir, { recursive: true })

const appId = appIdFor(exe)
const userData = join(home, "AppData", "Roaming", appId)
const paths = {
  home,
  appData: join(home, "AppData", "Roaming"),
  localAppData: join(home, "AppData", "Local"),
  temp: join(home, "AppData", "Local", "Temp"),
  db: join(home, ".local", "share", "opencode", "opencode.db"),
  config: join(home, ".config", "opencode"),
  registration: join(home, ".local", "state", "opencode", "service.json"),
  logs: join(userData, "logs"),
}
prepareHome()
// The desktop deletes XDG_STATE_HOME on Windows, so isolation goes through the home directory.
const env = {
  ...process.env,
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
}
const cdpPort = await freePort()
// A private service port keeps a cold launch's own service away from the developer's service.
const servicePort = await freePort()
writeFileSync(join(paths.config, "service.json"), JSON.stringify({ port: servicePort }))
const inspectPort = await freePort()
let appPid: number | undefined
let serviceProcess: ReturnType<typeof spawn> | undefined
// Renderer readiness, read over CDP: paint timing plus the DOM states the user actually waits for.
const probe = `(() => ({
  origin: performance.timeOrigin,
  firstPaint: performance.getEntriesByType('paint').find((e) => e.name === 'first-paint')?.startTime,
  domInteractive: performance.getEntriesByType('navigation')[0]?.domInteractive,
  shell: !!document.querySelector('[data-titlebar-tab-link], [data-action="vertical-tabs-home"]'),
  editor: !!document.querySelector('[data-component="composer-editor"][contenteditable="true"]'),
  rows: document.querySelectorAll('[data-timeline-row]').length,
  home: !!document.querySelector('[data-action="home-new-session"], [data-action="home-add-project-row"]'),
  url: location.pathname + location.search,
}))()`

console.log(`bench: ${exe}`)
console.log(`home:  ${home}`)
console.log(`service: ${service}, runs: ${runs}, cdp ${cdpPort}, inspect ${inspectPort}`)

if (service === "warm") await warmService()

const samples: Sample[] = []
for (let run = 1; run <= runs; run++) {
  await killApp()
  if (service === "cold") await stopService()
  const profile = args.values["profile-main"] && run === 1
  const trace = args.values.trace && run === runs
  const tracePath = join(outDir, `startup-trace-${Date.now()}.json`)
  const launch = [
    `--remote-debugging-port=${cdpPort}`,
    ...(profile ? [`--inspect-brk=${inspectPort}`] : []),
    ...(trace
      ? ["--trace-startup=*,disabled-by-default-v8.cpu_profiler", "--trace-startup-duration=6", "--trace-startup-format=json", `--trace-startup-file=${tracePath}`]
      : []),
  ]
  const spawnAt = Date.now()
  const child = spawn(exe, launch, { env, detached: true, stdio: "ignore" })
  child.unref()
  appPid = child.pid

  let mainProfile: Promise<unknown> | undefined
  if (profile) mainProfile = profileMain(spawnAt)

  const page = await waitFor(() => targets(cdpPort).then((list) => list.find((t) => t.type === "page" && t.url.startsWith("oc://"))), 60_000)
  const cdp = await connect(page.webSocketDebuggerUrl)
  await cdp.send("Runtime.enable")
  await cdp.send("Performance.enable")
  const rendererProfile = args.values["profile-renderer"] && run === 1
  if (rendererProfile) {
    await cdp.send("Profiler.enable")
    await cdp.send("Profiler.setSamplingInterval", { interval: 100 })
    await cdp.send("Profiler.start")
  }
  // Poll DOM readiness and the renderer's cumulative main-thread task time together. The run ends
  // when the shell is up and the main thread has spent under 10 % of any 500 ms window in tasks for `settleMs`.
  const seen: Record<string, number> = {}
  let last: Probe | undefined
  let quietSince: number | undefined
  let taskMs = 0
  let scriptMs = 0
  const window: { at: number; task: number }[] = []
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const result = await cdp.send("Runtime.evaluate", { expression: probe, returnByValue: true })
    last = result.result?.result?.value as Probe | undefined
    const t = Date.now() - spawnAt
    if (last?.shell && !seen.shellVisible) seen.shellVisible = t
    if (last?.editor && !seen.composerEditable) seen.composerEditable = t
    if (last?.rows && !seen.timelineRows) seen.timelineRows = t
    if (last?.home && !seen.homeReady) seen.homeReady = t
    const metrics = (await cdp.send("Performance.getMetrics")).result?.metrics as { name: string; value: number }[]
    const task = (metrics.find((m) => m.name === "TaskDuration")?.value ?? 0) * 1000
    scriptMs = (metrics.find((m) => m.name === "ScriptDuration")?.value ?? 0) * 1000
    if (process.env.BENCH_DEBUG && task - taskMs > 5) console.log(`busy +${Date.now() - spawnAt} ${Math.round(task - taskMs)} ms`)
    taskMs = task
    window.push({ at: Date.now(), task })
    while (window.length > 1 && window[1].at <= Date.now() - 500) window.shift()
    if (task - window[0].task > 50) quietSince = undefined
    else quietSince ??= window[0].at
    if (seen.shellVisible && quietSince && Date.now() - quietSince >= settleMs) break
    await sleep(50)
  }
  const rendererIdleMs = quietSince ? quietSince - spawnAt : undefined
  const rendererProfilePath = rendererProfile ? join(outDir, `renderer-${Date.now()}.cpuprofile`) : undefined
  if (rendererProfilePath) {
    const stopped = await cdp.send("Profiler.stop")
    writeFileSync(rendererProfilePath, JSON.stringify(stopped.result.profile))
    console.log("renderer profile:", rendererProfilePath)
  }
  cdp.close()
  await sleep(300)
  // Chromium writes the startup trace when --trace-startup-duration elapses; keep the app alive until then.
  if (trace) await waitFor(async () => (existsSync(tracePath) && statSync(tracePath).size > 0 ? true : undefined), 20_000)
  const main = mainLog()
  const origin = last?.origin ? Math.round(last.origin - spawnAt) : undefined
  const sample: Sample = {
    run,
    profiled: profile || !!rendererProfile,
    traced: trace ? tracePath : undefined,
    rendererProfile: rendererProfilePath,
    msSinceSpawn: {
      appStarting: main.appStarting && main.appStarting - spawnAt,
      cliVersionStart: main.versionStart && main.versionStart - spawnAt,
      cliVersionDone: main.versionDone && main.versionDone - spawnAt,
      serviceStarting: main.serviceStarting && main.serviceStarting - spawnAt,
      serviceReady: main.serviceReady && main.serviceReady - spawnAt,
      rendererProcess: origin,
      windowVisible: main.windowVisible && main.windowVisible - spawnAt,
      domInteractive: last?.domInteractive !== undefined && origin !== undefined ? Math.round(origin + last.domInteractive) : undefined,
      firstPaint: last?.firstPaint !== undefined && origin !== undefined ? Math.round(origin + last.firstPaint) : undefined,
      ...seen,
      rendererIdle: rendererIdleMs,
    },
    final: { url: last?.url, timelineRows: last?.rows },
    rendererCpu: { taskMs: Math.round(taskMs), scriptMs: Math.round(scriptMs) },
  }
  samples.push(sample)
  console.log(JSON.stringify(sample))
  if (mainProfile) {
    const profilePath = join(outDir, `main-${Date.now()}.cpuprofile`)
    writeFileSync(profilePath, JSON.stringify(await mainProfile))
    sample.mainProfile = profilePath
    console.log("main profile:", profilePath)
  }
}
await killApp()
if (service === "warm") await stopService()

const timed = samples.filter((s) => !s.profiled && !s.traced)
const summary = summarize(timed.length ? timed : samples)
const report = { exe, service, runs, home, summary, samples }
const reportPath = join(outDir, `startup-${Date.now()}.json`)
writeFileSync(reportPath, JSON.stringify(report, null, 2))
console.log(`\n${service} service — median (min…max) ms since spawn over ${timed.length || samples.length} runs`)
for (const [k, v] of Object.entries(summary)) console.log(`${k.padEnd(18)} ${String(v.median).padStart(6)}  (${v.min}…${v.max})`)
console.log(`\nreport: ${reportPath}`)
process.exit(0)

// ---------------------------------------------------------------------------------------------

type Probe = {
  origin: number
  firstPaint?: number
  domInteractive?: number
  shell: boolean
  editor: boolean
  rows: number
  home: boolean
  url: string
}
type Sample = {
  run: number
  profiled: boolean
  traced?: string
  mainProfile?: string
  rendererProfile?: string
  msSinceSpawn: Record<string, number | undefined>
  final: { url?: string; timelineRows?: number }
  rendererCpu: { taskMs: number; scriptMs: number }
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
  for (const dir of [paths.appData, paths.temp, dirname(paths.db), paths.config, dirname(paths.registration), join(home, ".cache")]) mkdirSync(dir, { recursive: true })
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
}

async function freePort() {
  return new Promise<number>((resolvePort, reject) => {
    const server = createServer()
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close(() => (typeof address === "object" && address ? resolvePort(address.port) : reject(new Error("no port"))))
    })
  })
}

async function targets(port: number) {
  return fetch(`http://127.0.0.1:${port}/json`)
    .then((r) => r.json() as Promise<{ type: string; url: string; webSocketDebuggerUrl: string }[]>)
    .catch(() => [] as { type: string; url: string; webSocketDebuggerUrl: string }[])
}

async function waitFor<T>(fn: () => Promise<T | undefined>, timeout: number) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await fn()
    if (value) return value
    await sleep(25)
  }
  throw new Error("Timed out waiting for the renderer debug target")
}

async function connect(url: string) {
  const ws = new WebSocket(url)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const pending = new Map<number, (v: any) => void>()
  const events: any[] = []
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data))
    if (msg.method) events.push(msg)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)!(msg)
      pending.delete(msg.id)
    }
  }
  return {
    events,
    send: (method: string, params: Record<string, unknown> = {}) =>
      new Promise<any>((resolvePromise) => {
        const n = ++id
        pending.set(n, resolvePromise)
        ws.send(JSON.stringify({ id: n, method, params }))
      }),
    close: () => ws.close(),
  }
}

// Attach to the main process while it is paused on its first statement, start sampling, release it.
async function profileMain(spawnAt: number) {
  const target = await waitFor(() => targets(inspectPort).then((list) => list.find((t) => t.type === "node")), 30_000)
  const cdp = await connect(target.webSocketDebuggerUrl)
  await cdp.send("Runtime.enable")
  await cdp.send("Debugger.enable")
  await cdp.send("Profiler.enable")
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 })
  await cdp.send("Profiler.start")
  await cdp.send("Runtime.runIfWaitingForDebugger")
  const until = Date.now() + 3000
  while (!cdp.events.some((e) => e.method === "Debugger.paused") && Date.now() < until) await sleep(10)
  await cdp.send("Debugger.resume")
  console.log(`debugger released at +${Date.now() - spawnAt} ms`)
  await sleep(8000)
  const result = await cdp.send("Profiler.stop")
  cdp.close()
  return result.result.profile
}

function mainLog() {
  const dirs = existsSync(paths.logs) ? readdirSync(paths.logs).sort().reverse() : []
  const file = dirs.map((d) => join(paths.logs, d, "main.log")).find((f) => existsSync(f))
  const text = file ? readFileSync(file, "utf8") : ""
  const at = (pattern: RegExp) => {
    const line = text.split("\n").find((l) => pattern.test(l))
    const m = line?.match(/^\[(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3})\]/)
    return m ? new Date(m[1].replace(" ", "T")).getTime() : undefined
  }
  return {
    appStarting: at(/app starting/),
    versionStart: at(/v2 CLI command started/),
    versionDone: at(/v2 CLI command completed/),
    serviceStarting: at(/v2 CLI background service starting/),
    serviceReady: at(/background service ready/),
    windowVisible: at(/main window visible/),
  }
}

function summarize(list: Sample[]) {
  const values = (s: Sample): Record<string, number | undefined> => ({ ...s.msSinceSpawn, rendererTaskMs: s.rendererCpu.taskMs, rendererScriptMs: s.rendererCpu.scriptMs })
  const keys = [...new Set(list.flatMap((s) => Object.keys(values(s))))]
  const out: Record<string, { median: number; min: number; max: number }> = {}
  for (const key of keys) {
    const sorted = list.map((s) => values(s)[key]).filter((v): v is number => Number.isFinite(v)).sort((a, b) => a - b)
    if (!sorted.length) continue
    out[key] = { median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted[sorted.length - 1] }
  }
  return out
}

// The service must come from the CLI bundled with this executable: the desktop restarts a service
// whose version differs from its bundled CLI, which would turn a warm run into a cold one.
function bundledCli() {
  const resources = process.platform === "darwin" ? join(dirname(exe), "..", "Resources") : join(dirname(exe), "resources")
  return join(resources, process.platform === "win32" ? "opencode-cli.exe" : "opencode-cli")
}

async function warmService() {
  await stopService()
  const cli = bundledCli()
  serviceProcess = spawn(cli, ["serve", "--service"], { env, detached: true, stdio: "ignore" })
  serviceProcess.unref()
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (existsSync(paths.registration)) {
      const registration = JSON.parse(readFileSync(paths.registration, "utf8")) as { url?: string }
      if (registration.url && (await fetch(`${registration.url}/api/info`).then((r) => r.status < 500).catch(() => false))) {
        console.log(`service warm at ${registration.url}`)
        return
      }
    }
    await sleep(200)
  }
  throw new Error("The bench service did not become ready")
}

async function stopService() {
  if (existsSync(paths.registration)) {
    const registration = JSON.parse(readFileSync(paths.registration, "utf8")) as { pid?: number }
    if (registration.pid) {
      try {
        process.kill(registration.pid)
      } catch {}
    }
    rmSync(paths.registration, { force: true })
  }
  if (serviceProcess?.pid) {
    try {
      process.kill(serviceProcess.pid)
    } catch {}
    serviceProcess = undefined
  }
  await sleep(500)
}

// Only ever touches the process this run spawned (a prod-channel build shares its executable name
// with the developer's installed app). Ask it to quit first so it exits the way a user's session
// ends (Node and Chromium flush their caches on a normal exit); force-kill the tree if it lingers.
async function killApp() {
  const pid = appPid
  if (!pid) return
  appPid = undefined
  const running = () =>
    new Promise<boolean>((done) => {
      const check =
        process.platform === "win32"
          ? spawn("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], { stdio: ["ignore", "pipe", "ignore"] })
          : spawn("kill", ["-0", String(pid)], { stdio: "ignore" })
      let out = ""
      check.stdout?.on("data", (chunk) => (out += chunk))
      check.on("close", (code) => done(process.platform === "win32" ? out.includes(String(pid)) : code === 0))
    })
  if (!(await running())) return
  if (process.platform === "win32") spawn("taskkill", ["/PID", String(pid)], { stdio: "ignore" })
  else process.kill(pid, "SIGTERM")
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && (await running())) await sleep(100)
  if (await running()) {
    if (process.platform === "win32") spawn("taskkill", ["/PID", String(pid), "/F", "/T"], { stdio: "ignore" })
    else process.kill(pid, "SIGKILL")
    await sleep(1000)
  }
  await sleep(500)
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
