import { randomUUID } from "node:crypto"
import { mkdirSync, rmSync } from "node:fs"
import { enableCompileCache } from "node:module"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { app } from "electron"
import { debugBuild, memoryLogInterval } from "@opencode/gui-plugins/debug/options"
import { APP_ID, APP_NAME, CHANNEL } from "../constants"
import { remoteDebuggingPort } from "../diagnostics/options"
import { testRootDirectories } from "../service/registration"
import { lockHeld } from "./instance-lock"

const testOnboarding = process.env.OPENCODE_TEST_ONBOARDING === "1"

/** The folder this launch keeps its profile and XDG directories under, when it runs apart from the real home. */
export const testRoot = testOnboarding
  ? path.join(tmpdir(), `opencode-onboarding-${randomUUID()}`)
  : process.env.OPENCODE_DESKTOP_TEST_ROOT || undefined

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

  // Chromium animates each mouse-wheel notch on Linux; native Linux apps scroll by the full delta immediately.
  if (process.platform === "linux") app.commandLine.appendSwitch("disable-smooth-scrolling")

  const build = { packaged: app.isPackaged, channel: CHANNEL }
  const debugPort = remoteDebuggingPort(build, process.env.OPENCODE_DESKTOP_REMOTE_DEBUGGING_PORT)

  if (debugPort) app.commandLine.appendSwitch("remote-debugging-port", debugPort)

  if (app.commandLine.hasSwitch("remote-debugging-port"))
    app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1")

  // Precise heap sizes need a launch switch. The debug bar's toggle starts the log without one.
  if (debugBuild(build) && memoryLogInterval(process.env.OPENCODE_DESKTOP_MEMORY_LOG) !== undefined)
    app.commandLine.appendSwitch("enable-precise-memory-info")

  if (testRoot) createTestRoot(testRoot)
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
  const held = lockHeld({ packaged: app.isPackaged }, app.getPath("userData"))

  if (held.type === "handover") {
    app.quit()

    return false
  }

  // A terminal's stderr is written asynchronously on Windows, so the exit waits for the sentence to be out.
  process.stderr.write(`${held.message}\n`, () => app.exit(1))

  return false
}

function createTestRoot(root: string) {
  if (testOnboarding) rmSync(root, { recursive: true, force: true })

  for (const dir of ["data", "config", "cache", "state", "desktop", "session", "documents"])
    mkdirSync(path.join(root, dir), { recursive: true })

  if (testOnboarding) process.env.OPENCODE_DB = ":memory:"

  Object.assign(process.env, testRootDirectories(root))
}
