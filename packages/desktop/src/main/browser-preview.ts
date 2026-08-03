import { randomUUID } from "node:crypto"
import { app, BrowserWindow, shell, WebContentsView, session } from "electron"
import type { WebContents } from "electron"
import type {
  BrowserPreviewBounds,
  BrowserPreviewCommand,
  BrowserPreviewResult,
  BrowserPreviewState,
  BrowserPreviewTab,
} from "@opencode-ai/app"
import {
  normalizePreviewBounds,
  normalizePreviewElement,
  normalizePreviewUrl,
  resolvePreviewNavigation,
} from "./browser-preview-policy"

const DEFAULT_URL = "https://www.google.com/"
const MAX_TABS = 5
const AUTO_REFRESH_MS = 2_000
const MAX_DOM_BYTES = 2 * 1024 * 1024
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024
const MAX_SCREENSHOT_DIMENSION = 4096
const MAX_CONSOLE_ENTRIES = 200
const MAX_CONSOLE_ENTRY_BYTES = 4 * 1024
const MAX_CONSOLE_BYTES = 512 * 1024
const INSPECTION_TIMEOUT_MS = 5_000
const ELEMENT_PICKER_WORLD_ID = 1001
const ELEMENT_PICKER_SCRIPT = String.raw`(() => new Promise((resolve) => {
  const key = "__opencodeBrowserPreviewPicker"
  const previous = globalThis[key]
  if (previous && typeof previous.cancel === "function") previous.cancel()

  const outline = document.createElement("div")
  const label = document.createElement("div")
  outline.setAttribute("data-opencode-element-picker", "")
  label.setAttribute("data-opencode-element-picker", "")
  outline.style.cssText = "position:fixed;display:none;pointer-events:none;z-index:2147483646;border:2px solid #6c8cff;background:rgba(108,140,255,.12);box-sizing:border-box;"
  label.style.cssText = "position:fixed;display:none;pointer-events:none;z-index:2147483647;max-width:320px;padding:4px 7px;border-radius:4px;background:#172033;color:#fff;font:11px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 2px 8px rgba(0,0,0,.3);"
  document.documentElement.append(outline, label)

  let done = false
  const sensitive = /password|secret|token|auth|cookie|session/i
  const safeToken = (value) => value.length <= 64 && !sensitive.test(value)
  const escape = (value) => CSS.escape(String(value))
  const targetFrom = (event) => event.composedPath().find((item) => item instanceof Element && !item.hasAttribute("data-opencode-element-picker"))
  const selectorFor = (element) => {
    if (element.id && safeToken(element.id)) return "#" + escape(element.id)
    const parts = []
    let current = element
    for (let depth = 0; current && current.nodeType === Node.ELEMENT_NODE && depth < 8; depth += 1) {
      let part = current.tagName.toLowerCase()
      const classes = Array.from(current.classList).filter((value) => value && safeToken(value)).slice(0, 2)
      if (classes.length) part += "." + classes.map(escape).join(".")
      const parent = current.parentElement
      if (parent) {
        const siblings = Array.from(parent.children).filter((item) => item.tagName === current.tagName)
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")"
      }
      parts.unshift(part)
      if (!parent || current.tagName === "BODY") break
      current = parent
    }
    return parts.join(" > ")
  }
  const truncate = (value, max) => {
    const bytes = new TextEncoder().encode(value)
    if (bytes.length <= max) return { value, truncated: false }
    return { value: new TextDecoder().decode(bytes.slice(0, max)), truncated: true }
  }
  const cleanHtml = (element) => {
    const clone = element.cloneNode(true)
    const nodes = [clone, ...clone.querySelectorAll("*")]
    for (const node of nodes) {
      if (node.matches("script,style,template,noscript")) {
        node.remove()
        continue
      }
      for (const attribute of Array.from(node.attributes)) {
        const name = attribute.name.toLowerCase()
        const allowed = ["id", "class", "role", "aria-label", "title", "alt", "type"].includes(name)
        if (!allowed || sensitive.test(name) || sensitive.test(attribute.value) || attribute.value.length > 512) {
          node.removeAttribute(attribute.name)
        }
      }
      if (node.matches("textarea,select")) node.textContent = ""
      node.removeAttribute("checked")
      node.removeAttribute("selected")
    }
    return clone.outerHTML
  }
  const cleanup = () => {
    window.removeEventListener("pointermove", move, true)
    window.removeEventListener("click", pick, true)
    window.removeEventListener("keydown", keydown, true)
    outline.remove()
    label.remove()
    if (globalThis[key] && globalThis[key].cancel === cancel) delete globalThis[key]
  }
  const finish = (value) => {
    if (done) return
    done = true
    cleanup()
    resolve(value)
  }
  const cancel = () => finish({ cancelled: true })
  const move = (event) => {
    const element = targetFrom(event)
    if (!element) return
    const rect = element.getBoundingClientRect()
    outline.style.display = "block"
    outline.style.left = rect.left + "px"
    outline.style.top = rect.top + "px"
    outline.style.width = rect.width + "px"
    outline.style.height = rect.height + "px"
    label.style.display = "block"
    label.style.left = Math.max(4, Math.min(innerWidth - 324, rect.left)) + "px"
    label.style.top = Math.max(4, rect.top - 25) + "px"
    label.textContent = selectorFor(element)
  }
  const pick = (event) => {
    const element = targetFrom(event)
    if (!event.isTrusted || !element || element.matches("script,style,template,noscript")) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    const rect = element.getBoundingClientRect()
    const text = truncate((element.innerText || element.textContent || "").trim(), 16384)
    const html = truncate(cleanHtml(element), 65536)
    finish({
      selector: selectorFor(element),
      tag: element.tagName.toLowerCase(),
      text: text.value,
      html: html.value,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      textTruncated: text.truncated,
      htmlTruncated: html.truncated,
    })
  }
  const keydown = (event) => {
    if (event.key !== "Escape") return
    event.preventDefault()
    event.stopPropagation()
    cancel()
  }

  globalThis[key] = { cancel }
  window.addEventListener("pointermove", move, true)
  window.addEventListener("click", pick, true)
  window.addEventListener("keydown", keydown, true)
}))()`
const CANCEL_ELEMENT_PICKER_SCRIPT = `globalThis.__opencodeBrowserPreviewPicker?.cancel?.()`

type ConsoleEntry = { level: number; message: string; source: string; line: number }
type BrowserPreviewWindow = {
  contentView: {
    children: readonly unknown[]
    addChildView(view: WebContentsView): void
    removeChildView(view: WebContentsView): void
  }
  webContents: Pick<WebContents, "send" | "isDestroyed" | "getZoomFactor">
  getContentBounds(): Electron.Rectangle
  isDestroyed(): boolean
}
type Tab = {
  state: BrowserPreviewTab
  view: WebContentsView
  revision: number
  navigationRevision: number
  inspecting?: "generic" | "picker"
  consoleEntries: ConsoleEntry[]
  consoleBytes: number
  consoleListener?: (...args: any[]) => void
  refreshTimer?: ReturnType<typeof setInterval>
  disposers: (() => void)[]
}

type BrowserPreviewControllers = {
  active?: BrowserPreviewController
  sessions: Map<string, BrowserPreviewController>
}

const controllers = new WeakMap<BrowserWindow, BrowserPreviewControllers>()
const controllerByContents = new Map<number, BrowserPreviewController>()

function sanitizeErrorMessage(value: string) {
  return value.replace(/https?:\/\/[^\s]+/g, "preview URL")
}

function redactConsole(value: string) {
  return value
    .replace(/(authorization|cookie|password|secret|token)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[redacted]")
    .slice(0, MAX_CONSOLE_ENTRY_BYTES)
}

function withTimeout<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Browser Preview inspection timed out")), INSPECTION_TIMEOUT_MS)
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

export class BrowserPreviewController {
  private readonly partition = `opencode-browser-preview-${randomUUID()}`
  private readonly previewSession = session.fromPartition(this.partition, { cache: true })
  private readonly tabs = new Map<string, Tab>()
  private activeTabId: string | undefined
  private visible = false
  private bounds: Electron.Rectangle | undefined
  private boundsRevision = 0
  private pendingBounds: Electron.Rectangle | undefined
  private boundsTimer: ReturnType<typeof setTimeout> | undefined
  private transition = Promise.resolve()
  private retired = false

  constructor(
    private readonly win: BrowserPreviewWindow,
    private readonly isActive = () => true,
  ) {
    this.previewSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    this.previewSession.setPermissionCheckHandler(() => false)
    this.previewSession.on("will-download", (event) => event.preventDefault())
  }

  state(): BrowserPreviewState {
    return {
      visible: this.visible,
      tabs: [...this.tabs.values()].map((tab) => ({ ...tab.state })),
      activeTabId: this.activeTabId,
    }
  }

  async show(url = DEFAULT_URL) {
    return this.lifecycle(async () => {
      if (this.retired) throw new Error("Browser Preview controller is closed")
      this.visible = true
      if (this.tabs.size === 0) await this.createTab(url)
      if (this.retired) return this.state()
      this.attachActive()
      this.emit()
      return this.state()
    })
  }

  async hide() {
    await this.lifecycle(() => this.destroyAll())
  }

  deactivate() {
    this.visible = false
    this.detachActive()
  }

  setBounds(input: BrowserPreviewBounds) {
    if (!this.visible || input.revision <= this.boundsRevision) return
    this.boundsRevision = input.revision
    const normalized = normalizePreviewBounds(input, this.win.getContentBounds(), this.win.webContents.getZoomFactor())
    if (!normalized) {
      this.bounds = undefined
      this.pendingBounds = undefined
      if (this.boundsTimer) clearTimeout(this.boundsTimer)
      this.boundsTimer = undefined
      this.detachActive()
      return
    }
    this.pendingBounds = normalized
    if (this.boundsTimer) return
    this.boundsTimer = setTimeout(() => {
      this.boundsTimer = undefined
      const bounds = this.pendingBounds
      this.pendingBounds = undefined
      if (!bounds || !this.visible) return
      this.bounds = bounds
      this.attachActive()
      this.active()?.view.setBounds(bounds)
    }, 16)
  }

  async command(command: BrowserPreviewCommand): Promise<BrowserPreviewResult> {
    switch (command.type) {
      case "new-tab":
        if (this.tabs.size >= MAX_TABS) throw new Error(`Browser Preview supports up to ${MAX_TABS} tabs`)
        await this.createTab(command.url ?? DEFAULT_URL)
        return { type: "none" }
      case "close-tab":
        await this.closeTab(command.tabId)
        return { type: "none" }
      case "activate-tab":
        await this.activate(command.tabId)
        return { type: "none" }
    }

    const tab = this.active()
    if (!tab) throw new Error("Browser Preview is not open")
    switch (command.type) {
      case "navigate":
        await this.navigate(tab, command.url)
        break
      case "back":
        if (tab.view.webContents.canGoBack()) tab.view.webContents.goBack()
        break
      case "forward":
        if (tab.view.webContents.canGoForward()) tab.view.webContents.goForward()
        break
      case "reload":
        void this.invalidateInspection(tab)
        tab.view.webContents.reload()
        break
      case "hard-reload":
        void this.invalidateInspection(tab)
        tab.view.webContents.reloadIgnoringCache()
        break
      case "set-auto-refresh":
        this.setAutoRefresh(tab, command.enabled)
        break
      case "open-external":
        await shell.openExternal(normalizePreviewUrl(tab.state.url))
        break
      case "open-devtools":
        tab.view.webContents.openDevTools({ mode: "detach" })
        break
      case "set-device-emulation":
        this.setDeviceEmulation(tab, command.enabled)
        break
      case "set-zoom":
        tab.state.zoom = Math.min(3, Math.max(0.25, command.zoom))
        tab.view.webContents.setZoomFactor(tab.state.zoom)
        break
      case "clear-cache":
        await this.previewSession.clearCache()
        break
      case "start-console-capture":
        this.startConsoleCapture(tab)
        break
      case "get-console-logs":
        return { type: "console", entries: tab.consoleEntries.map((entry) => ({ ...entry })) }
      case "read-dom":
        return this.inspect(tab, async () => {
          const result: unknown = await tab.view.webContents.executeJavaScript(
            `(() => {
              const value = document.documentElement?.outerHTML ?? ""
              const bytes = new TextEncoder().encode(value)
              if (bytes.length <= ${MAX_DOM_BYTES}) return { content: value, truncated: false }
              return { content: new TextDecoder().decode(bytes.slice(0, ${MAX_DOM_BYTES})), truncated: true }
            })()`,
            true,
          )
          if (
            !result ||
            typeof result !== "object" ||
            !("content" in result) ||
            typeof result.content !== "string" ||
            !("truncated" in result) ||
            typeof result.truncated !== "boolean"
          ) {
            throw new Error("Browser Preview returned an invalid DOM result")
          }
          return {
            type: "dom",
            content: result.content,
            truncated: result.truncated,
          }
        })
      case "capture-screenshot":
        return this.inspect(tab, async () => {
          const image = await tab.view.webContents.capturePage()
          const size = image.getSize()
          if (size.width > MAX_SCREENSHOT_DIMENSION || size.height > MAX_SCREENSHOT_DIMENSION) {
            throw new Error("Browser Preview screenshot exceeds 4096 x 4096")
          }
          const png = image.toPNG()
          if (png.byteLength > MAX_SCREENSHOT_BYTES) throw new Error("Browser Preview screenshot exceeds 10 MiB")
          return { type: "screenshot", dataUrl: `data:image/png;base64,${png.toString("base64")}` }
        })
      case "pick-element":
        return this.pickElement(tab)
      case "cancel-element-picker":
        await this.cancelElementPicker(tab)
        break
    }
    this.update(tab)
    return { type: "none" }
  }

  async destroyAll(emit = true) {
    this.visible = false
    this.bounds = undefined
    this.boundsRevision = 0
    if (this.boundsTimer) clearTimeout(this.boundsTimer)
    this.boundsTimer = undefined
    this.pendingBounds = undefined
    for (const tab of this.tabs.values()) this.destroyTab(tab)
    this.tabs.clear()
    this.activeTabId = undefined
    await Promise.allSettled([this.previewSession.clearStorageData(), this.previewSession.clearCache()])
    if (emit) this.emit()
  }

  private async createTab(rawUrl: string) {
    const url = resolvePreviewNavigation(rawUrl)
    const id = randomUUID()
    const view = new WebContentsView({
      webPreferences: {
        partition: this.partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        backgroundThrottling: true,
      },
    })
    const tab: Tab = {
      state: {
        id,
        title: new URL(url).host,
        url,
        loading: true,
        canGoBack: false,
        canGoForward: false,
        autoRefresh: false,
        deviceEmulation: false,
        zoom: 1,
        consoleCapture: false,
      },
      view,
      revision: 0,
      navigationRevision: 0,
      consoleEntries: [],
      consoleBytes: 0,
      disposers: [],
    }
    this.tabs.set(id, tab)
    controllerByContents.set(view.webContents.id, this)
    this.wireTab(tab)
    await this.activate(id)
    await this.navigate(tab, url)
  }

  private wireTab(tab: Tab) {
    const contents = tab.view.webContents
    const blockUnsafeNavigation = (event: Electron.Event, url: string) => {
      try {
        normalizePreviewUrl(url)
      } catch (error) {
        event.preventDefault()
        tab.state.error = { kind: "blocked", message: error instanceof Error ? error.message : "Blocked URL" }
        this.update(tab)
      }
    }
    contents.on("will-navigate", blockUnsafeNavigation)
    contents.on("will-redirect", blockUnsafeNavigation)
    tab.disposers.push(() => contents.removeListener("will-navigate", blockUnsafeNavigation))
    tab.disposers.push(() => contents.removeListener("will-redirect", blockUnsafeNavigation))

    const didStartLoading = () => {
      tab.state.loading = true
      tab.state.error = undefined
      void this.invalidateInspection(tab)
      this.update(tab)
    }
    const didStopLoading = () => {
      tab.state.loading = false
      this.update(tab)
    }
    const didNavigate = (_event: Electron.Event, url: string) => {
      try {
        tab.state.url = normalizePreviewUrl(url)
      } catch {
        return
      }
      this.update(tab)
    }
    const didNavigateInPage = (_event: Electron.Event, url: string, isMainFrame: boolean) => {
      if (!isMainFrame) return
      void this.invalidateInspection(tab)
      didNavigate(_event, url)
    }
    const pageTitleUpdated = (event: Electron.Event, title: string) => {
      event.preventDefault()
      tab.state.title = title || new URL(tab.state.url).host
      this.update(tab)
    }
    const didFailLoad = (
      _event: Electron.Event,
      code: number,
      description: string,
      _url: string,
      isMainFrame: boolean,
    ) => {
      if (!isMainFrame || code === -3) return
      tab.state.loading = false
      tab.state.error = {
        kind: code === -202 ? "tls" : code <= -100 && code >= -199 ? "unreachable" : "unknown",
        message: sanitizeErrorMessage(description),
      }
      this.detach(tab)
      this.update(tab)
    }
    const renderProcessGone = () => {
      tab.state.loading = false
      tab.state.error = { kind: "crashed", message: "The preview renderer stopped unexpectedly" }
      this.detach(tab)
      this.update(tab)
    }
    contents.on("did-start-loading", didStartLoading)
    contents.on("did-stop-loading", didStopLoading)
    contents.on("did-navigate", didNavigate)
    contents.on("did-navigate-in-page", didNavigateInPage)
    contents.on("page-title-updated", pageTitleUpdated)
    contents.on("did-fail-load", didFailLoad)
    contents.on("render-process-gone", renderProcessGone)
    tab.disposers.push(() => contents.removeListener("did-start-loading", didStartLoading))
    tab.disposers.push(() => contents.removeListener("did-stop-loading", didStopLoading))
    tab.disposers.push(() => contents.removeListener("did-navigate", didNavigate))
    tab.disposers.push(() => contents.removeListener("did-navigate-in-page", didNavigateInPage))
    tab.disposers.push(() => contents.removeListener("page-title-updated", pageTitleUpdated))
    tab.disposers.push(() => contents.removeListener("did-fail-load", didFailLoad))
    tab.disposers.push(() => contents.removeListener("render-process-gone", renderProcessGone))
    contents.setWindowOpenHandler(({ url }) => {
      try {
        normalizePreviewUrl(url)
        void this.navigate(tab, url).catch((error) => {
          tab.state.error = { kind: "unreachable", message: sanitizeErrorMessage(String(error)) }
          this.update(tab)
        })
      } catch {}
      return { action: "deny" }
    })
  }

  private async navigate(tab: Tab, rawUrl: string) {
    const url = resolvePreviewNavigation(rawUrl)
    const navigationRevision = ++tab.navigationRevision
    tab.state.error = undefined
    await this.invalidateInspection(tab)
    await tab.view.webContents.loadURL(url).catch((error) => {
      if (navigationRevision !== tab.navigationRevision || String(error).includes("ERR_ABORTED")) return
      tab.state.loading = false
      tab.state.error = { kind: "unreachable", message: sanitizeErrorMessage(String(error)) }
      this.detach(tab)
      this.update(tab)
    })
  }

  private async activate(id: string) {
    const next = this.tabs.get(id)
    if (!next) throw new Error("Browser Preview tab not found")
    const current = this.active()
    if (current && current !== next) await this.cancelElementPicker(current)
    this.detachActive()
    this.activeTabId = id
    this.attachActive()
    this.emit()
  }

  private async closeTab(id: string) {
    const tab = this.tabs.get(id)
    if (!tab) return
    const ids = [...this.tabs.keys()]
    const index = ids.indexOf(id)
    this.destroyTab(tab)
    this.tabs.delete(id)
    if (this.activeTabId === id) {
      this.activeTabId = ids[index + 1] ?? ids[index - 1]
      this.attachActive()
    }
    if (this.tabs.size === 0) await this.destroyAll()
    else this.emit()
  }

  private destroyTab(tab: Tab) {
    this.detach(tab)
    if (tab.refreshTimer) clearInterval(tab.refreshTimer)
    tab.disposers.forEach((dispose) => dispose())
    controllerByContents.delete(tab.view.webContents.id)
    void this.invalidateInspection(tab)
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
  }

  private active() {
    return this.activeTabId ? this.tabs.get(this.activeTabId) : undefined
  }

  private attachActive() {
    const tab = this.active()
    if (this.retired || !this.visible || !tab || tab.state.error || !this.bounds) return
    if (!this.win.contentView.children.includes(tab.view)) this.win.contentView.addChildView(tab.view)
    tab.view.setBounds(this.bounds)
  }

  private detachActive() {
    const tab = this.active()
    if (tab) this.detach(tab)
  }

  private detach(tab: Tab) {
    if (this.win.isDestroyed()) return
    if (this.win.contentView.children.includes(tab.view)) this.win.contentView.removeChildView(tab.view)
  }

  private setAutoRefresh(tab: Tab, enabled: boolean) {
    if (tab.refreshTimer) clearInterval(tab.refreshTimer)
    tab.refreshTimer = undefined
    tab.state.autoRefresh = enabled
    if (!enabled) return
    tab.refreshTimer = setInterval(() => {
      if (!this.visible || this.activeTabId !== tab.state.id || tab.state.loading) return
      void this.invalidateInspection(tab)
      tab.view.webContents.reload()
    }, AUTO_REFRESH_MS)
  }

  private setDeviceEmulation(tab: Tab, enabled: boolean) {
    tab.state.deviceEmulation = enabled
    if (!enabled) {
      tab.view.webContents.disableDeviceEmulation()
      return
    }
    tab.view.webContents.enableDeviceEmulation({
      screenPosition: "mobile",
      screenSize: { width: 390, height: 844 },
      viewPosition: { x: 0, y: 0 },
      deviceScaleFactor: 3,
      viewSize: { width: 390, height: 844 },
      scale: 1,
    })
  }

  private startConsoleCapture(tab: Tab) {
    if (tab.consoleListener) return
    tab.state.consoleCapture = true
    const listener = (_event: Electron.Event, level: number, message: string, line: number, source: string) => {
      const entry = { level, message: redactConsole(message), line, source: redactConsole(source).slice(0, 512) }
      const bytes = Buffer.byteLength(JSON.stringify(entry))
      while (tab.consoleEntries.length >= MAX_CONSOLE_ENTRIES || tab.consoleBytes + bytes > MAX_CONSOLE_BYTES) {
        const removed = tab.consoleEntries.shift()
        if (!removed) break
        tab.consoleBytes -= Buffer.byteLength(JSON.stringify(removed))
      }
      if (bytes > MAX_CONSOLE_BYTES) return
      tab.consoleEntries.push(entry)
      tab.consoleBytes += bytes
    }
    tab.consoleListener = listener
    tab.view.webContents.on("console-message", listener)
    tab.disposers.push(() => tab.view.webContents.removeListener("console-message", listener))
  }

  private invalidateInspection(tab: Tab) {
    tab.revision += 1
    const cancellation = this.cancelElementPicker(tab)
    tab.consoleEntries = []
    tab.consoleBytes = 0
    return cancellation
  }

  private async inspect<T extends BrowserPreviewResult>(tab: Tab, operation: () => Promise<T>): Promise<T> {
    if (tab.inspecting) throw new Error("A Browser Preview inspection is already running")
    tab.inspecting = "generic"
    const revision = tab.revision
    const pending = operation()
    void pending.then(
      () => {
        if (tab.inspecting === "generic") tab.inspecting = undefined
      },
      () => {
        if (tab.inspecting === "generic") tab.inspecting = undefined
      },
    )
    const result = await withTimeout(pending)
    if (revision !== tab.revision || !this.tabs.has(tab.state.id)) {
      if (tab.inspecting === "generic") tab.inspecting = undefined
      throw new Error("Preview changed during inspection")
    }
    return result
  }

  private lifecycle<T>(operation: () => Promise<T>) {
    const result = this.transition.then(operation, operation)
    this.transition = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async cancelElementPicker(tab: Tab) {
    if (tab.inspecting !== "picker" || tab.view.webContents.isDestroyed()) return
    tab.revision += 1
    try {
      await tab.view.webContents.executeJavaScriptInIsolatedWorld(ELEMENT_PICKER_WORLD_ID, [
        { code: CANCEL_ELEMENT_PICKER_SCRIPT },
      ])
    } catch {
      // Navigation or teardown can destroy the renderer while cancellation is in flight.
    } finally {
      if (tab.inspecting === "picker") tab.inspecting = undefined
    }
  }

  private async pickElement(tab: Tab): Promise<BrowserPreviewResult> {
    if (tab.inspecting) throw new Error("A Browser Preview inspection is already running")
    tab.inspecting = "picker"
    const revision = tab.revision
    try {
      let result: unknown
      try {
        result = await tab.view.webContents.executeJavaScriptInIsolatedWorld(
          ELEMENT_PICKER_WORLD_ID,
          [{ code: ELEMENT_PICKER_SCRIPT }],
          true,
        )
      } catch (error) {
        if (revision !== tab.revision || !this.tabs.has(tab.state.id) || tab.view.webContents.isDestroyed()) {
          return { type: "none" }
        }
        throw error
      }
      if (result && typeof result === "object" && "cancelled" in result && result.cancelled === true) {
        return { type: "none" }
      }
      if (revision !== tab.revision || !this.tabs.has(tab.state.id)) return { type: "none" }
      return { type: "element", element: normalizePreviewElement(result, tab.state.url) }
    } finally {
      if (revision === tab.revision && tab.inspecting === "picker") tab.inspecting = undefined
    }
  }

  private update(tab: Tab) {
    const contents = tab.view.webContents
    if (!contents.isDestroyed()) {
      tab.state.canGoBack = contents.canGoBack()
      tab.state.canGoForward = contents.canGoForward()
    }
    if (this.activeTabId === tab.state.id && !tab.state.error) this.attachActive()
    this.emit()
  }

  private emit() {
    if (this.retired || !this.isActive() || this.win.isDestroyed() || this.win.webContents.isDestroyed()) return
    this.win.webContents.send("browser-preview-state", this.state())
  }

  retire() {
    this.retired = true
    return this.destroyAll(false)
  }
}

export function getBrowserPreview(win: BrowserWindow, sessionID?: string) {
  let registry = controllers.get(win)
  if (!registry) {
    registry = { sessions: new Map() }
    controllers.set(win, registry)
  }
  if (!sessionID && registry.active) return registry.active
  sessionID ??= "default"
  let controller = registry.sessions.get(sessionID)
  if (!controller) {
    controller = new BrowserPreviewController(win, () => registry?.active === controller)
    registry.sessions.set(sessionID, controller)
  }
  if (registry.active !== controller) {
    registry.active?.deactivate()
    registry.active = controller
  }
  return controller
}

export async function destroyBrowserPreview(win: BrowserWindow) {
  const registry = controllers.get(win)
  if (!registry) return
  controllers.delete(win)
  await Promise.all([...registry.sessions.values()].map((controller) => controller.retire()))
}

export function rejectBrowserPreviewCertificate(contents: WebContents) {
  return controllerByContents.has(contents.id)
}

app.on("certificate-error", (event, contents, _url, _error, _certificate, callback) => {
  if (!rejectBrowserPreviewCertificate(contents)) return
  event.preventDefault()
  callback(false)
})
