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
  app.dock?.setIcon(nativeImage.createFromPath(join(iconsDir(), "128x128@2x.png")))
}

export function createMainWindow(globals: Globals) {
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
    show: true,
    title: "OpenCode",
    icon: iconPath(),
    backgroundColor,
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
    show: true,
    icon: iconPath(),
    backgroundColor,
    ...(process.platform === "darwin" ? { titleBarStyle: "hidden" as const } : {}),
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

  loadWindow(win, "loading.html")
  injectGlobals(win, globals)

  return win
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
