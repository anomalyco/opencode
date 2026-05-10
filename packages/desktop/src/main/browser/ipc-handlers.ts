import { BrowserWindow, ipcMain } from "electron"
import type { IpcMainEvent, Rectangle } from "electron"

import {
  attachBrowserView,
  click,
  clearBrowserData,
  clearAnnotationMarkers,
  getAnnotationData,
  getAnnotationDetail,
  getBrowserPanelState,
  getSnapshot,
  getBrowserView,
  getCurrentTitle,
  getCurrentUrl,
  dragElement,
  goBack,
  goForward,
  handleDialog,
  hideBrowserView,
  hoverElement,
  listDownloads,
  navigate,
  pressKey,
  reload,
  runBrowserCode,
  runPlaywrightCode,
  setBrowserViewBounds,
  showBrowserView,
  startInspectMode,
  storeAnnotationDetail,
  stopInspectMode,
  typeText,
  uploadFile,
} from "./BrowserManager"
import {
  activateBrowser,
  closeBrowser,
  createBrowser,
  getMultiBrowserState,
  getActiveBrowserId,
  setBrowserBounds,
} from "./MultiBrowserManager"
import { clearBrowserConsoleEntries, queryBrowserConsoleEntries } from "./console-store"
import type { BrowserAnnotationDetail, BrowserConsoleLevel, BrowserDialogAction, BrowserId, BrowserInstance } from "./types"
import { extractAnnotation } from "./annotation"

type BrowserIpcRegistration = {
  completed: boolean
}

type BrowserUploadFileParams = string | { selector: string; fileRef: string; workspaceRoot?: string; browserId?: BrowserId }
type BrowserDragParams = string | { selector: string; targetSelector: string; browserId?: BrowserId }
type BrowserDialogParams = BrowserDialogAction | { action: BrowserDialogAction; promptText?: string; browserId?: BrowserId }
type BrowserRunCodeParams = string | { code: string; browserId?: BrowserId }
type BrowserRendererInstance = Omit<BrowserInstance, "view">
type BrowserCreateParams = { url?: string; bounds?: Rectangle }
type BrowserLifecycleParams = { browserId?: BrowserId }
type BrowserConsoleMessagesParams = { browserId?: BrowserId; levels?: BrowserConsoleLevel[]; limit?: number }
type BrowserConsoleClearParams = { browserId?: BrowserId }

const browserConsoleLevels = new Set<BrowserConsoleLevel>(["log", "info", "warn", "error", "debug"])

const browserIpcRegistration = { completed: false }

function toRecord(value: unknown) {
  if (!value || typeof value !== "object") return undefined
  return value as Record<string, unknown>
}

function hasKey(record: Record<string, unknown> | undefined, key: string) {
  return Boolean(record && Object.hasOwn(record, key))
}

function getBrowserId(value: unknown, fallback?: BrowserId) {
  const record = toRecord(value)
  if (hasKey(record, "browserId") && typeof record?.browserId !== "string") throw new Error("browserId must be a string")
  if (typeof record?.browserId === "string") return record.browserId
  return fallback
}

function getRequiredBrowserId(value: unknown) {
  const browserId = getBrowserId(value)
  if (!browserId) throw new Error("browserId must be a string")
  return browserId
}

function getRequiredStringParam(value: unknown, key: string) {
  if (typeof value === "string") return value
  const record = toRecord(value)
  const result = record?.[key]
  if (typeof result === "string") return result
  throw new Error(`${key} must be a string`)
}

function getStringParam(value: unknown, key: string, fallback?: string) {
  if (typeof value === "string") return value
  const record = toRecord(value)
  const result = record?.[key]
  if (typeof result === "string") return result
  return fallback ?? ""
}

function getOptionalStringParam(value: unknown, key: string, fallback?: string) {
  const record = toRecord(value)
  if (hasKey(record, key) && record?.[key] !== undefined && typeof record[key] !== "string") throw new Error(`${key} must be a string`)
  const result = record?.[key]
  if (typeof result === "string") return result
  return fallback
}

function getOptionalObjectParam(value: unknown, key: string) {
  if (value === undefined) return undefined
  const record = toRecord(value)
  if (!record) throw new Error(`${key} must be an object`)
  return record
}

function getConsoleLevelsParam(value: unknown) {
  const record = getOptionalObjectParam(value, "console params")
  if (!hasKey(record, "levels")) return undefined
  if (!Array.isArray(record?.levels)) throw new Error("levels must be an array")
  if (!record.levels.every((level) => browserConsoleLevels.has(level as BrowserConsoleLevel))) {
    throw new Error("levels must contain valid console levels")
  }
  return record.levels as BrowserConsoleLevel[]
}

function getConsoleLimitParam(value: unknown) {
  const record = getOptionalObjectParam(value, "console params")
  if (!hasKey(record, "limit")) return undefined
  if (typeof record?.limit !== "number" || !Number.isFinite(record.limit) || record.limit <= 0) {
    throw new Error("limit must be a finite positive number")
  }
  return record.limit
}

function getConsoleBrowserId(value: unknown) {
  getOptionalObjectParam(value, "console params")
  return getBrowserId(value, getActiveBrowserId()) ?? ""
}

function getBrowserConsoleMessagesParams(value: unknown): BrowserConsoleMessagesParams & { browserId: BrowserId } {
  return {
    browserId: getConsoleBrowserId(value),
    levels: getConsoleLevelsParam(value),
    limit: getConsoleLimitParam(value),
  }
}

function getBrowserConsoleClearParams(value: unknown): BrowserConsoleClearParams & { browserId: BrowserId } {
  const record = getOptionalObjectParam(value, "console params")
  if (hasKey(record, "levels")) throw new Error("levels is not supported for browser-console-clear")
  if (hasKey(record, "limit")) throw new Error("limit is not supported for browser-console-clear")
  return { browserId: getConsoleBrowserId(value) }
}

function getDialogActionParam(value: unknown) {
  if (value === "accept" || value === "dismiss") return value
  const record = toRecord(value)
  if (record?.action === "accept" || record?.action === "dismiss") return record.action
  throw new Error("action must be accept or dismiss")
}

function getBoundsParam(value: unknown) {
  const record = toRecord(value)
  if (hasKey(record, "bounds") || hasKey(record, "browserId")) return getRectangleParam(record?.bounds, "bounds")
  return getRectangleParam(value, "bounds")
}

function getOptionalBoundsParam(value: unknown) {
  const record = toRecord(value)
  if (!hasKey(record, "bounds")) return undefined
  return getRectangleParam(record?.bounds, "bounds")
}

function getRectangleParam(value: unknown, key: string) {
  const record = toRecord(value)
  if (!record) throw new Error(`${key} must be an object`)
  const invalidKey = (["x", "y", "width", "height"] as const).find((field) => typeof record[field] !== "number")
  if (invalidKey) throw new Error(`${key}.${invalidKey} must be a number`)
  return record as unknown as Rectangle
}

function toRendererBrowserInstance(instance: BrowserInstance): BrowserRendererInstance {
  return {
    id: instance.id,
    title: instance.title,
    url: instance.url,
    bounds: instance.bounds,
    state: instance.state,
    inspectMode: instance.inspectMode,
  }
}

function getRendererMultiBrowserState() {
  const state = getMultiBrowserState()
  return {
    activeBrowserId: state.activeBrowserId,
    browsers: state.browsers.map(toRendererBrowserInstance),
  }
}

export function registerBrowserIpcHandlers(registration: BrowserIpcRegistration = browserIpcRegistration) {
  if (registration.completed) return
  registration.completed = true

  ipcMain.on("browser-attach", (event: IpcMainEvent, params?: { browserId?: BrowserId }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    attachBrowserView(win, getBrowserId(params))
  })

  ipcMain.on("browser-set-bounds", (_event: IpcMainEvent, bounds: Rectangle | { bounds: Rectangle; browserId?: BrowserId }, browserId?: BrowserId) => {
    setBrowserViewBounds(getBoundsParam(bounds), getBrowserId(bounds, browserId))
  })

  ipcMain.on("browser-show", (_event: IpcMainEvent, params?: { browserId?: BrowserId }) => showBrowserView(getBrowserId(params)))
  ipcMain.on("browser-hide", (_event: IpcMainEvent, params?: { browserId?: BrowserId }) => hideBrowserView(getBrowserId(params)))

  ipcMain.handle("browser-open", async (event, params?: { browserId?: BrowserId }) => {
    const browserId = getBrowserId(params)
    showBrowserView(browserId)
    event.sender.send("browser-open-requested")
    return {
      ...getBrowserPanelState(browserId),
      title: getCurrentTitle(browserId),
    }
  })

  ipcMain.handle("browser-navigate", async (_event, params: string | { url: string; browserId?: BrowserId }) => {
    const browserId = getBrowserId(params)
    await navigate(getRequiredStringParam(params, "url"), browserId)
    return { url: getCurrentUrl(browserId), title: getCurrentTitle(browserId) }
  })

  ipcMain.handle("browser-back", async (_event, params?: { browserId?: BrowserId }) => {
    const browserId = getBrowserId(params)
    goBack(browserId)
    return { url: getCurrentUrl(browserId), title: getCurrentTitle(browserId) }
  })

  ipcMain.handle("browser-forward", async (_event, params?: { browserId?: BrowserId }) => {
    const browserId = getBrowserId(params)
    goForward(browserId)
    return { url: getCurrentUrl(browserId), title: getCurrentTitle(browserId) }
  })

  ipcMain.handle("browser-reload", async (_event, params?: { browserId?: BrowserId }) => {
    reload(getBrowserId(params))
  })

  ipcMain.handle("browser-clear-data", async () => {
    await clearBrowserData()
  })

  ipcMain.handle("browser-state", (_event, params?: { browserId?: BrowserId }) => ({
    ...getBrowserPanelState(getBrowserId(params)),
    title: getCurrentTitle(getBrowserId(params)),
  }))

  ipcMain.handle("browser-screenshot", async (_event, params?: { browserId?: BrowserId }) => {
    const view = getBrowserView(getBrowserId(params))
    if (!view) return null
    const image = await view.webContents.capturePage()
    return image.toPNG().toString("base64")
  })

  ipcMain.handle("browser-inspect-start", async (_event, params?: { browserId?: BrowserId }) => startInspectMode(getBrowserId(params)))
  ipcMain.handle("browser-inspect-stop", async (_event, params?: { browserId?: BrowserId }) => {
    await stopInspectMode(getBrowserId(params))
  })
  ipcMain.handle("browser-annotation-markers-clear", async (_event, params?: { browserId?: BrowserId }) => {
    await clearAnnotationMarkers(getBrowserId(params))
  })

  ipcMain.handle("browser-click", async (_event, params: string | { selector: string; browserId?: BrowserId }) => {
    await click(getRequiredStringParam(params, "selector"), getBrowserId(params))
  })

  ipcMain.handle("browser-hover", async (_event, params: string | { selector: string; browserId?: BrowserId }) => {
    return await hoverElement(getRequiredStringParam(params, "selector"), getBrowserId(params))
  })

  ipcMain.handle("browser-drag", async (_event, params: BrowserDragParams, targetSelector?: string) => {
    return await dragElement(
      getRequiredStringParam(params, "selector"),
      typeof params === "string" ? getRequiredStringParam(targetSelector, "targetSelector") : getRequiredStringParam(params, "targetSelector"),
      getBrowserId(params),
    )
  })

  ipcMain.handle("browser-handle-dialog", async (_event, params: BrowserDialogParams, promptText?: string, browserId?: BrowserId) => {
    return await handleDialog(
      getDialogActionParam(params),
      typeof params === "string" ? promptText : getOptionalStringParam(params, "promptText"),
      getBrowserId(params, browserId),
    )
  })

  ipcMain.handle("browser-run-code", async (_event, params: BrowserRunCodeParams, browserId?: BrowserId) => {
    return await runBrowserCode(getRequiredStringParam(params, "code"), getBrowserId(params, browserId))
  })

  ipcMain.handle("browser-run-playwright-code", async (_event, params: BrowserRunCodeParams, browserId?: BrowserId) => {
    return await runPlaywrightCode(getRequiredStringParam(params, "code"), getBrowserId(params, browserId))
  })

  ipcMain.handle("browser-type", async (_event, params: string | { selector: string; text: string; browserId?: BrowserId }, text?: string) => {
    await typeText(getRequiredStringParam(params, "selector"), typeof params === "string" ? text ?? "" : getRequiredStringParam(params, "text"), getBrowserId(params))
  })

  ipcMain.handle("browser-press", async (_event, params: string | { key: string; browserId?: BrowserId }) => {
    await pressKey(getRequiredStringParam(params, "key"), getBrowserId(params))
  })

  ipcMain.handle(
    "browser-upload-file",
    async (_event, params: BrowserUploadFileParams, fileRef?: string, workspaceRoot?: string, browserId?: BrowserId) => {
      await uploadFile(
        getRequiredStringParam(params, "selector"),
        typeof params === "string" ? fileRef ?? "" : getRequiredStringParam(params, "fileRef"),
        getOptionalStringParam(params, "workspaceRoot", workspaceRoot),
        getBrowserId(params, browserId),
      )
    },
  )

  ipcMain.handle("browser-downloads-list", async () => listDownloads())
  ipcMain.handle("browser-annotation-get-detail", async (_event, id: string) => getAnnotationDetail(id))

  ipcMain.handle("browser-inspect", async (_event, params?: string | { selector?: string; browserId?: BrowserId }) => {
    const selector = getStringParam(params, "selector")
    if (selector && !getBrowserId(params)) return extractAnnotation(selector)
    if (selector) return getAnnotationData(selector, getBrowserId(params))
    return getSnapshot(getBrowserId(params))
  })

  ipcMain.handle("browser-get-snapshot", async (_event, params?: { browserId?: BrowserId }) => getSnapshot(getBrowserId(params)))
  ipcMain.handle("browser-get-annotation-data", async (_event, params: string | { selector: string; browserId?: BrowserId }) => {
    const selector = getRequiredStringParam(params, "selector")
    if (!getBrowserId(params)) return extractAnnotation(selector)
    return getAnnotationData(selector, getBrowserId(params))
  })
  ipcMain.handle("browser-store-annotation-detail", async (_event, id: string, detail: BrowserAnnotationDetail) => {
    await storeAnnotationDetail(id, detail)
  })

  ipcMain.handle("browser-console-messages", async (_event, params?: BrowserConsoleMessagesParams) => queryBrowserConsoleEntries(getBrowserConsoleMessagesParams(params)))

  ipcMain.handle("browser-console-clear", async (_event, params?: BrowserConsoleClearParams) => {
    const result = getBrowserConsoleClearParams(params)
    return {
      browserId: result.browserId,
      count: clearBrowserConsoleEntries(result.browserId),
    }
  })

  ipcMain.handle("browser-create", async (event, params?: BrowserCreateParams) => {
    const bounds = getOptionalBoundsParam(params)
    const browserId = createBrowser(BrowserWindow.fromWebContents(event.sender) ?? undefined)
    if (bounds) {
      setBrowserBounds(browserId, bounds)
      setBrowserViewBounds(bounds, browserId)
    }
    const url = getOptionalStringParam(params, "url")
    if (url) await navigate(url, browserId)
    const state = getRendererMultiBrowserState()
    const panelState = getBrowserPanelState(browserId)
    return {
      browser: {
        id: browserId,
        title: getCurrentTitle(browserId),
        url: getCurrentUrl(browserId),
        bounds: bounds ?? { x: 0, y: 0, width: 0, height: 0 },
        state: panelState,
        inspectMode: panelState.inspectMode,
      },
      state,
    }
  })

  ipcMain.handle("browser-list", async () => getRendererMultiBrowserState())

  ipcMain.handle("browser-activate", async (_event, params: BrowserLifecycleParams) => {
    const browserId = getRequiredBrowserId(params)
    return {
      success: Boolean(activateBrowser(browserId)),
      state: getRendererMultiBrowserState(),
    }
  })

  ipcMain.handle("browser-close", async (_event, params: BrowserLifecycleParams) => {
    const browserId = getRequiredBrowserId(params)
    return {
      success: Boolean(closeBrowser(browserId)),
      state: getRendererMultiBrowserState(),
    }
  })
}
