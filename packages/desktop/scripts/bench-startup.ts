#!/usr/bin/env bun
// Cold-start benchmark for a packaged desktop build.
//
//   bun run bench:startup -- [--exe <path>] [--compare <path>] [--runs 5] [--warmup 1] [--service warm|cold]
//                            [--fresh] [--offline] [--seed <userData dir>] [--profile-main] [--profile-renderer]
//                            [--trace] [--out <dir>] [--home <dir>] [--window-at x,y]
//
// The app runs in an isolated home directory (its own %APPDATA%, XDG dirs, OpenCode DB, config and
// service registration) with the developer's OPENCODE_* / OTEL_* environment stripped, so it never
// attaches to, restarts or reads the developer's live service or state and does not inherit their
// telemetry configuration. `warm` starts one service from the bundled CLI before the runs and lets
// every launch reuse it; `cold` stops it before each run so the desktop has to spawn it. `--fresh`
// wipes the profile before each launch to measure the first launch after an install. `--compare`
// alternates launches of a second build so machine drift affects both equally, and `--warmup`
// launches are discarded (the first launch of a new binary pays the antivirus scan).
//
// Milestones come from the main log, the renderer's performance timeline and DOM readiness polled
// over CDP, plus Node's own bootstrap timing read from the main process afterwards over --inspect
// (nothing attaches until the run is over), which splits the time before the first log line into
// Electron/Chromium native init, Node bootstrap and our main bundle. `--profile-main` records a
// main-process CPU profile from the first statement (via --inspect-brk) on the first run,
// `--profile-renderer` records the renderer main thread from the moment its debug target appears,
// and `--trace` records Chromium's startup trace on the last run. Raw samples are written as JSON.
//
// What is on screen is sampled from the screen itself (Windows): a helper pins the window topmost
// without activating it the moment it exists, then records when the window's pixels first differ
// from the background colour (`screenPainted`) and when they stop changing (`screenSettled`).
// Renderer paint timing alone is not enough: Chromium stops painting an occluded window, and a
// splash or a fade reads as "painted" long before the interface is on screen. `--window-at` puts
// the window somewhere the developer's foreground window does not cover. BENCH_SCREEN_DUMP=<dir>
// also saves every sample as PNG, BENCH_EXTRA_ARGS passes extra Chromium switches to the app.
import { execFileSync, spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { basename, dirname, join, relative, resolve } from "node:path"
import { parseArgs } from "node:util"

const args = parseArgs({
  args: process.argv.slice(2),
  options: {
    exe: { type: "string" },
    compare: { type: "string" },
    runs: { type: "string", default: "5" },
    warmup: { type: "string", default: "1" },
    service: { type: "string", default: "warm" },
    fresh: { type: "boolean", default: false },
    offline: { type: "boolean", default: false },
    seed: { type: "string" },
    home: { type: "string" },
    out: { type: "string" },
    "profile-main": { type: "boolean", default: false },
    "profile-renderer": { type: "boolean", default: false },
    trace: { type: "boolean", default: false },
    "settle-ms": { type: "string", default: "1500" },
    // Restore the bench window at "x,y" (and treat that display as trusted), for example on a display
    // that the developer's foreground window does not cover; Chromium stops painting an occluded window.
    "window-at": { type: "string" },
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
const service = args.values.service === "cold" ? "cold" : "warm"
const settleMs = Number(args.values["settle-ms"])
const outDir = resolve(args.values.out ?? join(packageDir, "dist", "bench-startup"))
const home = resolve(args.values.home ?? join(tmpdir(), "opencode-bench-startup"))
for (const build of builds) {
  if (!existsSync(build.exe))
    throw new Error(`Packaged executable not found: ${build.exe}. Run 'bun run build && bun run package:win' (or pass --exe).`)
}
if (!Number.isSafeInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer")
if (!Number.isSafeInteger(warmup) || warmup < 0) throw new Error("--warmup must be a non-negative integer")
mkdirSync(outDir, { recursive: true })

const appId = appIdFor(builds[0].exe)
if (builds.some((build) => appIdFor(build.exe) !== appId)) throw new Error("Compared builds must be the same channel")
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
// OPENCODE_* and OTEL_* from the developer's shell would otherwise leak into the measured app and
// its service (an OTLP endpoint alone adds a network round trip to every CLI exit).
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
  prepaint: !!document.getElementById('oc-prepaint'),
  visible: document.visibilityState === 'visible',
  shell: !!document.querySelector('#root [data-titlebar-tab-link], #root [data-action="vertical-tabs-home"]'),
  editor: !!document.querySelector('#root [data-component="composer-editor"][contenteditable="true"]'),
  rows: document.querySelectorAll('#root [data-timeline-row]').length,
  home: !!document.querySelector('#root [data-action="home-new-session"], #root [data-action="home-add-project-row"]'),
  url: location.pathname + location.search,
}))()`
// Main-process bootstrap timing, read after the run: when the process was created, when Node
// started inside it, and when Node's own bootstrap finished and handed control to the entry module.
const mainTiming = `JSON.stringify({ created: process.getCreationTime(), origin: performance.timeOrigin, ...performance.nodeTiming.toJSON(), cpu: process.cpuUsage(), rss: process.memoryUsage().rss })`
// Renderer navigation and resource timing plus any marks the app emitted, read once the run is settled.
const rendererTimeline = `(() => {
  const nav = performance.getEntriesByType('navigation')[0]
  const resources = performance.getEntriesByType('resource')
  const scripts = resources.filter((r) => r.initiatorType === 'script' || r.name.endsWith('.js'))
  return {
    navigation: nav && { fetchStart: nav.fetchStart, responseEnd: nav.responseEnd, domInteractive: nav.domInteractive, domContentLoaded: nav.domContentLoadedEventEnd, load: nav.loadEventEnd },
    resources: { count: resources.length, scripts: scripts.length, firstStart: Math.min(...resources.map((r) => r.startTime)), lastEnd: Math.max(...resources.map((r) => r.responseEnd)), bytes: resources.reduce((n, r) => n + (r.encodedBodySize || 0), 0) },
    paint: Object.fromEntries(performance.getEntriesByType('paint').map((e) => [e.name, e.startTime])),
    marks: performance.getEntriesByType('mark').map((e) => [e.name, Math.round(e.startTime)]),
    measures: performance.getEntriesByType('measure').map((e) => [e.name, Math.round(e.startTime), Math.round(e.duration)]),
  }
})()`

for (const build of builds) console.log(`bench${build.label ? ` ${build.label}` : ""}: ${build.exe}`)
console.log(`home:  ${home}`)
console.log(`service: ${service}, runs: ${runs} (+${warmup} warm-up), cdp ${cdpPort}, inspect ${inspectPort}${args.values.fresh ? ", fresh profile per launch" : ""}`)

if (service === "warm") await warmService()

const samples: Sample[] = []
// A launch that never produces a renderer would otherwise leave an instance behind that every later
// launch hands off to through the single-instance lock.
process.on("uncaughtException", async (error) => {
  console.error(error)
  await killApp()
  await stopService()
  process.exit(1)
})
for (let run = 1 - warmup; run <= runs; run++) {
  for (const build of builds) {
    const sample = await launch(build, run)
    if (run < 1) {
      console.log(`warm-up${build.label ? ` ${build.label}` : ""}: shell ${sample.msSinceSpawn.shellVisible} ms`)
      continue
    }
    samples.push(sample)
    console.log(JSON.stringify(sample))
  }
}
await killApp()
if (service === "warm") await stopService()

const summaries = Object.fromEntries(
  builds.map((build) => {
    const own = samples.filter((s) => s.build === build.label)
    const timed = own.filter((s) => !s.profiled && !s.traced)
    return [build.label || "A", summarize(timed.length ? timed : own)]
  }),
)
// Durations between consecutive checkpoints, so "where did the time go" needs no subtraction.
const phaseOrder = [
  ["electron native init", "processCreated", "nodeStart"],
  ["node bootstrap", "nodeStart", "nodeBootstrapped"],
  ["electron js init → entry", "nodeBootstrapped", "entryStart"],
  ["entry → chromium ready", "entryStart", "electronReady"],
  ["ready → window shown", "electronReady", "windowVisible"],
  ["main bundle load + evaluate", "windowVisible", "bundleEvaluated"],
  ["layers → first log line", "bundleEvaluated", "appStarting"],
  ["layers → renderer process", "appStarting", "rendererProcess"],
  ["renderer boot → first paint", "rendererProcess", "firstPaint"],
  ["first paint → shell", "firstPaint", "shellVisible"],
  ["shell → idle", "shellVisible", "rendererIdle"],
] as const
const phases = Object.fromEntries(
  builds.map((build) => {
    const own = samples.filter((s) => s.build === build.label && !s.profiled && !s.traced)
    const out: Record<string, number> = {}
    for (const [name, from, to] of phaseOrder) {
      const deltas = own
        .map((s) => (s.msSinceSpawn[to] ?? NaN) - (s.msSinceSpawn[from] ?? NaN))
        .filter(Number.isFinite)
        .sort((a, b) => a - b)
      if (deltas.length) out[name] = deltas[Math.floor(deltas.length / 2)]
    }
    return [build.label || "A", out]
  }),
)
const report = { builds, service, runs, warmup, fresh: args.values.fresh, home, summaries, phases, samples }
const reportPath = join(outDir, `startup-${Date.now()}.json`)
writeFileSync(reportPath, JSON.stringify(report, null, 2))
const labels = Object.keys(summaries)
const header = `${"".padEnd(32)}${labels.map((label) => (labels.length > 1 ? label : "").padStart(6).padEnd(22)).join("")}`
console.log(`\n${service} service${args.values.fresh ? ", fresh profile" : ""} — median (min…max) ms since spawn over ${runs} runs`)
console.log(header)
for (const key of [...new Set(labels.flatMap((label) => Object.keys(summaries[label])))]) {
  const cells = labels.map((label) => {
    const v = summaries[label][key]
    return v ? `${String(v.median).padStart(6)}  (${v.min}…${v.max})`.padEnd(22) : "".padEnd(22)
  })
  console.log(`${key.padEnd(32)}${cells.join("")}`)
}
console.log(`\nphases — median ms`)
console.log(header)
for (const [name] of phaseOrder) {
  const cells = labels.map((label) => String(phases[label][name] ?? "").padStart(6).padEnd(22))
  console.log(`${name.padEnd(32)}${cells.join("")}`)
}
const idle = (label: string) => samples.filter((s) => s.build === label && !s.profiled && !s.traced).at(-1)
console.log(`\nmemory once idle (last run) — working set MB per process, main CPU ms`)
for (const label of labels) {
  const s = idle(label === "A" && labels.length === 1 ? "" : label)
  if (!s) continue
  const total = s.processes.reduce((n, p) => n + p.rssMB, 0)
  console.log(`${(labels.length > 1 ? label : "").padEnd(4)}total ${total} MB · main cpu ${s.mainCpuMs ?? "?"} ms · renderer heap ${s.renderer.jsHeapMB} MB, ${s.renderer.domNodes} nodes, layout ${s.renderer.layoutMs} ms/${s.renderer.layouts}×, style ${s.renderer.styleMs} ms/${s.renderer.styleRecalcs}×`)
  console.log(`    ${s.processes.map((p) => `${p.name} ${p.rssMB}`).join(" · ")}`)
}
console.log(`\nreport: ${reportPath}`)
process.exit(0)

// ---------------------------------------------------------------------------------------------

type Probe = {
  origin: number
  firstPaint?: number
  domInteractive?: number
  prepaint: boolean
  visible: boolean
  shell: boolean
  editor: boolean
  rows: number
  home: boolean
  url: string
}
type Sample = {
  build: string
  run: number
  profiled: boolean
  traced?: string
  mainProfile?: string
  rendererProfile?: string
  msSinceSpawn: Record<string, number | undefined>
  final: { url?: string; timelineRows?: number }
  rendererCpu: { taskMs: number; scriptMs: number }
  // Renderer main-thread breakdown from Performance.getMetrics at the end of the run.
  renderer: Record<string, number>
  rendererTimeline: unknown
  // Working set per process in the app's tree (main, renderer, GPU, utility) once idle, in MB, and
  // the main process's CPU time.
  processes: { name: string; pid: number; rssMB: number }[]
  mainCpuMs?: number
  // Every timestamped line from the run's log directory (main, crash, onboarding, window, …) as
  // [ms since spawn, file, message].
  timeline: [number, string, string][]
}

async function launch(build: { label: string; exe: string }, run: number): Promise<Sample> {
  await killApp()
  if (service === "cold") await stopService()
  if (args.values.fresh) rmSync(userData, { recursive: true, force: true })
  const profile = args.values["profile-main"] && run === 1
  const trace = args.values.trace && run === runs
  const tracePath = join(outDir, `startup-trace-${Date.now()}.json`)
  const launchArgs = [
    ...(process.env.BENCH_EXTRA_ARGS?.split(" ").filter(Boolean) ?? []),
    `--remote-debugging-port=${cdpPort}`,
    profile ? `--inspect-brk=${inspectPort}` : `--inspect=${inspectPort}`,
    ...(trace
      ? [
          "--trace-startup=*,disabled-by-default-v8.cpu_profiler",
          "--trace-startup-duration=6",
          "--trace-startup-format=json",
          `--trace-startup-file=${tracePath}`,
        ]
      : []),
  ]
  const raiser = await windowRaiser()
  const spawnAt = Date.now()
  const child = spawn(build.exe, launchArgs, { env, detached: true, stdio: "ignore" })
  child.unref()
  appPid = child.pid
  raiser.raise(child.pid!)

  let mainProfile: Promise<unknown> | undefined
  if (profile) mainProfile = profileMain(spawnAt)

  const page = await waitFor(
    () => targets(cdpPort).then((list) => list.find((t) => t.type === "page" && t.url.startsWith("oc://"))),
    60_000,
  )
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
  let prepaintSeen = false
  let quietSince: number | undefined
  let taskMs = 0
  let scriptMs = 0
  const window: { at: number; task: number }[] = []
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const result = await cdp.send("Runtime.evaluate", { expression: probe, returnByValue: true })
    last = result.result?.result?.value as Probe | undefined
    const t = Date.now() - spawnAt
    if (last?.prepaint) prepaintSeen = true
    // Chromium marks a window it considers occluded hidden and the renderer stops painting.
    if (last?.visible && !seen.documentVisible) seen.documentVisible = t
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
  const finalMetrics = (await cdp.send("Performance.getMetrics")).result?.metrics as { name: string; value: number }[]
  const metric = (name: string) => finalMetrics.find((m) => m.name === name)?.value ?? 0
  const renderer = {
    taskMs: Math.round(metric("TaskDuration") * 1000),
    scriptMs: Math.round(metric("ScriptDuration") * 1000),
    layoutMs: Math.round(metric("LayoutDuration") * 1000),
    styleMs: Math.round(metric("RecalcStyleDuration") * 1000),
    layouts: metric("LayoutCount"),
    styleRecalcs: metric("RecalcStyleCount"),
    domNodes: metric("Nodes"),
    jsHeapMB: Math.round(metric("JSHeapUsedSize") / 1048576),
  }
  const timelineResult = await cdp.send("Runtime.evaluate", { expression: rendererTimeline, returnByValue: true })
  cdp.close()
  const processes = appPid ? await processTree(appPid) : []
  const screenChanges = await raiser.screen()
  const boot = profile ? undefined : await mainBootTiming()
  await sleep(300)
  // Chromium writes the startup trace when --trace-startup-duration elapses; keep the app alive until then.
  if (trace) await waitFor(async () => (existsSync(tracePath) && statSync(tracePath).size > 0 ? true : undefined), 20_000)
  const main = mainLog()
  const origin = last?.origin ? Math.round(last.origin - spawnAt) : undefined
  const sample: Sample = {
    build: build.label,
    run,
    profiled: profile || !!rendererProfile,
    traced: trace ? tracePath : undefined,
    rendererProfile: rendererProfilePath,
    msSinceSpawn: {
      processCreated: boot && Math.round(boot.created - spawnAt),
      nodeStart: boot && Math.round(boot.origin + boot.nodeStart - spawnAt),
      nodeBootstrapped: boot && Math.round(boot.origin + boot.bootstrapComplete - spawnAt),
      entryStart: main.marks.entry && main.marks.entry - spawnAt,
      electronReady: main.marks.ready && main.marks.ready - spawnAt,
      bundleEvaluated: main.marks.bundle && main.marks.bundle - spawnAt,
      appStarting: main.appStarting && main.appStarting - spawnAt,
      cliVersionStart: main.versionStart && main.versionStart - spawnAt,
      cliVersionDone: main.versionDone && main.versionDone - spawnAt,
      serviceStarting: main.serviceStarting && main.serviceStarting - spawnAt,
      serviceReady: main.serviceReady && main.serviceReady - spawnAt,
      rendererProcess: origin,
      windowVisible: main.windowVisible && main.windowVisible - spawnAt,
      domInteractive:
        last?.domInteractive !== undefined && origin !== undefined ? Math.round(origin + last.domInteractive) : undefined,
      firstPaint: last?.firstPaint !== undefined && origin !== undefined ? Math.round(origin + last.firstPaint) : undefined,
      // With a shell snapshot in the early document, first paint is the snapshot, not the app.
      prepaintVisible:
        prepaintSeen && last?.firstPaint !== undefined && origin !== undefined
          ? Math.round(origin + last.firstPaint)
          : undefined,
      ...seen,
      // First sampled screen change inside the window: the ground truth for "the user sees something".
      screenPainted: screenChanges.changed[0],
      // When the sampled window content stopped changing: the interface, not a splash, is on screen.
      screenSettled: screenChanges.settled,
      rendererIdle: rendererIdleMs,
    },
    final: { url: last?.url, timelineRows: last?.rows },
    rendererCpu: { taskMs: Math.round(taskMs), scriptMs: Math.round(scriptMs) },
    renderer,
    rendererTimeline: timelineResult.result?.result?.value,
    processes,
    mainCpuMs: boot && Math.round((boot.cpu.user + boot.cpu.system) / 1000),
    timeline: main.timeline.map(([at, file, message]) => [at - spawnAt, file, message]),
  }
  if (mainProfile) {
    const profilePath = join(outDir, `main-${Date.now()}.cpuprofile`)
    writeFileSync(profilePath, JSON.stringify(await mainProfile))
    sample.mainProfile = profilePath
    console.log("main profile:", profilePath)
  }
  return sample
}

// Read after the run, so the inspector attach cannot influence what was measured.
async function mainBootTiming() {
  const target = (await targets(inspectPort)).find((t) => t.type === "node")
  if (!target) return undefined
  const cdp = await connect(target.webSocketDebuggerUrl)
  const result = await cdp.send("Runtime.evaluate", { expression: mainTiming, returnByValue: true })
  cdp.close()
  const value = result.result?.result?.value
  if (typeof value !== "string") return undefined
  return JSON.parse(value) as {
    created: number
    origin: number
    nodeStart: number
    bootstrapComplete: number
    cpu: { user: number; system: number }
    rss: number
  }
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
  const at = args.values["window-at"]?.split(",").map(Number)
  if (at?.length === 2 && existsSync(userData)) {
    for (const file of readdirSync(userData).filter((name) => /^window-state-.*\.json$/.test(name))) {
      const state = JSON.parse(readFileSync(join(userData, file), "utf8"))
      const bounds = displayAt(at[0], at[1])
      writeFileSync(join(userData, file), JSON.stringify({ ...state, x: at[0], y: at[1], isMaximized: false, isFullScreen: false, displayBounds: bounds }))
    }
  }
}

function displayAt(x: number, y: number) {
  if (process.platform !== "win32") return undefined
  const out = execFileSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { \"$($_.Bounds.X),$($_.Bounds.Y),$($_.Bounds.Width),$($_.Bounds.Height)\" }"], { encoding: "utf8" })
  const displays = out.trim().split(/\r?\n/).map((line) => line.split(",").map(Number))
  const hit = displays.find(([dx, dy, dw, dh]) => x >= dx && y >= dy && x < dx + dw && y < dy + dh)
  return hit ? { x: hit[0], y: hit[1], width: hit[2], height: hit[3] } : undefined
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

// Every timestamped line of the run's log directory, merged across the main log and the scoped logs
// (crash, onboarding, window, …) that electron-log writes next to it.
function mainLog() {
  const dirs = existsSync(paths.logs) ? readdirSync(paths.logs).sort().reverse() : []
  const dir = dirs.map((d) => join(paths.logs, d)).find((d) => existsSync(join(d, "main.log")))
  const timeline: [number, string, string][] = []
  let windowShownAt: number | undefined
  // Epoch marks the entry module recorded before any logger existed, reported with "app starting".
  const marks: Record<string, number> = {}
  for (const name of dir ? readdirSync(dir).filter((f) => f.endsWith(".log")) : []) {
    const text = readFileSync(join(dir!, name), "utf8")
    // electron-log wraps long objects onto continuation lines; read them as part of the entry.
    for (const entry of text.split(/\r?\n(?=\[\d{4}-)/)) {
      const line = entry.split(/\r?\n/)[0]
      const m = line.match(/^\[(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3})\]\s+\[\w+\]\s+(?:\([\w-]+\)\s+)?(.*)$/)
      if (!m) continue
      const message = m[2].replace(/\s*\{.*$/, "").trim()
      // A window shown before the logger existed reports when it was shown; the line itself is later.
      const shown = /main window visible/.test(message) ? entry.match(/shownAt: (\d+)/)?.[1] : undefined
      if (shown) windowShownAt = Number(shown)
      if (/app starting/.test(message))
        for (const [, key, value] of entry.matchAll(/\b(entry|ready|window|bundle): (\d{10,})/g)) marks[key] = Number(value)
      timeline.push([new Date(m[1].replace(" ", "T")).getTime(), name.replace(/\.log$/, ""), message])
    }
  }
  timeline.sort((a, b) => a[0] - b[0])
  const at = (pattern: RegExp) => timeline.find(([, , message]) => pattern.test(message))?.[0]
  return {
    timeline,
    appStarting: at(/app starting/),
    versionStart: at(/v2 CLI command started/),
    versionDone: at(/v2 CLI command completed/),
    serviceStarting: at(/v2 CLI background service starting/),
    serviceReady: at(/background service ready/),
    windowVisible: windowShownAt ?? marks.window ?? at(/main window visible/),
    marks,
  }
}

// Working set of every process in the launched app's tree once it is idle.
// Windows places a window launched from a background process behind the foreground one, and
// Chromium then marks it occluded and the renderer stops painting, so paint timings would depend on
// what else is on screen. A helper started before the app polls for its main window and pins it
// topmost without activating it, so the user keeps their focus and the bench window is visible.
async function windowRaiser(): Promise<{ raise: (pid: number) => void; screen: () => Promise<number[]> }> {
  if (process.platform !== "win32") return { raise: () => {}, screen: async () => [] }
  const script = join(outDir, "raise-window.ps1")
  writeFileSync(
    script,
    [
      `Add-Type -AssemblyName System.Drawing`,
      `Add-Type -Namespace Bench -Name User32 -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int z, uint f); [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; } [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);'`,
      `[Console]::Out.WriteLine("ready")`,
      `$target = [int][Console]::In.ReadLine()`,
      `$clock = [Diagnostics.Stopwatch]::StartNew()`,
      `$h = 0`,
      `for ($i = 0; $i -lt 600; $i++) {`,
      `  $h = (Get-Process -Id $target -ErrorAction SilentlyContinue).MainWindowHandle`,
      `  if ($h -and $h -ne 0) { [Bench.User32]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 0x13) | Out-Null; [Console]::Out.WriteLine("raised " + $clock.ElapsedMilliseconds); break }`,
      `  Start-Sleep -Milliseconds 10`,
      `}`,
      `if (-not $h -or $h -eq 0) { exit }`,
      // Sample a 16x16 grid of pixels inside the window: cheap, and enough to tell the background
      // colour, a splash and the interface apart.
      `$r = New-Object Bench.User32+RECT`,
      `while ($clock.ElapsedMilliseconds -lt 3000) {`,
      `  [Bench.User32]::GetWindowRect($h, [ref]$r) | Out-Null`,
      `  $w = $r.R - $r.L; $ht = $r.B - $r.T`,
      `  if ($w -le 48 -or $ht -le 48) { Start-Sleep -Milliseconds 30; continue }`,
      `  $t = $clock.ElapsedMilliseconds`,
      `  $bmp = New-Object System.Drawing.Bitmap $w, $ht`,
      `  $g = [System.Drawing.Graphics]::FromImage($bmp)`,
      `  try { $g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size) } catch { $g.Dispose(); $bmp.Dispose(); Start-Sleep -Milliseconds 30; continue }`,
      `  $sum = 0`,
      `  for ($i = 1; $i -le 16; $i++) { for ($j = 1; $j -le 16; $j++) { $p = $bmp.GetPixel([int]($w * $j / 17), [int]($ht * $i / 17)); $sum += [int]$p.R + [int]$p.G + [int]$p.B } }`,
      `  [Console]::Out.WriteLine("screen " + $t + " " + $sum)`,
      `  if ($env:BENCH_SCREEN_DUMP) { $bmp.Save((Join-Path $env:BENCH_SCREEN_DUMP ("screen-" + $t.ToString().PadLeft(4, "0") + ".png"))) }`,
      `  $g.Dispose(); $bmp.Dispose()`,
      `  Start-Sleep -Milliseconds 30`,
      `}`,
    ].join("\n"),
  )
  const helper = spawn("pwsh", ["-NoProfile", "-NonInteractive", "-File", script], { stdio: ["pipe", "pipe", "pipe"] })
  const lines: string[] = []
  let buffer = ""
  await new Promise<void>((resolve) => {
    helper.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString()
      const parts = buffer.split(/\r?\n/)
      buffer = parts.pop() ?? ""
      for (const line of parts) {
        if (line === "ready") resolve()
        else lines.push(line)
      }
    })
    helper.stderr!.on("data", (chunk: Buffer) => console.error(`raise-window: ${chunk.toString().trim()}`))
    helper.on("exit", () => resolve())
  })
  const exited = new Promise<void>((resolve) => helper.on("exit", () => resolve()))
  return {
    raise: (pid) => helper.stdin!.write(`${pid}\n`),
    // Resolves with the times (ms since the pid was sent, ~spawn) at which the sampled screen
    // content differed from the first sample, i.e. when something other than the background colour
    // was on screen.
    screen: async () => {
      await exited
      const samples = lines
        .filter((line) => line.startsWith("screen "))
        .map((line) => line.split(" ").slice(1).map(Number) as [number, number])
      if (process.env.BENCH_DEBUG) console.log(lines.filter((line) => line.startsWith("raised")).join(" "), `${samples.length} screen samples`)
      const first = samples[0]?.[1]
      const last = samples.at(-1)?.[1]
      const differs = (a: number, b: number) => Math.abs(a - b) > 16 * 16 * 12
      const changed = samples.filter(([, sum]) => differs(sum, first)).map(([t]) => t)
      // The last sample that still differed from the final content, i.e. when the window stopped changing.
      const settledIndex = samples.findLastIndex(([, sum]) => last !== undefined && differs(sum, last))
      return { changed, settled: settledIndex >= 0 ? samples[settledIndex + 1]?.[0] : samples[0]?.[0] }
    },
  }
}
async function processTree(root: number) {
  const script =
    process.platform === "win32"
      ? [
          "powershell",
          [
            "-NoProfile",
            "-Command",
            `$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, WorkingSetSize, CommandLine; $ids = @(${root}); do { $before = $ids.Count; $ids = @($ids + ($all | Where-Object { $ids -contains $_.ParentProcessId } | ForEach-Object ProcessId) | Sort-Object -Unique) } while ($ids.Count -ne $before); $all | Where-Object { $ids -contains $_.ProcessId } | ForEach-Object { '{0}|{1}|{2}|{3}' -f $_.ProcessId, $_.Name, $_.WorkingSetSize, (($_.CommandLine -split ' ' | Where-Object { $_ -like '--type=*' }) -join '') } `,
          ],
        ]
      : ["sh", ["-c", `ps -eo pid=,ppid=,rss=,comm= | awk -v r=${root} 'BEGIN{ids[r]=1} {p[$1]=$2; rss[$1]=$3; c[$1]=$4} END{for(k=0;k<8;k++) for(i in p) if(p[i] in ids) ids[i]=1; for(i in ids) if(i in rss) print i "|" c[i] "|" rss[i]*1024 "|"}'`]]
  const out = await new Promise<string>((done) => {
    const child = spawn(script[0] as string, script[1] as string[], { stdio: ["ignore", "pipe", "ignore"] })
    let text = ""
    child.stdout?.on("data", (chunk) => (text += chunk))
    child.on("close", () => done(text))
  })
  return out
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [pid, name, rss, type] = line.split("|")
      return { pid: Number(pid), name: `${name}${type ? ` ${type.replace("--type=", "")}` : ""}`, rssMB: Math.round(Number(rss) / 1048576) }
    })
}

function summarize(list: Sample[]) {
  const values = (s: Sample): Record<string, number | undefined> => ({
    ...s.msSinceSpawn,
    rendererTaskMs: s.rendererCpu.taskMs,
    rendererScriptMs: s.rendererCpu.scriptMs,
  })
  const keys = [...new Set(list.flatMap((s) => Object.keys(values(s))))]
  const out: Record<string, { median: number; min: number; max: number }> = {}
  for (const key of keys) {
    const sorted = list.map((s) => values(s)[key]).filter((v): v is number => Number.isFinite(v)).sort((a, b) => a - b)
    if (!sorted.length) continue
    out[key] = { median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted[sorted.length - 1] }
  }
  return out
}

// The service must come from the CLI bundled with the executable: the desktop restarts a service
// whose version differs from its bundled CLI, which would turn a warm run into a cold one.
function bundledCli(exe: string) {
  const resources = process.platform === "darwin" ? join(dirname(exe), "..", "Resources") : join(dirname(exe), "resources")
  return join(resources, process.platform === "win32" ? "opencode-cli.exe" : "opencode-cli")
}

async function warmService() {
  await stopService()
  const clis = builds.map((build) => bundledCli(build.exe))
  const identity = (cli: string) => {
    const version = join(dirname(cli), "opencode-cli.version")
    return existsSync(version) ? readFileSync(version, "utf8").trim() : String(statSync(cli).size)
  }
  if (new Set(clis.map(identity)).size > 1)
    throw new Error("The compared builds bundle different CLIs; the desktop would restart the service on the mismatch")
  serviceProcess = spawn(clis[0], ["serve", "--service"], { env, detached: true, stdio: "ignore" })
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
