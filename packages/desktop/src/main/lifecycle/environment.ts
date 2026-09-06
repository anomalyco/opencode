import { randomUUID } from "node:crypto"
import http from "node:http"
import { homedir, tmpdir } from "node:os"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import { app } from "electron"
import contextMenu from "electron-context-menu"
import { Effect, FileSystem, Path } from "effect"
import { CHANNEL } from "../constants"
import { DesktopPaths } from "../paths"
import { getUserShell, loadShellEnv, loadWindowsPath } from "../service/shell-env"
import { cleanupStoreFiles } from "../storage/cleanup"
import { registerRendererProtocol, setDockIcon } from "../windows"

const appNames: Record<string, string> = {
  dev: "OpenCode Dev",
  beta: "OpenCode Beta",
  prod: "OpenCode",
}
const appIDs: Record<string, string> = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
}
const testOnboarding = process.env.OPENCODE_TEST_ONBOARDING === "1"
const jsCallStackFeature = "DocumentPolicyIncludeJSCallStacksInCrashReports"

export const configureApplication = Effect.fn("Application.configure")(function* () {
  const path = yield* Path.Path
  contextMenu({ showSaveImageAs: true, showLookUpSelection: false, showSearchWithGoogle: false })
  try {
    process.chdir(homedir())
  } catch {}
  process.env.OPENCODE_DISABLE_EMBEDDED_WEB_UI = "true"

  const appID = app.isPackaged ? appIDs[CHANNEL] : "ai.opencode.desktop.dev"
  app.setName(app.isPackaged ? appNames[CHANNEL] : "OpenCode Dev")
  app.setAppUserModelId(appID)
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")
  const features = app.commandLine.getSwitchValue("enable-features")
  app.commandLine.appendSwitch("enable-features", features ? `${jsCallStackFeature},${features}` : jsCallStackFeature)
  if (!app.isPackaged)
    app.commandLine.appendSwitch("remote-debugging-port", process.env.OPENCODE_DESKTOP_REMOTE_DEBUGGING_PORT ?? "9222")

  const testRoot = yield* createTestRoot()
  app.setPath("userData", testRoot ? path.join(testRoot, "desktop") : path.join(app.getPath("appData"), appID))
  if (testRoot) app.setPath("sessionData", path.join(testRoot, "session"))
})

export function acquireApplicationLock() {
  if (app.requestSingleInstanceLock()) return true
  app.quit()
  return false
}

export const prepareApplicationEnvironment = Effect.gen(function* () {
  yield* loadSystemCertificates
  yield* loadProxyEnvironment
})

export const preferApplicationEnvironment = Effect.gen(function* () {
  const shellEnv: Record<string, string> | null =
    process.platform === "win32" ? yield* loadWindowsPath() : yield* loadShellEnv(getUserShell())
  yield* Effect.sync(() => {
    if (!shellEnv?.XDG_STATE_HOME) delete process.env.XDG_STATE_HOME
    Object.assign(process.env, {
      ...shellEnv,
      OPENCODE_EXPERIMENTAL_ICON_DISCOVERY: "true",
      OPENCODE_EXPERIMENTAL_FILEWATCHER: "true",
      OPENCODE_CLIENT: "desktop",
    })
  })
})

export const prepareDesktop = Effect.gen(function* () {
  const path = yield* Path.Path
  const paths = yield* DesktopPaths.resolve
  yield* cleanupStoreFiles(app.getPath("userData")).pipe(
    Effect.tap((result) =>
      result.deleted.length === 0
        ? Effect.void
        : Effect.logInfo("cleaned scoped store files", { count: result.deleted.length, scanned: result.scanned }),
    ),
    Effect.catch((error) => Effect.logWarning("failed to clean scoped store files", { error })),
  )
  if (app.isPackaged || process.env.OPENCODE_DESKTOP_DISABLE_PROTOCOL_REGISTRATION !== "1")
    app.setAsDefaultProtocolClient("opencode")
  yield* registerRendererProtocol()
  setDockIcon(path, paths)
})

export const loadProxyEnvironment = Effect.gen(function* () {
  yield* Effect.try(() => {
    ensureLoopbackNoProxy()
    // Electron 41.2 has a newer Node API than the current @types/node package.
    const proxyAwareHttp = http as typeof http & { setGlobalProxyFromEnv(): void }
    proxyAwareHttp.setGlobalProxyFromEnv()
  }).pipe(Effect.catch((error) => Effect.logWarning("failed to load proxy environment", { error })))
})

const createTestRoot = Effect.fn("Application.createTestRoot")(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = testOnboarding
    ? path.join(tmpdir(), `opencode-onboarding-${randomUUID()}`)
    : app.isPackaged
      ? undefined
      : process.env.OPENCODE_DESKTOP_TEST_ROOT
  if (!root) return undefined
  if (testOnboarding) yield* fs.remove(root, { recursive: true, force: true })
  yield* Effect.forEach(
    ["data", "config", "cache", "state", "desktop", "session"],
    (dir) => fs.makeDirectory(path.join(root, dir), { recursive: true }),
    { discard: true },
  )
  if (testOnboarding) process.env.OPENCODE_DB = ":memory:"
  process.env.XDG_DATA_HOME = path.join(root, "data")
  process.env.XDG_CONFIG_HOME = path.join(root, "config")
  process.env.XDG_CACHE_HOME = path.join(root, "cache")
  process.env.XDG_STATE_HOME = path.join(root, "state")
  return root
})

const loadSystemCertificates = Effect.try({
  try: () => {
    setDefaultCACertificates([...new Set([...getCACertificates("default"), ...getCACertificates("system")])])
  },
  catch: (error) => error,
}).pipe(Effect.catch((error) => Effect.logWarning("failed to load system certificates", { error })))

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  ;["NO_PROXY", "no_proxy"].forEach((key) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
    loopback.forEach((host) => {
      if (!items.some((value) => value.toLowerCase() === host)) items.push(host)
    })
    process.env[key] = items.join(",")
  })
}
