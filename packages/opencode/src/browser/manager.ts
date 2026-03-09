import { type Browser, type BrowserContext, type Page } from "playwright"
import { Log } from "@/util/log"
import path from "path"
import { spawn, ChildProcess } from "child_process"

const log = Log.create({ service: "browser.manager" })

export interface BrowserConfig {
  profilePath?: string
  headed?: boolean
  slowMo?: number
  defaultTimeout?: number
  viewportWidth?: number
  viewportHeight?: number
}

export interface PageInfo {
  url: string
  title: string
  scroll: { x: number; y: number }
  viewport: { width: number; height: number }
}

export interface ElementBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface InteractiveElement {
  index: number
  tagName: string
  selector: string
  text: string
  type?: string
  placeholder?: string
  ariaLabel?: string
  textContent?: string
  bounds: ElementBounds
  isVisible: boolean
  isClickable: boolean
  isInput: boolean
}

/**
 * BrowserManager - Hybrid approach
 * Runs Bun on main process, spawns Node.js for Chromium
 */
export namespace BrowserManager {
  let currentPage: Page | null = null
  let browserServerProcess: ChildProcess | null = null
  let config: BrowserConfig = {}
  let isInitialized = false
  let cursorPosition = { x: 0, y: 0 }

  const DEFAULT_TIMEOUT = 30000
  const DEFAULT_VIEWPORT = { width: 1280, height: 720 }

  /**
   * Start Node.js browser server
   */
  async function startBrowserServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      const serverPath = path.join(import.meta.dir, "..", "..", "browser-server.js")
      const debugLogs = process.env.OPENCODE_BROWSER_DEBUG === "true"
      const stdio: any = debugLogs ? ["ignore", "pipe", "pipe"] : "ignore"

      log.info("spawning browser server process")
      browserServerProcess = spawn("node", [serverPath], {
        stdio,
        detached: false,
      })

      if (debugLogs) {
        browserServerProcess.stdout?.on("data", (data) => {
          console.log(`[node] ${data.toString().trim()}`)
        })

        browserServerProcess.stderr?.on("data", (data) => {
          console.error(`[node] ${data.toString().trim()}`)
        })
      }

      // Wait for server to start
      let attempts = 0
      const checkServer = async () => {
        try {
          const response = await fetch("http://localhost:9999/health", {
            method: "GET",
            signal: AbortSignal.timeout(500),
          })
          if (response.ok) {
            log.info("browser server ready")
            resolve()
          } else {
            throw new Error("Not ready")
          }
        } catch (error) {
          attempts++
          if (attempts > 50) {
            reject(new Error("Browser server failed to start"))
          } else {
            setTimeout(checkServer, 100)
          }
        }
      }

      setTimeout(checkServer, 200)
    })
  }

  /**
   * Initialize browser
   */
  export async function init(opts: BrowserConfig = {}): Promise<void> {
    if (isInitialized) {
      log.debug("browser already initialized")
      return
    }

    config = {
      headed: opts.headed ?? true,
      slowMo: opts.slowMo,
      defaultTimeout: opts.defaultTimeout ?? DEFAULT_TIMEOUT,
      viewportWidth: opts.viewportWidth ?? DEFAULT_VIEWPORT.width,
      viewportHeight: opts.viewportHeight ?? DEFAULT_VIEWPORT.height,
    }

    log.info("initializing browser", { headed: config.headed })

    // Start Node.js server if not running
    if (!browserServerProcess) {
      await startBrowserServer()
    }

    // Initialize browser on Node.js server
    const initResponse = await fetch(`http://localhost:9999/init?headed=${config.headed}`, {
      method: "GET",
      signal: AbortSignal.timeout(60000),
    })

    if (!initResponse.ok) {
      throw new Error(`Failed to initialize browser: ${initResponse.statusText}`)
    }

    isInitialized = true
    log.info("browser initialized successfully")
  }

  /**
   * Ensure initialized
   */
  async function ensureInitialized(): Promise<void> {
    if (!isInitialized) {
      await init()
    }
  }

  /**
   * Get current page (simple wrapper)
   */
  export async function getPage(): Promise<Page> {
    await ensureInitialized()
    // For now, return a dummy page - all operations go through HTTP to Node.js server
    if (!currentPage) {
      // Create a minimal page object for compatibility
      currentPage = {} as Page
    }
    return currentPage
  }

  /**
   * Navigate to URL via Node.js server
   */
  export async function navigate(
    url: string,
    options?: {
      waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit"
      timeout?: number
    },
  ): Promise<PageInfo> {
    await ensureInitialized()
    const normalizedUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`

    log.info("navigating to URL", { url: normalizedUrl })

    const params = new URLSearchParams({
      url: normalizedUrl,
      waitUntil: options?.waitUntil ?? "domcontentloaded",
      timeout: String(options?.timeout ?? config.defaultTimeout),
    })

    const response = await fetch(`http://localhost:9999/navigate?${params}`, {
      method: "GET",
      signal: AbortSignal.timeout((options?.timeout ?? DEFAULT_TIMEOUT) + 5000),
    })

    if (!response.ok) {
      throw new Error(`Navigation failed: ${response.statusText}`)
    }

    const data = (await response.json()) as PageInfo
    return data
  }

  /**
   * Get page info from Node.js server
   */
  export async function getPageInfo(): Promise<PageInfo> {
    await ensureInitialized()

    const response = await fetch("http://localhost:9999/pageInfo", {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`Failed to get page info: ${response.statusText}`)
    }

    const data = (await response.json()) as PageInfo
    return data
  }

  /**
   * Screenshot via Node.js server
   */
  export async function screenshot(options?: {
    fullPage?: boolean
    selector?: string
    quality?: number
    clip?: { x: number; y: number; width: number; height: number }
  }): Promise<Buffer> {
    await ensureInitialized()

    const params = new URLSearchParams({
      fullPage: String(options?.fullPage ?? false),
      selector: options?.selector ?? "",
      quality: String(options?.quality ?? 95),
    })

    const response = await fetch(`http://localhost:9999/screenshot?${params}`, {
      method: "GET",
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      throw new Error(`Screenshot failed: ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    return Buffer.from(buffer)
  }

  /**
   * Screenshot base64
   */
  export async function screenshotBase64(options?: Parameters<typeof screenshot>[0]): Promise<string> {
    const buffer = await screenshot(options)
    return `data:image/png;base64,${buffer.toString("base64")}`
  }

  /**
   * Click via Node.js server
   */
  export async function click(options: {
    selector?: string
    x?: number
    y?: number
    button?: "left" | "right" | "middle"
    clickCount?: number
    coordinates?: { x: number; y: number }
    timeout?: number
  }): Promise<void> {
    await ensureInitialized()

    const params = new URLSearchParams({
      selector: options.selector ?? "",
      x: String(options.x ?? options.coordinates?.x ?? 0),
      y: String(options.y ?? options.coordinates?.y ?? 0),
      button: options.button ?? "left",
      clickCount: String(options.clickCount ?? 1),
      timeout: String(options.timeout ?? config.defaultTimeout),
    })

    const response = await fetch(`http://localhost:9999/click?${params}`, {
      method: "GET",
      signal: AbortSignal.timeout((options.timeout ?? DEFAULT_TIMEOUT) + 5000),
    })

    const payload = await response.json().catch(() => null)

    if (!response.ok || payload?.success === false) {
      const message = payload?.error || response.statusText || "Unknown error"
      throw new Error(`Click failed: ${message}`)
    }

    const result =
      options.x !== undefined && options.y !== undefined ? { x: options.x, y: options.y } : options.coordinates
    if (result) {
      cursorPosition = result
    }
  }

  /**
   * Type via Node.js server
   */
  export async function type(options: {
    selector?: string
    text: string
    clear?: boolean
    pressEnter?: boolean
    delay?: number
    timeout?: number
  }): Promise<void> {
    await ensureInitialized()

    const params = new URLSearchParams({
      selector: options.selector ?? "",
      text: options.text,
      clear: String(options.clear ?? false),
      pressEnter: String(options.pressEnter ?? false),
      delay: String(options.delay ?? 50),
      timeout: String(options.timeout ?? config.defaultTimeout),
    })

    const response = await fetch(`http://localhost:9999/type?${params}`, {
      method: "GET",
      signal: AbortSignal.timeout((options.timeout ?? DEFAULT_TIMEOUT) + 5000),
    })

    const payload = await response.json().catch(() => null)
    if (!response.ok || payload?.success === false) {
      const message = payload?.error || response.statusText || "Unknown error"
      throw new Error(`Type failed: ${message}`)
    }
  }

  /**
   * Scroll via Node.js server
   */
  export async function scroll(options: {
    direction?: "up" | "down" | "left" | "right"
    amount?: number
    selector?: string
    toElement?: string
    position?: { x: number; y: number }
    smooth?: boolean
  }): Promise<{ x: number; y: number }> {
    await ensureInitialized()

    const params = new URLSearchParams({
      direction: options.direction ?? "down",
      amount: String(options.amount ?? 500),
      selector: options.selector ?? "",
      toElement: options.toElement ?? "",
      posX: String(options.position?.x ?? 0),
      posY: String(options.position?.y ?? 0),
      smooth: String(options.smooth ?? true),
    })

    const response = await fetch(`http://localhost:9999/scroll?${params}`, {
      method: "GET",
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      throw new Error(`Scroll failed: ${response.statusText}`)
    }

    const data = (await response.json()) as { x: number; y: number }
    return data
  }

  /**
   * Move cursor via HTTP
   */
  export async function moveCursor(pos: { x: number; y: number }): Promise<{ x: number; y: number }> {
    await ensureInitialized()
    cursorPosition = pos
    return cursorPosition
  }

  /**
   * Get cursor position
   */
  export function getCursorPosition(): { x: number; y: number } {
    return { ...cursorPosition }
  }

  /**
   * Get element at coordinates via HTTP
   */
  export async function getElementAt(
    x: number,
    y: number,
  ): Promise<{
    tagName: string
    id?: string
    className?: string
    text: string
    bounds: ElementBounds
  } | null> {
    await ensureInitialized()

    const params = new URLSearchParams({
      x: String(x),
      y: String(y),
    })

    try {
      const response = await fetch(`http://localhost:9999/elementAt?${params}`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        return null
      }

      const data = (await response.json()) as {
        tagName: string
        id?: string
        className?: string
        text: string
        bounds: ElementBounds
      } | null

      return data
    } catch {
      return null
    }
  }

  /**
   * Get interactive elements via HTTP
   */
  export async function getInteractiveElements(options?: {
    viewportOnly?: boolean
    type?: "all" | "clickable" | "input"
  }): Promise<InteractiveElement[]> {
    await ensureInitialized()

    const params = new URLSearchParams({
      viewportOnly: String(options?.viewportOnly ?? true),
      type: options?.type ?? "all",
    })

    try {
      const response = await fetch(`http://localhost:9999/elements?${params}`, {
        method: "GET",
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) {
        return []
      }

      const data = (await response.json()) as InteractiveElement[]
      return data
    } catch {
      return []
    }
  }

  /**
   * Get element bounds via HTTP
   */
  export async function getElementBounds(selector: string): Promise<ElementBounds | null> {
    await ensureInitialized()

    const params = new URLSearchParams({
      selector,
    })

    try {
      const response = await fetch(`http://localhost:9999/elementBounds?${params}`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        return null
      }

      const data = (await response.json()) as ElementBounds | null
      return data
    } catch {
      return null
    }
  }

  /**
   * Press keyboard key
   */
  export async function pressKey(key: string, modifiers?: string[]): Promise<{ success: boolean; error?: string }> {
    await ensureInitialized()

    const params = new URLSearchParams({
      key,
      modifiers: (modifiers ?? []).join(","),
    })

    const response = await fetch(`http://localhost:9999/pressKey?${params}`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    })

    const payload = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string }

    if (!response.ok || payload?.success === false) {
      return { success: false, error: payload?.error || response.statusText }
    }

    return { success: true }
  }

  /**
   * Hover over element
   */
  export async function hover(options: {
    selector?: string
    ref?: string
    coordinates?: { x: number; y: number }
    timeout?: number
  }): Promise<{ success: boolean; error?: string }> {
    await ensureInitialized()

    const params = new URLSearchParams({
      selector: options.selector ?? "",
      ref: options.ref ?? "",
      x: String(options.coordinates?.x ?? 0),
      y: String(options.coordinates?.y ?? 0),
      timeout: String(options.timeout ?? config.defaultTimeout),
    })

    const response = await fetch(`http://localhost:9999/hover?${params}`, {
      method: "GET",
      signal: AbortSignal.timeout((options.timeout ?? DEFAULT_TIMEOUT) + 5000),
    })

    const payload = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string }

    if (!response.ok || payload?.success === false) {
      return { success: false, error: payload?.error || response.statusText }
    }

    // Update cursor position if we have coordinates
    if (options.coordinates) {
      cursorPosition = options.coordinates
    }

    return { success: true }
  }

  /**
   * Select option in dropdown
   */
  export async function select(options: {
    selector: string
    ref?: string
    values: string[]
    timeout?: number
  }): Promise<{ success: boolean; error?: string }> {
    await ensureInitialized()

    const params = new URLSearchParams({
      selector: options.selector,
      ref: options.ref ?? "",
      values: options.values.join("|||"),
      timeout: String(options.timeout ?? config.defaultTimeout),
    })

    const response = await fetch(`http://localhost:9999/select?${params}`, {
      method: "GET",
      signal: AbortSignal.timeout((options.timeout ?? DEFAULT_TIMEOUT) + 5000),
    })

    const payload = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string }

    if (!response.ok || payload?.success === false) {
      return { success: false, error: payload?.error || response.statusText }
    }

    return { success: true }
  }

  /**
   * Check (simplified stub)
   */
  export async function check(selector: string, checked: boolean = true): Promise<void> {
    await ensureInitialized()

    const params = new URLSearchParams({
      selector,
      checked: String(checked),
    })

    const response = await fetch(`http://localhost:9999/check?${params}`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`Check failed: ${response.statusText}`)
    }
  }

  /**
   * Close page (simplified)
   */
  export async function closePage(): Promise<void> {
    await ensureInitialized()

    const response = await fetch("http://localhost:9999/closePage", {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`Close page failed: ${response.statusText}`)
    }
  }

  /**
   * Wait for conditions
   */
  export async function wait(options: {
    loadState?: "load" | "domcontentloaded" | "networkidle"
    selector?: string
    visible?: boolean
    timeout?: number
  }): Promise<void> {
    await ensureInitialized()

    const params = new URLSearchParams({
      loadState: options.loadState ?? "domcontentloaded",
      selector: options.selector ?? "",
      visible: String(options.visible ?? false),
      timeout: String(options.timeout ?? config.defaultTimeout),
    })

    const response = await fetch(`http://localhost:9999/wait?${params}`, {
      method: "GET",
      signal: AbortSignal.timeout((options.timeout ?? DEFAULT_TIMEOUT) + 5000),
    })

    if (!response.ok) {
      throw new Error(`Wait failed: ${response.statusText}`)
    }
  }

  /**
   * Get page content
   */
  export async function getContent(options?: {
    format?: "text" | "html" | "structured"
    selector?: string
  }): Promise<{ text: string; html: string }> {
    await ensureInitialized()

    const params = new URLSearchParams({
      format: options?.format ?? "text",
      selector: options?.selector ?? "",
    })

    const response = await fetch(`http://localhost:9999/content?${params}`, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      throw new Error(`Content retrieval failed: ${response.statusText}`)
    }

    const data = (await response.json()) as { text: string; html: string }
    return data
  }

  /**
   * Drag from one element to another
   */
  export async function drag(options: {
    startElement?: string
    startRef?: string
    endElement?: string
    endRef?: string
    startCoordinates?: { x: number; y: number }
    endCoordinates?: { x: number; y: number }
  }): Promise<{ success: boolean; error?: string }> {
    await ensureInitialized()

    const params = new URLSearchParams({
      startElement: options.startElement ?? "",
      startRef: options.startRef ?? "",
      endElement: options.endElement ?? "",
      endRef: options.endRef ?? "",
      startX: String(options.startCoordinates?.x ?? 0),
      startY: String(options.startCoordinates?.y ?? 0),
      endX: String(options.endCoordinates?.x ?? 0),
      endY: String(options.endCoordinates?.y ?? 0),
    })

    const response = await fetch(`http://localhost:9999/drag?${params}`, {
      method: "GET",
      signal: AbortSignal.timeout(30000),
    })

    const payload = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string }

    if (!response.ok || payload?.success === false) {
      return { success: false, error: payload?.error || response.statusText }
    }

    return { success: true }
  }

  /**
   * Fill multiple form fields at once
   */
  export async function fillForm(
    fields: Array<{ selector: string; value: string; ref?: string }>,
  ): Promise<{ success: boolean; filled: number; error?: string }> {
    await ensureInitialized()

    const response = await fetch(`http://localhost:9999/fillForm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
      signal: AbortSignal.timeout(30000),
    })

    const payload = (await response.json().catch(() => ({}))) as {
      success?: boolean
      filled?: number
      error?: string
    }

    if (!response.ok || payload?.success === false) {
      return { success: false, filled: 0, error: payload?.error || response.statusText }
    }

    return { success: true, filled: payload.filled ?? fields.length }
  }

  /**
   * Evaluate JavaScript on page
   */
  export async function evaluate(
    code: string,
    options?: { element?: string; ref?: string },
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    await ensureInitialized()

    const response = await fetch(`http://localhost:9999/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        element: options?.element,
        ref: options?.ref,
      }),
      signal: AbortSignal.timeout(30000),
    })

    const payload = (await response.json().catch(() => ({}))) as {
      success?: boolean
      result?: unknown
      error?: string
    }

    if (!response.ok || payload?.success === false) {
      return { success: false, error: payload?.error || response.statusText }
    }

    return { success: true, result: payload.result }
  }

  /**
   * Get console messages from page
   */
  export async function getConsoleMessages(
    level?: "error" | "warning" | "info" | "log",
  ): Promise<Array<{ level: string; text: string; timestamp: number }>> {
    await ensureInitialized()

    const params = new URLSearchParams({
      level: level ?? "info",
    })

    const response = await fetch(`http://localhost:9999/consoleMessages?${params}`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      return []
    }

    const data = (await response.json()) as Array<{ level: string; text: string; timestamp: number }>
    return data
  }

  /**
   * Get network requests
   */
  export async function getNetworkRequests(
    includeStatic?: boolean,
  ): Promise<Array<{ url: string; method: string; status: number; type: string }>> {
    await ensureInitialized()

    const params = new URLSearchParams({
      includeStatic: String(includeStatic ?? false),
    })

    const response = await fetch(`http://localhost:9999/networkRequests?${params}`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      return []
    }

    const data = (await response.json()) as Array<{ url: string; method: string; status: number; type: string }>
    return data
  }

  /**
   * Handle dialog (alert, confirm, prompt)
   */
  export async function handleDialog(
    accept: boolean,
    promptText?: string,
  ): Promise<{ success: boolean; error?: string }> {
    await ensureInitialized()

    const params = new URLSearchParams({
      accept: String(accept),
      promptText: promptText ?? "",
    })

    const response = await fetch(`http://localhost:9999/handleDialog?${params}`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    })

    const payload = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string }

    if (!response.ok || payload?.success === false) {
      return { success: false, error: payload?.error || response.statusText }
    }

    return { success: true }
  }

  /**
   * Upload files to a file input element or wait for file chooser dialog
   * @param selector - Optional CSS selector for file input element. If omitted, waits for file chooser dialog.
   * @param paths - Array of file paths to upload
   */
  export async function uploadFiles(
    selector: string | undefined,
    paths: string[],
  ): Promise<{ success: boolean; count?: number; error?: string }> {
    await ensureInitialized()

    const response = await fetch(`http://localhost:9999/uploadFiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selector, paths }),
      signal: AbortSignal.timeout(30000),
    })

    const payload = (await response.json().catch(() => ({}))) as { success?: boolean; count?: number; error?: string }

    if (!response.ok || payload?.success === false) {
      return { success: false, error: payload?.error || response.statusText }
    }

    return { success: true, count: payload.count }
  }

  /**
   * Resize browser window
   */
  export async function resize(width: number, height: number): Promise<{ success: boolean; error?: string }> {
    await ensureInitialized()

    const params = new URLSearchParams({
      width: String(width),
      height: String(height),
    })

    const response = await fetch(`http://localhost:9999/resize?${params}`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    })

    const payload = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string }

    if (!response.ok || payload?.success === false) {
      return { success: false, error: payload?.error || response.statusText }
    }

    return { success: true }
  }

  /**
   * Tab management
   */
  export async function tabs(
    action: "list" | "create" | "close" | "select",
    index?: number,
  ): Promise<{
    success: boolean
    tabs?: Array<{ index: number; url: string; title: string; active: boolean }>
    error?: string
  }> {
    await ensureInitialized()

    const params = new URLSearchParams({
      action,
      index: String(index ?? -1),
    })

    const response = await fetch(`http://localhost:9999/tabs?${params}`, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    })

    const payload = (await response.json().catch(() => ({}))) as {
      success?: boolean
      tabs?: Array<{ index: number; url: string; title: string; active: boolean }>
      error?: string
    }

    if (!response.ok || payload?.success === false) {
      return { success: false, error: payload?.error || response.statusText }
    }

    return { success: true, tabs: payload.tabs }
  }

  /**
   * Get page accessibility snapshot
   */
  export async function snapshot(): Promise<{
    snapshot: string
    elementMap: Record<string, { ref: string; role: string; name: string }>
  }> {
    await ensureInitialized()

    const response = await fetch(`http://localhost:9999/snapshot`, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      return { snapshot: "", elementMap: {} }
    }

    const data = (await response.json()) as {
      snapshot: string
      elementMap: Record<string, { ref: string; role: string; name: string }>
    }
    return data
  }

  /**
   * Navigate back
   */
  export async function goBack(): Promise<{ success: boolean; error?: string }> {
    await ensureInitialized()

    const response = await fetch(`http://localhost:9999/goBack`, {
      method: "GET",
      signal: AbortSignal.timeout(30000),
    })

    const payload = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string }

    if (!response.ok || payload?.success === false) {
      return { success: false, error: payload?.error || response.statusText }
    }

    return { success: true }
  }

  /**
   * Navigate forward
   */
  export async function goForward(): Promise<{ success: boolean; error?: string }> {
    await ensureInitialized()

    const response = await fetch(`http://localhost:9999/goForward`, {
      method: "GET",
      signal: AbortSignal.timeout(30000),
    })

    const payload = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string }

    if (!response.ok || payload?.success === false) {
      return { success: false, error: payload?.error || response.statusText }
    }

    return { success: true }
  }

  /**
   * List elements by type with efficient numbering for AI context
   */
  export async function listElements(
    type: "buttons" | "inputs" | "textareas" | "links" | "all",
  ): Promise<{ elements: InteractiveElement[]; summary: string }> {
    await ensureInitialized()

    const params = new URLSearchParams({ type })

    const response = await fetch(`http://localhost:9999/listElements?${params}`, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      return { elements: [], summary: "" }
    }

    const elements = (await response.json()) as InteractiveElement[]

    // Generate compact summary for AI context efficiency
    let summary: string
    switch (type) {
      case "buttons":
        summary = elements
          .map((el, i) => `[${i + 1}] ${el.text?.slice(0, 30) || el.ariaLabel || el.tagName}`)
          .join("\n")
        break
      case "inputs":
        summary = elements
          .map(
            (el, i) =>
              `[${i + 1}] ${el.tagName}${el.type ? `[${el.type}]` : ""} ${el.placeholder || el.ariaLabel || el.selector?.slice(0, 20) || ""}`,
          )
          .join("\n")
        break
      case "textareas":
        summary = elements.map((el, i) => `[${i + 1}] textarea ${el.placeholder || el.ariaLabel || ""}`).join("\n")
        break
      case "links":
        summary = elements.map((el, i) => `[${i + 1}] ${el.text?.slice(0, 40) || "link"}`).join("\n")
        break
      default:
        summary = elements
          .map((el, i) => `[${i + 1}] ${el.tagName} ${el.text?.slice(0, 30) || el.ariaLabel || ""}`)
          .join("\n")
    }

    return { elements, summary }
  }

  /**
   * Search elements with filters
   */
  export async function searchElements(options: {
    text?: string
    innerHTML?: string
    id?: string
    className?: string
    tagName?: string
    role?: string
    placeholder?: string
  }): Promise<InteractiveElement[]> {
    await ensureInitialized()

    const params = new URLSearchParams()
    if (options.text) params.set("text", options.text)
    if (options.innerHTML) params.set("innerHTML", options.innerHTML)
    if (options.id) params.set("id", options.id)
    if (options.className) params.set("className", options.className)
    if (options.tagName) params.set("tagName", options.tagName)
    if (options.role) params.set("role", options.role)
    if (options.placeholder) params.set("placeholder", options.placeholder)

    const response = await fetch(`http://localhost:9999/searchElements?${params}`, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      return []
    }

    const data = (await response.json()) as InteractiveElement[]
    return data
  }

  /**
   * Animate cursor to position (shows visual cursor overlay)
   */
  export async function animateCursorTo(
    targetX: number,
    targetY: number,
    isDragging?: boolean,
  ): Promise<{ success: boolean }> {
    await ensureInitialized()

    const params = new URLSearchParams({
      fromX: String(cursorPosition.x),
      fromY: String(cursorPosition.y),
      toX: String(targetX),
      toY: String(targetY),
      isDragging: String(isDragging ?? false),
    })

    const response = await fetch(`http://localhost:9999/animateCursor?${params}`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    })

    // Update cursor position regardless of animation success
    cursorPosition = { x: targetX, y: targetY }

    if (!response.ok) {
      return { success: false }
    }

    return { success: true }
  }

  /**
   * Show/hide cursor overlay
   */
  export async function showCursor(show: boolean): Promise<{ success: boolean }> {
    await ensureInitialized()

    const params = new URLSearchParams({
      show: String(show),
    })

    const response = await fetch(`http://localhost:9999/showCursor?${params}`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    })

    if (!response.ok) {
      return { success: false }
    }

    return { success: true }
  }

  /**
   * Run Playwright code snippet
   */
  export async function runCode(code: string): Promise<{ success: boolean; result?: unknown; error?: string }> {
    await ensureInitialized()

    const response = await fetch(`http://localhost:9999/runCode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(60000),
    })

    const payload = (await response.json().catch(() => ({}))) as {
      success?: boolean
      result?: unknown
      error?: string
    }

    if (!response.ok || payload?.success === false) {
      return { success: false, error: payload?.error || response.statusText }
    }

    return { success: true, result: payload.result }
  }

  /**
   * Verify element is visible (for testing)
   */
  export async function verifyElementVisible(options: {
    role?: string
    accessibleName?: string
    selector?: string
    ref?: string
  }): Promise<{ visible: boolean; error?: string }> {
    await ensureInitialized()

    const params = new URLSearchParams({
      role: options.role ?? "",
      accessibleName: options.accessibleName ?? "",
      selector: options.selector ?? "",
      ref: options.ref ?? "",
    })

    const response = await fetch(`http://localhost:9999/verifyElementVisible?${params}`, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    })

    const payload = (await response.json().catch(() => ({}))) as { visible?: boolean; error?: string }

    return { visible: payload.visible ?? false, error: payload.error }
  }

  /**
   * Verify text is visible (for testing)
   */
  export async function verifyTextVisible(text: string): Promise<{ visible: boolean; error?: string }> {
    await ensureInitialized()

    const params = new URLSearchParams({ text })

    const response = await fetch(`http://localhost:9999/verifyTextVisible?${params}`, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    })

    const payload = (await response.json().catch(() => ({}))) as { visible?: boolean; error?: string }

    return { visible: payload.visible ?? false, error: payload.error }
  }

  /**
   * Generate locator for element (for testing)
   */
  export async function generateLocator(options: {
    element: string
    ref: string
  }): Promise<{ locator: string; error?: string }> {
    await ensureInitialized()

    const params = new URLSearchParams({
      element: options.element,
      ref: options.ref,
    })

    const response = await fetch(`http://localhost:9999/generateLocator?${params}`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    })

    const payload = (await response.json().catch(() => ({}))) as { locator?: string; error?: string }

    return { locator: payload.locator ?? "", error: payload.error }
  }

  /**
   * Close browser
   */
  export async function close(): Promise<void> {
    if (browserServerProcess) {
      browserServerProcess.kill()
      browserServerProcess = null
    }
    isInitialized = false

    log.info("browser closed")
  }

  /**
   * Is ready
   */
  export function isReady(): boolean {
    return isInitialized
  }

  /**
   * Register cleanup
   */
  export function registerCleanup(): void {
    const cleanup = async () => {
      await close()
    }

    process.on("exit", () => {
      cleanup().catch(() => {})
    })
    process.on("SIGINT", () => {
      cleanup().then(() => process.exit(0))
    })
    process.on("SIGTERM", () => {
      cleanup().then(() => process.exit(0))
    })

    log.debug("browser cleanup registered")
  }

  /**
   * Get config
   */
  export function getConfig(): BrowserConfig {
    return { ...config }
  }
}
