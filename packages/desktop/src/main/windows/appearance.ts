import { resolveThemeVariant } from "@opencode-ai/ui/theme/resolve"
import type { DesktopTheme } from "@opencode-ai/ui/theme/types"
import oc2ThemeJson from "../../../../ui/src/theme/themes/oc-2.json"
import { app, BrowserWindow, nativeImage, nativeTheme } from "electron"
import { join } from "node:path"
import { Ipc, sendIpcEvent, type TitlebarTheme } from "../../shared/ipc-contract"
import { developmentResourcesRoot, preloadPath } from "../paths"
import { PINCH_ZOOM_ENABLED_KEY } from "../storage/keys"
import { getStore } from "../storage/store"

const oc2Theme = oc2ThemeJson as DesktopTheme
const oc2Background = {
  light: resolveThemeVariant(oc2Theme.light, false)["background-base"],
  dark: resolveThemeVariant(oc2Theme.dark, true)["background-base"],
}
const titlebarThemes = new WeakMap<BrowserWindow, Partial<TitlebarTheme>>()
const pinchZoomEnabled = new WeakMap<BrowserWindow, boolean>()
const titlebarHeight = 40
const maxZoomLevel = 10
const minZoomLevel = 0.2
let backgroundColor: string | undefined

export function windowAppearance() {
  const mode = tone()
  return {
    title: "OpenCode",
    icon: iconPath(),
    backgroundColor: backgroundColor ?? oc2Background[mode],
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
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  }
}

export function setDockIcon() {
  if (process.platform !== "darwin") return
  const icon = nativeImage.createFromPath(join(iconsDir(), "dock.png"))
  if (!icon.isEmpty()) app.dock?.setIcon(icon)
}

export function setBackgroundColor(color: string) {
  backgroundColor = color
  BrowserWindow.getAllWindows().forEach((win) => {
    win.setBackgroundColor(color)
    if (process.platform === "darwin") win.invalidateShadow()
  })
}

export function getBackgroundColor() {
  return backgroundColor
}

export function setTitlebar(win: BrowserWindow, theme: Partial<TitlebarTheme> = {}) {
  titlebarThemes.set(win, theme)
  // The macOS frame follows nativeTheme, not the renderer theme.
  if (process.platform === "darwin") nativeTheme.themeSource = theme.scheme ?? theme.mode ?? "system"
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
    sendIpcEvent(win.webContents, Ipc.window.pinchZoomEnabledChanged, enabled)
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
    sendIpcEvent(win.webContents, Ipc.window.fullscreenChanged, fullscreen)
  }
  win.on("enter-full-screen", () => send(true))
  win.on("leave-full-screen", () => send(false))
}

function iconsDir() {
  return app.isPackaged ? join(process.resourcesPath, "icons") : join(developmentResourcesRoot, "icons")
}

function iconPath() {
  return join(iconsDir(), `icon.${process.platform === "win32" ? "ico" : "png"}`)
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
  sendIpcEvent(win.webContents, Ipc.window.zoomFactorChanged, win.webContents.getZoomFactor())
}
