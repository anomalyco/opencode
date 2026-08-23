import { Service } from "@opencode-ai/client/service"
import { chromium, expect, type Browser, type Page, type TestInfo } from "@playwright/test"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { startChromeTrace } from "../chrome-trace"

const repository = resolve(import.meta.dirname, "../../../../..")
const milestones = [
  "bunRootScript",
  "bunDesktopScript",
  "desktopPrepared",
  "mainBundleReady",
  "preloadBundleReady",
  "rendererDevServerReady",
  "electronSpawnStarted",
  "debugEndpointReady",
  "electronStarted",
  "serviceEnsureStarted",
  "serviceSpawnRequested",
  "serviceReady",
  "backgroundLoadingReady",
  "rendererViteConnected",
  "rendererInitializationStarted",
  "rendererInitializationReady",
  "windowVisible",
  "homeReady",
] as const
const phases = [
  "desktopPreparation",
  "viteMainBundle",
  "vitePreloadBundle",
  "rendererServerStartup",
  "electronStartup",
  "serviceSpawnWait",
  "serviceProcessStartup",
  "rendererStartup",
  "visibleWindowToHome",
] as const

type Milestone = (typeof milestones)[number]
type Phase = (typeof phases)[number]
type ServiceInfo = { id: string; version: string; url: string; pid: number }

export type DesktopStartupSample = {
  run: number
  commandToHomeReadyMs: number
  milestonesMs: Record<Milestone, number>
  phasesMs: Record<Phase, number>
  service: Omit<ServiceInfo, "id">
}

export async function runDesktopStartup(run: number, testInfo: TestInfo) {
  const profile = await createColdProfile()
  const desktop = await Promise.resolve()
    .then(() => startDesktop(profile))
    .catch(async (error) => {
      await rm(profile.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      throw error
    })
  try {
    const page = await desktop.open()
    const stopTrace = await startChromeTrace(page, `desktop-startup-${run}`)
    try {
      await startThemeObservation(page)
      await waitForHome(page, desktop.mark)
      await requireStableTheme(page)
      return await desktop.result(run)
    } finally {
      await stopTrace?.()
    }
  } finally {
    await desktop.close(testInfo, run)
  }
}

export async function desktopBenchmarkContext(runs: number) {
  const pkg = JSON.parse(await readFile(join(repository, "packages/desktop/package.json"), "utf8"))
  const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repository })
  if (revision.status !== 0) throw new Error("Failed to read the benchmark Git revision")
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: repository })
  if (status.status !== 0) throw new Error("Failed to read the benchmark Git status")
  const bun = spawnSync("bun", ["--version"], { cwd: repository })
  if (bun.status !== 0) throw new Error("Failed to read the benchmark Bun version")
  return {
    arch: process.arch,
    command: "bun dev:desktop",
    runs,
    profile: "fresh",
    service: "isolated-cold",
    install: "complete",
    viteCache: "cold",
    electronInstall: "present",
    bunVersion: bun.stdout.toString().trim(),
    electronVersion: pkg.devDependencies.electron,
    electronViteVersionRange: pkg.devDependencies["electron-vite"],
    gitCommit: revision.stdout.toString().trim(),
    gitDirty: status.stdout.length > 0,
    trace: Boolean(process.env.OPENCODE_PERFORMANCE_TRACE_DIR),
  }
}

export function summarizeDesktopStartup(samples: DesktopStartupSample[]) {
  return {
    commandToHomeReadyMs: statistics(samples.map((sample) => sample.commandToHomeReadyMs)),
    milestonesMs: Object.fromEntries(
      milestones.map((name) => [name, statistics(samples.map((sample) => sample.milestonesMs[name]))]),
    ),
    phasesMs: Object.fromEntries(
      phases.map((name) => [name, statistics(samples.map((sample) => sample.phasesMs[name]))]),
    ),
  }
}

export function milestoneForLine(line: string): Milestone | undefined {
  const text = stripAnsi(line)
  return milestonePatterns.find((item) => text.includes(item.text))?.name
}

const milestonePatterns: ReadonlyArray<{ name: Milestone; text: string }> = [
  { name: "bunRootScript", text: "$ bun --cwd packages/desktop dev" },
  { name: "bunDesktopScript", text: "$ bun ./scripts/dev.ts" },
  { name: "desktopPrepared", text: "Copied dev icons from" },
  { name: "mainBundleReady", text: "electron main process built successfully" },
  { name: "preloadBundleReady", text: "electron preload scripts built successfully" },
  { name: "rendererDevServerReady", text: "dev server running for the electron renderer process at:" },
  { name: "electronSpawnStarted", text: "starting electron app..." },
  { name: "debugEndpointReady", text: "DevTools listening on ws://" },
  { name: "electronStarted", text: "app starting" },
  { name: "serviceEnsureStarted", text: "starting v2 background service" },
  { name: "serviceSpawnRequested", text: "v2 CLI background service starting" },
  { name: "serviceReady", text: "v2 CLI background service ready" },
  { name: "backgroundLoadingReady", text: "loading task finished" },
  { name: "rendererViteConnected", text: "[vite] connected." },
  { name: "rendererInitializationStarted", text: "awaiting server ready" },
  { name: "rendererInitializationReady", text: "server ready" },
  { name: "windowVisible", text: "main window visible" },
]

async function createColdProfile() {
  await Promise.all(
    ["packages/desktop/node_modules/.vite", "packages/desktop/out"].map((path) =>
      rm(join(repository, path), { recursive: true, force: true }),
    ),
  )
  const root = await mkdtemp(join(tmpdir(), "opencode-desktop-startup-"))
  return initializeColdProfile(root).catch(async (error) => {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    throw error
  })
}

async function initializeColdProfile(root: string) {
  await Promise.all(
    ["data", "config", "cache", "state", "desktop", "session", "home"].map((dir) =>
      mkdir(join(root, dir), { recursive: true }),
    ),
  )
  await Promise.all([
    writeFile(
      join(root, "desktop", "opencode.settings"),
      JSON.stringify({ firstLaunchOnboardingComplete: true }),
    ),
    writeFile(join(root, "desktop", "opencode.global.dat"), JSON.stringify({ language: '{"locale":"en"}' })),
  ])
  const registration = join(root, "desktop", "opencode", "service-local.json")
  await Service.stop({ file: registration })
  return { root, registration }
}

function startDesktop(profile: Awaited<ReturnType<typeof createColdProfile>>) {
  const started = performance.now()
  const child = spawn("bun", ["dev:desktop"], {
    cwd: repository,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      OPENCODE_CONFIG_DIR: join(profile.root, "config"),
      OPENCODE_DB: join(profile.root, "data", "opencode.db"),
      OPENCODE_TEST_HOME: join(profile.root, "home"),
      OPENCODE_TEST_ONBOARDING: "0",
      OPENCODE_DESKTOP_TEST_ROOT: profile.root,
      OPENCODE_DESKTOP_REMOTE_DEBUGGING_PORT: "0",
      OPENCODE_DESKTOP_DISABLE_PROTOCOL_REGISTRATION: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (!child.pid || !child.stdout || !child.stderr) throw new Error("Failed to start the desktop command")
  const exited = childExit(child)
  const observed: Partial<Record<Milestone, number>> = {}
  const endpoint = Promise.withResolvers<string>()
  const pageErrors: string[] = []
  let browser: Browser | undefined
  let service: ServiceInfo | undefined
  const mark = (name: Milestone) => {
    observed[name] ??= elapsed(started)
  }
  const record = (line: string) => {
    const milestone = milestoneForLine(line)
    if (milestone) mark(milestone)
    const match = stripAnsi(line).match(/DevTools listening on (ws:\/\/\S+)/)
    if (match?.[1]) endpoint.resolve(match[1])
  }
  const stdout = observeOutput(child.stdout, record)
  const stderr = observeOutput(child.stderr, record)

  return {
    mark,
    async open() {
      const url = await Promise.race([
        endpoint.promise,
        exited.then((code) => {
          throw new Error(`Desktop command exited with code ${code} before opening its debug endpoint`)
        }),
        sleep(120_000).then(() => {
          throw new Error("Timed out waiting for the desktop debug endpoint")
        }),
      ])
      browser = await chromium.connectOverCDP(url, { timeout: 120_000 })
      const context = browser.contexts()[0]
      if (!context) throw new Error("Electron did not expose a browser context")
      await expect.poll(() => context.pages().length, { timeout: 120_000 }).toBeGreaterThan(0)
      const page = context.pages()[0]
      if (!page) throw new Error("Electron did not expose a renderer page")
      page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message))
      return page
    },
    async result(run: number): Promise<DesktopStartupSample> {
      if (pageErrors.length) throw new Error(`Desktop renderer reported errors:\n\n${pageErrors.join("\n\n")}`)
      service = await readService(profile)
      const milestonesMs = requireMilestones(observed)
      return {
        run,
        commandToHomeReadyMs: milestonesMs.homeReady,
        milestonesMs,
        phasesMs: calculatePhases(milestonesMs),
        service: {
          version: service.version,
          url: service.url,
          pid: service.pid,
        },
      }
    },
    async close(testInfo: TestInfo, run: number) {
      const errors: unknown[] = []
      await browser?.close().catch(() => undefined)
      await stopProcessTree(child, exited).catch((error) => {
        errors.push(error)
        child.stdout?.destroy()
        child.stderr?.destroy()
      })
      const [stdoutText, stderrText] = await Promise.all([stdout, stderr]).catch((error) => {
        errors.push(error)
        return ["", ""]
      })
      await Promise.all([
        testInfo.attach(`desktop-startup-${run}-stdout`, { body: stdoutText, contentType: "text/plain" }),
        testInfo.attach(`desktop-startup-${run}-stderr`, { body: stderrText, contentType: "text/plain" }),
        pageErrors.length
          ? testInfo.attach(`desktop-startup-${run}-page-errors`, {
              body: pageErrors.join("\n\n"),
              contentType: "text/plain",
            })
          : Promise.resolve(),
      ]).catch((error) => errors.push(error))
      await Service.stop({ file: profile.registration }).catch((error) => errors.push(error))
      if (service && processAlive(service.pid))
        errors.push(new Error(`Desktop service process ${service.pid} did not stop`))
      await rm(profile.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch((error) =>
        errors.push(error),
      )
      if (errors.length) throw new AggregateError(errors, "Desktop benchmark cleanup failed")
    },
  }
}

async function waitForHome(page: Page, mark: (name: Milestone) => void) {
  await expect.poll(() => page.evaluate(() => document.visibilityState), { timeout: 120_000 }).toBe("visible")

  const projects = page.getByRole("complementary", { name: "Projects", exact: true })
  const sessions = page.getByRole("region", { name: "Recent sessions", exact: true })
  const search = page.getByRole("textbox", { name: "Search sessions", exact: true })
  const addProject = projects.locator('button[data-action="home-add-project-row"]')
  await expect(projects).toBeVisible({ timeout: 120_000 })
  await expect(sessions).toBeVisible()
  await expect(search).toBeEditable()
  await expect(sessions.getByText("Nothing here yet", { exact: true })).toBeVisible()
  await expect(addProject).toHaveCount(1)
  await addProject.click({ trial: true })
  mark("homeReady")
}

type ThemeWindow = Window & {
  __OPENCODE_THEME_STATES__?: string[]
  __OPENCODE_THEME_OBSERVER__?: MutationObserver
}

async function startThemeObservation(page: Page) {
  await page.addInitScript(installThemeObservation)
  await page.evaluate(installThemeObservation)
}

async function requireStableTheme(page: Page) {
  const states = await page.evaluate(() => {
    const target = window as ThemeWindow
    target.__OPENCODE_THEME_OBSERVER__?.disconnect()
    return target.__OPENCODE_THEME_STATES__ ?? []
  })
  if (states.length !== 1) throw new Error(`Desktop theme changed during startup: ${states.join(" -> ")}`)
}

function installThemeObservation() {
  const target = window as ThemeWindow
  const observeRoot = () => {
    const root = document.documentElement
    if (!root) return false
    const state = () => {
      const theme = root.dataset.theme
      const scheme = root.dataset.colorScheme
      return theme && scheme ? `${theme}:${scheme}` : undefined
    }
    const initial = state()
    target.__OPENCODE_THEME_STATES__ = initial ? [initial] : []
    target.__OPENCODE_THEME_OBSERVER__ = new MutationObserver(() => {
      const next = state()
      if (!next) return
      if (target.__OPENCODE_THEME_STATES__?.at(-1) !== next) target.__OPENCODE_THEME_STATES__?.push(next)
    })
    target.__OPENCODE_THEME_OBSERVER__.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme", "data-color-scheme"],
    })
    return true
  }
  if (observeRoot()) return
  const documentObserver = new MutationObserver(() => {
    if (!observeRoot()) return
    documentObserver.disconnect()
  })
  target.__OPENCODE_THEME_OBSERVER__ = documentObserver
  documentObserver.observe(document, { childList: true })
}

async function observeOutput(stream: NodeJS.ReadableStream, record: (line: string) => void) {
  const decoder = new TextDecoder()
  const output: string[] = []
  let pending = ""
  for await (const chunk of stream) {
    const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true })
    output.push(text)
    pending += text
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ""
    lines.forEach(record)
  }
  const final = decoder.decode()
  output.push(final)
  pending += final
  if (pending) record(pending)
  return output.join("")
}

async function readService(profile: Awaited<ReturnType<typeof createColdProfile>>) {
  const value: unknown = JSON.parse(await readFile(profile.registration, "utf8"))
  if (!isServiceInfo(value)) throw new Error("Desktop service registration is invalid")
  const url = new URL(value.url)
  const port = Number(url.port)
  if (url.hostname !== "127.0.0.1" || !Number.isInteger(port) || port <= 0)
    throw new Error(`Desktop service used unexpected endpoint ${value.url}`)
  if (!value.version.startsWith("2.0.0-local-"))
    throw new Error(`Desktop service used unexpected version ${value.version}`)
  return value
}

function isServiceInfo(value: unknown): value is ServiceInfo {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "version" in value &&
    typeof value.version === "string" &&
    "url" in value &&
    typeof value.url === "string" &&
    "pid" in value &&
    typeof value.pid === "number"
  )
}

function requireMilestones(observed: Partial<Record<Milestone, number>>) {
  const get = (name: Milestone) => {
    const value = observed[name]
    if (value === undefined) throw new Error(`Desktop startup did not report milestone: ${name}`)
    return round(value)
  }
  return {
    bunRootScript: get("bunRootScript"),
    bunDesktopScript: get("bunDesktopScript"),
    desktopPrepared: get("desktopPrepared"),
    mainBundleReady: get("mainBundleReady"),
    preloadBundleReady: get("preloadBundleReady"),
    rendererDevServerReady: get("rendererDevServerReady"),
    electronSpawnStarted: get("electronSpawnStarted"),
    debugEndpointReady: get("debugEndpointReady"),
    electronStarted: get("electronStarted"),
    serviceEnsureStarted: get("serviceEnsureStarted"),
    serviceSpawnRequested: get("serviceSpawnRequested"),
    serviceReady: get("serviceReady"),
    backgroundLoadingReady: get("backgroundLoadingReady"),
    rendererViteConnected: get("rendererViteConnected"),
    rendererInitializationStarted: get("rendererInitializationStarted"),
    rendererInitializationReady: get("rendererInitializationReady"),
    windowVisible: get("windowVisible"),
    homeReady: get("homeReady"),
  }
}

function calculatePhases(value: Record<Milestone, number>): Record<Phase, number> {
  return {
    desktopPreparation: value.desktopPrepared,
    viteMainBundle: round(value.mainBundleReady - value.desktopPrepared),
    vitePreloadBundle: round(value.preloadBundleReady - value.mainBundleReady),
    rendererServerStartup: round(value.rendererDevServerReady - value.preloadBundleReady),
    electronStartup: round(value.electronStarted - value.electronSpawnStarted),
    serviceSpawnWait: round(value.serviceSpawnRequested - value.serviceEnsureStarted),
    serviceProcessStartup: round(value.serviceReady - value.serviceSpawnRequested),
    rendererStartup: round(value.homeReady - value.rendererViteConnected),
    visibleWindowToHome: round(value.homeReady - value.windowVisible),
  }
}

function statistics(values: number[]) {
  if (!values.length) throw new Error("Cannot summarize an empty benchmark")
  const sorted = values.toSorted((left, right) => left - right)
  const median = medianOf(sorted)
  return {
    min: round(sorted[0]),
    median: round(median),
    max: round(sorted.at(-1)!),
    medianAbsoluteDeviation: round(medianOf(sorted.map((value) => Math.abs(value - median)).toSorted((a, b) => a - b))),
  }
}

function medianOf(sorted: number[]) {
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2) return sorted[middle]
  return (sorted[middle - 1] + sorted[middle]) / 2
}

async function stopProcessTree(child: ChildProcess, exited: Promise<number | null>) {
  if (!child.pid) throw new Error("Desktop command has no process ID")
  if (process.platform !== "win32") return stopProcessGroup(child.pid, exited)
  if (child.exitCode !== null || (await exitsWithin(child, exited, 2_000))) return
  const kill = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
    stdio: "ignore",
  })
  await childExit(kill)
  if (await exitsWithin(child, exited, 10_000)) return
  if (!(await exitsWithin(child, exited, 5_000))) throw new Error(`Desktop command process ${child.pid} did not stop`)
}

async function stopProcessGroup(pid: number, exited: Promise<number | null>) {
  await Promise.race([exited, sleep(2_000)])
  if (!processGroupAlive(pid)) return
  process.kill(-pid, "SIGTERM")
  if (await processGroupStopsWithin(pid, 10_000)) return
  process.kill(-pid, "SIGKILL")
  if (!(await processGroupStopsWithin(pid, 5_000))) throw new Error(`Desktop command process group ${pid} did not stop`)
}

async function processGroupStopsWithin(pid: number, timeout: number) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (!processGroupAlive(pid)) return true
    await sleep(50)
  }
  return !processGroupAlive(pid)
}

function processGroupAlive(pid: number) {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

async function exitsWithin(child: ChildProcess, exited: Promise<number | null>, timeout: number) {
  if (child.exitCode !== null) return true
  const result = await Promise.race([exited.then(() => true), sleep(timeout).then(() => false)])
  return result
}

function childExit(child: ChildProcess) {
  return new Promise<number | null>((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code) => resolve(code))
  })
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

function processAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function stripAnsi(value: string) {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
}

function elapsed(started: number) {
  return round(performance.now() - started)
}

function round(value: number) {
  return Math.round(value * 100) / 100
}
