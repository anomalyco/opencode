import { $ } from "bun"
import { Database } from "bun:sqlite"
import { Option, Schema } from "effect"
import { createHash } from "node:crypto"
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
} from "node:fs"
import { constants, homedir, hostname, setPriority, tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { prepareDevElectron } from "./dev-electron"
import { downloadCliToResources, windowsify } from "./utils"

type ServerSource = { type: "build" } | { type: "download"; version: string }

type DevOptions = { server: ServerSource; electron: string[] }

async function main() {
  process.env.OPENCODE_CHANNEL = "local"
  process.env.OPENCODE_VERSION ??= `2.0.0-local-${Date.now()}`
  process.env.OPENCODE_DISABLE_CHANNEL_DB = "0"
  const options = selectOptions()

  if (options.server.type === "build") process.env.OPENCODE_DESKTOP_SERVER_CHANNEL = "local"
  process.env.OPENCODE_DESKTOP_ISOLATED_SERVER ??= "1"
  cloneLockedDevProfile()
  await prepareDesktop()
  await prepareDevServer(options.server)
  await startDesktop(options.electron)
}

async function prepareDesktop() {
  await Promise.all([
    $`bun run install-electron`,
    $`bun ./script/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`,
  ])

  if (process.platform === "darwin") process.env.ELECTRON_EXEC_PATH = await prepareDevElectron()
}

function selectOptions(): DevOptions {
  const args = process.argv.slice(2)
  const build = args.indexOf("--build-server")
  const download = args.indexOf("--download-server")

  if (build >= 0 && download >= 0) {
    throw new Error("--build-server and --download-server cannot be used together")
  }

  if (download >= 0 && !args[download + 1]) throw new Error("--download-server requires a version")
  const consumed = new Set([build, download, download >= 0 ? download + 1 : -1])

  return {
    server: download >= 0 ? { type: "download", version: args[download + 1] } : { type: "build" },
    electron: args.filter((_, index) => !consumed.has(index)),
  }
}

async function prepareDevServer(source: ServerSource) {
  if (process.env.OPENCODE_DESKTOP_REUSE_SERVER !== "1") return prepareServer(source)

  if (source.type === "download") {
    return downloadCliToResources(source.version, windowsify("resources/opencode-cli-dev"))
  }

  process.env.OPENCODE_DESKTOP_CLI_DEV = join(import.meta.dirname, "../../cli")
}

async function prepareServer(source: ServerSource) {
  if (source.type === "download")
    return downloadCliToResources(source.version, windowsify("resources/opencode-cli-dev"))
  buildWebUi()
  process.env.OPENCODE_DESKTOP_CLI_DEV = join(import.meta.dirname, "../../cli")

  if (process.platform !== "win32") return
  process.env.OPENCODE_DESKTOP_WSL_CLI_BUILD = join(import.meta.dirname, "../../cli/script/build.ts")
  process.env.OPENCODE_DESKTOP_WSL_CLI_OUTPUT = join(import.meta.dirname, "../resources/opencode-cli-wsl")
}

// The source CLI serves packages/app/dist only to paired devices, and nothing on the way to the
// desktop window reads it, so it builds alongside startup instead of before it. Idle priority also
// lowers its disk and memory priority on Windows; below-normal still delayed the window by seconds.
function buildWebUi() {
  const started = performance.now()

  const build = Bun.spawn(["bun", "run", "build"], {
    cwd: join(import.meta.dirname, "../../app"),
    env: { ...process.env, VITE_OPENCODE_SERVER_MODE: "origin" },
    stdio: ["ignore", "ignore", "ignore"],
  })

  setPriority(build.pid, constants.priority.PRIORITY_LOW)
  build.unref()
  void build.exited.then((code) =>
    console.log(
      code === 0
        ? `Built the pairing web UI in ${((performance.now() - started) / 1000).toFixed(1)} s`
        : `Pairing web UI build failed with code ${code}; run 'bun run --cwd packages/app build' to see why`,
    ),
  )
}

function defaultDevUserData() {
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "ai.opencode.desktop.dev")
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "ai.opencode.desktop.dev")
  }

  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "ai.opencode.desktop.dev")
}

function isPidAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false

  try {
    process.kill(pid, 0)

    return true
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}

function isProfileLocked(userData: string) {
  if (process.platform === "win32") {
    const lockfile = join(userData, "lockfile")

    if (!existsSync(lockfile)) return false

    try {
      const fd = openSync(lockfile, "r+")
      closeSync(fd)

      return false
    } catch {
      return true
    }
  }

  // On macOS and Linux, Chromium's SingletonLock is a dangling symlink targeting `<hostname>-<pid>`.
  const singleton = join(userData, "SingletonLock")
  let target: string

  try {
    target = readlinkSync(singleton)
  } catch {
    return false
  }

  const dash = target.lastIndexOf("-")

  if (dash <= 0) return true
  const lockHost = target.slice(0, dash)
  const pid = Number(target.slice(dash + 1))

  if (lockHost && lockHost !== hostname()) return true

  return isPidAlive(pid)
}

const RegisteredServicePid = Schema.fromJsonString(Schema.Struct({ pid: Schema.Number }))

function hasLiveRegisteredService(serviceFile: string) {
  if (!existsSync(serviceFile)) return false

  try {
    const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(RegisteredServicePid)(readFileSync(serviceFile, "utf8")))

    return decoded ? isPidAlive(decoded.pid) : false
  } catch {
    return false
  }
}

// When OpenCode Dev is already running, snapshot only its small desktop profile (`drafts.sqlite` + window state)
// into a per-worktree temp userData dir while sharing the main OpenCode database (`~/.local/share/opencode`) in place.
function cloneLockedDevProfile() {
  if (process.env.OPENCODE_DESKTOP_USER_DATA || process.env.OPENCODE_DESKTOP_TEST_ROOT) return
  const sourceDir = defaultDevUserData()

  if (!isProfileLocked(sourceDir)) return
  const slug = createHash("sha1").update(import.meta.dirname).digest("hex").slice(0, 8)
  const cloneDir = join(tmpdir(), `opencode-desktop-dev-${slug}`)
  mkdirSync(cloneDir, { recursive: true })

  const sourceDb = join(sourceDir, "drafts.sqlite")
  const cloneDb = join(cloneDir, "drafts.sqlite")

  if (existsSync(sourceDb)) {
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${cloneDb}${suffix}`, { force: true })
    const db = new Database(sourceDb, { readonly: true })
    db.exec(`VACUUM INTO ${JSON.stringify(cloneDb.replaceAll("\\", "/"))}`)
    db.close()
  }

  for (const entry of readdirSync(sourceDir)) {
    if (
      entry === "opencode.settings" ||
      entry === "Local State" ||
      entry === "Preferences" ||
      entry.startsWith("window-state-")
    ) {
      copyFileSync(join(sourceDir, entry), join(cloneDir, entry))
    }
  }

  const isolatedServiceFile = join(sourceDir, "opencode", "service-local.json")

  if (hasLiveRegisteredService(isolatedServiceFile)) {
    process.env.XDG_STATE_HOME = sourceDir
    process.env.OPENCODE_DESKTOP_REUSE_SERVICE_FILE = isolatedServiceFile
  }

  process.env.OPENCODE_DESKTOP_USER_DATA = cloneDir
  process.env.OPENCODE_DESKTOP_REUSE_SERVER = "1"
  process.env.OPENCODE_DESKTOP_ISOLATED_SERVER = "0"
  process.env.OPENCODE_DESKTOP_REMOTE_DEBUGGING_PORT ??= "0"
  console.log(`OpenCode Dev is already running; cloned UI state into ${cloneDir} and reusing live background server`)
}

async function startDesktop(args: string[]) {
  // Bun's implicit spawn environment omits values set during preparation.
  process.exitCode = await Bun.spawn(
    ["node", fileURLToPath(new URL("../bin/electron-vite.js", import.meta.resolve("electron-vite"))), "dev", ...args],
    { env: process.env, stdio: ["inherit", "inherit", "inherit"] },
  ).exited
}

await main()
