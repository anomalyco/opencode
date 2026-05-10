import { WebContentsView } from "electron"
import type { BrowserWindow, Rectangle } from "electron"

import { redactSensitiveBrowserUrl } from "../logging"
import { addBrowserConsoleEntry, clearBrowserConsoleEntries, mapElectronConsoleLevel } from "./console-store"
import type { BrowserId, BrowserInstance, BrowserPanelState, MultiBrowserState } from "./types"

export const BROWSER_PARTITION = "persist:opencode-browser"

const initialBounds: Rectangle = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
}

const initialState: BrowserPanelState = {
  visible: false,
  url: "",
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  inspectMode: false,
}

const browsers = new Map<BrowserId, BrowserInstance>()
const browserWindows = new Map<BrowserId, BrowserWindow>()
let activeBrowserId: BrowserId | undefined

export function generateBrowserId(): BrowserId {
  return `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function getActiveBrowserId() {
  return activeBrowserId
}

export function getBrowser(id: BrowserId) {
  return browsers.get(id)
}

export function getActiveBrowser() {
  if (!activeBrowserId) return undefined
  return browsers.get(activeBrowserId)
}

export function getAllBrowsers() {
  return Array.from(browsers.values())
}

export function getMultiBrowserState(): MultiBrowserState {
  return {
    activeBrowserId,
    browsers: getAllBrowsers(),
  }
}

export function getBrowserState(id: BrowserId) {
  return browsers.get(id)?.state
}

function syncBrowserState(id: BrowserId) {
  const instance = browsers.get(id)
  if (!instance) return

  instance.title = instance.view.webContents.getTitle()
  instance.url = instance.view.webContents.getURL()
  instance.state = {
    ...instance.state,
    url: instance.url,
    canGoBack: instance.view.webContents.canGoBack(),
    canGoForward: instance.view.webContents.canGoForward(),
    isLoading: instance.view.webContents.isLoading(),
    inspectMode: instance.inspectMode,
  }
}

function detachBrowserView(id: BrowserId) {
  const win = browserWindows.get(id)
  const instance = browsers.get(id)
  if (instance?.view.webContents.isDestroyed()) return
  if (!win || !instance || !win.contentView.children.includes(instance.view)) return
  win.contentView.removeChildView(instance.view)
}

function attachBrowserView(id: BrowserId, win?: BrowserWindow) {
  const instance = browsers.get(id)
  if (!instance || !win) return
  browserWindows.set(id, win)
  if (!win.contentView.children.includes(instance.view)) {
    win.contentView.addChildView(instance.view)
  }
  instance.view.setBounds(instance.bounds)
  instance.view.setVisible(instance.state.visible)
}

function selectNextActiveBrowser(closedId: BrowserId) {
  if (activeBrowserId !== closedId) return
  activeBrowserId = browsers.keys().next().value
}

function cleanupBrowser(id: BrowserId) {
  detachBrowserView(id)
  browsers.delete(id)
  browserWindows.delete(id)
  clearBrowserConsoleEntries(id)
  selectNextActiveBrowser(id)
}

export function createBrowser(win?: BrowserWindow) {
  const id = generateBrowserId()
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: BROWSER_PARTITION,
      sandbox: true,
    },
  })

  browsers.set(id, {
    id,
    view,
    title: "",
    url: "",
    bounds: { ...initialBounds },
    state: { ...initialState },
    inspectMode: false,
  })
  activeBrowserId = id
  attachBrowserView(id, win)

  view.webContents.on("destroyed", () => {
    cleanupBrowser(id)
  })
  view.webContents.on("console-message", (_event, level, message, line, source) => {
    addBrowserConsoleEntry({
      browserId: id,
      level: mapElectronConsoleLevel(level),
      line: typeof line === "number" ? line : null,
      message: String(message ?? ""),
      source: String(source ?? "console"),
    })
  })
  view.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame === false || errorCode === -3) return
    addBrowserConsoleEntry({
      browserId: id,
      level: "error",
      line: null,
      message: `Failed to load ${redactSensitiveBrowserUrl(String(validatedURL ?? ""))}: ${errorDescription} (${errorCode})`,
      source: "did-fail-load",
    })
  })
  view.webContents.on("did-navigate", () => syncBrowserState(id))
  view.webContents.on("did-navigate-in-page", () => syncBrowserState(id))
  view.webContents.on("page-title-updated", () => syncBrowserState(id))
  view.webContents.on("did-start-loading", () => syncBrowserState(id))
  view.webContents.on("did-stop-loading", () => syncBrowserState(id))

  return id
}

export function activateBrowser(id: BrowserId) {
  const instance = browsers.get(id)
  if (!instance) return undefined
  activeBrowserId = id
  hideAllExcept(id)
  syncBrowserState(id)
  return instance
}

export function closeBrowser(id: BrowserId) {
  const instance = browsers.get(id)
  if (!instance) return false

  instance.state.visible = false
  instance.view.setVisible(false)

  if (instance.view.webContents.isDestroyed()) {
    cleanupBrowser(id)
    return true
  }

  instance.view.webContents.close()
  return true
}

export function setBrowserBounds(id: BrowserId, bounds: Rectangle) {
  const instance = browsers.get(id)
  if (!instance) return false
  instance.bounds = bounds
  instance.view.setBounds(bounds)
  return true
}

export function showBrowser(id: BrowserId) {
  const instance = browsers.get(id)
  if (!instance) return false
  instance.state.visible = true
  instance.view.setVisible(true)
  return true
}

export function hideBrowser(id: BrowserId) {
  const instance = browsers.get(id)
  if (!instance) return false
  instance.state.visible = false
  instance.view.setVisible(false)
  return true
}

export function hideAllExcept(id: BrowserId) {
  browsers.forEach((instance, browserId) => {
    if (browserId === id) return
    instance.state.visible = false
    instance.view.setVisible(false)
  })
}
