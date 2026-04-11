import windowState from "electron-window-state"
import { app, BrowserWindow, nativeImage, nativeTheme } from "electron"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { TitlebarTheme } from "../preload/types"

type Globals = {
  updaterEnabled: boolean
  deepLinks?: string[]
}

const root = dirname(fileURLToPath(import.meta.url))

let backgroundColor: string | undefined

export function setBackgroundColor(color: string) {
  backgroundColor = color
}

export function getBackgroundColor(): string | undefined {
  return backgroundColor
}

function back(mode = tone()) {
  return backgroundColor ?? (mode === "dark" ? "#101010" : "#f8f8f8")
}

function iconsDir() {
  return app.isPackaged ? join(process.resourcesPath, "icons") : join(root, "../../resources/icons")
}

function iconPath() {
  const ext = process.platform === "win32" ? "ico" : "png"
  return join(iconsDir(), `icon.${ext}`)
}

function tone() {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light"
}

function overlay(theme: Partial<TitlebarTheme> = {}) {
  const mode = theme.mode ?? tone()
  return {
    color: "#00000000",
    symbolColor: mode === "dark" ? "white" : "black",
    height: 40,
  }
}

export function setTitlebar(win: BrowserWindow, theme: Partial<TitlebarTheme> = {}) {
  if (process.platform !== "win32") return
  win.setTitleBarOverlay(overlay(theme))
}

export function setDockIcon() {
  if (process.platform !== "darwin") return
  const icon = nativeImage.createFromPath(join(iconsDir(), "dock.png"))
  if (!icon.isEmpty()) app.dock?.setIcon(icon)
}

export function createMainWindow(globals: Globals, opts: { show?: boolean } = {}) {
  const state = windowState({
    defaultWidth: 1280,
    defaultHeight: 800,
  })

  const mode = tone()
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    show: opts.show ?? true,
    title: "OpenCode",
    icon: iconPath(),
    backgroundColor: back(mode),
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hidden" as const,
          trafficLightPosition: { x: 12, y: 14 },
        }
      : {}),
    ...(process.platform === "win32"
      ? {
          frame: false,
          titleBarStyle: "hidden" as const,
          titleBarOverlay: overlay({ mode }),
        }
      : {}),
    webPreferences: {
      preload: join(root, "../preload/index.mjs"),
      sandbox: false,
    },
  })

  state.manage(win)
  loadWindow(win, "index.html")
  wireZoom(win)
  injectGlobals(win, globals)

  return win
}

export function createLoadingWindow(globals: Globals) {
  const mode = tone()
  const win = new BrowserWindow({
    width: 640,
    height: 480,
    resizable: false,
    center: true,
    show: false,
    frame: false,
    icon: iconPath(),
    backgroundColor: back(mode),
    webPreferences: {
      preload: join(root, "../preload/index.mjs"),
      sandbox: false,
    },
  })

  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.show()
  })

  loadSplash(win, mode)
  injectGlobals(win, globals)

  return win
}

function loadSplash(win: BrowserWindow, mode: "dark" | "light") {
  void win.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(page(mode))}`)
}

function page(mode: "dark" | "light") {
  const dark = mode === "dark"
  const bg = back(mode)
  const base = dark ? "#7e7e7e" : "#8f8f8f"
  const weak = dark ? "#343434" : "#dbdbdb"
  const strong = dark ? "#ededed" : "#171717"
  const track = dark ? "rgba(255,255,255,0.078)" : "rgba(0,0,0,0.051)"
  const warn = dark ? "#fbb73c" : "#ebb76e"
  const pulse = mark(base, strong)
  const splash = mark(weak, strong)

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenCode</title>
    <style>
      :root {
        color-scheme: ${mode};
      }

      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: ${bg};
      }

      body {
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #root {
        display: flex;
        width: 100%;
        height: 100%;
        align-items: center;
        justify-content: center;
      }

      #pulse,
      #migrate {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      #pulse[hidden],
      #migrate[hidden] {
        display: none;
      }

      #pulse svg {
        width: 64px;
        height: 80px;
        opacity: 0.5;
        animation: pulse 1.6s ease-in-out infinite;
        transform-origin: center;
      }

      #migrate {
        flex-direction: column;
        gap: 44px;
      }

      #migrate svg {
        width: 80px;
        height: 100px;
        opacity: 0.15;
      }

      #copy {
        display: flex;
        width: 240px;
        flex-direction: column;
        align-items: center;
        gap: 16px;
      }

      #status {
        width: 100%;
        overflow: hidden;
        color: ${strong};
        text-align: center;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 14px;
        line-height: 20px;
      }

      #bar {
        width: 80px;
        height: 4px;
        overflow: hidden;
        background: ${track};
      }

      #fill {
        width: 25%;
        height: 100%;
        background: ${warn};
      }

      @keyframes pulse {
        0%,
        100% {
          opacity: 0.5;
        }

        50% {
          opacity: 0.15;
        }
      }
    </style>
  </head>
  <body>
    <div id="root">
      <div id="pulse">${pulse}</div>
      <div id="migrate" hidden>
        ${splash}
        <div id="copy" aria-live="polite">
          <span id="status">Just a moment...</span>
          <div id="bar"><div id="fill"></div></div>
        </div>
      </div>
    </div>
    <script>
      ;(() => {
        const lines = ["Just a moment...", "Migrating your database", "This may take a couple of minutes"]
        const pulse = document.getElementById("pulse")
        const migrate = document.getElementById("migrate")
        const status = document.getElementById("status")
        const fill = document.getElementById("fill")
        let step = { phase: "server_waiting" }
        let line = 0
        let seen = false
        let value = 0
        let done = false

        function render() {
          const sql = step.phase === "sqlite_waiting" || (seen && step.phase === "done")
          pulse.hidden = sql
          migrate.hidden = !sql
          if (!sql) return
          status.textContent = step.phase === "done" ? "All done" : lines[line]
          fill.style.width = String(step.phase === "done" ? 100 : Math.max(25, Math.min(100, value))) + "%"
        }

        function finish() {
          if (done) return
          done = true
          window.api?.loadingWindowComplete?.()
        }

        function set(step_) {
          step = step_ || step
          render()
          if (step.phase === "done") finish()
        }

        const timers = [3000, 9000].map((ms, i) =>
          setTimeout(() => {
            line = i + 1
            render()
          }, ms),
        )

        const off = window.api?.onInitStep?.((step_) => set(step_)) ?? (() => {})
        const progress =
          window.api?.onSqliteMigrationProgress?.((next) => {
            seen = true
            if (next.type === "InProgress") {
              value = Math.max(0, Math.min(100, next.value))
              step = { phase: "sqlite_waiting" }
              render()
              return
            }
            value = 100
            step = { phase: "done" }
            render()
            finish()
          }) ?? (() => {})

        window.api?.awaitInitialization?.((step_) => set(step_))?.catch(() => undefined)

        addEventListener("beforeunload", () => {
          off()
          progress()
          timers.forEach(clearTimeout)
        })

        render()
      })()
    </script>
  </body>
</html>`
}

function mark(base: string, strong: string) {
  return `<svg viewBox="0 0 80 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M60 80H20V40H60V80Z" fill="${base}" /><path d="M60 20H20V80H60V20ZM80 100H0V0H80V100Z" fill="${strong}" /></svg>`
}

function loadWindow(win: BrowserWindow, html: string) {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    const url = new URL(html, devUrl)
    void win.loadURL(url.toString())
    return
  }

  void win.loadFile(join(root, `../renderer/${html}`))
}

function injectGlobals(win: BrowserWindow, globals: Globals) {
  win.webContents.on("dom-ready", () => {
    const deepLinks = globals.deepLinks ?? []
    const data = {
      updaterEnabled: globals.updaterEnabled,
      deepLinks: Array.isArray(deepLinks) ? deepLinks.splice(0) : deepLinks,
    }
    void win.webContents.executeJavaScript(
      `window.__OPENCODE__ = Object.assign(window.__OPENCODE__ ?? {}, ${JSON.stringify(data)})`,
    )
  })
}

function wireZoom(win: BrowserWindow) {
  win.webContents.setZoomFactor(1)
  win.webContents.on("zoom-changed", () => {
    win.webContents.setZoomFactor(1)
  })
}
