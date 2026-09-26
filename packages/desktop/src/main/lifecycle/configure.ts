import { randomUUID } from "node:crypto"
import { mkdirSync, rmSync } from "node:fs"
import { enableCompileCache } from "node:module"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { app } from "electron"
import { APP_ID, APP_NAME } from "../constants"

const testOnboarding = process.env.OPENCODE_TEST_ONBOARDING === "1"
const jsCallStackFeature = "DocumentPolicyIncludeJSCallStacksInCrashReports"

// Runs synchronously from the entry module, before Chromium is ready: command-line switches only
// take effect before ready, the single-instance lock is scoped to userData, and the early window
// needs userData to find the persisted window list and state.
export function configureApplication() {
  try {
    process.chdir(homedir())
  } catch {}
  process.env.OPENCODE_DISABLE_EMBEDDED_WEB_UI = "true"

  app.setName(APP_NAME)
  app.setAppUserModelId(APP_ID)
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")
  const features = app.commandLine.getSwitchValue("enable-features")
  app.commandLine.appendSwitch("enable-features", features ? `${jsCallStackFeature},${features}` : jsCallStackFeature)
  if (!app.isPackaged)
    app.commandLine.appendSwitch("remote-debugging-port", process.env.OPENCODE_DESKTOP_REMOTE_DEBUGGING_PORT ?? "9222")

  const testRoot = createTestRoot()
  app.setPath("userData", testRoot ? path.join(testRoot, "desktop") : path.join(app.getPath("appData"), APP_ID))
  if (testRoot) {
    app.setPath("sessionData", path.join(testRoot, "session"))
    if (testOnboarding) app.setPath("documents", path.join(testRoot, "documents"))
  }
  // V8 bytecode for the main bundle survives between launches, like the renderer's code cache.
  enableCompileCache(path.join(app.getPath("userData"), "compile-cache"))
}

export function acquireApplicationLock() {
  if (app.requestSingleInstanceLock()) return true
  app.quit()
  return false
}

function createTestRoot() {
  const root = testOnboarding
    ? path.join(tmpdir(), `opencode-onboarding-${randomUUID()}`)
    : app.isPackaged
      ? undefined
      : process.env.OPENCODE_DESKTOP_TEST_ROOT
  if (!root) return undefined
  if (testOnboarding) rmSync(root, { recursive: true, force: true })
  for (const dir of ["data", "config", "cache", "state", "desktop", "session", "documents"])
    mkdirSync(path.join(root, dir), { recursive: true })
  if (testOnboarding) process.env.OPENCODE_DB = ":memory:"
  process.env.XDG_DATA_HOME = path.join(root, "data")
  process.env.XDG_CONFIG_HOME = path.join(root, "config")
  process.env.XDG_CACHE_HOME = path.join(root, "cache")
  process.env.XDG_STATE_HOME = path.join(root, "state")
  return root
}
