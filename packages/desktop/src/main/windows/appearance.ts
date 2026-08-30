import { resolveThemeVariant } from "@opencode-ai/ui/theme/resolve"
import type { DesktopTheme } from "@opencode-ai/ui/theme/types"
import oc2ThemeJson from "../../../../ui/src/theme/themes/oc-2.json"
import { app, BrowserWindow, nativeImage, nativeTheme } from "electron"
import type { Path } from "effect"
import { type TitlebarTheme } from "../../shared/ipc-contract"
import { WindowFullscreenChanged, WindowPinchZoomChanged, WindowZoomChanged } from "../../shared/ipc-rpc/events"
import { emitIpcEvent } from "../ipc-events"
import type { DesktopPaths } from "../paths"
import { BACKGROUND_COLOR_KEY, PINCH_ZOOM_ENABLED_KEY } from "../storage/keys"
import { getStore } from "../storage/store"

const oc2Theme = oc2ThemeJson as DesktopTheme
const oc2Background = {
  light: resolveThemeVariant(oc2Theme.light, false)["background-base"],
  dark: resolveThemeVariant(oc2Theme.dark, true)["background-base"],
}
const titlebarThemes = new WeakMap<BrowserWindow, Partial<TitlebarTheme>>()
const pinchZoomEnabled = new WeakMap<BrowserWindow, boolean>()
// Match the renderer's 36px titlebar plus its former 8px content inset.
const titlebarHeight = 44
const maxZoomLevel = 10
const minZoomLevel = 0.2
let backgroundColor: string | undefined

export function windowAppearance(path: Path.Path, paths: DesktopPaths.Resolved) {
  const mode = tone()
  return {
    title: "OpenCode",
    icon: iconPath(path, paths),
    backgroundColor: getBackgroundColor() ?? oc2Background[mode],
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hidden" as const,
          trafficLightPosition: { x: 14, y: 14 },
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
      preload: paths.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  }
}

export function setDockIcon(path: Path.Path, paths: DesktopPaths.Resolved) {
  if (process.platform !== "darwin") return
  const icon = nativeImage.createFromPath(path.join(iconsDir(path, paths), "dock.png"))
  if (!icon.isEmpty()) app.dock?.setIcon(icon)
}

export function setBackgroundColor(color: string) {
  backgroundColor = color
  getStore().set(BACKGROUND_COLOR_KEY, color)
  BrowserWindow.getAllWindows().forEach((win) => {
    win.setBackgroundColor(color)
    if (process.platform === "darwin") win.invalidateShadow()
  })
}

export function getBackgroundColor() {
  const stored = getStore().get(BACKGROUND_COLOR_KEY)
  return backgroundColor ?? (typeof stored === "string" ? stored : undefined)
}

export function setTitlebar(win: BrowserWindow, theme: Partial<TitlebarTheme> = {}) {
  titlebarThemes.set(win, theme)
  // Native window controls follow nativeTheme, not the renderer theme.
  if (process.platform === "darwin" || process.platform === "win32") {
    nativeTheme.themeSource = theme.scheme ?? theme.mode ?? "system"
  }
  updateTitlebar(win)
}

export function updateTitlebar(win: BrowserWindow) {
  if (process.platform !== "win32") return
  win.setTitleBarOverlay(overlay(titlebarThemes.get(win), win.webContents.getZoomFactor()))
}

export function setPinchZoomEnabled(enabled: boolean) {
  getStore().set(PINCH_ZOOM_ENABLED_KEY, enabled)
  BrowserWindow.getAllWindows().forEach((win) => {
    pinchZoomEnabled.set(win, enabled)
    emitIpcEvent(win.webContents, new WindowPinchZoomChanged({ enabled }))
    if (!enabled && win.webContents.getZoomFactor() !== 1) win.webContents.setZoomFactor(1)
    updateZoom(win)
  })
}

export function getPinchZoomEnabled() {
  return getStore().get(PINCH_ZOOM_ENABLED_KEY) === true
}

export function wireZoom(win: BrowserWindow) {
  pinchZoomEnabled.set(win, getPinchZoomEnabled())
  win.webContents.setZoomFactor(1)
  win.webContents.on("zoom-changed", (event, direction) => {
    event.preventDefault()
    if (pinchZoomEnabled.get(win)) {
      const delta = direction === "in" ? 0.2 : -0.2
      win.webContents.setZoomFactor(clampZoom(win.webContents.getZoomFactor() + delta))
      updateZoom(win)
      return
    }
    if (win.webContents.getZoomFactor() !== 1) win.webContents.setZoomFactor(1)
    updateZoom(win)
  })
}

export function wireFullscreen(win: BrowserWindow) {
  const send = (fullscreen: boolean) => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    emitIpcEvent(win.webContents, new WindowFullscreenChanged({ fullscreen }))
  }
  win.on("enter-full-screen", () => send(true))
  win.on("leave-full-screen", () => send(false))
}

function iconsDir(path: Path.Path, paths: DesktopPaths.Resolved) {
  return app.isPackaged ? path.join(process.resourcesPath, "icons") : path.join(paths.developmentResourcesRoot, "icons")
}

function iconPath(path: Path.Path, paths: DesktopPaths.Resolved) {
  return path.join(iconsDir(path, paths), `icon.${process.platform === "win32" ? "ico" : "png"}`)
}

function tone() {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light"
}

function overlay(theme: Partial<TitlebarTheme> = {}, zoom = 1) {
  const mode = theme.mode ?? tone()
  return {
    color: "#00000000",
    symbolColor: mode === "dark" ? "white" : "black",
    height: Math.max(titlebarHeight, Math.round(titlebarHeight * zoom)),
  }
}

function clampZoom(value: number) {
  return Math.min(Math.max(value, minZoomLevel), maxZoomLevel)
}

function updateZoom(win: BrowserWindow) {
  updateTitlebar(win)
  emitIpcEvent(win.webContents, new WindowZoomChanged({ factor: win.webContents.getZoomFactor() }))
}
