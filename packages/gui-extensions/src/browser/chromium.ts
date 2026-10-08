import { Browser } from "@opencode/plugin-browser/rpc"
import electron, { type BrowserWindow, type WebContents, type WebContentsView } from "electron"
import type { Protocol } from "devtools-protocol"
import { Schema } from "effect"
import type { Embeds } from "../sdk/main"
import { createCdp, abortError, waitFor } from "./cdp"
import { createBrowserFiles } from "./files"
import { createDiagnostics } from "./diagnostics"
import { BrowserError } from "./errors"
import { loadIcon } from "./icon"
import { parseChord, typedKey, type KeyEvent } from "./keys"
import { isExplicitLocator, parseLocator, type Step } from "./locator"
import {
  PageControl,
  PageCount,
  PageEntries,
  PageInfo,
  PageOutcome,
  PagePosition,
  PageRead,
  pageCall,
  type PageMethod,
} from "./page"
import type { Presenter, Presenters } from "./presenter"
import { createProfiling, type Recording } from "./profiling"
import type { BrowserNetwork } from "./network"
import {
  allowedDestination,
  destinationOrigin,
  fileURLWithin,
  localFileURL,
  normalizeURL,
  refusal,
  type Policy,
} from "./policy"
import type { PaneElement } from "./ipc"

type Element = { backendID: number; frameID: string; sessionID?: string }

/** A page object an operation holds, released with its object group. */
type Remote = { objectId: string; sessionID?: string }

/** One operation's remote objects, released together when it ends. */
type Scope = { group: string; sessions: Set<string | undefined> }

type Located = { element: Element; remote: Remote; count: number }

/** What a page helper checks before an action: the element must exist, or also be ready for that input. */
type Readiness = "exists" | "click" | "hover" | "fill" | "type" | "drag" | "upload"

type Emulation = {
  viewport?: Browser.Viewport
  colorScheme?: "light" | "dark"
  reducedMotion?: "reduce" | "no-preference"
  media?: "screen" | "print"
  offline: boolean
  timezone?: string
  locale?: string
  userAgent?: string
}

/** State every page of the pane shares: the element ref allocator and the app-wide trace recording. */
export type Shared = { ref: () => string; recording?: Recording }

// Input the page receives while the element picker is on would pick an element instead.
const pointerOperations: readonly Browser.Method[] = [
  "click",
  "hover",
  "drag",
  "fill",
  "type",
  "press",
  "scroll",
  "drop",
  "upload",
]

// Input whose JavaScript dialog is an outcome to report, not a failure: the click that opens a confirm worked.
const dialogOutcomes: readonly Browser.Method[] = ["click", "hover", "drag", "fill", "type", "press", "upload", "drop"]

// Chromium DevTools' element picker colors, so the overlay matches the Elements panel.
const inspectHighlight: Protocol.Overlay.HighlightConfig = {
  showInfo: true,
  showStyles: true,
  showAccessibilityInfo: true,
  colorFormat: "hex",
  contrastAlgorithm: "aa",
  contentColor: { r: 111, g: 168, b: 220, a: 0.66 },
  paddingColor: { r: 147, g: 196, b: 125, a: 0.55 },
  borderColor: { r: 255, g: 229, b: 153, a: 0.66 },
  marginColor: { r: 246, g: 178, b: 107, a: 0.66 },
  eventTargetColor: { r: 255, g: 196, b: 196, a: 0.66 },
  // SAFETY: CDP's Overlay.HighlightConfig names these two fields; they are the protocol's, not ours to rename.
  /* oxlint-disable anti-slop/no-shape-in-symbol-names -- see SAFETY above */
  shapeColor: { r: 96, g: 82, b: 177, a: 0.8 },
  shapeMarginColor: { r: 96, g: 82, b: 127, a: 0.6 },
  /* oxlint-enable anti-slop/no-shape-in-symbol-names */
}

const pickedHighlight = { ...inspectHighlight, showInfo: false, showStyles: false, showAccessibilityInfo: false }

// Chromium rejects mode "none" without a config. A rejected call leaves the picker armed, and the
// next hideHighlight would put its hover tool back.
const inspectOff = { mode: "none", highlightConfig: inspectHighlight }

// Chromium's zoom presets, so a step lands where it would in the system browser.
const zoomSteps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]

// The agent's tabs start at a desktop layout instead of the narrow pane's width.
const defaultSize = { width: 1280, height: 800 }

// Roles whose elements an agent acts on; each gets a ref in a snapshot.
const actionableRoles = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "option",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "treeitem",
  "listbox",
  "textarea",
])

// Roles that give interactive elements their context in an "interactive" snapshot.
const contextRoles = new Set([
  "heading",
  "dialog",
  "alertdialog",
  "alert",
  "navigation",
  "main",
  "banner",
  "contentinfo",
  "complementary",
  "form",
  "region",
  "tablist",
  "menu",
  "menubar",
  "toolbar",
  "list",
  "table",
  "grid",
  "tree",
  "group",
  "status",
])

// Wrapper roles that only add depth; they are skipped without a name.
const wrapperRoles = new Set(["generic", "none", "presentation", "InlineTextBox", "LineBreak", "paragraph", "Section"])

/** A page's icon as a data URL, and its zoom factor, 1 at 100%. */
export type PageDetail = { icon?: string; zoom: number }

/** The zoom a key press asks for: the system browser's zoom keys, with the platform's modifier already checked. */
function zoomKey(input: Electron.Input) {
  if (input.key === "=" || input.key === "+" || input.code === "NumpadAdd") return "in"

  if (input.key === "-" || input.code === "NumpadSubtract") return "out"

  if (input.key === "0") return "reset"
}

/**
 * The address a cookie is removed by: its domain without the leading dot, its path, and its scheme. An IPv6 host
 * needs its brackets in a URL.
 */
function cookieURL(cookie: Electron.Cookie) {
  const domain = (cookie.domain ?? "").replace(/^\./, "")
  const host = domain.includes(":") && !domain.startsWith("[") ? `[${domain}]` : domain

  return `${cookie.secure ? "https" : "http"}://${host}${cookie.path ?? "/"}`
}

/** The next preset in the direction, or 100%; the current factor at either end. */
function zoomStep(current: number, direction: "in" | "out" | "reset") {
  if (direction === "reset") return 1

  if (direction === "in") return zoomSteps.find((step) => step > current + 0.001) ?? current

  return zoomSteps.findLast((step) => step < current - 0.001) ?? current
}

/** Whether a script is a function the page calls with arguments, rather than an expression or statements. */
export function functionSource(script: string) {
  return /^\s*(?:async\s+)?(?:function\b|\((?:[^()]|\([^()]*\))*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/.test(script)
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

export type BrowserPage = ReturnType<typeof createBrowserPage>

export function createBrowserPage(
  win: BrowserWindow,
  options: {
    id: Browser.TabID
    partition: string
    network: BrowserNetwork | null
    publish: (error?: string) => void
    /** Reports the element picker starting, stopping, or picking an element. */
    inspect?: (event: { active: boolean; element?: PaneElement }) => void
    /** Reports the page's icon or zoom changing. */
    detail?: (detail: PageDetail) => void
    /** The page's zoom changed, which Chromium applies to every page of the same origin in the partition. */
    zoomed?: () => void
    /** The user pressed the address shortcut while the page had focus. */
    address?: () => void
    fail: () => void
    /** Adopts a page the document opened; a background one leaves the current tab selected. */
    popup: (options: Electron.BrowserWindowConstructorOptions, background: boolean) => WebContents
    /** An agent tab's link that opens a new tab: the pane opens it as another agent tab. */
    open: (url: string, background: boolean) => void
    initialize?: boolean
    restore?: Browser.Tab
    popupOptions?: Electron.BrowserWindowConstructorOptions
    /** Directories whose files may load as file:// documents; empty when the server is remote. */
    fileRoots?: () => ReadonlyArray<string>
    /** Who opened the tab. The agent's tabs render offscreen, so they work while nobody watches. */
    owner: "agent" | "user"
    /** The agent's key for the tab. */
    key?: string
    /** A viewport the agent pinned before the tab was restored. */
    viewport?: { width: number; height: number }
    presenters: Presenters
    shared: Shared
    embeds: Embeds
  },
) {
  const policy: Policy = {
    get fileRoots() {
      return options.fileRoots?.() ?? []
    },
  }

  const preferences: Electron.WebPreferences = {
    partition: options.partition,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
    devTools: false,
    backgroundThrottling: false,
    // Agent navigation, including in hidden tabs, must not take the user's keyboard focus.
    focusOnNavigation: false,
  }

  // The agent's tabs render into an offscreen window: Chromium keeps them painting, laid out, and receiving input
  // whether the pane shows them, the app is minimized, or nobody looks. A presenter view shows their frames.
  const scale = electron.screen.getDisplayMatching(win.getBounds()).scaleFactor
  const offscreen = options.owner === "agent" && !options.popupOptions

  const host = offscreen
    ? new electron.BrowserWindow({
        show: false,
        width: options.viewport?.width ?? defaultSize.width,
        height: options.viewport?.height ?? defaultSize.height,
        useContentSize: true,
        webPreferences: { ...preferences, offscreen: { deviceScaleFactor: scale } },
      })
    : undefined

  const emulation: Emulation = { offline: false, viewport: options.viewport }

  // The page's contents, and the view the pane lays out: the offscreen page's presenter, or the page itself.
  const surface: { contents: WebContents; view: WebContentsView; presenter?: Presenter } = host
    ? offscreenSurface(host)
    : nativeSurface()

  const contents = surface.contents
  const view = surface.view
  const presenter = surface.presenter
  // Whether the user can see the tab, and how many agent operations are running on it.
  let watched = false
  let busy = 0
  let unpinned: number[] | undefined

  // An offscreen tab paints at full rate while watched, while the agent works on it, and not at all otherwise; its
  // scripts keep running either way.
  const paint = () => {
    if (!host || contents.isDestroyed()) return

    if (watched || busy > 0) {
      contents.setFrameRate(watched ? 60 : 30)

      if (!contents.isPainting()) contents.startPainting()

      return
    }

    if (contents.isPainting()) contents.stopPainting()
  }

  const detachNetwork = options.network?.attach(contents)

  const shortcuts = (event: Electron.Event, input: Electron.Input) => {
    if (input.type !== "keyDown") return

    if (input.key === "F5" && !input.meta && !input.control && !input.alt && !input.shift) {
      event.preventDefault()
      contents.reload()

      return
    }

    if (input.key === "Escape" && inspecting) {
      event.preventDefault()
      void toggleInspect(false)

      return
    }

    if (input.alt || !(process.platform === "darwin" ? input.meta : input.control)) return

    // The same chord as Chromium DevTools' element picker.
    if (input.shift && input.code === "KeyC") {
      event.preventDefault()
      void toggleInspect(!inspecting)

      return
    }

    // The system browser's address shortcut. The app's own focus moves to the address field.
    if (!input.shift && input.code === "KeyL") {
      event.preventDefault()
      options.address?.()

      return
    }

    const direction = zoomKey(input)

    if (!direction) return
    event.preventDefault()
    zoom(direction)
  }

  contents.on("before-input-event", shortcuts)
  // Ctrl or Cmd with the mouse wheel; Electron leaves applying it to the app.
  contents.on("zoom-changed", (_event, direction) => zoom(direction))

  // The user types into an offscreen tab through its presenter, which sees the keys first.
  if (presenter) presenter.view.webContents.on("before-input-event", shortcuts)

  const zoom = (direction: "in" | "out" | "reset") => {
    const current = contents.getZoomFactor()
    const next = zoomStep(current, direction)

    if (next === current) return
    contents.setZoomFactor(next)
    options.zoomed?.()
  }

  let icon: string | undefined
  // Bumped by every icon change, so a slow fetch for an earlier icon cannot replace a later one.
  let iconRequest = 0
  let reported = ""

  const detail = () => {
    if (closed) return
    // Chromium's factor for the outermost presets can land a rounding error outside them.
    const next: PageDetail = { zoom: Math.min(5, Math.max(0.25, contents.getZoomFactor())) }

    if (icon) next.icon = icon
    const key = `${next.zoom}:${next.icon ?? ""}`

    if (key === reported) return
    reported = key
    options.detail?.(next)
  }

  contents.on("page-favicon-updated", (_event, favicons) => {
    const request = ++iconRequest
    void loadIcon(favicons, options.network).then((value) => {
      if (closed || request !== iconRequest) return
      icon = value
      detail()
    })
  })
  const cdp = createCdp(contents)
  const documents = new Map<string, string>()
  const sourceURLs = () => [...new Set([contents.getURL(), ...documents.values()])].sort()
  const files = createBrowserFiles(sourceURLs)
  const diagnostics = createDiagnostics(cdp)
  const profiling = createProfiling(contents, cdp, files, sourceURLs, options.shared)
  // Element refs by name, and the ref each element already has, so a later snapshot or find keeps the same names.
  const refs = new Map<string, Element>()
  const named = new Map<string, string>()
  // Elements the user picked. Their refs outlive later snapshots, so a comment keeps pointing at
  // the element until the document changes.
  const picked = new Map<string, Element>()
  let inspecting = false
  // Bumped by every picker toggle and hide, so a pick still being described can tell it was cancelled.
  let picks = 0
  let flash: ReturnType<typeof setTimeout> | undefined
  const sessions = new Map<string, string>()
  const parents = new Map<string, string>()
  const contexts = new Map<string, { id: number; sessionID?: string }>()
  const dialogs = new Set<() => void>()
  let dialog: { type: string; message: string; defaultValue: string } | null = null
  let dialogURL = ""
  let dialogRevision = 0
  // The first restored navigation consumes the generation reserved in the unloaded inventory.
  let generation = options.restore ? options.restore.generation - 1 : 0
  let revision = 0
  // The HTTP status of the main document, once known.
  let status: number | undefined
  let recordingKind: "trace" | "cpu" | undefined
  cdp.on("Page.frameNavigated", ({ frame }) => {
    documents.set(frame.id, frame.url)
    revision++
  })
  cdp.on("Page.frameDetached", ({ frameId }) => {
    documents.delete(frameId)
    revision++
  })
  let closed = false
  // The committed document's origin; its icon stays while navigations remain on it.
  let origin = ""
  // Whether the native surface holds a real document worth showing. Chromium keeps the
  // previous document painted until the next one renders, so a shown page stays shown
  // through later navigations; blank and failed documents hide until a real one is ready.
  let content = false
  let failure: { url: string; message: string } | undefined

  const state = (): Browser.Tab => {
    const page = {
      id: options.id,
      url: (failure?.url ?? contents.getURL()).slice(0, 16_384),
      title: contents.getTitle().slice(0, 2_048),
      loading: contents.isLoading(),
    }

    const history = {
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      generation,
      owner: options.owner,
      watched,
      key: options.key,
      viewport: emulation.viewport && { width: emulation.viewport.width, height: emulation.viewport.height },
    }

    return failure ? { ...page, loadError: failure.message, ...history } : { ...page, ...history }
  }

  const publish = () => {
    if (!closed) options.publish()
  }

  const reset = (event: Electron.Event<{ url: string; isMainFrame: boolean; isSameDocument: boolean }>) => {
    if (!event.isMainFrame || event.isSameDocument) return
    failure = undefined
    status = undefined
    generation++
    documents.clear()
    refs.clear()
    named.clear()
    picked.clear()
    diagnostics.navigated()

    if (inspecting) void toggleInspect(false)
    publish()
  }

  const settle = () => {
    content = contents.getURL() !== "about:blank" && !failure
    updateVisibility()
  }

  contents.on("did-start-navigation", reset)
  contents.on("did-navigate", (_event, url, code, statusText) => {
    status = code > 0 ? code : undefined

    // The server-network proxy answers an unreachable HTTP target with an empty 502. Other
    // error statuses are real documents from the user's server and stay visible.
    if (code === 502) failure = { url, message: `${code} ${statusText}`.trim().slice(0, 2_048) }

    // Another site's icon arrives with its document; the same site keeps its icon meanwhile, as tabs do. Files and blank
    // pages have no shared origin, so each keeps none.
    const next = destinationOrigin(url) ?? url

    if (next !== origin) {
      icon = undefined
      iconRequest++
    }

    origin = next

    // A blank or failed document paints at commit; a real one waits for dom-ready.
    if (url === "about:blank" || failure) settle()
    publish()
    // After the state that names the new URL. Chromium keeps a zoom per origin, so a new site may have its own.
    detail()
  })
  contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    // Cancelled navigation and failed subframes do not replace the current page.
    if (!isMainFrame || code === -3) return
    failure = { url, message: description.slice(0, 2_048) }
    settle()
    publish()
  })
  contents.on("dom-ready", settle)
  contents.on("did-stop-loading", () => {
    settle()
    publish()
  })
  contents.on("did-navigate-in-page", publish)
  contents.on("page-title-updated", publish)
  contents.on("render-process-gone", () => {
    if (!closed) options.fail()
  })
  contents.debugger.on("detach", () => {
    if (!closed) options.fail()
  })
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  contents.session.setPermissionCheckHandler(() => false)
  contents.session.setDevicePermissionHandler(() => false)
  contents.session.setDisplayMediaRequestHandler((_request, callback) => callback({}))
  contents.on("content-bounds-updated", (event) => event.preventDefault())

  // Sub-frames keep Chromium's own rules so blob:/data: viewers and sandboxed previews still load,
  // except file: documents, which must stay inside the allowed roots at every depth.
  const guard = (event: Electron.Event<{ url: string; isMainFrame: boolean }>) => {
    if (event.url === "about:blank") return

    if (event.isMainFrame ? allowedDestination(event.url, policy) : !localFileURL(event.url)) return

    if (!event.isMainFrame && fileURLWithin(event.url, policy.fileRoots ?? [])) return
    event.preventDefault()
    // The same reason a typed address gets, so a blocked link and a blocked address read alike.
    options.publish(refusal(event.url, policy) ?? "ERR_BLOCKED_BY_CLIENT")
  }

  contents.on("will-frame-navigate", guard)
  contents.on("will-redirect", guard)
  // Links opened with Cmd or Ctrl arrive as background tabs, and stay behind the current one as in the system browser.
  contents.setWindowOpenHandler(({ url, disposition }) => {
    if (url !== "about:blank" && !destinationOrigin(url)) return { action: "deny" }

    // An offscreen page cannot adopt a popup's contents. A link that opens a tab becomes another agent tab; a
    // scripted window (OAuth and similar flows that need window.opener) stays a native popup.
    if (offscreen && (disposition === "foreground-tab" || disposition === "background-tab")) {
      options.open(url, disposition === "background-tab")

      return { action: "deny" }
    }

    return {
      action: "allow",
      outlivesOpener: true,
      overrideBrowserWindowOptions: {
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          webviewTag: false,
          devTools: false,
          // Electron applies these preferences before the popup is adopted by our view.
          focusOnNavigation: false,
          partition: options.partition,
        },
      },
      createWindow: (popupOptions) => options.popup(popupOptions, disposition === "background-tab"),
    }
  })

  const download = (_event: Electron.Event, item: Electron.DownloadItem, source: WebContents) => {
    if (source !== contents) return

    try {
      const file = files.add(item.getFilename(), item.getMimeType() || "application/octet-stream", [
        ...sourceURLs(),
        ...item.getURLChain(),
      ])

      item.setSavePath(file.path)
      item.on("updated", () => {
        file.bytes = item.getReceivedBytes()

        if (file.bytes > Browser.MAX_FILE_BYTES) item.cancel()
      })
      item.once("done", (_event, done) => {
        file.bytes = item.getReceivedBytes()
        file.state = done === "completed" ? "completed" : "failed"
      })
    } catch {
      item.cancel()
      options.publish("download_failed")
    }
  }

  contents.session.on("will-download", download)
  cdp.on("Runtime.executionContextCreated", ({ context }, sessionID) => {
    // SAFETY: CDP documents a page execution context's auxData as `{ frameId, isDefault, type }`.
    const aux = context.auxData as { frameId?: string; isDefault?: boolean } | undefined

    if (aux?.frameId && aux.isDefault) contexts.set(aux.frameId, { id: context.id, sessionID })
  })
  cdp.on("Runtime.executionContextDestroyed", ({ executionContextId }, sessionID) => {
    contexts.forEach((context, key) => {
      if (context.id === executionContextId && context.sessionID === sessionID) contexts.delete(key)
    })
  })
  cdp.on("Target.attachedToTarget", ({ sessionId, targetInfo }, parentSessionID) => {
    if (targetInfo.type !== "iframe") return
    const parentID = targetInfo.parentFrameId ?? Array.from(sessions).find(([, id]) => id === parentSessionID)?.[0]

    if (parentID) parents.set(targetInfo.targetId, parentID)
    sessions.set(targetInfo.targetId, sessionId)
    void Promise.all([
      diagnostics.enable(sessionId),
      cdp.send("Page.enable", {}, sessionId),
      cdp.send(
        "Target.setAutoAttach",
        {
          autoAttach: true,
          waitForDebuggerOnStart: false,
          flatten: true,
          filter: [{ type: "iframe", exclude: false }, { exclude: true }],
        },
        sessionId,
      ),
      ...(inspecting ? [arm(sessionId)] : []),
    ]).catch(() => undefined)
  })
  // Each out-of-process frame runs its own picker; the frame under the pointer reports the click.
  cdp.on("Overlay.inspectNodeRequested", ({ backendNodeId }, sessionID) => {
    if (!inspecting) return
    void inspected(backendNodeId, sessionID).catch(() => {
      void hideHighlight()
      options.inspect?.({ active: false })
    })
  })
  cdp.on("Target.detachedFromTarget", ({ sessionId }) => {
    sessions.forEach((id, frameID) => {
      if (id === sessionId) {
        sessions.delete(frameID)
        parents.delete(frameID)
      }
    })
  })
  cdp.on("Page.javascriptDialogOpening", (event) => {
    dialogURL = event.url
    dialogRevision++
    dialog = {
      type: event.type,
      message: event.message.slice(0, Browser.MAX_TEXT),
      defaultValue: event.defaultPrompt ?? "",
    }
    dialogs.forEach((reject) => reject())
    publish()
  })
  cdp.on("Page.javascriptDialogClosed", () => {
    dialogRevision++
    dialog = null
    publish()
  })
  // Hidden tabs keep a desktop-sized viewport until the renderer lays the embed out.
  view.setBounds({ x: 0, y: 0, width: 1000, height: 700 })
  const embed = options.embeds.create(view, win)
  // A hidden page cannot be picked from, and a comment's frozen still already shows the
  // picked element, so hiding ends the picker, any pick in progress, and the highlight.
  embed.on("visible", (visible) => {
    if (visible !== watched) {
      watched = visible
      paint()
      publish()
    }

    if (visible || closed) return
    picks++
    void (inspecting ? toggleInspect(false) : hideHighlight())
  })
  // The renderer's layout requests may lag behind navigation; the page decides
  // whether there is a document worth exposing over the themed background.
  const updateVisibility = () => embed.show(content)

  const ready = Promise.all([
    files.ready,
    ...(options.initialize === false
      ? []
      : [
          contents.loadURL(normalizeURL(options.restore?.url || "about:blank", policy)).catch((error: Error) => {
            if (!options.restore) throw error
            // A dev server may have stopped while this page was unloaded. Keep its tab available to retry.
            options.publish(error.message)
          }),
        ]),
    diagnostics.enable(),
    cdp.send("Page.enable"),
    cdp.send("DOM.enable"),
    cdp.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
      filter: [{ type: "iframe", exclude: false }, { exclude: true }],
    }),
    // An offscreen page never has the app's focus; it must still behave as the focused page it is to the agent.
    ...(host
      ? [
          cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true }),
          Promise.resolve().then(() => contents.focus()),
        ]
      : []),
    ...(emulation.viewport && !host ? [applyViewport()] : []),
  ]).then(() => paint())

  return {
    view,
    contents,
    state,
    ready,
    /** The host embed the renderer lays this page out with. */
    embed: embed.id,
    async inspect(enabled: boolean) {
      if (closed) return
      await ready
      await toggleInspect(enabled)
    },
    async highlight(ref?: Browser.Ref) {
      if (closed) return
      await highlightPicked(ref).catch(() => undefined)
    },
    zoom(direction: "in" | "out" | "reset") {
      if (!closed) zoom(direction)
    },
    async site() {
      const url = contents.getURL()

      if (closed || !destinationOrigin(url)) return { cookies: 0 }

      return { cookies: (await contents.session.cookies.get({ url })).length }
    },
    /**
     * Deletes what the page's site stored: the cookies its address can read, and its origin's storage. Resolves once
     * the page reloaded without them, so a count read next includes what the reload set again.
     */
    async clearSite() {
      const url = contents.getURL()
      const site = destinationOrigin(url)

      if (closed || !site) return
      const cookies = await contents.session.cookies.get({ url })
      await Promise.all(cookies.map((cookie) => contents.session.cookies.remove(cookieURL(cookie), cookie.name)))
      await contents.session.clearStorageData({
        origin: site,
        storages: ["localstorage", "indexdb", "serviceworkers", "cachestorage", "filesystem", "shadercache"],
      })

      if (closed) return
      contents.reload()
      // A slow page still cleared; the count then reads what it set so far.
      await waitFor(() => closed || !contents.isLoading(), new AbortController().signal, 30_000).catch(() => undefined)
    },
    /** Reports the page's icon and zoom when either changed since the last report. */
    detail,
    async execute(command: Browser.Command, signal: AbortSignal): Promise<Browser.Result> {
      await ready
      abortError(signal)

      if (closed)
        throw new Error(
          "Browser tab was closed. Call browser.tabs.list({}) and choose an existing tabID; do not reuse the closed tab's refs.",
        )

      if (inspecting && pointerOperations.includes(command.action.type)) await toggleInspect(false)

      if (dialog && command.action.type !== "dialog")
        throw new Error(
          'A JavaScript dialog is open. Inspect it with browser.dialog({tabID,action:"get"}), then explicitly accept or dismiss it before continuing.',
        )

      if (command.inspect) return { value: await inspect(command.action), files: [] }

      if (command.target && JSON.stringify(await inspect(command.action)) !== JSON.stringify(command.target))
        throw new Error(
          "Browser target changed while permission was pending. Take a fresh snapshot or listing and request the action again; it was not executed.",
        )

      const modal = Promise.withResolvers<Browser.Result>()
      const cancelled = Promise.withResolvers<never>()
      // The action underneath the race keeps running after a dialog wins it; it checks this
      // signal before each further step, so a validation alert on one field stops the rest.
      // A navigation is left alone: its beforeunload dialog is answered through browser.dialog
      // and the pending load then proceeds or not.
      const run = new AbortController()

      const cancel = () => {
        run.abort()
        cancelled.reject(
          new Error(
            "Browser operation was cancelled. Inspect the tab before deciding to repeat an action; cancellation does not undo changes already made.",
          ),
        )
      }

      signal.addEventListener("abort", cancel, { once: true })

      const opened = () => {
        if (command.action.type !== "navigate") run.abort()

        if (dialog && dialogOutcomes.includes(command.action.type)) {
          modal.resolve(
            result({
              tab: state(),
              changed: { navigated: false, dialog: { type: dialog.type, message: dialog.message } },
            }),
          )

          return
        }

        modal.reject(
          new Error(
            'A JavaScript dialog opened while the action was running. Inspect it with browser.dialog({tabID,action:"get"}) and accept or dismiss it. Do not repeat the original action just to close the dialog.',
          ),
        )
      }

      if (command.action.type !== "dialog") dialogs.add(opened)
      busy++
      paint()

      try {
        return await Promise.race([
          execute(command.action, command.files, run.signal, command.target),
          modal.promise,
          cancelled.promise,
        ])
      } finally {
        signal.removeEventListener("abort", cancel)
        dialogs.delete(opened)
        // A short tail keeps frames coming for the agent's next call.
        setTimeout(() => {
          busy--
          paint()
        }, 1_000)
      }
    },
    async dispose() {
      if (closed) return
      closed = true
      clearTimeout(flash)
      detachNetwork?.()
      contents.session.off("will-download", download)
      await profiling.dispose()
      cdp.dispose()
      refs.clear()
      named.clear()
      picked.clear()
      embed.dispose()
      presenter?.dispose()

      if (host && !host.isDestroyed()) host.destroy()

      if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false })
      await files.dispose()
    },
  }

  function offscreenSurface(window: BrowserWindow) {
    const created = options.presenters.create({
      page: window.webContents,
      window,
      pinned: () => emulation.viewport && { width: emulation.viewport.width, height: emulation.viewport.height },
    })

    return { contents: window.webContents, view: created.view, presenter: created }
  }

  function nativeSurface() {
    const created = new electron.WebContentsView({ ...options.popupOptions, webPreferences: preferences })

    return { contents: created.webContents, view: created }
  }

  function result<T>(value: T, attached: Browser.File[] = []): Browser.Result {
    // The JSON round trip drops properties that are undefined, as the wire does.
    const json = Schema.decodeUnknownSync(Schema.Json)(JSON.parse(JSON.stringify(value) ?? "null"))

    if (JSON.stringify(json).length > 512_000)
      throw new Error(
        "Browser result exceeds 512000 JSON characters. Ask for less: fewer entries, a smaller snapshot (maxLines), maxChars on read, selected fields in evaluate, or saveTo to write an evaluate result to a server file.",
      )

    return { value: json, files: attached }
  }

  async function execute(
    action: Browser.Action,
    transfers: readonly Browser.File[],
    signal: AbortSignal,
    approved?: Browser.Target,
  ): Promise<Browser.Result> {
    const captureSources = sourceURLs()
    const transfer = (id: Browser.FileID) => files.transfer(id, approved?.resources)
    const scope: Scope = { group: `opencode-${crypto.randomUUID()}`, sessions: new Set() }

    try {
      return await run(action, transfers, signal, scope, captureSources, transfer)
    } finally {
      scope.sessions.forEach((sessionID) =>
        void cdp.send("Runtime.releaseObjectGroup", { objectGroup: scope.group }, sessionID).catch(() => undefined),
      )
    }
  }

  async function run(
    action: Browser.Action,
    transfers: readonly Browser.File[],
    signal: AbortSignal,
    scope: Scope,
    captureSources: readonly string[],
    transfer: (id: Browser.FileID) => Promise<Browser.File>,
  ): Promise<Browser.Result> {
    switch (action.type) {
      case "navigate": {
        const before = generation

        if (action.history) {
          const history = contents.navigationHistory

          if (action.history === "back" ? !history.canGoBack() : !history.canGoForward())
            throw new BrowserError("invalid", `This tab has no page to go ${action.history} to.`)

          if (action.history === "back") history.goBack()
          else history.goForward()
          await loaded(before, action.waitUntil ?? "load", action.timeoutMs ?? 30_000, signal)

          return result({ ...state(), status })
        }

        const url = normalizeURL(action.url ?? "about:blank", policy)
        const cancel = () => contents.stop()
        signal.addEventListener("abort", cancel, { once: true })

        try {
          await loaded(before, action.waitUntil ?? "load", action.timeoutMs ?? 30_000, signal, contents.loadURL(url))
        } finally {
          signal.removeEventListener("abort", cancel)
        }

        abortError(signal)

        return result({ ...state(), status })
      }

      case "back":
      case "forward":
      case "reload":
      case "stop": {
        const mark = diagnostics.mark()
        const before = generation

        if (action.type === "back" && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()

        if (action.type === "forward" && contents.navigationHistory.canGoForward())
          contents.navigationHistory.goForward()

        if (action.type === "reload") {
          if ("hard" in action && action.hard) contents.reloadIgnoringCache()
          else contents.reload()
        }

        if (action.type === "stop") {
          contents.stop()

          return result(state())
        }

        if (action.type !== "reload") {
          await waitFor(() => !contents.isLoading(), signal, 30_000)

          return result(state())
        }

        await loaded(before, action.waitUntil ?? "load", action.timeoutMs ?? 30_000, signal)

        return result({ ...state(), status, errors: diagnostics.errorsSince(mark) })
      }

      case "frames":
        return result({ tab: state(), frames: await frames() })
      case "snapshot":
        return result({ tab: state(), ...(await snapshot(action, scope)) })
      case "find":
        return result({ tab: state(), ...(await find(action, scope)) })
      case "read": {
        const self = action.target
          ? (await resolve(action.target, "exists", 5_000, false, signal, scope)).remote
          : await windowObject(action.frameID, scope)

        const value = await call(
          PageRead,
          "read",
          self,
          [
            { value: action.format ?? "text" },
            { value: action.after ?? null },
            { value: action.before ?? null },
            { value: action.offset ?? 0 },
            { value: action.maxChars ?? 8_000 },
          ],
          scope,
        )

        return result({ tab: state(), ...value })
      }

      case "evaluate": {
        const value = await evaluate(action.script, action.args ?? [], {
          target: action.target,
          frameID: action.frameID,
          timeoutMs: action.timeoutMs ?? 30_000,
          signal,
          scope,
        })

        if (!action.saveTo) return result({ tab: state(), value })
        const id = await files.save("result.json", "application/json", Buffer.from(JSON.stringify(value)), captureSources)

        return result({ tab: state(), value: null }, [await transfer(id)])
      }

      case "click":
        return result(
          await acting(signal, async () => {
            const located = await resolve(
              action.target,
              "click",
              action.timeoutMs,
              action.force,
              signal,
              scope,
              action.position,
            )

            await click(located.element, action.button ?? "left", action.count ?? 1, action.modifiers, action.position)

            return located.count
          }),
        )
      case "hover":
        return result(
          await acting(signal, async () => {
            const located = await resolve(action.target, "hover", action.timeoutMs, false, signal, scope)
            await mouse({ type: "mouseMoved", ...(await point(located.element)) })

            return located.count
          }),
        )
      case "drag":
        return result(
          await acting(signal, async () => {
            const source = await resolve(action.from, "drag", action.timeoutMs, false, signal, scope)
            const destination = await resolve(action.to, "hover", action.timeoutMs, false, signal, scope)
            await drag(source.element, destination.element, signal)

            return source.count
          }),
        )
      case "fill":
        return result(await acting(signal, () => fill(action, signal, scope)))
      case "type":
        return result(
          await acting(signal, async () => {
            const located = action.target
              ? await resolve(action.target, "type", action.timeoutMs, false, signal, scope)
              : undefined

            if (located) {
              await cdp.send("DOM.focus", { backendNodeId: located.element.backendID }, located.element.sessionID)

              if (!action.clear) await caretToEnd(located.remote)
            }

            if (action.clear) {
              await press(parseChord(process.platform === "darwin" ? "Meta+A" : "Control+A"))
              await press(parseChord("Backspace"))
            }

            for (const char of action.text) {
              abortError(signal)
              const key = typedKey(char)

              if (key) await press(key)
              else await cdp.send("Input.insertText", { text: char })

              if (action.delayMs) await delay(action.delayMs, signal)
            }

            if (action.submit) await press(parseChord("Enter"))

            return located?.count
          }),
        )
      case "press":
        return result(
          await acting(signal, async () => {
            const chord = (() => {
              try {
                return parseChord(action.key)
              } catch (error) {
                throw new BrowserError("invalid", error instanceof Error ? error.message : String(error))
              }
            })()

            const located = action.target
              ? await resolve(action.target, "exists", action.timeoutMs, false, signal, scope)
              : undefined

            if (located)
              await cdp.send("DOM.focus", { backendNodeId: located.element.backendID }, located.element.sessionID)
            await press(chord)

            return located?.count
          }),
        )
      case "scroll": {
        const before = { url: contents.getURL(), title: contents.getTitle(), generation, mark: diagnostics.mark() }

        const located = action.target
          ? await resolve(action.target, "exists", action.timeoutMs, false, signal, scope)
          : undefined

        const self = located?.remote ?? (await windowObject(undefined, scope))

        const position = await call(
          PagePosition,
          "scroll",
          self,
          [{ value: action.to ?? null }, { value: action.by ?? null }],
          scope,
        )

        await delay(50, signal)

        return result({ tab: state(), changed: changes(before, located?.count), position })
      }

      case "wait":
        return result(await wait(action, signal, scope))
      case "watch":
        return result(await watch(action, signal, scope))
      case "screenshot":
        return result(...(await screenshot(action, signal, scope, captureSources, transfer)))
      case "dialog": {
        if (action.action !== "get") {
          if (!dialog)
            throw new Error(
              'This tab has no JavaScript dialog to handle. browser.dialog({tabID,action:"get"}) returns null when none is open; continue without accepting or dismissing one.',
            )
          await cdp.send("Page.handleJavaScriptDialog", {
            accept: action.action === "accept",
            promptText: action.promptText,
          })
          dialog = null
        }

        return result({ tab: state(), dialog })
      }

      case "upload":
      case "drop":
        return result(
          await acting(signal, async () => {
            if (!transfers.length)
              throw new Error(
                "Upload command has no file bytes. Supply server-local paths to browser.upload or browser.drop; do not call the desktop RPC directly with desktop paths. If paths were supplied, report a client/server transfer mismatch.",
              )

            const local = await Promise.all(
              transfers.map(async (file) => files.get(await files.save(file.name, file.mime, file.data)).path),
            )

            // File inputs are often visually hidden behind a styled button; they only need to exist.
            const located = await resolve(
              action.target,
              action.type === "upload" ? "exists" : "hover",
              5_000,
              false,
              signal,
              scope,
            )

            const element = located.element

            if (action.type === "upload") {
              const control = await call(PageControl, "control", located.remote, [{ objectId: located.remote.objectId }], scope)

              if (control.kind !== "file")
                throw new BrowserError(
                  "not_actionable",
                  `${action.target} is not a file input. Pass a locator for input[type=file] (it may be hidden behind a styled button, which is fine), or use browser.drop for a drop area.`,
                )
              await cdp.send("DOM.setFileInputFiles", { files: local, backendNodeId: element.backendID }, element.sessionID)

              return located.count
            }

            const position = await point(element)

            for (const type of ["dragEnter", "dragOver", "drop"])
              await cdp.send("Input.dispatchDragEvent", {
                type,
                ...position,
                data: { items: [], files: local, dragOperationsMask: 1 },
              })

            return located.count
          }),
        )
      case "files.list":
        return result({ tab: state(), files: files.list() })
      case "files.get":
        return result({ tab: state() }, [await transfer(action.id)])
      case "console":
        return result({ tab: state(), ...diagnostics.console(action) })
      case "network.list":
        return result({ tab: state(), ...diagnostics.list(action) })
      case "network.get":
        return result({ tab: state(), ...(await diagnostics.get(action)) })
      case "emulate":
        return result({ tab: state(), emulation: await emulate(action) })
      case "storage":
        return result({ tab: state(), entries: await storage(action, scope) })
      case "addInitScript": {
        const args = JSON.stringify(action.args ?? [])

        const source = functionSource(action.script)
          ? `;(${action.script})(...${args});`
          : `;(function (args) {\n${action.script}\n})(${args});`

        const added = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source })

        return result({ tab: state(), id: added.identifier })
      }

      case "profile.start":
        if (action.kind === "trace") await profiling.startTrace(action.durationMs)
        else await profiling.startCpu()
        recordingKind = action.kind

        return result({ tab: state(), recording: true })
      case "profile.stop": {
        const kind = profiling.active() ?? recordingKind

        if (!kind)
          throw new BrowserError(
            "invalid",
            'This tab has no recording to stop. Call browser.profile.start({tabID, kind: "trace" | "cpu"}), perform the interaction, then browser.profile.stop({tabID}).',
          )
        recordingKind = undefined

        if (kind === "trace") {
          const value = await profiling.stopTrace()
          const analysis = await profiling.analyze({ type: "trace", fileID: value.id, limit: action.limit ?? 50 })

          return result(
            { tab: state(), kind, durationMs: value.durationMs, incomplete: value.incomplete, ...analysis },
            [await transfer(value.id)],
          )
        }

        const value = await profiling.stopCpu()
        const analysis = await profiling.analyze({ type: "cpu", fileID: value.id, limit: action.limit ?? 50 })

        return result({ tab: state(), kind, ...analysis, durationMs: value.durationMs }, [await transfer(value.id)])
      }

      case "heap.snapshot": {
        const id = await profiling.heap()
        const summary = await profiling.analyze({ type: "heap.summary", fileID: id, limit: action.limit ?? 50 })

        const growth = action.compareTo
          ? await profiling.analyze({ type: "heap.compare", before: action.compareTo, after: id, limit: action.limit ?? 50 })
          : undefined

        return result(
          { tab: state(), ...summary, growth: growth && "classes" in growth ? growth.classes : undefined },
          [await transfer(id)],
        )
      }

      case "heap.query":
        return result({
          tab: state(),
          ...(await profiling.analyze({
            type: "heap.query",
            fileID: action.fileID,
            name: action.name,
            limit: action.limit,
          })),
        })
      case "heap.object":
        return result({
          tab: state(),
          ...(await profiling.analyze({ type: "heap.object", fileID: action.fileID, id: action.id, limit: action.limit })),
        })
      case "lighthouse": {
        const { audit } = await import("./lighthouse")
        const report = await audit(contents, files, cdp, captureSources)

        return result(
          { tab: state(), scores: report.scores, failures: report.failures },
          await Promise.all(report.files.map(transfer)),
        )
      }

      default:
        throw new Error(
          "This operation was routed to a page instead of the tab manager. Report a desktop/plugin routing mismatch; changing tab IDs or repeating the operation will not fix it.",
        )
    }
  }

  // ---- Waiting for the page ----

  /** Waits until a navigation started after `before` reached `until`; a slow page returns still loading. */
  async function loaded(
    before: number,
    until: "commit" | "load" | "idle",
    timeoutMs: number,
    signal: AbortSignal,
    navigation?: Promise<void>,
  ) {
    const deadline = Date.now() + timeoutMs
    const remaining = () => Math.max(0, deadline - Date.now())

    // Chromium aborts a load whose document became another navigation (a redirect, or YouTube's own routing), but a
    // document did commit: that is a loaded page, not a failure.
    const committed = navigation?.catch((error: Error) => {
      if (generation !== before && /ERR_ABORTED|\(-3\)/.test(String(error.message))) return
      throw error
    })

    if (until === "commit") {
      await Promise.race([committed, waitFor(() => generation !== before, signal, remaining())]).catch((error) => {
        if (navigation && !/within/.test(error instanceof Error ? error.message : "")) throw error
      })

      return
    }

    const settled = committed ?? waitFor(() => !contents.isLoading(), signal, remaining())
    const timer = delay(remaining(), signal).then(() => "timeout" as const)
    await Promise.race([settled.then(() => "done" as const), timer])

    if (until !== "idle" || Date.now() >= deadline) return
    let quiet = Date.now()

    while (Date.now() < deadline && !signal.aborted) {
      if (contents.isLoading() || diagnostics.pending() > 0) quiet = Date.now()

      if (Date.now() - quiet >= 500) return
      await delay(100, signal)
    }
  }

  /** Runs an input action and reports what it changed once the page settled. */
  async function acting(signal: AbortSignal, action: () => Promise<number | undefined>) {
    const before = { url: contents.getURL(), title: contents.getTitle(), generation, mark: diagnostics.mark() }
    const revision = dialogRevision
    const matches = await action()
    await delay(100, signal)

    if (generation !== before.generation || contents.isLoading())
      await waitFor(() => !contents.isLoading(), signal, 10_000).catch(() => undefined)
    await delay(50, signal)

    const changed = changes(before, matches)

    return {
      tab: state(),
      changed:
        dialog && dialogRevision !== revision
          ? { ...changed, dialog: { type: dialog.type, message: dialog.message } }
          : changed,
    }
  }

  function changes(
    before: { url: string; title: string; generation: number; mark: number },
    matches?: number,
  ): Browser.Changed {
    const url = contents.getURL()
    const title = contents.getTitle()
    const errors = diagnostics.errorsSince(before.mark)

    return {
      navigated: generation !== before.generation,
      url: url === before.url ? undefined : url,
      title: title === before.title ? undefined : title.slice(0, 2_048),
      errors: errors.length ? errors : undefined,
      matches,
    }
  }

  async function wait(action: Extract<Browser.Action, { type: "wait" }>, signal: AbortSignal, scope: Scope) {
    const started = Date.now()
    const timeout = action.timeoutMs ?? 10_000

    const given = [action.load, action.text, action.gone, action.target, action.url, action.script, action.idle].filter(
      (value) => value !== undefined,
    )

    if (given.length > 1)
      throw new BrowserError(
        "invalid",
        "Pass one condition to browser.wait: load, text, gone, target (with state), url, script, or idle.",
      )

    // No condition is a plain delay, which is what a wait without one always meant.
    if (!given.length) {
      await delay(timeout, signal)

      return { tab: state(), met: true, elapsedMs: Date.now() - started }
    }

    const gone = action.gone
    const goneSteps = gone !== undefined && isExplicitLocator(gone) ? steps(gone) : undefined
    let observed: Schema.Json | undefined

    const check = async (): Promise<boolean> => {
      if (action.load)
        return (
          !contents.isLoading() &&
          (await evaluate("document.readyState", [], { frameID: action.frameID, timeoutMs: 5_000, signal, scope })) ===
            "complete"
        )

      if (action.url !== undefined) {
        observed = contents.getURL()
        const pattern = /^\/(.+)\/([a-z]*)$/.exec(action.url)

        return pattern ? new RegExp(pattern[1] ?? "", pattern[2]).test(observed) : observed.includes(action.url)
      }

      if (action.text !== undefined) {
        const present = await call(
          Schema.Boolean,
          "textPresent",
          await windowObject(action.frameID, scope),
          [{ value: action.text }, { value: true }],
          scope,
        )

        return action.state === "hidden" || action.state === "detached" ? !present : present
      }

      if (gone !== undefined) {
        if (goneSteps) return (await within(await windowObject(action.frameID, scope), goneSteps, "", scope, false)).visible === 0

        const present = await call(
          Schema.Boolean,
          "textPresent",
          await windowObject(action.frameID, scope),
          [{ value: gone }, { value: true }],
          scope,
        )

        return !present
      }

      if (action.target !== undefined) {
        const state = action.state ?? "visible"
        const found = await locate(steps(action.target), action.frameID, scope, state === "enabled")

        if (state === "attached") return found.count > 0

        if (state === "detached") return found.count === 0

        if (state === "hidden") return found.visible === 0

        if (state === "visible") return found.visible > 0

        if (!found.located) return false

        const ready = await call(
          PageOutcome,
          "actionable",
          found.located.remote,
          [{ objectId: found.located.remote.objectId }, { value: "click" }],
          scope,
        )

        return ready.ok || !/disabled|not visible|detached/.test(ready.reason)
      }

      if (action.script !== undefined) {
        observed = await evaluate(action.script, action.args ?? [], {
          frameID: action.frameID,
          timeoutMs: 5_000,
          signal,
          scope,
        })

        return Boolean(observed)
      }

      if (action.idle !== undefined) {
        const idle = await call(Schema.Number, "idle", await windowObject(action.frameID, scope), [], scope)

        return diagnostics.pending() === 0 && idle >= action.idle
      }

      return true
    }

    while (true) {
      abortError(signal)

      const met = await check().catch((error: Error) => {
        // A wrong condition fails at once; a document changing under the check is retried.
        if (error instanceof BrowserError && error.code === "invalid") throw error

        return false
      })

      const elapsedMs = Date.now() - started

      if (met) return { tab: state(), met: true, elapsedMs, observed }

      if (elapsedMs >= timeout)
        return { tab: state(), met: false, elapsedMs, observed: observed ?? { url: contents.getURL() } }
      await delay(Math.min(100, timeout - elapsedMs), signal)
    }
  }

  async function watch(action: Extract<Browser.Action, { type: "watch" }>, signal: AbortSignal, scope: Scope) {
    const started = Date.now()
    const every = action.everyMs ?? 250
    const max = action.maxSamples ?? 100
    const samples: { t: number; value: Schema.Json }[] = []
    let last: string | undefined

    while (Date.now() - started < action.durationMs && samples.length < max) {
      abortError(signal)

      const value = await evaluate(action.script, action.args ?? [], {
        frameID: action.frameID,
        timeoutMs: Math.max(1_000, every),
        signal,
        scope,
      }).catch((error: Error): Schema.Json => ({ error: String(error.message).slice(0, 300) }))

      const json = JSON.stringify(value)

      if (json !== last) {
        samples.push({ t: Date.now() - started, value })
        last = json
      }

      await delay(every, signal)
    }

    return { tab: state(), samples, ended: samples.length >= max ? ("samples" as const) : ("duration" as const) }
  }

  // ---- Locators ----

  function steps(target: string) {
    try {
      return parseLocator(target)
    } catch (error) {
      throw new BrowserError("invalid", error instanceof Error ? error.message : String(error))
    }
  }

  /** Finds a locator's first visible match without waiting; also counts every match. */
  async function locate(list: readonly Step[], frameID: string | undefined, scope: Scope, pick = true) {
    const [first, ...rest] = list

    if (first?.kind === "ref") {
      const element = refElement(first.ref)
      const remote = await remoteOf(element, scope)

      if (!rest.length) return { located: { element, remote, count: 1 }, count: 1, visible: 1 }

      return within(remote, rest, element.frameID, scope, pick)
    }

    const self = await windowObject(frameID, scope)

    return within(self, list, self.frameID, scope, pick)
  }

  async function within(
    self: Remote,
    list: readonly Step[],
    frameID: string,
    scope: Scope,
    pick: boolean,
  ): Promise<{ located?: Located; count: number; visible: number }> {
    const counted = await call(PageCount, "count", self, [{ value: list }], scope)

    if (!counted.count || !pick) return counted
    const picked = await callRemote("first", self, [{ value: list }], scope)

    if (!picked) return counted
    const node = await cdp.send("DOM.describeNode", { objectId: picked }, self.sessionID)

    return {
      ...counted,
      located: {
        element: { backendID: node.node.backendNodeId, frameID, sessionID: self.sessionID },
        remote: { objectId: picked, sessionID: self.sessionID },
        count: counted.count,
      },
    }
  }

  /**
   * Waits until a locator matches an element that is ready for the input, then returns it. A missing or blocked
   * element fails with what the page shows instead, so the agent can correct the locator.
   */
  async function resolve(
    target: string,
    readiness: Readiness,
    timeoutMs: number | undefined,
    force: boolean | undefined,
    signal: AbortSignal,
    scope: Scope,
    position?: { x: number; y: number },
  ): Promise<Located> {
    const list = steps(target)
    const timeout = timeoutMs ?? 5_000
    const deadline = Date.now() + timeout
    const last = { count: 0, visible: 0, reason: "" }

    while (true) {
      abortError(signal)

      const found = await locate(list, undefined, scope).catch((error: Error) => {
        // A stale ref or bad syntax will not fix itself; a document changing under the search will.
        if (error instanceof BrowserError || /ref is stale/.test(String(error.message))) throw error

        return undefined
      })

      if (found) {
        last.count = found.count
        last.visible = found.visible
      }

      if (found?.located) {
        if (force || readiness === "exists") return found.located

        // The point an explicit click position names is hit-tested instead of the center.
        const args: Protocol.Runtime.CallArgument[] = [{ objectId: found.located.remote.objectId }, { value: readiness }]

        if (position) args.push({ value: position })

        const ready = await call(PageOutcome, "actionable", found.located.remote, args, scope).catch(
          () => ({ ok: false, reason: "changed while checking" }) as const,
        )

        if (ready.ok) return found.located
        last.reason = ready.reason
      }

      if (Date.now() >= deadline) throw await missing(target, list, last, timeout, scope)
      await delay(100, signal)
    }
  }

  async function missing(
    target: string,
    list: readonly Step[],
    last: { count: number; visible: number; reason: string },
    timeout: number,
    scope: Scope,
  ) {
    if (last.count && last.reason) {
      const hint = /covered/.test(last.reason)
        ? "Close what covers it first (a dialog, menu, or banner), or pass force: true."
        : /disabled/.test(last.reason)
          ? 'Fill what it depends on first, or wait for it: browser.wait({tabID, target, state: "enabled"}).'
          : /not visible/.test(last.reason)
            ? "It may be inside a closed menu, tab, or collapsed section; open that first, or use a locator for a visible element."
            : /editable/.test(last.reason)
              ? "Target the input, textarea, or editor itself, not its label or wrapper."
              : /moving/.test(last.reason)
                ? "It is still animating; retry, or pass force: true."
                : "Inspect the page with browser.find or browser.snapshot."

      return new BrowserError(
        "not_actionable",
        `${last.count} element${last.count === 1 ? "" : "s"} matched ${target}, but it was ${last.reason} for ${timeout} ms. ${hint}`,
      )
    }

    const query = list
      .map((step) =>
        step.kind === "text" || step.kind === "label" || step.kind === "placeholder"
          ? step.text
          : step.kind === "role"
            ? `${step.role} ${step.name ?? ""}`
            : step.kind === "testid"
              ? step.id
              : step.kind === "css"
                ? step.selector.replace(/[^a-zA-Z0-9]+/g, " ")
                : "",
      )
      .join(" ")
      .trim()

    const similar = await call(
      Schema.Array(Schema.String),
      "suggest",
      await windowObject(undefined, scope),
      [{ value: query || target }, { value: 8 }],
      scope,
    ).catch(() => [])

    return new BrowserError(
      "not_found",
      `${last.count ? `${last.count} element${last.count === 1 ? "" : "s"} matched ${target} but none is visible` : `Nothing matched ${target}`} after ${timeout} ms.${similar.length ? ` Visible elements that look related: ${similar.join(", ")}.` : ""} Use browser.find or browser.snapshot to see the page, and prefer text=, role=, or label= locators over guessed CSS.`,
    )
  }

  async function windowObject(frameID: string | undefined, scope: Scope): Promise<Remote & { frameID: string }> {
    const context = frameID ? contexts.get(frameID) : undefined

    if (frameID && !context)
      throw new BrowserError(
        "invalid",
        "Frame context is unavailable. Call browser.frames({tabID}) and use a current frameID from this tab, or omit frameID for the main frame.",
      )
    scope.sessions.add(context?.sessionID)

    const [value, tree] = await Promise.all([
      cdp.send("Runtime.evaluate", { expression: "window", contextId: context?.id, objectGroup: scope.group }, context?.sessionID),
      frameID ? undefined : cdp.send("Page.getFrameTree"),
    ])

    if (!value.result.objectId) throw new Error("The page has no window to run in yet; it may still be loading.")

    return { objectId: value.result.objectId, sessionID: context?.sessionID, frameID: frameID ?? tree?.frameTree.frame.id ?? "" }
  }

  async function remoteOf(element: Element, scope: Scope): Promise<Remote> {
    scope.sessions.add(element.sessionID)

    const object = await cdp.send(
      "DOM.resolveNode",
      { backendNodeId: element.backendID, objectGroup: scope.group },
      element.sessionID,
    )

    if (!object.object.objectId)
      throw new Error(
        "Element ref is stale: its element left the page. Use a locator (text=, role=, label=, CSS) or call browser.find again.",
      )

    return { objectId: object.object.objectId, sessionID: element.sessionID }
  }

  /** Calls a page helper with `this` bound to `self` and decodes its JSON value. */
  async function call<A>(
    schema: Schema.Decoder<A>,
    method: PageMethod,
    self: Remote,
    args: readonly Protocol.Runtime.CallArgument[],
    scope: Scope,
  ): Promise<A> {
    scope.sessions.add(self.sessionID)

    const value = await cdp.send(
      "Runtime.callFunctionOn",
      {
        objectId: self.objectId,
        functionDeclaration: pageCall(method),
        arguments: args,
        returnByValue: true,
        awaitPromise: true,
        objectGroup: scope.group,
      },
      self.sessionID,
    )

    if (value.exceptionDetails)
      throw new Error(
        `${(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text).replace(/^Error: /, "").slice(0, 400)}`,
      )

    return Schema.decodeUnknownSync(schema)(value.result.value)
  }

  /** Calls a page helper that returns an element, kept as a remote object in the operation's group. */
  async function callRemote(
    method: PageMethod,
    self: Remote,
    args: readonly Protocol.Runtime.CallArgument[],
    scope: Scope,
  ) {
    scope.sessions.add(self.sessionID)

    const value = await cdp.send(
      "Runtime.callFunctionOn",
      {
        objectId: self.objectId,
        functionDeclaration: pageCall(method),
        arguments: args,
        returnByValue: false,
        awaitPromise: true,
        objectGroup: scope.group,
      },
      self.sessionID,
    )

    if (value.exceptionDetails) return undefined

    return value.result.subtype === "null" ? undefined : value.result.objectId
  }

  /** The ref an element already has, or a new one. Refs live until the element's document changes. */
  function refFor(element: Element) {
    const key = `${element.frameID}:${element.backendID}`
    const known = named.get(key)

    if (known) return known

    const pinned = Array.from(picked).find(
      ([, item]) => item.backendID === element.backendID && item.frameID === element.frameID,
    )?.[0]

    if (pinned) return pinned
    const ref = options.shared.ref()
    refs.set(ref, element)
    named.set(key, ref)

    return ref
  }

  function refElement(ref: string): Element {
    const key = ref.replace(/^@/, "")
    const value = refs.get(key) ?? picked.get(key)

    if (!value)
      throw new Error(
        "Element ref is stale or belongs to another tab: refs end when their document changes. Use a locator such as text=, role=, label=, or CSS instead, or call browser.find again.",
      )

    return value
  }

  // ---- Reading ----

  async function find(action: Extract<Browser.Action, { type: "find" }>, scope: Scope) {
    if ((action.target === undefined) === (action.text === undefined))
      throw new BrowserError("invalid", "Pass target (a locator) or text to browser.find, not both and not neither.")

    const list: readonly Step[] =
      action.target !== undefined ? steps(action.target) : [{ kind: "text", text: action.text ?? "", exact: false }]

    const [first, ...tail] = list
    const limit = action.limit ?? 20
    const element = first?.kind === "ref" ? refElement(first.ref) : undefined
    const rest = element ? tail : list
    const root = element ? undefined : await windowObject(action.frameID, scope)
    const self = element ? await remoteOf(element, scope) : root

    if (!self) return { matches: [], total: 0 }
    const frameID = element?.frameID ?? root?.frameID ?? ""

    // A bare ref is its own only match.
    const objects =
      rest.length === 0
        ? [self.objectId]
        : await callRemote("all", self, [{ value: rest }, { value: limit }], scope).then(async (array) => {
            if (!array) return []

            const properties = await cdp.send(
              "Runtime.getProperties",
              { objectId: array, ownProperties: true },
              self.sessionID,
            )

            return properties.result
              .filter((property) => /^\d+$/.test(property.name) && property.value?.objectId)
              .flatMap((property) => (property.value?.objectId ? [property.value.objectId] : []))
          })

    const total =
      rest.length === 0 ? 1 : (await call(PageCount, "count", self, [{ value: rest }], scope)).count

    const matches = await Promise.all(
      objects.slice(0, limit).map(async (objectId) => {
        const node = await cdp.send("DOM.describeNode", { objectId }, self.sessionID)
        const ref = refFor({ backendID: node.node.backendNodeId, frameID, sessionID: self.sessionID })

        const info = await call(
          PageInfo,
          "info",
          self,
          [{ objectId }, { value: action.fields ?? [] }, { value: action.styles ?? [] }],
          scope,
        )

        return { ref: Browser.Ref.make(`@${ref}`), ...info }
      }),
    )

    return { matches, total }
  }

  async function snapshot(action: Extract<Browser.Action, { type: "snapshot" }>, scope: Scope) {
    const tree = await frames()

    const selected = action.target
      ? (await resolve(action.target, "exists", 5_000, false, new AbortController().signal, scope)).element
      : undefined

    const frameID = selected?.frameID || action.frameID || tree[0]?.id

    if (!frameID || !tree.some((frame) => frame.id === frameID))
      throw new BrowserError(
        "invalid",
        "Frame is unavailable. Call browser.frames({tabID}) and use a current frameID from this tab; omit frameID for the main frame.",
      )
    const sessionID = sessionFor(frameID, tree)
    const ax = await cdp.send("Accessibility.getFullAXTree", { frameId: frameID }, sessionID)
    const nodes = new Map(ax.nodes.map((node) => [node.nodeId, node]))
    const root = selected ? ax.nodes.find((node) => node.backendDOMNodeId === selected.backendID) : ax.nodes[0]

    if (!root)
      throw new BrowserError(
        "not_found",
        "That element is not in the page's accessibility tree (it may be hidden). Snapshot the whole page instead, or use browser.find.",
      )

    const mode = action.mode ?? "interactive"
    const maxLines = action.maxLines ?? 500
    const lines: string[] = []
    let refsAdded = 0
    let reason: "lines" | "chars" | undefined

    const walk = async (node: Protocol.Accessibility.AXNode, level: number): Promise<void> => {
      if (lines.length >= maxLines) {
        reason = "lines"

        return
      }

      const role = String(node.role?.value ?? "node")
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 40)

      const name = String(node.name?.value ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 300)

      const properties = new Map(node.properties?.map((property) => [property.name, property.value.value]) ?? [])
      const editable = Boolean(properties.get("editable"))
      const element = node.backendDOMNodeId ? { backendID: node.backendDOMNodeId, frameID, sessionID } : undefined

      const refable =
        !node.ignored &&
        role !== "RootWebArea" &&
        (actionableRoles.has(role) || editable || Boolean(properties.get("focusable")))

      const shown =
        !node.ignored &&
        role !== "RootWebArea" &&
        (refable ||
          (mode === "full"
            ? !(wrapperRoles.has(role) && !name) && !(role === "StaticText" && !name)
            : contextRoles.has(role) && (role !== "group" || !!name)))

      if (shown) {
        const ref = refable && element ? refFor(element) : ""

        if (ref) refsAdded++

        const flags = (["checked", "disabled", "expanded", "selected", "pressed", "required", "invalid"] as const).flatMap(
          (flag) => {
            const value = properties.get(flag)

            return value !== undefined && value !== false && value !== "false" ? [`${flag}=${value}`] : []
          },
        )

        const value =
          refable && node.value?.value !== undefined && String(node.value.value)
            ? ` value=${JSON.stringify(String(node.value.value).slice(0, 80))}`
            : ""

        const box = action.boxes && ref && element ? await rect(element).catch(() => undefined) : undefined

        lines.push(
          `${"  ".repeat(level)}${ref ? `@${ref} ` : ""}[${role}] ${JSON.stringify(name)}${value}${flags.length ? ` ${flags.join(" ")}` : ""}${box ? ` box=${JSON.stringify({ x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) })}` : ""}`,
        )
      }

      // An editor's contents are its value, not more elements to list.
      if (["textbox", "searchbox"].includes(role) || editable) return

      for (const childID of node.childIds ?? []) {
        const child = nodes.get(childID)

        if (child) await walk(child, shown ? level + 1 : level)
      }
    }

    await walk(root, 0)
    const content = lines.join("\n")

    if (content.length > Browser.MAX_TEXT) reason = "chars"

    return {
      content: content.slice(0, Browser.MAX_TEXT),
      refs: refsAdded,
      truncated: reason !== undefined,
      reason,
    }
  }

  async function evaluate(
    script: string,
    args: readonly Schema.Json[],
    input: { target?: string; frameID?: string; timeoutMs: number; signal: AbortSignal; scope: Scope },
  ): Promise<Schema.Json> {
    const isFunction = functionSource(script)

    if (input.target && !isFunction)
      throw new BrowserError(
        "invalid",
        "With target, script must be a function that receives the element, for example (element) => element.textContent.",
      )

    const evaluation = (async () => {
      if (input.target || isFunction) {
        const element = input.target
          ? (await resolve(input.target, "exists", 5_000, false, input.signal, input.scope)).remote
          : undefined

        const self = element ?? (await windowObject(input.frameID, input.scope))

        return cdp.send(
          "Runtime.callFunctionOn",
          {
            objectId: self.objectId,
            functionDeclaration: script,
            arguments: [...(element ? [{ objectId: element.objectId }] : []), ...args.map((value) => ({ value }))],
            returnByValue: true,
            awaitPromise: true,
            userGesture: true,
          },
          self.sessionID,
        )
      }

      const context = input.frameID ? contexts.get(input.frameID) : undefined

      if (input.frameID && !context)
        throw new BrowserError(
          "invalid",
          "Frame context is unavailable. Call browser.frames({tabID}) and use a current frameID from this tab, or omit frameID for the main frame.",
        )
      const json = JSON.stringify(args)

      // Chromium's parser decides what the script is, without running it: an expression (an object literal too) is
      // returned; statements run like the DevTools console, which keeps the last value and lets calls redeclare const;
      // statements with a top-level return run as a function body.
      const compiles = async (source: string) =>
        !(
          await cdp.send(
            "Runtime.compileScript",
            { expression: source, sourceURL: "", persistScript: false, executionContextId: context?.id },
            context?.sessionID,
          )
        ).exceptionDetails

      const form = await (async () => {
        if (await compiles(`(${script}\n)`)) return "expression" as const

        if (await compiles(script)) return "statements" as const

        return "body" as const
      })()

      const sources = {
        expression: `(async (args) => (${script}\n))(${json})`,
        statements: `${args.length ? `const args = ${json};\n` : ""}${script}`,
        body: `(async (args) => {\n${script}\n})(${json})`,
      }

      return cdp.send(
        "Runtime.evaluate",
        {
          expression: sources[form],
          contextId: context?.id,
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
          replMode: form === "statements",
        },
        context?.sessionID,
      )
    })()

    const timeout = delay(input.timeoutMs, input.signal).then(() => {
      throw new BrowserError(
        "timeout",
        `The script did not finish within ${input.timeoutMs} ms. Its page work may still be running. Await only what you need, or raise timeoutMs.`,
      )
    })

    const value = await Promise.race([evaluation, timeout])

    if (value.exceptionDetails)
      throw new Error(
        `Page JavaScript threw an exception. Check the script${input.target ? " and target" : ""}; inspect the page before repeating code with side effects. Details: ${(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text).slice(0, 800)}`,
      )

    return Schema.decodeUnknownSync(Schema.Json)(value.result.value ?? null)
  }

  // ---- Acting ----

  function mouse(params: Protocol.Input.DispatchMouseEventRequest) {
    return delivered(cdp.send("Input.dispatchMouseEvent", params))
  }

  async function press(key: KeyEvent) {
    await delivered(cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...key }))
    await delivered(
      cdp.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: key.key,
        code: key.code,
        windowsVirtualKeyCode: key.windowsVirtualKeyCode,
        modifiers: key.modifiers,
      }),
    )
  }

  /** A user's tab that is not on screen can stall input; that is reported instead of hanging. */
  function delivered<A>(sent: Promise<A>) {
    if (host) return sent

    return Promise.race([
      sent,
      delay(5_000).then(() => {
        throw new BrowserError(
          "tab_hidden",
          "The page did not take the input: it is one of the user's own tabs and is not on screen. Open the page in your own tab with browser.tabs.open({url}) (agent tabs work in the background), or ask the user to show this tab.",
        )
      }),
    ])
  }

  async function caretToEnd(remote: Remote) {
    await cdp
      .send(
        "Runtime.callFunctionOn",
        {
          objectId: remote.objectId,
          functionDeclaration:
            "function() { if (typeof this.setSelectionRange === 'function' && typeof this.value === 'string') { try { this.setSelectionRange(this.value.length, this.value.length) } catch {} return } if (this.isContentEditable) { const range = document.createRange(); range.selectNodeContents(this); range.collapse(false); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range) } }",
        },
        remote.sessionID,
      )
      .catch(() => undefined)
  }

  async function fill(action: Extract<Browser.Action, { type: "fill" }>, signal: AbortSignal, scope: Scope) {
    const found = await resolve(action.target, "exists", action.timeoutMs, false, signal, scope)
    const control = await call(PageControl, "control", found.remote, [{ objectId: found.remote.objectId }], scope)
    const value = action.value
    const flag = value === true || value === "true" ? true : value === false || value === "false" ? false : undefined

    if (control.kind === "file")
      throw new BrowserError("invalid", `${action.target} is a file input. Use browser.upload({tabID, target, paths}).`)

    if (control.kind === "checkbox" || control.kind === "radio" || control.kind === "switch") {
      if (flag === undefined)
        throw new BrowserError("invalid", `${action.target} is a ${control.kind}; fill it with true or false.`)

      const checked = Schema.NullOr(Schema.Boolean)
      const current = await call(checked, "checked", found.remote, [{ objectId: found.remote.objectId }], scope)

      if (control.kind === "radio" && current === true && !flag)
        throw new BrowserError(
          "invalid",
          "A selected radio button cannot be cleared; fill another radio in its group with true.",
        )

      // Styled checkboxes hide their input (opacity 0) behind a label or a drawn box. When the input itself cannot take
      // a pointer click, its own click() toggles it and fires the events frameworks listen for, as a label click would.
      const pointer = await call(
        PageOutcome,
        "actionable",
        found.remote,
        [{ objectId: found.remote.objectId }, { value: "click" }],
        scope,
      )

      if (current !== flag && pointer.ok) await click(found.element)

      if (current !== flag && !pointer.ok)
        await cdp.send(
          "Runtime.callFunctionOn",
          { objectId: found.remote.objectId, functionDeclaration: "function() { this.click() }", userGesture: true },
          found.remote.sessionID,
        )

      const after = await call(checked, "checked", found.remote, [{ objectId: found.remote.objectId }], scope)

      if (after !== flag)
        throw new BrowserError(
          "not_actionable",
          "The page did not keep the requested checked state. Inspect its validation (browser.read or browser.find) before trying again.",
        )

      return found.count
    }

    if (value === true || value === false)
      throw new BrowserError(
        "invalid",
        `${action.target} is a ${control.kind} control; fill it with text, not true or false.`,
      )

    const values = Array.isArray(value) ? value : [String(value)]
    const text = values.join("\n")

    if (control.kind === "select" || control.kind === "range" || control.kind === "date" || control.kind === "color") {
      const located = await resolve(action.target, "fill", action.timeoutMs, false, signal, scope)

      const outcome = await call(
        PageOutcome,
        control.kind === "select" ? "select" : "setValue",
        located.remote,
        [{ objectId: located.remote.objectId }, { value: control.kind === "select" ? values : text }],
        scope,
      )

      if (!outcome.ok) throw new BrowserError("not_actionable", outcome.reason)

      return located.count
    }

    const located = await resolve(action.target, "fill", action.timeoutMs, false, signal, scope)
    await cdp.send("DOM.focus", { backendNodeId: located.element.backendID }, located.element.sessionID)
    // Focusing this field blurs the previous one; a validation dialog from that blur must stop here.
    abortError(signal)
    await press(parseChord(process.platform === "darwin" ? "Meta+A" : "Control+A"))
    await press(parseChord("Backspace"))
    abortError(signal)

    if (text) await cdp.send("Input.insertText", { text })

    return located.count
  }

  async function click(
    element: Element,
    button: Protocol.Input.MouseButton = "left",
    count = 1,
    modifiers: readonly string[] = [],
    position?: { x: number; y: number },
  ) {
    const at = await point(element, position)
    const flags = modifiers.reduce((mask, key) => mask | ({ Alt: 1, Control: 2, Meta: 4, Shift: 8 }[key] ?? 0), 0)
    await mouse({ type: "mouseMoved", ...at, modifiers: flags })

    for (let clickCount = 1; clickCount <= count; clickCount++) {
      await mouse({ type: "mousePressed", ...at, button, clickCount, modifiers: flags })
      await mouse({ type: "mouseReleased", ...at, button, clickCount, modifiers: flags })
    }
  }

  async function drag(source: Element, destination: Element, signal: AbortSignal) {
    await point(destination)
    const from = await point(source)
    const box = await rect(destination)
    const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    const html5 = await describeCall(source, "function() { return this.draggable; }")
    let data: Protocol.Input.DragData | undefined

    const off = cdp.on("Input.dragIntercepted", (event) => {
      data = event.data
    })

    await cdp.send("Input.setInterceptDrags", { enabled: true })
    await mouse({ type: "mouseMoved", ...from })
    await mouse({ type: "mousePressed", ...from, button: "left", buttons: 1, clickCount: 1 })

    try {
      for (let i = 1; i <= 10; i++) {
        abortError(signal)
        await mouse({
          type: "mouseMoved",
          x: from.x + ((to.x - from.x) * i) / 10,
          y: from.y + ((to.y - from.y) * i) / 10,
          button: "left",
          buttons: 1,
        })
      }

      if (html5) await waitFor(() => data !== undefined, signal, 2_000)

      if (data) {
        for (const type of ["dragEnter", "dragOver", "drop"])
          await cdp.send("Input.dispatchDragEvent", { type, ...to, data })
      }
    } finally {
      off()
      await cdp.send("Input.setInterceptDrags", { enabled: false })
      await mouse({ type: "mouseReleased", ...to, button: "left", clickCount: 1 })
    }
  }

  async function point(element: Element, position?: { x: number; y: number }) {
    const box = await rect(element, true)

    return position
      ? { x: box.x + position.x, y: box.y + position.y }
      : { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }

  // ---- Capture and emulation ----

  async function screenshot(
    action: Extract<Browser.Action, { type: "screenshot" }>,
    signal: AbortSignal,
    scope: Scope,
    captureSources: readonly string[],
    transfer: (id: Browser.FileID) => Promise<Browser.File>,
  ): Promise<[value: object, files: Browser.File[]]> {
    if (action.target && action.fullPage)
      throw new BrowserError(
        "invalid",
        "Choose either target for an element screenshot or fullPage: true for the whole page, not both.",
      )

    // The user's own tabs render only on screen; the agent's render offscreen and capture any time.
    if (!host)
      await waitFor(() => view.getVisible() && win.isVisible() && !win.isMinimized(), signal, 3_000).catch((error) => {
        if (signal.aborted) throw error
        throw new BrowserError(
          "tab_hidden",
          "This is one of the user's own tabs and it is not on screen, so it cannot be captured. Open the page in your own tab with browser.tabs.open({url}) (agent tabs capture in the background), or ask the user to show it.",
        )
      })

    const restore = action.viewport ? await temporaryViewport(action.viewport) : undefined

    try {
      const located = action.target ? await resolve(action.target, "exists", 5_000, false, signal, scope) : undefined
      const element = located ? await rect(located.element, true) : undefined
      const metrics = await cdp.send("Page.getLayoutMetrics")

      const bounds = element
        ? {
            ...element,
            x: element.x + metrics.cssVisualViewport.pageX,
            y: element.y + metrics.cssVisualViewport.pageY,
          }
        : action.fullPage
          ? metrics.cssContentSize
          : {
              x: metrics.cssVisualViewport.pageX,
              y: metrics.cssVisualViewport.pageY,
              width: metrics.cssVisualViewport.clientWidth,
              height: metrics.cssVisualViewport.clientHeight,
            }

      const pixelRatio = contents.getZoomFactor() * (host ? scale : electron.screen.getDisplayMatching(win.getBounds()).scaleFactor)
      const scaled = Math.min(1, (action.maxWidth ?? 2000) / (bounds.width * pixelRatio))

      if (bounds.width <= 0 || bounds.height <= 0)
        throw new BrowserError(
          "not_actionable",
          "The element or page has no visible area to capture. Choose a visible element, or omit target to capture the viewport.",
        )

      if (bounds.width * bounds.height * (scaled * pixelRatio) ** 2 > 16_000_000)
        throw new BrowserError("invalid", "Screenshot exceeds 16 megapixels; capture an element or use a smaller maxWidth.")
      const format = action.format ?? "png"

      const capture = await cdp.send("Page.captureScreenshot", {
        format,
        quality: format === "png" ? undefined : (action.quality ?? 80),
        captureBeyondViewport: true,
        clip: { ...bounds, scale: scaled },
      })

      const data = Buffer.from(capture.data, "base64")
      const size = electron.nativeImage.createFromBuffer(data).getSize()

      const id = await files.save(`screenshot.${format}`, `image/${format}`, data, [
        ...captureSources,
        ...sourceURLs(),
      ])

      return [{ tab: state(), width: size.width, height: size.height }, [await transfer(id)]]
    } finally {
      await restore?.()
    }
  }

  /** Renders the page at another size until the returned restore runs. */
  async function temporaryViewport(viewport: Browser.Viewport) {
    const previous = emulation.viewport
    emulation.viewport = viewport
    await applyViewport()

    return async () => {
      emulation.viewport = previous
      await applyViewport()
    }
  }

  /** Applies the pinned viewport, or lets the page follow the pane again. */
  async function applyViewport() {
    const viewport = emulation.viewport

    if (host) {
      // The size the page had before a pin, which it returns to when no presenter reports one.
      if (viewport) {
        unpinned ??= host.getContentSize()
        host.setContentSize(viewport.width, viewport.height)
      }

      if (!viewport && unpinned) {
        host.setContentSize(unpinned[0] ?? defaultSize.width, unpinned[1] ?? defaultSize.height)
        unpinned = undefined
      }

      presenter?.resize()

      if (viewport && (viewport.mobile || viewport.deviceScaleFactor))
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: viewport.deviceScaleFactor ?? 0,
          mobile: viewport.mobile ?? false,
        })
      else await cdp.send("Emulation.clearDeviceMetricsOverride")

      // A resized offscreen window lays out on its next frame; the agent's next read must see the new size.
      const width = viewport?.width ?? host.getContentSize()[0]
      await waitFor(
        async () =>
          (await cdp.send("Runtime.evaluate", { expression: "innerWidth", returnByValue: true })).result.value ===
          width,
        new AbortController().signal,
        1_000,
      ).catch(() => undefined)

      return
    }

    if (!viewport) {
      await cdp.send("Emulation.clearDeviceMetricsOverride")

      return
    }

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor ?? 0,
      mobile: viewport.mobile ?? false,
    })
  }

  async function emulate(action: Extract<Browser.Action, { type: "emulate" }>) {
    if (action.reset) {
      emulation.viewport = undefined
      emulation.colorScheme = undefined
      emulation.reducedMotion = undefined
      emulation.media = undefined
      emulation.offline = false
      emulation.timezone = undefined
      emulation.locale = undefined
      emulation.userAgent = undefined
    }

    if (action.viewport !== undefined) emulation.viewport = action.viewport ?? undefined

    if (action.colorScheme !== undefined) emulation.colorScheme = action.colorScheme ?? undefined

    if (action.reducedMotion !== undefined) emulation.reducedMotion = action.reducedMotion ?? undefined

    if (action.media !== undefined) emulation.media = action.media ?? undefined

    if (action.offline !== undefined) emulation.offline = action.offline

    if (action.timezone !== undefined) emulation.timezone = action.timezone ?? undefined

    if (action.locale !== undefined) emulation.locale = action.locale ?? undefined

    if (action.userAgent !== undefined) emulation.userAgent = action.userAgent ?? undefined

    await applyViewport()
    await cdp.send("Emulation.setEmulatedMedia", {
      media: emulation.media ?? "",
      features: [
        { name: "prefers-color-scheme", value: emulation.colorScheme ?? "" },
        { name: "prefers-reduced-motion", value: emulation.reducedMotion ?? "" },
      ],
    })
    await cdp.send("Network.emulateNetworkConditions", {
      offline: emulation.offline,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    })
    await cdp
      .send("Emulation.setTimezoneOverride", { timezoneId: emulation.timezone ?? "" })
      .catch(() => {
        if (emulation.timezone)
          throw new BrowserError("invalid", `Unknown time zone ${emulation.timezone}. Use an IANA name such as Europe/Berlin.`)
      })
    await cdp.send("Emulation.setLocaleOverride", emulation.locale ? { locale: emulation.locale } : {}).catch(() => {
      if (emulation.locale) throw new BrowserError("invalid", `Unknown locale ${emulation.locale}. Use a BCP 47 tag such as de-DE.`)
    })
    await cdp.send("Emulation.setUserAgentOverride", { userAgent: emulation.userAgent ?? contents.session.getUserAgent() })
    publish()

    return { ...emulation }
  }

  async function storage(action: Extract<Browser.Action, { type: "storage" }>, scope: Scope) {
    if (action.area !== "cookies") {
      return call(
        PageEntries,
        "storage",
        await windowObject(undefined, scope),
        [
          { value: action.area },
          { value: action.action },
          { value: action.entries ?? null },
          { value: action.keys ?? null },
        ],
        scope,
      )
    }

    const url = contents.getURL()

    if (!destinationOrigin(url))
      throw new BrowserError("invalid", "Cookies belong to web pages. Navigate the tab to the site first.")
    const cookies = contents.session.cookies

    if (action.action === "set") {
      const entries = Object.entries(action.entries ?? {})
      await Promise.all(entries.map(([name, value]) => cookies.set({ url, name, value })))

      return entries.map(([name]) => ({ name, value: "<redacted>" }))
    }

    const all = await cookies.get({ url })
    const chosen = action.keys ? all.filter((cookie) => action.keys?.includes(cookie.name)) : all

    if (action.action === "clear") {
      await Promise.all(chosen.map((cookie) => cookies.remove(cookieURL(cookie), cookie.name)))

      return []
    }

    // The model never reads cookie values, as with request headers; names and scope are enough to reason about them.
    return chosen.map((cookie) => ({
      name: cookie.name,
      value: "<redacted>",
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expirationDate,
      httpOnly: cookie.httpOnly ?? false,
      secure: cookie.secure ?? false,
    }))
  }

  // ---- Permission metadata ----

  async function inspect(action: Browser.Action): Promise<Browser.Target> {
    // Most CDP queries cannot run while a JavaScript dialog blocks the renderer.
    if (action.type === "dialog")
      return {
        resources: [dialog ? dialogURL : contents.getURL()],
        key: `${generation}:${dialogRevision}:${Boolean(dialog)}`,
      }

    const fileIDs =
      action.type === "heap.query" || action.type === "heap.object"
        ? [action.fileID]
        : action.type === "files.get"
          ? [action.id]
          : action.type === "heap.snapshot" && action.compareTo
            ? [action.compareTo]
            : []

    if (fileIDs.length)
      return {
        resources: [...new Set(fileIDs.flatMap((id) => files.get(id).resources))].sort(),
        key: JSON.stringify(fileIDs),
      }

    if (action.type === "network.get") return { resources: [diagnostics.info(action.id).url], key: action.id }

    if (action.type === "profile.stop") return profiling.target(profiling.active() ?? recordingKind ?? "trace")
    const tree = await frames()
    tree.forEach((frame) => documents.set(frame.id, frame.url))

    const locators =
      action.type === "drag"
        ? [action.from, action.to]
        : "target" in action && action.target !== undefined
          ? [action.target]
          : []

    // Only refs name an element before the action runs; other locators resolve against the document then.
    const selected = locators.flatMap((locator) => {
      const first = steps(locator)[0]

      return first?.kind === "ref" ? [refElement(first.ref)] : []
    })

    const frameIDs = selected.length
      ? selected.map((element) => element.frameID)
      : "frameID" in action && action.frameID
        ? [action.frameID]
        : []

    const urls = frameIDs.map((id) => {
      const frame = tree.find((frame) => frame.id === id)

      if (!frame) throw new Error("Frame is unavailable. Call browser.frames({tabID}) and use a current frameID.")

      return frame.url
    })

    const capture = ["screenshot", "lighthouse", "profile.start", "heap.snapshot"].includes(action.type)

    return {
      resources: [
        ...new Set(
          action.type === "navigate" && action.url
            ? [new URL(normalizeURL(action.url, policy)).href]
            : capture
              ? sourceURLs()
              : urls.length
                ? urls
                : [contents.getURL()],
        ),
      ].sort(),
      key: JSON.stringify([generation, revision, selected, locators]),
    }
  }

  // ---- Element geometry, shared with the element picker ----

  async function frames() {
    const root = await cdp.send("Page.getFrameTree")
    const result: { id: string; parentID?: string; url: string; name: string }[] = []

    const walk = (tree: Protocol.Page.FrameTree, parentID?: string) => {
      if (!result.some((frame) => frame.id === tree.frame.id))
        result.push(
          tree.frame.parentId || parentID
            ? {
                id: tree.frame.id,
                parentID: tree.frame.parentId ?? parentID,
                url: tree.frame.url,
                name: tree.frame.name ?? "",
              }
            : { id: tree.frame.id, url: tree.frame.url, name: tree.frame.name ?? "" },
        )
      tree.childFrames?.forEach((child) => walk(child, tree.frame.id))
    }

    walk(root.frameTree)

    const children = await Promise.all(
      Array.from(sessions, async ([id, sessionID]) => ({
        id,
        tree: await cdp.send("Page.getFrameTree", {}, sessionID).catch(() => undefined),
      })),
    )

    children.forEach(({ id, tree }) => {
      if (tree) walk(tree.frameTree, parents.get(id) ?? root.frameTree.frame.id)
    })

    return result
  }

  async function describeCall(element: Element, functionDeclaration: string, args: unknown[] = []) {
    const objectId = await resolveObject(element)

    try {
      const result = await cdp.send(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration,
          arguments: args.map((value) => ({ value })),
          returnByValue: true,
          awaitPromise: true,
          userGesture: true,
        },
        element.sessionID,
      )

      if (result.exceptionDetails)
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)

      // SAFETY: widens CDP's `any` value to unknown; every caller decodes or compares it.
      return result.result.value as unknown
    } finally {
      await cdp.send("Runtime.releaseObject", { objectId }, element.sessionID).catch(() => undefined)
    }
  }

  async function resolveObject(element: Element) {
    const object = await cdp.send("DOM.resolveNode", { backendNodeId: element.backendID }, element.sessionID)

    if (!object.object.objectId)
      throw new Error(
        "Element is no longer available: the page replaced it. Use a locator (text=, role=, label=, CSS) instead of the old ref.",
      )

    return object.object.objectId
  }

  async function rect(element: Element, scroll = false) {
    if (scroll) {
      await cdp.send("DOM.scrollIntoViewIfNeeded", { backendNodeId: element.backendID }, element.sessionID)

      // A user's tab that is not on screen may hold its last frame; a capture makes Chromium lay it out again. The
      // agent's offscreen tabs are painting while they work.
      if (!host)
        await Promise.race([
          contents.capturePage(undefined, { stayHidden: true, stayAwake: true }).catch(() => undefined),
          delay(1_000),
        ])
    }

    const bounds = Schema.Struct({ x: Schema.Finite, y: Schema.Finite, width: Schema.Finite, height: Schema.Finite })

    const value = {
      ...Schema.decodeUnknownSync(bounds)(
        await describeCall(
          element,
          "function() { const r = this.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; }",
        ),
      ),
    }

    const tree = await frames()
    let frame = tree.find((frame) => frame.id === element.frameID)

    while (frame?.parentID) {
      const parent = { frameID: frame.parentID, sessionID: sessionFor(frame.parentID, tree) }
      const owner = await cdp.send("DOM.getFrameOwner", { frameId: frame.id }, parent.sessionID)

      // A CSS transform on the iframe scales its content box; the child's own coordinates are unscaled.
      const box = Schema.decodeUnknownSync(
        Schema.Struct({ ...bounds.fields, scaleX: Schema.Finite, scaleY: Schema.Finite }),
      )(
        await describeCall(
          { backendID: owner.backendNodeId, ...parent },
          "function() { const r = this.getBoundingClientRect(); const sx = this.offsetWidth ? r.width / this.offsetWidth : 1; const sy = this.offsetHeight ? r.height / this.offsetHeight : 1; return {x:r.x+this.clientLeft*sx,y:r.y+this.clientTop*sy,width:r.width,height:r.height,scaleX:sx,scaleY:sy}; }",
        ),
      )

      value.x = box.x + value.x * box.scaleX
      value.y = box.y + value.y * box.scaleY
      value.width *= box.scaleX
      value.height *= box.scaleY
      frame = tree.find((item) => item.id === frame?.parentID)
    }

    return value
  }

  // Same-process child frames have no CDP target of their own; the nearest ancestor with one owns them.
  function sessionFor(frameID: string, tree: { id: string; parentID?: string }[]) {
    let id: string | undefined = frameID

    while (id && !sessions.has(id)) id = tree.find((frame) => frame.id === id)?.parentID

    return id ? sessions.get(id) : undefined
  }

  // ---- The user's element picker ----

  async function toggleInspect(enabled: boolean) {
    picks++

    if (enabled !== inspecting) {
      inspecting = enabled
      clearTimeout(flash)
      await Promise.all(
        [undefined, ...sessions.values()].map((sessionID) =>
          (enabled ? arm(sessionID) : cdp.send("Overlay.setInspectMode", inspectOff, sessionID)).catch(() => undefined),
        ),
      )

      if (!enabled) await hideHighlight()
    }

    // A later toggle may have finished first; report where the picker ended up.
    options.inspect?.({ active: inspecting })
  }

  async function arm(sessionID?: string) {
    // The main target enables DOM at startup; frame targets only need it for the picker.
    if (sessionID) await cdp.send("DOM.enable", {}, sessionID)
    await cdp.send("Overlay.enable", {}, sessionID)

    // The picker may have been turned off while the domains were enabling.
    if (!inspecting) return
    await cdp.send("Overlay.setInspectMode", { mode: "searchForNode", highlightConfig: inspectHighlight }, sessionID)
  }

  async function inspected(backendID: number, sessionID?: string) {
    inspecting = false
    const pick = ++picks
    const navigation = generation
    await Promise.all(
      [undefined, ...sessions.values()].map((id) =>
        cdp.send("Overlay.setInspectMode", inspectOff, id).catch(() => undefined),
      ),
    )
    // Keep the box model on the picked element, without the tooltip, while the renderer freezes the page.
    await cdp.send("Overlay.highlightNode", { backendNodeId: backendID, highlightConfig: pickedHighlight }, sessionID)
    const element = { backendID, frameID: await frameOf(backendID, sessionID), sessionID }
    const [details, box, accessible] = await Promise.all([describe(element), rect(element), accessibility(element)])
    await painted(sessionID)

    // Escape, a toggle, hiding, or navigation while the element was described cancels the pick.
    if (closed) return

    if (pick !== picks || navigation !== generation) {
      if (!inspecting) await hideHighlight()
      options.inspect?.({ active: inspecting })

      return
    }

    const ref = options.shared.ref()
    picked.set(ref, element)
    const zoom = contents.getZoomFactor()

    // The pick focused the page; the comment editor opens in the app window. Focus only moves
    // within a focused window, so synthetic input never raises a background window.
    if (!win.isDestroyed() && win.isFocused()) win.webContents.focus()
    options.inspect?.({
      active: false,
      element: {
        ref: Browser.Ref.make(ref),
        ...details,
        ...accessible,
        rect: { x: box.x * zoom, y: box.y * zoom, width: box.width * zoom, height: box.height * zoom },
      },
    })
  }

  async function highlightPicked(ref?: Browser.Ref) {
    clearTimeout(flash)
    const element = ref ? picked.get(ref.replace(/^@/, "")) : undefined

    if (!element) return hideHighlight()
    await cdp.send("DOM.scrollIntoViewIfNeeded", { backendNodeId: element.backendID }, element.sessionID)
    await cdp.send(
      "Overlay.highlightNode",
      { backendNodeId: element.backendID, highlightConfig: pickedHighlight },
      element.sessionID,
    )
    flash = setTimeout(() => void hideHighlight(), 1_500)
  }

  async function hideHighlight() {
    await Promise.all(
      [undefined, ...sessions.values()].map((sessionID) =>
        cdp.send("Overlay.hideHighlight", {}, sessionID).catch(() => undefined),
      ),
    )
  }

  // The picker names a node but not its frame. A target owns its root frame plus any same-process
  // child frames, so match the node's document against each child frame's content document.
  async function frameOf(backendID: number, sessionID?: string) {
    const tree = await frames()
    const owned = tree.filter((frame) => sessionFor(frame.id, tree) === sessionID)
    const root = owned.find((frame) => !frame.parentID || sessionFor(frame.parentID, tree) !== sessionID) ?? tree[0]
    const nested = owned.filter((frame) => frame !== root)

    if (!nested.length) return root.id
    // The node and its document join one object group, released even when a later call rejects.
    const objectGroup = `frame-of-${crypto.randomUUID()}`

    const described = await (async () => {
      const node = await cdp.send("DOM.resolveNode", { backendNodeId: backendID, objectGroup }, sessionID)

      const document = node.object.objectId
        ? await cdp.send(
            "Runtime.callFunctionOn",
            {
              objectId: node.object.objectId,
              functionDeclaration: "function() { return this.ownerDocument; }",
              objectGroup,
            },
            sessionID,
          )
        : undefined

      return document?.result.objectId
        ? await cdp.send("DOM.describeNode", { objectId: document.result.objectId }, sessionID)
        : undefined
    })().finally(() => void cdp.send("Runtime.releaseObjectGroup", { objectGroup }, sessionID).catch(() => undefined))

    const owners = await Promise.all(
      nested.map(async (frame) => {
        const owner = await cdp.send("DOM.getFrameOwner", { frameId: frame.id }, sessionID).catch(() => undefined)

        const iframe = owner
          ? await cdp.send("DOM.describeNode", { backendNodeId: owner.backendNodeId }, sessionID).catch(() => undefined)
          : undefined

        return { id: frame.id, document: iframe?.node.contentDocument?.backendNodeId }
      }),
    )

    return owners.find((owner) => owner.document === described?.node.backendNodeId)?.id ?? root.id
  }

  async function describe(element: Element) {
    return Schema.decodeUnknownSync(
      Schema.Struct({ label: Schema.String, selector: Schema.String, text: Schema.optionalKey(Schema.String) }),
    )(
      await describeCall(
        element,
        `function() {
          const clip = (value, max) => (value.length > max ? value.slice(0, max - 1) + "\u2026" : value)
          const label = this.localName + (this.id ? "#" + this.id : "") + Array.from(this.classList, (name) => "." + name).join("")
          // One segment per document or shadow root, outermost first; " >>> " steps into a host's shadow root.
          const segments = []
          for (let start = this; start; ) {
            const root = start.getRootNode()
            const path = []
            for (let node = start; node; node = node.parentElement) {
              if (node.id && root.querySelectorAll("#" + CSS.escape(node.id)).length === 1) {
                path.unshift("#" + CSS.escape(node.id))
                break
              }
              if (node === node.ownerDocument.body) {
                path.unshift("body")
                break
              }
              const same = Array.from(node.parentNode?.children ?? []).filter((child) => child.localName === node.localName)
              path.unshift(CSS.escape(node.localName) + (same.length > 1 ? ":nth-of-type(" + (same.indexOf(node) + 1) + ")" : ""))
            }
            segments.unshift(path.join(" > "))
            start = root instanceof ShadowRoot ? root.host : undefined
          }
          const selector = segments.join(" >>> ")
          const text = clip((this.innerText ?? this.textContent ?? "").replace(/\\s+/g, " ").trim(), 160)
          // A cut selector is invalid syntax; leave it out rather than pass it off as usable.
          return { label: clip(label, 200), selector: selector.length > 2000 ? "" : selector, ...(text ? { text } : {}) }
        }`,
      ),
    )
  }

  async function accessibility(element: Element) {
    const tree = await cdp
      .send(
        "Accessibility.getPartialAXTree",
        { backendNodeId: element.backendID, fetchRelatives: false },
        element.sessionID,
      )
      .catch(() => undefined)

    const node = tree?.nodes.find((node) => node.backendDOMNodeId === element.backendID && !node.ignored)
    const role = String(node?.role?.value ?? "")

    const name = String(node?.name?.value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160)

    const labeled = role && !["generic", "none", "presentation"].includes(role) ? { role: role.slice(0, 128) } : {}

    return name ? { ...labeled, name } : labeled
  }

  // Wait until the compositor shows the picked highlight without the hover tooltip, so the
  // renderer's still of the page includes it. A stalled page must not hold the comment back.
  async function painted(sessionID?: string) {
    await Promise.race([
      cdp
        .send(
          "Runtime.evaluate",
          {
            expression: "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
            awaitPromise: true,
          },
          sessionID,
        )
        .catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 150)),
    ])
  }
}
