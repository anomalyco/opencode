import { mkdirSync, readdirSync, realpathSync, statSync } from "node:fs"
import { basename, isAbsolute, join, relative, resolve } from "node:path"

import { app, session } from "electron"
import type { BrowserWindow, Rectangle } from "electron"

import type {
  BrowserAnnotationData,
  BrowserAnnotationDetail,
  BrowserDialogAction,
  BrowserDialogResult,
  BrowserId,
  BrowserDownload,
  BrowserInspectResult,
  BrowserInstance,
  BrowserPanelState,
  BrowserRunCodeResult,
  BrowserScreenshot,
  BrowserSnapshot,
} from "./types"
import { browserDomLimits, sanitizeBrowserAnnotationData, sanitizeBrowserInspectResult, sanitizeBrowserSnapshot } from "./annotation"
import {
  BROWSER_PARTITION,
  createBrowser,
  getActiveBrowser,
  getBrowser,
  hideBrowser,
  setBrowserBounds,
  showBrowser,
} from "./MultiBrowserManager"
import { attachAndShow } from "./bounds-sync"

export { BROWSER_PARTITION, generateBrowserId } from "./MultiBrowserManager"

const initialBounds: Rectangle = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
}

let browserWindow: BrowserWindow | null = null
let browserBounds = initialBounds
let browserVisible = false
let browserWindowClosedListener: (() => void) | null = null
let browserSessionConfigured = false
const annotationDetails = new Map<string, BrowserAnnotationDetail>()
const runCodeResultLimitBytes = 10 * 1024
const runCodeTimeoutMs = 30_000

const safeAttributeNames = [
  "alt",
  "data-testid",
  "href",
  "id",
  "name",
  "placeholder",
  "role",
  "title",
  "type",
  "value",
]

const safeAttributePrefixes = ["aria-"]

function getBrowserSession() {
  const browserSession = session.fromPartition(BROWSER_PARTITION)
  if (browserSessionConfigured) return browserSession

  mkdirSync(getBrowserDownloadsDirectory(), { recursive: true })
  browserSession.on("will-download", (_event, item) => {
    item.setSavePath(join(getBrowserDownloadsDirectory(), basename(item.getFilename())))
  })
  browserSessionConfigured = true

  return browserSession
}

function getBrowserDownloadsDirectory() {
  return join(app.getPath("userData"), "browser-downloads")
}

function isAttachedToWindow(win: BrowserWindow, view: BrowserInstance["view"]) {
  return win.contentView.children.includes(view)
}

function setBrowserWindow(win: BrowserWindow | null) {
  if (browserWindow && browserWindowClosedListener) {
    browserWindow.off("closed", browserWindowClosedListener)
  }

  browserWindow = win
  browserWindowClosedListener = null

  if (!win) return

  browserWindowClosedListener = () => {
    if (browserWindow !== win) return
    browserWindow = null
    browserWindowClosedListener = null
  }

  win.on("closed", browserWindowClosedListener)
}

function getOrCreateBrowser(browserId?: BrowserId) {
  if (browserId) return getBrowser(browserId)
  const activeBrowser = getActiveBrowser()
  if (activeBrowser) return activeBrowser
  const id = createBrowser(browserWindow ?? undefined)
  const browser = getBrowser(id)
  if (!browser) return undefined
  browser.bounds = browserBounds
  browser.state.visible = browserVisible
  browser.view.setBounds(browserBounds)
  browser.view.setVisible(browserVisible)
  return browser
}

function evaluateInBrowser<T>(script: string, browserId?: BrowserId) {
  return getOrCreateBrowser(browserId)?.view.webContents.executeJavaScript(script) as Promise<T>
}

function getBrowserForRunCode(browserId?: BrowserId) {
  if (browserId) return getBrowser(browserId)
  return getActiveBrowser()
}

function getExistingBrowser(browserId?: BrowserId) {
  if (browserId) return getBrowser(browserId)
  return getActiveBrowser()
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function normalizeJsonValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === undefined) return null
  if (typeof value === "function") return "[Function]"
  if (typeof value === "bigint") return `${value}n`
  if (typeof value === "symbol") return String(value)
  if (!value || typeof value !== "object") return value
  if (seen.has(value)) return "[Circular]"

  seen.add(value)

  if (Array.isArray(value)) {
    const result = value.map((item) => normalizeJsonValue(item, seen))
    seen.delete(value)
    return result
  }

  if (value instanceof Error) {
    const result = { name: value.name, message: value.message }
    seen.delete(value)
    return result
  }

  const result = Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeJsonValue(entry, seen)]))
  seen.delete(value)
  return result
}

function toJsonSafeValue(value: unknown) {
  try {
    return normalizeJsonValue(value)
  } catch (error) {
    return `[Unserializable: ${getErrorMessage(error)}]`
  }
}

function truncateToJsonBound(value: unknown) {
  const jsonSafeValue = toJsonSafeValue(value)
  const serialized = JSON.stringify(jsonSafeValue)
  if (serialized.length <= runCodeResultLimitBytes) return { result: jsonSafeValue }

  const text = typeof jsonSafeValue === "string" ? jsonSafeValue : serialized
  const truncate = (size: number) => text.slice(0, size)
  const bounded = Array.from({ length: runCodeResultLimitBytes }, (_, index) => runCodeResultLimitBytes - index)
    .map(truncate)
    .find((candidate) => JSON.stringify(candidate).length <= runCodeResultLimitBytes)

  return { result: bounded ?? "", truncated: true as const }
}

function browserRunCodeScript(code: string) {
  return `
    (() => {
      // These local shadows are defense-in-depth only. The real security
      // boundary is Electron's sandbox/contextIsolation/nodeIntegration=false
      // configuration with no preload injected into browser pages.
      const require = undefined
      const process = undefined
      const module = undefined
      const exports = undefined
      const Buffer = undefined
      const global = undefined
      const __dirname = undefined
      const __filename = undefined
      const source = ${JSON.stringify(code)}
      const run = () => {
        const candidate = Function(
          "require",
          "process",
          "module",
          "exports",
          "Buffer",
          "global",
          "__dirname",
          "__filename",
          '"use strict"; return (' + source + ')',
        )(require, process, module, exports, Buffer, global, __dirname, __filename)
        if (typeof candidate === "function") return candidate()
        return candidate
      }
      try {
        return Promise.resolve(run()).then(
          (result) => ({ result }),
          (error) => ({ result: null, error: error instanceof Error ? error.message : String(error) }),
        )
      } catch (error) {
        return { result: null, error: error instanceof Error ? error.message : String(error) }
      }
    })()
  `
}

function withRunCodeTimeout<T>(promise: Promise<T>) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  promise.catch(() => undefined)
  const timeoutResult = new Promise<T>((resolve) => {
    timeout = setTimeout(() => {
      resolve({ result: null, error: `Browser code execution timed out after ${runCodeTimeoutMs}ms` } as T)
    }, runCodeTimeoutMs)
  })

  // Electron does not expose cancellation for an already-running executeJavaScript
  // call. Promise.race bounds the API response so callers never hang forever.
  return Promise.race([promise, timeoutResult]).finally(() => {
    if (timeout) clearTimeout(timeout)
  })
}

function browserDomScript(body: string) {
  return `
    (() => {
      const LIMITS = ${JSON.stringify(browserDomLimits)}
      const SAFE_ATTRIBUTE_NAMES = ${JSON.stringify(safeAttributeNames)}
      const SAFE_ATTRIBUTE_PREFIXES = ${JSON.stringify(safeAttributePrefixes)}
      const sanitizeText = (value, maxLength = LIMITS.maxTextLength) =>
        String(value ?? "").replace(/\\s+/g, " ").trim().slice(0, maxLength)
      const hasSafeAttributeName = (name) =>
        SAFE_ATTRIBUTE_NAMES.includes(name) || SAFE_ATTRIBUTE_PREFIXES.some((prefix) => name.startsWith(prefix))
      const toAttributes = (element) =>
        Object.fromEntries(
          Array.from(element.attributes, (attribute) => [attribute.name, sanitizeText(attribute.value, LIMITS.maxAttributeValueLength)])
            .filter(([name]) => hasSafeAttributeName(name)),
        )
      const toBoundingBox = (element) => {
        const rect = element.getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }
      const getAccessibleName = (element) => {
        const labelledBy = element.getAttribute("aria-labelledby")
        const ariaLabel = element.getAttribute("aria-label")
        if (ariaLabel) return sanitizeText(ariaLabel)
        if (!labelledBy) return undefined
        const text = labelledBy
          .split(/\\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
        return text ? sanitizeText(text) : undefined
      }
      const getSelector = (element) => {
        if (element.id) return "#" + element.id
        const classes = Array.from(element.classList).slice(0, 3)
        return [element.tagName.toLowerCase(), ...classes.map((name) => "." + name)].join("")
      }
      const getXPath = (target) => {
        if (target.id) return '//*[@id="' + target.id + '"]'
        const parts = []
        let current = target
        while (current instanceof Element) {
          const siblings = current.parentElement
            ? Array.from(current.parentElement.children).filter((sibling) => sibling.tagName === current.tagName)
            : [current]
          const index = siblings.indexOf(current) + 1
          parts.unshift(current.tagName.toLowerCase() + "[" + index + "]")
          current = current.parentElement
        }
        return "/" + parts.join("/")
      }
      const toAnnotationData = (element, selector = getSelector(element)) => ({
        selector,
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute("role") ?? undefined,
        accessibleName: getAccessibleName(element),
        visibleText: sanitizeText(element.innerText ?? element.textContent ?? ""),
        attributes: toAttributes(element),
        boundingBox: toBoundingBox(element),
        xpath: getXPath(element),
        nearbyDomSanitized: sanitizeText(
          element.parentElement?.innerText ?? element.parentElement?.textContent ?? "",
          LIMITS.maxNearbyTextLength,
        ),
      })
      const safeQuerySelector = (selector) => {
        try {
          return document.querySelector(selector)
        } catch {
          return null
        }
      }
${body}
    })()
  `
}

function getNavigationUrl(url: string) {
  if (URL.canParse(url)) return url
  if (URL.canParse(`https://${url}`)) return `https://${url}`
  return url
}

export function attachBrowserView(win: BrowserWindow, browserId?: BrowserId) {
  const browser = getOrCreateBrowser(browserId)
  if (!browser) return undefined
  const view = browser.view

  if (browserWindow && browserWindow !== win && isAttachedToWindow(browserWindow, view)) {
    browserWindow.contentView.removeChildView(view)
  }

  setBrowserWindow(win)

  if (browser.state.visible) {
    attachAndShow(win, view, browser.bounds)
    return view
  }

  if (!isAttachedToWindow(win, view)) win.contentView.addChildView(view)
  view.setBounds(browser.bounds)
  view.setVisible(false)

  return view
}

export function detachBrowserView(win = browserWindow) {
  const browser = getActiveBrowser()
  if (!win || !browser) return
  if (isAttachedToWindow(win, browser.view)) {
    win.contentView.removeChildView(browser.view)
  }
  if (browserWindow === win) {
    setBrowserWindow(null)
  }
}

export function getBrowserView(browserId?: BrowserId) {
  return getOrCreateBrowser(browserId)?.view ?? null
}

export function setBrowserViewBounds(bounds: Rectangle, browserId?: BrowserId) {
  browserBounds = bounds
  const browser = getOrCreateBrowser(browserId)
  if (!browser) return
  setBrowserBounds(browser.id, bounds)
  if (browserWindow) attachAndShow(browserWindow, browser.view, bounds)
}

export function showBrowserView(browserId?: BrowserId) {
  browserVisible = true
  const browser = getOrCreateBrowser(browserId)
  if (!browser) return
  showBrowser(browser.id)
}

export function hideBrowserView(browserId?: BrowserId) {
  browserVisible = false
  const browser = getExistingBrowser(browserId)
  if (!browser) return
  hideBrowser(browser.id)
}

export async function navigate(url: string, browserId?: BrowserId) {
  const browser = getOrCreateBrowser(browserId)
  if (!browser) return
  await browser.view.webContents.loadURL(getNavigationUrl(url))
}

export function goBack(browserId?: BrowserId) {
  const browser = getOrCreateBrowser(browserId)
  if (!browser?.view.webContents.canGoBack()) return
  browser.view.webContents.goBack()
}

export function goForward(browserId?: BrowserId) {
  const browser = getOrCreateBrowser(browserId)
  if (!browser?.view.webContents.canGoForward()) return
  browser.view.webContents.goForward()
}

export function reload(browserId?: BrowserId) {
  getOrCreateBrowser(browserId)?.view.webContents.reload()
}

export async function clearBrowserData() {
  annotationDetails.clear()
  const browserSession = getBrowserSession()
  await browserSession.clearStorageData()
  await browserSession.clearCache()
}

function getWorkspaceRoot(workspaceRoot?: string) {
  if (workspaceRoot?.trim()) return workspaceRoot
  if (workspaceRoot === undefined && process.env.NODE_ENV === "test") return process.cwd()
  throw new Error("Browser upload workspace root is required")
}

export function resolveBrowserUploadPath(fileRef: string, workspaceRoot?: string) {
  if (!fileRef.trim()) throw new Error("Browser upload file path is required")
  if (fileRef.includes("\0")) throw new Error("Browser upload file path is invalid")
  if (isAbsolute(fileRef)) throw new Error("Browser uploads only accept workspace-relative paths")

  const absoluteWorkspaceRoot = resolve(getWorkspaceRoot(workspaceRoot))
  const absolutePath = resolve(absoluteWorkspaceRoot, fileRef)
  const relativePath = relative(absoluteWorkspaceRoot, absolutePath)
  if (!relativePath || relativePath === ".") throw new Error("Browser upload file path must point to a file")
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Browser uploads must stay within the workspace")
  }
  if (!statSync(absolutePath).isFile()) throw new Error("Browser upload file path must point to a file")

  const realWorkspaceRoot = realpathSync(absoluteWorkspaceRoot)
  const realPath = realpathSync(absolutePath)
  const realRelativePath = relative(realWorkspaceRoot, realPath)
  if (!realRelativePath || realRelativePath === ".") throw new Error("Browser upload file path must point to a file")
  if (realRelativePath.startsWith("..") || isAbsolute(realRelativePath)) {
    throw new Error("Browser uploads must stay within the workspace")
  }

  return absolutePath
}

export async function uploadFile(selector: string, fileRef: string, workspaceRoot?: string, browserId?: BrowserId) {
  const absolutePath = resolveBrowserUploadPath(fileRef, workspaceRoot)
  const browser = getOrCreateBrowser(browserId)
  if (!browser) return
  const debuggerSession = browser.view.webContents.debugger
  const attachedByCall = !debuggerSession.isAttached()
  if (attachedByCall) debuggerSession.attach("1.3")

  try {
    const document = await debuggerSession.sendCommand("DOM.getDocument", { depth: -1 })
    const match = await debuggerSession.sendCommand("DOM.querySelector", {
      nodeId: document.root.nodeId,
      selector,
    })
    if (!match.nodeId) throw new Error(`Browser upload target not found for selector: ${selector}`)

    await debuggerSession.sendCommand("DOM.setFileInputFiles", {
      files: [absolutePath],
      nodeId: match.nodeId,
    })
  } finally {
    if (attachedByCall && debuggerSession.isAttached()) debuggerSession.detach()
  }
}

export function getAnnotationDetail(id: string) {
  return Promise.resolve(annotationDetails.get(id) ?? null)
}

export function storeAnnotationDetail(id: string, detail: BrowserAnnotationDetail) {
  annotationDetails.set(id, { ...detail, id })
  return Promise.resolve()
}

function toScreenshotId() {
  return `browser-screenshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function toCaptureBounds(bounds: BrowserAnnotationData["boundingBox"]) {
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  }
}

async function captureInspectScreenshot(pageTitle: string, pageUrl: string, browserId?: BrowserId) {
  const viewport = await evaluateInBrowser<{ deviceScaleFactor: number; height: number; width: number }>(`
    (() => ({
      deviceScaleFactor: window.devicePixelRatio || 1,
      height: window.innerHeight || 0,
      width: window.innerWidth || 0,
    }))()
  `, browserId)
  const view = getBrowserView(browserId)
  const imageData = view ? (await view.webContents.capturePage()).toDataURL() : ""
  return {
    id: toScreenshotId(),
    pageTitle,
    pageUrl,
    imageData,
    viewport: typeof viewport === "string" ? { deviceScaleFactor: 1, height: 0, width: 0 } : viewport,
    createdAt: Date.now(),
  } satisfies BrowserScreenshot
}

async function captureAnnotationCrop(bounds: BrowserAnnotationData["boundingBox"], browserId?: BrowserId) {
  const view = getBrowserView(browserId)
  if (!view) return undefined
  return (await view.webContents.capturePage(toCaptureBounds(bounds))).toDataURL()
}

export async function listDownloads(): Promise<BrowserDownload[]> {
  const downloadDirectory = getBrowserDownloadsDirectory()
  mkdirSync(downloadDirectory, { recursive: true })

  return readdirSync(downloadDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(downloadDirectory, entry.name)
      const stat = statSync(path)
      return {
        createdAt: stat.birthtimeMs,
        modifiedAt: stat.mtimeMs,
        name: entry.name,
        path,
        size: stat.size,
      }
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
}

export function getCurrentUrl(browserId?: BrowserId) {
  return getOrCreateBrowser(browserId)?.view.webContents.getURL() ?? ""
}

export function getCurrentTitle(browserId?: BrowserId) {
  return getExistingBrowser(browserId)?.view.webContents.getTitle() ?? ""
}

export function getBrowserPanelState(browserId?: BrowserId): BrowserPanelState {
  const browser = getExistingBrowser(browserId)
  return {
    visible: browser?.state.visible ?? false,
    url: browser?.view.webContents.getURL() ?? "",
    canGoBack: browser?.view.webContents.canGoBack() ?? false,
    canGoForward: browser?.view.webContents.canGoForward() ?? false,
    isLoading: browser?.view.webContents.isLoading() ?? false,
    inspectMode: browser?.inspectMode ?? false,
  }
}

export async function click(selector: string, browserId?: BrowserId) {
  await evaluateInBrowser<void>(browserDomScript(`
      const element = safeQuerySelector(${JSON.stringify(selector)})
      if (!(element instanceof HTMLElement)) return false
      element.focus()
      const rect = element.getBoundingClientRect()
      const point = {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      }
      const dispatchMouseEvent = (type, buttons) => element.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        button: 0,
        buttons,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
      }))
      const dispatchPointerEvent = (type, buttons) => {
        if (typeof PointerEvent !== "function") return dispatchMouseEvent(type, buttons)
        return element.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          button: 0,
          buttons,
          cancelable: true,
          clientX: point.x,
          clientY: point.y,
          pointerId: 1,
          pointerType: "mouse",
        }))
      }
      dispatchPointerEvent("pointerdown", 1)
      dispatchMouseEvent("mousedown", 1)
      dispatchPointerEvent("pointerup", 0)
      dispatchMouseEvent("mouseup", 0)
      dispatchMouseEvent("click", 0)
      return true
  `), browserId)
}

export async function hoverElement(selector: string, browserId?: BrowserId) {
  return await evaluateInBrowser<boolean>(browserDomScript(`
      const element = safeQuerySelector(${JSON.stringify(selector)})
      if (!(element instanceof HTMLElement)) return false
      element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }))
      element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
      element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }))
      return true
  `), browserId)
}

export async function dragElement(selector: string, targetSelector: string, browserId?: BrowserId) {
  const browser = getOrCreateBrowser(browserId)
  if (!browser) return false
  return await browser.view.webContents.executeJavaScript(browserDomScript(`
      const element = safeQuerySelector(${JSON.stringify(selector)})
      const target = safeQuerySelector(${JSON.stringify(targetSelector)})
      if (!(element instanceof HTMLElement) || !(target instanceof HTMLElement)) return false
      const sourceRect = element.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      const sourcePoint = {
        x: sourceRect.x + sourceRect.width / 2,
        y: sourceRect.y + sourceRect.height / 2,
      }
      const targetPoint = {
        x: targetRect.x + targetRect.width / 2,
        y: targetRect.y + targetRect.height / 2,
      }
      if (typeof DragEvent !== "function") return false
      const dataTransfer = typeof DataTransfer === "function" ? new DataTransfer() : undefined
      const dragEventInit = (point) => ({
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
        dataTransfer,
      })
      const dispatchDragEvent = (node, type, point) => node.dispatchEvent(new DragEvent(type, dragEventInit(point)))
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: sourcePoint.x, clientY: sourcePoint.y }))
      dispatchDragEvent(element, "dragstart", sourcePoint)
      dispatchDragEvent(target, "dragenter", targetPoint)
      dispatchDragEvent(target, "dragover", targetPoint)
      dispatchDragEvent(target, "drop", targetPoint)
      dispatchDragEvent(element, "dragend", targetPoint)
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: targetPoint.x, clientY: targetPoint.y }))
      return true
  `)) as Promise<boolean>
}

export function handleDialog(
  _action: BrowserDialogAction,
  _promptText?: string,
  _browserId?: BrowserId,
): Promise<BrowserDialogResult> {
  // Electron 41's typed WebContents/WebContentsView surface exposes keyboard/mouse
  // interception and generic DevTools Protocol commands, but no reliable typed API or
  // event for accepting, dismissing, or filling already-open JavaScript dialogs.
  // Return an explicit unsupported result instead of pretending this controls dialogs.
  return Promise.resolve({
    success: false,
    unsupported: true,
    message: "Electron WebContentsView does not expose a reliable API to accept, dismiss, or fill JavaScript dialogs after they are shown.",
  })
}

export async function runBrowserCode(code: string, browserId?: BrowserId): Promise<BrowserRunCodeResult> {
  const browser = getBrowserForRunCode(browserId)
  if (!browser) return { result: null, error: browserId ? "Browser not found" : "No active browser" }

  try {
    const result = await withRunCodeTimeout(
      browser.view.webContents.executeJavaScript(browserRunCodeScript(code)) as Promise<BrowserRunCodeResult>,
    )
    if (result.error) return { result: null, error: result.error }
    return truncateToJsonBound(result.result)
  } catch (error) {
    return { result: null, error: getErrorMessage(error) }
  }
}

export function runPlaywrightCode(code: string, browserId?: BrowserId): Promise<BrowserRunCodeResult> {
  return runBrowserCode(code, browserId)
}

export async function typeText(selector: string, text: string, browserId?: BrowserId) {
  await evaluateInBrowser<void>(browserDomScript(`
      const element = safeQuerySelector(${JSON.stringify(selector)})
      if (!(element instanceof HTMLElement)) return false
      element.focus()
      const setNativeValue = (target, value) => {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), "value")
        if (descriptor?.set) {
          descriptor.set.call(target, value)
          return
        }
        target.value = value
      }
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        setNativeValue(element, ${JSON.stringify(text)})
      } else if (element.isContentEditable) {
        element.textContent = ${JSON.stringify(text)}
      } else {
        return false
      }
      element.dispatchEvent(new InputEvent("input", { bubbles: true, data: ${JSON.stringify(text)} }))
      element.dispatchEvent(new Event("change", { bubbles: true }))
      return true
  `), browserId)
}

export async function pressKey(key: string, browserId?: BrowserId) {
  await evaluateInBrowser<void>(`
    (() => {
      const target = document.activeElement
      if (!(target instanceof HTMLElement)) return
      target.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true }))
      target.dispatchEvent(new KeyboardEvent("keyup", { key: ${JSON.stringify(key)}, bubbles: true }))
    })()
  `, browserId)
}

export async function getSnapshot(browserId?: BrowserId) {
  const snapshot = await evaluateInBrowser<BrowserSnapshot>(browserDomScript(`
      const elements = Array.from(
        document.querySelectorAll("a, button, input, select, textarea, [role='button'], [role='link']"),
      )
        .filter((element) => element instanceof HTMLElement)
        .slice(0, LIMITS.maxSnapshotElements)
        .map((element) => ({
          selector: getSelector(element),
          tagName: element.tagName.toLowerCase(),
          role: element.getAttribute("role") ?? undefined,
          accessibleName: getAccessibleName(element),
          visibleText: sanitizeText(element.innerText ?? element.textContent ?? ""),
          attributes: toAttributes(element),
          boundingBox: toBoundingBox(element),
        }))
        return {
          url: window.location.href,
          title: document.title,
          elements,
        }
  `), browserId)
  return typeof snapshot === "string" ? (snapshot as BrowserSnapshot) : sanitizeBrowserSnapshot(snapshot)
}

export async function getAnnotationData(selector: string, browserId?: BrowserId) {
  const annotation = await evaluateInBrowser<BrowserAnnotationData | null>(browserDomScript(`
      const element = safeQuerySelector(${JSON.stringify(selector)})
      if (!(element instanceof HTMLElement)) return null
      return toAnnotationData(element, ${JSON.stringify(selector)})
  `), browserId)
  return typeof annotation === "string" ? (annotation as BrowserAnnotationData) : sanitizeBrowserAnnotationData(annotation)
}

export async function startInspectMode(browserId?: BrowserId) {
  const browser = getOrCreateBrowser(browserId)
  if (!browser) return null
  browser.inspectMode = true
  browser.state.inspectMode = true
  const result = await evaluateInBrowser<BrowserInspectResult | null>(browserDomScript(`
      const existing = window.__opencodeInspectSession
      if (existing?.cancel) existing.cancel(null)
      return new Promise((resolve) => {
        let done = false
        let selectedTarget = null
        const overlay = document.createElement("div")
        const bubble = document.createElement("div")
        const textarea = document.createElement("textarea")
        const cursorStyle = document.createElement("style")
        cursorStyle.textContent = "html, body, body * { cursor: crosshair !important; }"
        Object.assign(overlay.style, {
          position: "fixed",
          zIndex: "2147483647",
          border: "2px solid #ea580c",
          background: "rgba(234, 88, 12, 0.12)",
          pointerEvents: "none",
          display: "none",
          boxSizing: "border-box",
        })
        Object.assign(bubble.style, {
          position: "fixed",
          zIndex: "2147483647",
          width: "220px",
          padding: "8px",
          borderRadius: "8px",
          border: "1px solid var(--border-base, rgba(148, 163, 184, 0.32))",
          background: "var(--surface-raised-base, #1f2933)",
          display: "none",
          boxSizing: "border-box",
          pointerEvents: "auto",
          font: "13px system-ui, sans-serif",
        })
        textarea.setAttribute("aria-label", "Annotation comment")
        textarea.placeholder = "Nota"
        Object.assign(textarea.style, {
          width: "100%",
          minHeight: "72px",
          resize: "vertical",
          boxSizing: "border-box",
          borderRadius: "6px",
          border: "1px solid var(--border-base, rgba(148, 163, 184, 0.32))",
          padding: "8px",
          font: "inherit",
          color: "var(--text-strong, #f8fafc)",
          background: "var(--surface-base, #111827)",
        })
        document.documentElement.appendChild(cursorStyle)
        bubble.append(textarea)
        document.documentElement.appendChild(overlay)
        document.documentElement.appendChild(bubble)

        const addAnnotationMarker = (target) => {
          window.__opencodeAnnotationMarkerCount = (window.__opencodeAnnotationMarkerCount ?? 0) + 1
          const marker = document.createElement("div")
          const rect = target.getBoundingClientRect()
          marker.className = "opencode-browser-annotation-marker"
          marker.textContent = String(window.__opencodeAnnotationMarkerCount)
          marker.setAttribute("aria-label", "Browser annotation " + window.__opencodeAnnotationMarkerCount)
          Object.assign(marker.style, {
            position: "fixed",
            zIndex: "2147483646",
            left: Math.max(10, Math.min(rect.x + rect.width, window.innerWidth - 10)) + "px",
            top: Math.max(10, Math.min(rect.y, window.innerHeight - 10)) + "px",
            width: "22px",
            height: "22px",
            borderRadius: "999px",
            border: "2px solid #67e8f9",
            background: "#0891b2",
            color: "#ffffff",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            font: "700 12px system-ui, sans-serif",
            lineHeight: "1",
            boxShadow: "0 6px 18px rgba(8, 145, 178, 0.35)",
            pointerEvents: "none",
            transform: "translate(-50%, -50%)",
          })
          document.documentElement.appendChild(marker)
        }

        const positionBubble = (rect) => {
          const width = 220
          const height = 96
          const gap = 12
          bubble.style.left = Math.max(gap, Math.min(rect.x + rect.width + gap, window.innerWidth - width - gap)) + "px"
          bubble.style.top = Math.max(gap, Math.min(rect.y, window.innerHeight - height - gap)) + "px"
        }

        const finish = (value) => {
          if (done) return
          done = true
          document.removeEventListener("mousemove", handleMove, true)
          document.removeEventListener("click", handleClick, true)
          document.removeEventListener("keydown", handleKeyDown, true)
          overlay.remove()
          bubble.remove()
          cursorStyle.remove()
          if (window.__opencodeInspectSession?.cancel === finish) delete window.__opencodeInspectSession
          resolve(value)
        }

        const readTarget = (event) => document.elementFromPoint(event.clientX, event.clientY)
        const handleMove = (event) => {
          const target = readTarget(event)
          if (!(target instanceof HTMLElement)) {
            overlay.style.display = "none"
            return
          }
          const rect = target.getBoundingClientRect()
          overlay.style.display = "block"
          overlay.style.left = rect.x + "px"
          overlay.style.top = rect.y + "px"
          overlay.style.width = rect.width + "px"
          overlay.style.height = rect.height + "px"
        }

        const openBubble = (target) => {
          selectedTarget = target
          const rect = target.getBoundingClientRect()
          overlay.style.display = "block"
          overlay.style.left = rect.x + "px"
          overlay.style.top = rect.y + "px"
          overlay.style.width = rect.width + "px"
          overlay.style.height = rect.height + "px"
          positionBubble(rect)
          bubble.style.display = "block"
          textarea.value = ""
          queueMicrotask(() => textarea.focus())
        }

        const saveAnnotation = (event) => {
          event.preventDefault()
          event.stopPropagation()
          if (!(selectedTarget instanceof HTMLElement)) return finish(null)
          const userComment = textarea.value.trim()
          if (!userComment) return
          addAnnotationMarker(selectedTarget)
          finish({
            annotation: toAnnotationData(selectedTarget),
            pageTitle: document.title,
            pageUrl: window.location.href,
            userComment: textarea.value.trim(),
          })
        }

        const handleClick = (event) => {
          if (bubble.contains(event.target)) return
          event.preventDefault()
          event.stopPropagation()
          const target = readTarget(event)
          if (!(target instanceof HTMLElement)) return finish(null)
          document.removeEventListener("mousemove", handleMove, true)
          openBubble(target)
        }

        const handleKeyDown = (event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            event.stopPropagation()
            finish(null)
            return
          }
          if (event.key !== "Enter" || event.shiftKey || bubble.style.display !== "block") return
          saveAnnotation(event)
        }

        window.__opencodeInspectSession = { cancel: finish }
        document.addEventListener("mousemove", handleMove, true)
        document.addEventListener("click", handleClick, true)
        document.addEventListener("keydown", handleKeyDown, true)
      })
  `), browser.id).catch(() => null)
  if (typeof result === "string") return result as BrowserInspectResult
  const sanitized = sanitizeBrowserInspectResult(result)
  if (!sanitized) {
    browser.inspectMode = false
    browser.state.inspectMode = false
    return null
  }
  const viewportScreenshot = await captureInspectScreenshot(sanitized.pageTitle, sanitized.pageUrl, browser.id)
  return {
    ...sanitized,
    context: {
      nearbyDomSanitized: sanitized.annotation.nearbyDomSanitized,
      accessibilitySnapshotNearby: {
        accessibleName: sanitized.annotation.accessibleName,
        role: sanitized.annotation.role,
        tagName: sanitized.annotation.tagName,
      },
    },
    preview: {
      screenshotCrop: await captureAnnotationCrop(sanitized.annotation.boundingBox, browser.id),
      viewportScreenshotId: viewportScreenshot.id,
    },
    viewportScreenshot,
  } satisfies BrowserInspectResult
}

export async function stopInspectMode(browserId?: BrowserId) {
  const browser = getOrCreateBrowser(browserId)
  if (!browser) return
  browser.inspectMode = false
  browser.state.inspectMode = false
  await evaluateInBrowser<void>(`
    (() => {
      const existing = window.__opencodeInspectSession
      if (!existing?.cancel) return
      existing.cancel(null)
    })()
  `, browser.id)
}

export async function clearAnnotationMarkers(browserId?: BrowserId) {
  const browser = browserId ? getBrowser(browserId) : getActiveBrowser()
  if (!browser) return
  await evaluateInBrowser<void>(`
    (() => {
      document.querySelectorAll(".opencode-browser-annotation-marker").forEach((marker) => marker.remove())
      window.__opencodeAnnotationMarkerCount = 0
    })()
  `, browser.id)
}
