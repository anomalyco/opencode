import { app, nativeTheme } from "electron"
import { execFile, spawn } from "node:child_process"
import { isColorSchemeSignal, nextRetry, parsePortalColorScheme, resolveThemeSource } from "./theme-source"

type Scheme = "light" | "dark"

let portalScheme: Scheme | null = null

let currentScheme: "system" | Scheme | undefined

let monitor: ReturnType<typeof spawn> | undefined

let quickExits = 0

let quitting = false

let quitHandled = false

// Chromium only reads the Linux appearance at startup, so live `color-scheme` changes from the XDG
// portal never reach `nativeTheme`. Resolve the portal ourselves and apply it while the app setting
// is "system". See anomalyco/opencode#61925.
export function startThemeSource() {
  if (process.platform !== "linux" || monitor || quitting) return

  if (!quitHandled) {
    quitHandled = true
    app.once("will-quit", () => {
      quitting = true
      monitor?.kill()
      monitor = undefined
    })
  }

  void readPortalColorScheme().then(applyPortalScheme)
  watchPortal()
}

export function applyThemeSource(scheme: "system" | Scheme | undefined) {
  currentScheme = scheme
  nativeTheme.themeSource = resolveThemeSource(scheme, portalScheme)
}

// Applying "no preference" (null) as well keeps the source in sync when the portal resets.
function applyPortalScheme(scheme: Scheme | null) {
  portalScheme = scheme
  applyThemeSource(currentScheme)
}

// Event-driven: one long-lived monitor instead of a poll. A missing gdbus only disables live
// updates; the source stays "system", which is the previous behavior.
function watchPortal() {
  const startedAt = Date.now()

  const child = spawn(
    "gdbus",
    ["monitor", "--session", "--dest", "org.freedesktop.portal.Desktop", "--object-path", "/org/freedesktop/portal/desktop"],
    { stdio: ["ignore", "pipe", "ignore"] },
  )

  monitor = child

  let buffered = ""

  child.stdout?.setEncoding("utf8")
  child.stdout?.on("data", (chunk: string) => {
    const lines = (buffered + chunk).split("\n")

    buffered = lines.pop() ?? ""

    for (const line of lines) {
      if (!isColorSchemeSignal(line)) continue

      applyPortalScheme(parsePortalColorScheme(line))
    }
  })
  child.on("error", () => {
    monitor = undefined
  })
  child.on("exit", () => {
    monitor = undefined

    if (quitting) return

    const retry = nextRetry(quickExits, Date.now() - startedAt)

    quickExits = retry.quickExits

    if (retry.delayMs === null) return

    setTimeout(() => startThemeSource(), retry.delayMs).unref()
  })
}

function readPortalColorScheme(): Promise<Scheme | null> {
  return new Promise((resolve) => {
    execFile(
      "gdbus",
      [
        "call",
        "--session",
        "--dest",
        "org.freedesktop.portal.Desktop",
        "--object-path",
        "/org/freedesktop/portal/desktop",
        "--method",
        "org.freedesktop.portal.Settings.ReadOne",
        "org.freedesktop.appearance",
        "color-scheme",
      ],
      { timeout: 3000 },
      (error, stdout) => resolve(error ? null : parsePortalColorScheme(stdout)),
    )
  })
}
