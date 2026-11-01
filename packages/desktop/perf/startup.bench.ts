import { app, bench, command, type LaunchContext, type Milestone } from "@hona/strobe-bench"
import { Service } from "@opencode/client/service"
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"

// Home with no projects: what a returning user waits for.
const home = '[data-action="home-new-session"], [data-action="home-add-project-row"]'

// A first launch opens a draft session for the onboarding project instead.
const composer = '[data-component="composer-editor"][contenteditable="true"]'

// The main process writes epoch marks into its log (src/main/lifecycle/marks.ts): the time is the
// mark, not when the line was written. Log lines without a mark are timed when strobe reads them.
const log = "AppData/Roaming/*/logs/*/main.log"

const mark = (key: string): Milestone => ({ match: new RegExp(`\\b${key}: (?<at>\\d{13})`), in: log })

const packaged = {
  entry: mark("entry"),
  electron: mark("ready"),
  window: mark("window"),
  served: mark("served"),
  bundle: mark("bundle"),
  logging: mark("logging"),
  storage: mark("storage"),
  init: mark("init"),
  layers: mark("layers"),
  visible: { match: /shownAt: (?<at>\d{13})/, in: log },
  "service.starting": { match: "v2 CLI background service starting", in: log },
  "service.ready": { match: "v2 CLI background service ready", in: log },
}

// The dev command prints every step of a cold start.
const dev = {
  "script.root": { match: "$ bun --cwd packages/desktop dev" },
  "script.desktop": { match: "$ bun run script/dev.ts" },
  prepared: { match: "Copied dev icons from" },
  "bundle.main": { match: "electron main process built successfully" },
  "bundle.preload": { match: "electron preload scripts built successfully" },
  "renderer.server": { match: "dev server running for the electron renderer process at:" },
  "electron.spawn": { match: "starting electron app..." },
  endpoint: { match: "DevTools listening on ws://" },
  electron: { match: "app starting" },
  layers: { match: "layers ready" },
  visible: { match: "main window visible" },
  "service.ensure": { match: "starting v2 background service" },
  "service.starting": { match: "v2 CLI background service starting" },
  "service.ready": { match: "v2 CLI background service ready" },
  "renderer.connected": { match: "[vite] connected." },
} satisfies Record<string, Milestone>

export default bench({
  targets: {
    // The installed app by its strobe.json profile. Compare two packaged builds with
    // `--base exe:<path> --head exe:<path>`, or channels with `--base app:opencode-beta`.
    desktop: app("opencode"),
    // A contributor's `bun dev:desktop` in each variant's checkout, isolated under the launch's home.
    dev: command("bun dev:desktop", {
      unset: ["OPENCODE_*", "OTEL_*", "SENTRY_*"],
      env: {
        OPENCODE_CONFIG_DIR: "{home}/config",
        OPENCODE_DB: "{home}/data/opencode.db",
        OPENCODE_TEST_HOME: "{home}/home",
        OPENCODE_TEST_ONBOARDING: "0",
        OPENCODE_DESKTOP_TEST_ROOT: "{home}",
        OPENCODE_DESKTOP_REMOTE_DEBUGGING_PORT: "0",
        OPENCODE_DESKTOP_DISABLE_PROTOCOL_REGISTRATION: "1",
        // The test root moves XDG_CACHE_HOME, which would make every start transpile the source CLI
        // from scratch; a contributor's dev start reuses Bun's own cache.
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH ?? bunTranspilerCache(),
      },
    }),
  },
  cases: {
    // A returning user: the profile and its caches are there, and the background service already runs.
    "launch to Home": {
      primary: "launch.ready",
      targets: ["desktop"],
      launch: {
        until: home,
        milestones: packaged,
        profile: "warm",
        inspect: true,
        async before(ctx) {
          skipOnboarding(ctx)
          await warmService(ctx)
        },
      },
    },
    // A returning user with an open tab: the discarded first launch ran onboarding, which opened a
    // draft session; every later launch restores it.
    "launch to a restored tab": {
      primary: "launch.ready",
      targets: ["desktop"],
      launch: { until: composer, milestones: packaged, profile: "warm", before: warmService },
    },
    // After a restart: the profile is there, the app starts its service itself.
    "launch to Home, service stopped": {
      primary: "launch.ready",
      targets: ["desktop"],
      launch: { until: home, milestones: packaged, profile: "warm", before: skipOnboarding },
    },
    // Right after an install: no profile, and onboarding opens a draft session.
    "first launch": {
      primary: "launch.ready",
      targets: ["desktop"],
      launch: { until: composer, milestones: packaged },
    },
    // `bun dev:desktop` with Vite's caches and the built output deleted.
    "dev start to Home": {
      primary: "launch.ready",
      targets: ["dev"],
      launch: {
        until: '[data-action="home-add-project-row"]',
        milestones: dev,
        timeout: 600_000,
        before(ctx) {
          for (const path of ["packages/desktop/node_modules/.vite", "packages/desktop/out"])
            rmSync(join(ctx.root, path), { recursive: true, force: true })
          const root = ctx.home!

          for (const dir of ["data", "config", "cache", "state", "desktop", "session", "home"])
            mkdirSync(join(root, dir), { recursive: true })
          writeFileSync(
            join(root, "desktop", "opencode.settings"),
            JSON.stringify({ firstLaunchOnboardingComplete: true }),
          )
          writeFileSync(join(root, "desktop", "opencode.global.dat"), JSON.stringify({ language: '{"locale":"en"}' }))
          devHome = root
        },
      },
    },
  },
  // The dev app's service runs detached from the command: stop it before strobe removes the home
  // that holds its registration.
  async teardown() {
    if (!devHome) return
    await Service.stop({ file: join(devHome, "desktop", "opencode", "service-local.json") })
    devHome = undefined
  },
})

let devHome: string | undefined

// The app's settings file, under its channel's data folder in the launch's home.
function skipOnboarding(ctx: LaunchContext<unknown>) {
  const name = basename(ctx.exe!, ".exe")

  const id = /beta/i.test(name)
    ? "ai.opencode.desktop.beta"
    : /dev/i.test(name)
      ? "ai.opencode.desktop.dev"
      : "ai.opencode.desktop"

  const file = join(ctx.home!, "AppData", "Roaming", id, "opencode.settings")
  const settings = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}

  if (settings.firstLaunchOnboardingComplete) return
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ ...settings, firstLaunchOnboardingComplete: true }))
}

// One service per warm home, started from the CLI bundled with the launched executable (the app
// restarts a service whose version differs), with the app's own environment. It outlives each
// launch and ends with the runner.
const services = new Map<string, number>()

async function warmService(ctx: LaunchContext<unknown>) {
  const registration = join(ctx.home!, ".local", "state", "opencode", "service.json")

  if (await answers(registration)) return

  const resources =
    process.platform === "darwin" ? join(dirname(ctx.exe!), "..", "Resources") : join(dirname(ctx.exe!), "resources")

  const cli = join(resources, process.platform === "win32" ? "opencode-cli.exe" : "opencode-cli")
  const child = spawn(cli, ["serve", "--service"], { env: ctx.env!, detached: true, stdio: "ignore" })
  child.unref()

  if (child.pid) services.set(ctx.home!, child.pid)
  const deadline = Date.now() + 60_000

  while (Date.now() < deadline) {
    if (await answers(registration)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`the service from ${cli} did not answer in 60 s`)
}

async function answers(registration: string) {
  if (!existsSync(registration)) return false
  // The service's registration file: where it listens once it is up.
  const service: { url?: string } = JSON.parse(readFileSync(registration, "utf8"))

  if (!service.url) return false

  return fetch(`${service.url}/api/info`)
    .then((response) => response.status < 500)
    .catch(() => false)
}

process.on("exit", () => {
  for (const pid of services.values()) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" })
    else process.kill(pid)
  }
})

// Bun's default location for its runtime transpiler cache.
function bunTranspilerCache() {
  if (process.env.XDG_CACHE_HOME) return join(process.env.XDG_CACHE_HOME, "bun", "@t@")

  if (process.platform === "darwin") return join(process.env.HOME ?? "", "Library", "Caches", "bun", "@t@")

  return join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".bun", "install", "cache", "@t@")
}
