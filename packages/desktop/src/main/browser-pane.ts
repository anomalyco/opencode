export * as BrowserPane from "./browser-pane"

import { randomUUID } from "node:crypto"
import {
  BrowserDriver,
  OpenCode,
  type BrowserAttachment,
  type BrowserRegistration,
  type ChromiumController,
  type ChromiumPort,
  type OpenCodeClient,
} from "@opencode-ai/client/node"
import type {
  BrowserPaneBinding,
  BrowserPaneLayout,
} from "@opencode-ai/app/browser-pane"
import { BrowserWindow, WebContentsView } from "electron"
import { BrowserPaneIPC, type BrowserPaneOpenEvent } from "../browser-pane-ipc"
import { installBrowserNetwork } from "./browser-network"
import { allowedDestination, destinationOrigin, normalizeBounds } from "./browser-pane-policy"

type ViewState = {
  readonly url: string
  readonly title: string
  readonly loading: boolean
  readonly canGoBack: boolean
  readonly canGoForward: boolean
}
type ViewEvent = { readonly state: ViewState; readonly mainDocumentChanged: boolean }
type Page = {
  readonly view: WebContentsView; readonly abort: AbortController
  readonly listeners: Set<(event: ViewEvent) => void>
  approvedOrigin: string; closed: boolean
  attachment?: BrowserAttachment<ChromiumController<Page>>
}
type Entry = {
  readonly binding: BrowserPaneBinding; readonly win: BrowserWindow
  readonly registration: BrowserRegistration; readonly onClosed: () => void
  page?: Page
}

export function createBrowserPane() {
  const clients = new Map<string, OpenCodeClient>()
  const entries = new Map<string, Entry>()

  const unregister = async (win: BrowserWindow, bindingID: string) => {
    const entry = ownedEntry(entries, win, bindingID)
    await closeRegistration(entry)
  }

  const closeRegistration = async (entry: Entry) => {
    const bindingID = entry.binding.bindingID
    if (entries.get(bindingID) !== entry) return
    entries.delete(bindingID)
    closePage(entry)
    // Electron destroys the parent WebContents before BrowserWindow emits closed.
    if (!entry.win.isDestroyed()) entry.win.off("closed", entry.onClosed)
    await entry.registration.close()
  }

  const register = async (win: BrowserWindow, input: unknown) => {
    const binding = parseBinding(input)
    const previous = entries.get(binding.bindingID)
    if (previous) await closeRegistration(previous)
    const key = JSON.stringify(binding.endpoint)
    const client =
      clients.get(key) ??
      OpenCode.make({
        baseUrl: binding.endpoint.url,
        headers: binding.endpoint.password
          ? {
              Authorization: `Basic ${Buffer.from(`${binding.endpoint.username ?? "opencode"}:${binding.endpoint.password}`).toString("base64")}`,
            }
          : undefined,
      })
    clients.set(key, client)
    const registration = await client.browser.register({
      sessionID: binding.sessionID,
      open: () => {
        if (!win.isDestroyed()) {
          win.webContents.send(BrowserPaneIPC.open, { bindingID: binding.bindingID } satisfies BrowserPaneOpenEvent)
        }
      },
    })
    if (win.isDestroyed()) {
      await registration.close()
      throw new Error("Browser pane window closed during registration")
    }
    const onClosed = () => void closeRegistration(entry)
    const entry: Entry = { binding, win, registration, onClosed }
    entries.set(binding.bindingID, entry)
    win.once("closed", onClosed)
  }

  const setLayout = (win: BrowserWindow, input: unknown) => {
    const request = parseLayout(input)
    const entry = ownedEntry(entries, win, request.bindingID)
    if (!request.layout) return closePage(entry)
    if (!entry.page) createPage(entry)
    const page = entry.page
    if (!page || page.closed) return
    if (!request.layout.visible || !request.layout.bounds) {
      page.view.setVisible(false)
      return
    }
    const bounds = normalizeBounds(request.layout.bounds, win.contentView.getBounds())
    if (!bounds) return page.view.setVisible(false)
    page.view.setBounds(bounds)
    page.view.setVisible(true)
  }

  return {
    register,
    unregister,
    setLayout,
    dispose() {
      entries.forEach((entry) => void closeRegistration(entry))
      clients.clear()
    },
  }

  function publish(page: Page, state: ViewState, mainDocumentChanged = false) {
    page.listeners.forEach((listener) => listener({ state, mainDocumentChanged }))
  }

  function createPage(entry: Entry) {
    const view = new WebContentsView({
      webPreferences: {
        partition: `opencode-browser-${randomUUID()}`,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
        devTools: false,
      },
    })
    const page: Page = {
      view,
      abort: new AbortController(),
      listeners: new Set(),
      approvedOrigin: "about:blank",
      closed: false,
    }
    entry.page = page
    view.setVisible(false)
    entry.win.contentView.addChildView(view)
    const contents = view.webContents
    contents.setWindowOpenHandler(() => ({ action: "deny" }))
    const guardNavigation = (event: Electron.Event<{ url: string }>) => {
      if (allowedDestination(event.url, page.approvedOrigin)) return
      event.preventDefault()
    }
    contents.on("will-navigate", guardNavigation)
    contents.on("will-redirect", guardNavigation)
    const update = () => publish(page, readState(page))
    contents.on("did-start-loading", update)
    contents.on("did-stop-loading", update)
    contents.on("did-navigate", update)
    contents.on("did-navigate-in-page", update)
    contents.on("page-title-updated", update)
    contents.on("did-start-navigation", (event) => {
      if (!event.isMainFrame) return
      publish(page, { ...readState(page), url: event.url, loading: true }, !event.isSameDocument)
    })

    const driver = BrowserDriver.chromium<Page>(async ({ proxy, signal }) => {
      const cleanupNetwork = await installBrowserNetwork({ proxy, session: contents.session, webContents: contents })
      const browserDebugger = contents.debugger
      let disposed = false
      let queue = Promise.resolve()
      const port = {
        resource: page,
        state: () => readState(page),
        subscribe(listener: (event: ViewEvent) => void) {
          page.listeners.add(listener)
          return () => page.listeners.delete(listener)
        },
        navigate(url: string) {
          const origin = destinationOrigin(url)
          if (!origin) throw new Error("Only HTTP and HTTPS browser navigation is allowed")
          page.approvedOrigin = origin
          return contents.loadURL(url)
        },
        back: () => navigateHistory(page, -1),
        forward: () => navigateHistory(page, 1),
        reload: () => contents.reload(),
        stop: () => {
          if (!contents.isDestroyed()) contents.stop()
        },
        send(command) {
          const result = queue.then(() => {
            if (page.closed || contents.isDestroyed()) throw new Error("The browser page is no longer available")
            if (!browserDebugger.isAttached()) browserDebugger.attach("1.3")
            return browserDebugger.sendCommand(command.method, command.params)
          })
          queue = result.then(
            () => undefined,
            () => undefined,
          )
          return result
        },
        viewport: () => view.getBounds(),
        async screenshot(maxDimension: number) {
          const source = await contents.capturePage()
          const size = source.getSize()
          const scale = Math.min(1, Math.floor(maxDimension) / Math.max(size.width, size.height))
          const image =
            scale < 1
              ? source.resize({
                  width: Math.max(1, Math.round(size.width * scale)),
                  height: Math.max(1, Math.round(size.height * scale)),
                  quality: "good",
                })
              : source
          return { data: new Uint8Array(image.toPNG()), ...image.getSize() }
        },
        dispose() {
          if (disposed) return
          disposed = true
          cleanupNetwork()
        },
      } satisfies ChromiumPort<Page>
      if (signal.aborted) throw signal.reason
      await contents.loadURL("about:blank")
      return port
    })
    void entry.registration.attach({ driver, signal: page.abort.signal }).then(
      (attachment) => {
        if (page.closed) return attachment.close()
        page.attachment = attachment
      },
      () => undefined,
    )
  }
}

export type Controller = ReturnType<typeof createBrowserPane>

function closePage(entry: Entry) {
  const page = entry.page
  if (!page || page.closed) return
  entry.page = undefined
  page.closed = true
  page.abort.abort()
  page.listeners.clear()
  page.view.setVisible(false)
  if (!entry.win.isDestroyed()) entry.win.contentView.removeChildView(page.view)
  if (!page.view.webContents.isDestroyed()) page.view.webContents.close({ waitForBeforeUnload: false })
  void page.attachment?.close().catch(() => undefined)
}

function readState(page: Page): ViewState {
  const contents = page.view.webContents
  if (contents.isDestroyed()) return { url: "", title: "", loading: false, canGoBack: false, canGoForward: false }
  return {
    url: contents.getURL(),
    title: contents.getTitle(),
    loading: contents.isLoading(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
  }
}

function navigateHistory(page: Page, offset: -1 | 1) {
  const history = page.view.webContents.navigationHistory
  if (!history.canGoToOffset(offset)) return
  const url = history.getAllEntries()[history.getActiveIndex() + offset]?.url
  const origin = url && destinationOrigin(url)
  if (!origin) throw new Error("Only HTTP and HTTPS browser navigation is allowed")
  page.approvedOrigin = origin
  history.goToOffset(offset)
}

function parseBinding(input: unknown): BrowserPaneBinding {
  if (!record(input) || !record(input.endpoint)) throw new TypeError("Invalid browser pane binding")
  const sessionID = text(input.sessionID, 256)
  const bindingID = text(input.bindingID, 128)
  const url = new URL(text(input.endpoint.url, 16_384))
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new TypeError("Browser server URL must be HTTP or HTTPS without embedded credentials")
  }
  const username = input.endpoint.username === undefined ? undefined : text(input.endpoint.username, 1_024)
  const password = input.endpoint.password === undefined ? undefined : text(input.endpoint.password, 4_096)
  if (username && !password) throw new TypeError("Browser server username requires a password")
  return { sessionID, bindingID, endpoint: { url: url.href, username, password } }
}

function parseLayout(input: unknown): { bindingID: string; layout?: BrowserPaneLayout } {
  if (!record(input)) throw new TypeError("Invalid browser pane layout")
  const bindingID = text(input.bindingID, 128)
  if (input.layout === undefined) return { bindingID }
  if (!record(input.layout) || typeof input.layout.visible !== "boolean") throw new TypeError("Invalid browser pane layout")
  if (input.layout.bounds !== undefined && !record(input.layout.bounds)) throw new TypeError("Invalid browser pane bounds")
  const bounds = input.layout.bounds
  return {
    bindingID,
    layout: {
      visible: input.layout.visible,
      ...(bounds
        ? { bounds: { x: number(bounds.x), y: number(bounds.y), width: number(bounds.width), height: number(bounds.height) } }
        : {}),
    },
  }
}

function ownedEntry(entries: Map<string, Entry>, win: BrowserWindow, bindingID: string) {
  const entry = entries.get(bindingID)
  if (!entry || entry.win !== win) throw new Error("Browser pane registration is unavailable")
  return entry
}

function text(input: unknown, limit: number) {
  if (typeof input !== "string" || !input || input.length > limit) throw new TypeError("Invalid browser pane value")
  return input
}

function number(input: unknown) {
  if (typeof input !== "number" || !Number.isFinite(input)) throw new TypeError("Invalid browser pane bounds")
  return input
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
