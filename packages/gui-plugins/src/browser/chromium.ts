import { homedir } from "node:os"
import { scheduler } from "node:timers/promises"
import { navigationTurn, replacementNavigation } from "./navigation-turn"
import { accessibilitySnapshot } from "./snapshot"
import { documentRefs } from "./refs"
import { describeField, Field, readableField } from "./field-value"
import { agentRendering, needsWakeFrame } from "./agent-rendering"
import { extensionResource } from "./profile/extension-api/resource"
import { Browser } from "@opencode/plugin-browser/rpc"
import electron, { type BrowserWindow, type WebContents } from "electron"
import type { Protocol } from "devtools-protocol"
import { Schema } from "effect"
import type { Embeds } from "@opencode/plugin/gui/main"
import { captureCoordinator, captureScale, cropPixels, FULL_PAGE_DEADLINE_MS, jpegFits, pngFits, undrawable, undrawableMessage } from "./capture"
import { createCdp, abortError, waitFor } from "./cdp"
import { navigationDeadline } from "./navigation-deadline"
import { attachChildren, releaseWorker } from "./child-targets"
import { CodedError, missingArtifact, pageReports } from "./errors"
import { createBrowserFiles } from "./files"
import { guardFileChoosers } from "./file-choosers"
import { guardMediaRequests } from "./media-gate"
import { afterRefusal, agentPasskeyRefusal, guardWebAuthn } from "./webauthn-gate"
import { cookieSite } from "./profile/sites"
import { createDiagnostics } from "./diagnostics"
import { loadIcon } from "./icon"
import { agentKeyRefusal, hardwareInput, pageLetter, pageReload, pageShortcut, type PageShortcut } from "./keys"
import {
  createDocumentState,
  documentGeneration,
  documentIcon,
  documentTab,
  frameStillCurrent,
  isDocumentClosed,
  isNavigationPending,
  leftApprovedSite,
  retryOnly,
  transitionDocument,
  type DocumentEvent,
} from "./page-machine"
import {
  initialPickerState,
  isPickerActive,
  pickerAttempt,
  PICKER_TIMEOUT_MS,
  transitionPicker,
  type PickerEffect,
  type PickerEvent,
} from "./picker-machine"
import { createProfiling } from "./profiling"
import type { SharedTrace } from "./profiling-machine"
import {
  createDialogGateState,
  selectDialog,
  selectDialogTarget,
  selectOpenDialog,
  selectSuppressed,
  selectUserDialog,
  transitionDialogGate,
  type DialogGateEvent,
  type RunStopReason,
} from "./dialog-machine"
import type { BrowserNetwork } from "./network"
import {
  agentFrame,
  agentFrames,
  agentDriven,
  childActivity,
  agentRefusal,
  activityOwner,
  recordPageInput,
  allowedDestination,
  committedLoad,
  destinationOrigin,
  downloadOwner,
  excludedFrames,
  inputDocument,
  localFileURL,
  normalizeURL,
  type Policy,
  type TabActivity,
} from "./policy"
import type { PaneElement, PaneEvent, PromptView, RefusalNotice, Viewport } from "./ipc"
import { createViewportWriter } from "./viewport-native"
import { createDeviceEmulation } from "./mobile-emulation"
import { navigationNotice, popupActivated } from "./refusal-notice"
import { noticeActions } from "./notice-actions"
import { attachPageMenu, type PageMenuHost } from "./native-page-menu"
import { reloadAddress } from "./preview"
import { pageHandoff } from "./address"
import { defaultBrowser } from "./default-browser"
import { FileVerificationError } from "@opencode/util/file-verification"
import type { workspacePages } from "./workspace-pages"
import { artifactLinks } from "./artifact-links"
import { createPagePrompts, RESTORE_PROMPT, takeDialogs } from "./page-prompts"
import type { SitePermissions } from "./site-permissions"
import type { SystemMedia } from "./system-media"
import { previewScheme } from "./scheme"
import type { WorkspaceSource } from "./workspace-file"
import type { artifactPages } from "./artifact-preview"

type Element = { backendID: number; frameID: string; sessionID?: string }

// A page can retain a removed node. Check in the same renderer call that reads or acts on the ref.
function connectedFunction(fn: string) {
  return `function(...args) { if (!this.isConnected) throw new Error('browser.detached_ref'); return (${fn}\n).apply(this,args) }`
}

function detachedRef() {
  return new CodedError(Browser.FailureCode.staleRef, "Element is no longer connected. Take a fresh snapshot and choose a current ref.")
}

const noVisibleArea = "Element has no visible screenshot area. Take a fresh snapshot and choose a visible element, or omit ref to capture the viewport."

/** State every page of the pane shares: the element ref allocator and the owner of the app-wide trace. */
export type Shared = { ref: () => string; trace?: SharedTrace }

// Captures and downloads belong to the tab, not whichever document it now shows; navigate replaces it anyway. A wait
// reads whichever document is current, often the one a click just navigated to.
const retainedOperations: readonly Browser.Method[] = [
  "navigate",
  "wait",
  "files.list",
  "files.get",
  "trace.stop",
  "trace.analyze",
  "cpu.stop",
  "cpu.analyze",
  "heap.summary",
  "heap.query",
  "heap.object",
  "heap.compare",
]

// The user's commands that leave the document, which a page's beforeunload may hold back for "Leave site?".
const leavable: readonly Browser.Method[] = ["navigate", "back", "forward", "reload"]

// Input the page receives while the element picker is on would pick an element instead.
const pointerOperations: readonly Browser.Method[] = [
  "click",
  "hover",
  "drag",
  "fill",
  "fill_form",
  "select",
  "check",
  "scroll",
  "files.drop",
]

/** Virtual key codes of the named keys `press` accepts. */
interface KeyCodes {
  readonly [key: string]: number
}

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

export type PageDetail = Omit<Extract<PaneEvent, { type: "page" }>, "type" | "tabID">

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

/** Ends a running command's wait when it is interrupted. */
type Interrupted = ReturnType<typeof Promise.withResolvers<never>>

/** What a command that stopped, or never started, tells the agent. */
function runStopError(reason: RunStopReason) {
  switch (reason) {
    case "dialog-open":
      return new Error(
        'A JavaScript dialog is open. Inspect it with browser.dialog({tabID,action:"get"}), then explicitly accept or dismiss it before continuing.',
      )
    case "dialog-interrupted":
      return new Error(
        'A JavaScript dialog opened while the action was running. Inspect it with browser.dialog({tabID,action:"get"}) and accept or dismiss it. Do not repeat the original action just to close the dialog.',
      )
    case "cancelled":
      return new Error(
        "Browser operation was cancelled. Inspect the tab before deciding to repeat an action; cancellation does not undo changes already made.",
      )
    case "closed":
      return new Error(
        "Browser tab was closed. Call browser.tabs.list({}) and choose an existing tabID; do not reuse the closed tab's refs.",
      )
  }
}

export type BrowserPage = ReturnType<typeof createBrowserPage>

export function createBrowserPage(
  win: BrowserWindow,
  options: {
    id: Browser.TabID
    partition: string
    network: BrowserNetwork | null
    publish: (error?: string) => void
    refused: (notice: RefusalNotice, token: string, site?: string) => void
    /** Reports the element picker starting, stopping, or picking an element. */
    inspect?: (event: { active: boolean; element?: PaneElement }) => void
    /** Reports changes to the page's icon, zoom, or layout viewport. */
    detail?: (detail: PageDetail) => void
    /** The page's zoom changed, which Chromium applies to every page of the same origin in the partition. */
    zoomed?: () => void
    /** Whether the build offers the device toolbar, which owns ⇧⌘M. */
    toolbar: boolean
    /** Hands a browser or shell shortcut to the app window. */
    shortcut?: (shortcut: PageShortcut) => void
    /** The page took keyboard focus. */
    focused?: () => void
    /** The page left the screen: another tab or a preview took its place, or the pane closed. */
    hidden?: () => void
    fail: () => void
    /** Adopts a page the document opened; a background one leaves the current tab selected. */
    popup: (options: Electron.BrowserWindowConstructorOptions, background: boolean, activity: TabActivity) => WebContents
    activity: TabActivity
    userInput: () => void
    initialize?: boolean
    restore?: Browser.Tab
    popupOptions?: Electron.BrowserWindowConstructorOptions
    /** Directories whose files may load as file:// documents; empty when the server is remote. */
    fileRoots?: () => ReadonlyArray<string>
    /** This binding's isolated origin for workspace previews. */
    workspace?: ReturnType<typeof workspacePages>
    /** Failure retained by the protocol handler; Chromium only reports ERR_FAILED for a rejected request. */
    previewFailure?: (url: string) => typeof FileVerificationError.code | undefined
    artifacts?: ReturnType<typeof artifactPages>
    remote?: Extract<WorkspaceSource, { type: "remote" }>
    /**
     * The tab's pop-up group must refuse passkeys too: the agent drives this tab, and a page of the group can script
     * another through `window.opener` or the window it opened. Windows only.
     */
    restrictPasskeys?: () => void
    /** The tab's pop-up group refuses passkeys already, so this tab does from its first document. */
    passkeysRestricted?: () => boolean
    /** The server runs on this machine, so its loopback addresses are this machine's and the system browser reaches them. */
    local: boolean
    signal: AbortSignal
    /** Extensions whose `chrome-extension://` pages may open, such as their popups and options. */
    extensions?: () => ReadonlyArray<string>
    shared: Shared
    menu: PageMenuHost
    embeds: Embeds
    /** The permission decisions the user kept for sites. */
    sites: SitePermissions
    /** The page browses in a remote server's partition, not the profile. */
    serverPartition?: boolean
    waitForFilters?: (url: string, signal: AbortSignal) => Promise<void> | undefined
    /** Reports what the tab waits on the user for, to the window only. */
    prompt?: (view: PromptView | null) => void
    /** Closes the tab, after the user chose to leave a page that asked to stay. */
    closeTab?: () => void
    /** Gives the page keyboard focus back after a prompt, when its tab is in front. */
    focusPage?: () => void
    /** The tab is the one in front of its pane and the app window has the keyboard. */
    front?: () => boolean
    /** The system's camera and microphone setting, and its prompt (system-media.ts). */
    system: SystemMedia
    /** Logs that an Electron internal is not what the page expects; the pane logs each message once. */
    warn?: (message: string) => void
  },
) {
  const policy: Policy = {
    home: homedir(),
    remote: options.remote?.prefix,
    artifacts: !!options.artifacts,
    get fileRoots() {
      return options.fileRoots?.() ?? []
    },
    get extensions() {
      return options.extensions?.() ?? []
    },
  }

  const initial = options.initialize === false ? undefined : normalizeURL(options.restore?.url || "about:blank", policy)
  // Until this constructor hands back a BrowserPage there is no tab which could dispose these resources.
  using constructing = new DisposableStack()

  const view = new electron.WebContentsView({
    ...options.popupOptions,
    webPreferences: {
      partition: options.partition,
      nodeIntegration: false,
      // Deliver the profile's CSS receiver to child frames. It runs in the isolated sandbox, not the web world.
      nodeIntegrationInSubFrames: options.local === true,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      devTools: false,
      // Agent navigation, including in hidden tabs, must not take the user's keyboard focus.
      focusOnNavigation: false,
    },
  })

  const contents = view.webContents
  const pageLifetime = new AbortController()
  contents.once("destroyed", () => pageLifetime.abort())
  constructing.defer(() => pageLifetime.abort())
  constructing.defer(() => { if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false }) })

  const rendering = agentRendering(pageLifetime.signal, enabled => contents.setBackgroundThrottling(enabled))
  const opening = agentDriven(options.activity) ? rendering.hold() : undefined
  constructing.defer(() => options.workspace?.dispose())
  constructing.defer(() => options.artifacts?.dispose())
  const preview = (url: string) => options.artifacts?.display(url) ?? options.workspace?.display(url)
  // Keep the fence across transient blank/error documents. Page JS cannot clear it by navigating itself.
  let artifactHost: string | undefined
  const displayURL = (url: string) => preview(url) ?? (/^(?:oc-preview|file):/i.test(url) ? "about:blank" : url)
  const detachNetwork = options.network?.attach(contents)

  if (detachNetwork) constructing.defer(detachNetwork)
  let nativeMenu = true
  // Tab focus and browser chrome commands also reclaim the tab for the person. Neither is input to this document.
  let documentInput = false
  // Presses the agent sent through the debugger that the page has not reported yet.
  let agentPresses = 0
  contents.on("before-mouse-event", (_event, mouse) => {
    if (mouse.type !== "mouseDown") return

    // Unlike keyboard events, Electron 44 does not expose the Blink modifiers on mouse events, so a press carries no
    // debugger provenance. Each press the agent sent is counted out here, even one reported after its command ended;
    // any other press while the agent acts stays the agent's. A press during the agent's `wait`, which sends no
    // input and is not counted as acting, is the person's.
    if (agentPresses > 0) return void agentPresses--

    if (activity.agentRuns > 0) return
    documentInput = true
    nativeMenu = true
    recordPageInput(activity, "user")
    options.userInput()
    void choosers.update().catch(() => undefined)
  })

  // A cropped page can own focus in its child window. Only that child may raise the host.
  function focusHost() {
    if (win.isDestroyed()) return
    const focused = electron.BaseWindow.getFocusedWindow()

    if (focused?.getParentWindow() === win && focused.contentView.children.includes(view)) win.focus()

    if (win.isFocused()) win.webContents.focus()
  }

  contents.on("before-input-event", (event, input) => {
    const hardware = hardwareInput(input)
    contents.setIgnoreMenuShortcuts(!hardware)

    if (!hardware || input.type !== "keyDown") return

    documentInput = true
    nativeMenu = true
    recordPageInput(activity, "user")
    options.userInput()
    void choosers.update().catch(() => undefined)

    if (pageReload(input, process.platform === "darwin")) {
      event.preventDefault()
      void options.menu.navigate("reload").catch((error: Error) => { if (!pageReports(error)) publish(error.message) })

      return
    }

    if (input.key === "Escape" && isPickerActive(pickerState)) {
      event.preventDefault()
      void dispatchPicker({ type: "escape.pressed" })

      return
    }

    const shortcut = pageShortcut(input, process.platform === "darwin", options.toolbar)

    if (shortcut) {
      event.preventDefault()

      options.shortcut?.(shortcut)

      return
    }

    if (input.alt || !(process.platform === "darwin" ? input.meta : input.control)) return

    // The same chord as Chromium DevTools' element picker.
    if (input.shift && pageLetter(input) === "c") {
      event.preventDefault()
      void dispatchPicker({ type: "inspect.toggled" })

      return
    }

    const direction = zoomKey(input)

    if (!direction) return
    event.preventDefault()
    zoom(direction)
  })
  // Ctrl or Cmd with the mouse wheel; Electron leaves applying it to the app.
  contents.on("zoom-changed", (_event, direction) => zoom(direction))

  const zoom = (direction: "in" | "out" | "reset") => {
    const current = contents.getZoomFactor()
    const next = zoomStep(current, direction)

    if (next === current) return
    contents.setZoomFactor(next)
    detail()
    options.zoomed?.()
  }

  let documentState = createDocumentState(options.restore)
  const closed = () => isDocumentClosed(documentState)

  const withFrames = captureCoordinator(
    () => contents.beginFrameSubscription(true, () => {}),
    () => { if (!contents.isDestroyed()) contents.endFrameSubscription() },
  )

  let reported: PageDetail | undefined
  const cdp = createCdp(contents)

  const sessions = new Map<string, string>()
  const device = createDeviceEmulation(cdp, sessions)
  const metrics = createViewportWriter(device.apply, report, closed)

  function report() {
    if (closed()) return
    // Chromium's factor for the outermost presets can land a rounding error outside them.
    const zoom = Math.min(5, Math.max(0.25, contents.getZoomFactor()))
    const icon = documentIcon(documentState)
    const retry = retryOnly(documentState)
    const { viewport, viewportNotice } = metrics.applied()

    if (
      reported?.zoom === zoom &&
      reported.icon === icon &&
      !!reported.retryOnly === retry &&
      reported.viewport === viewport &&
      reported.viewportNotice === viewportNotice
    )
      return
    reported = { zoom, viewport, ...(icon && { icon }), ...(retry && { retryOnly: true }), ...(viewportNotice && { viewportNotice }) }
    options.detail?.(reported)
  }

  async function setViewport(viewport: Viewport) {
    if (closed() || contents.isDestroyed()) throw new Error("browser.pane.unavailable")
    const zoom = contents.getZoomFactor()
    await metrics.set(viewport, view.getBounds(), zoom)

    if (closed() || contents.isDestroyed()) throw new Error("browser.pane.unavailable")

    if (viewport.mode === "fixed" && zoom !== 1) throw new Error("viewport.zoomPrompt")
  }

  const resize = () => {
    const viewport = metrics.requested()

    if (viewport.mode === "fixed") void setViewport(viewport).catch(() => undefined)
  }

  const detail = () => {
    if (closed()) return
    // Navigation and another tab of the same origin can both change this page's zoom.
    const viewport = metrics.requested()

    if (viewport.mode === "fixed" && contents.getZoomFactor() !== 1) resize()
    void metrics.settled().then(report)
  }

  view.on("bounds-changed", resize)
  cdp.on("Page.frameResized", () => {
    if (!closed() && contents.getZoomFactor() !== reported?.zoom) detail()
  })
  const documents = new Map<string, string>()
  const sourceURLs = () => [...new Set([state().url, ...documents.values()])].sort()
  const files = createBrowserFiles(sourceURLs)
  constructing.defer(() => void files.dispose().catch(() => undefined))

  const diagnostics = createDiagnostics(cdp, displayURL, (id, sessionID) =>
    Array.from(contexts.values()).some((context) => context.id === id && context.sessionID === sessionID))

  const profiling = createProfiling(contents, cdp, files, sourceURLs, options.shared)
  const refs = documentRefs()
  // Elements the user picked. Their refs outlive later snapshots, so a comment keeps pointing at
  // the element until the document changes.
  const picked = new Map<string, Element>()
  let pickerState = initialPickerState
  let pickerTimer: ReturnType<typeof setTimeout> | undefined
  const parents = new Map<string, string>()
  const contexts = new Map<string, { id: number; sessionID?: string }>()
  // Frames that show an extension's document, which no agent frameID may reach: an extension's out-of-process frame by
  // the session it attached with (a web frame's own session may detach after its replacement attached), and a frame
  // whose document has an extension's origin.
  const extensionTargets = new Map<string, string>()
  const extensionContexts = new Set<string>()
  const extensionFrames = () => new Set([...extensionTargets.values(), ...extensionContexts])

  const attachFrames = (sessionID?: string) => attachChildren(cdp, sessionID)

  const activity = options.activity

  const notices = noticeActions((notice, token) => options.refused(notice, token, destinationOrigin(contents.getURL())), {
    tab: options.menu.open,
    app: (url) => electron.shell.openExternal(url),
    copy: (url) => electron.clipboard.writeText(url),
  })

  constructing.defer(notices.clear)
  const registerArtifactLinks = artifactLinks(cdp, () => artifactHost, target => notices.show({reason:"popup",target,action:"tab"}))
  const refused = (url: string) => notices.show(navigationNotice(url, policy, activityOwner(activity), documentInput))
  let popupReport: Protocol.Page.WindowOpenEvent | undefined
  cdp.on("Page.windowOpen", (event) => { popupReport = event })
  let dialogGate = createDialogGateState()
  // Running commands by run id: the controller that stops their remaining steps, and the wait an interruption ends.
  const runs = new Map<number, { controller: AbortController; interrupted: Interrupted; origin: "user" | "agent" }>()

  const choosers = guardFileChoosers(cdp, activity, message => {
    for (const run of runs.values()) {
      if (run.origin !== "agent") continue
      run.interrupted.reject(new Error(message))
      run.controller.abort()
    }
  })

  // Set the nested auto-attach policy before the new renderer can create its own children.
  const prepareFrame = async (sessionID: string) => {
    try {
      await Promise.all([attachFrames(sessionID), choosers.attach(sessionID), media.attach(sessionID), passkeys.attach(sessionID)])
      await cdp.send("Runtime.runIfWaitingForDebugger", {}, sessionID)
    } catch {
      // A detached target needs no resumption. A live one must not run unguarded or remain invisibly paused.
      if (!closed() && (extensionTargets.has(sessionID) || Array.from(sessions.values()).includes(sessionID))) options.fail()
    }
  }

  let revision = 0
  cdp.on("Page.frameNavigated", ({ frame }) => {
    documents.set(frame.id, displayURL(frame.url))
    revision++
  })
  cdp.on("Page.frameDetached", ({ frameId, reason }) => {
    documents.delete(frameId)
    revision++

    // A swap moves the frame to another process, where it may now show an extension's document; keep what is known.
    if (reason === "remove") extensionContexts.delete(frameId)
  })

  const state = (display = false) =>
    documentTab(documentState, {
      id: options.id,
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
    }, display)

  // Every state report goes through here, so a page that was disposed publishes nothing.
  // While a user's close asks the page's beforeunload on a blank load, the tab reports nothing: the blank page is not
  // where it is, and a close or a window that goes meanwhile keeps its real address for restore.
  let quiet = false

  const publish = (error?: string) => {
    if (!closed() && !quiet) options.publish(error)
  }

  let startingBlank = false

  const dispatch = (event: DocumentEvent) => {
    if (startingBlank && event.type !== "disposed") return
    const next = transitionDocument(documentState, event)
    documentState = next.state
    next.effects.forEach((effect) => {
      switch (effect.type) {
        case "reset-document":
          documents.clear()
          refs.clear()
          picked.clear()
          void dispatchPicker({ type: "document.changed" })
          break
        case "clear-diagnostics":
          diagnostics.clear()
          break
        case "show":
          // The renderer's layout requests may lag behind navigation; the page decides
          // whether there is a document worth exposing over the themed background.
          embed.show(effect.visible)
          break
        case "publish":
          publish()
          break
        case "detail":
          detail()
          break
        case "load-icon":
          // Never rejects: an icon that does not load is none.
          // Main's icon fetch is outside the page's network policy. Never proxy an artifact's candidates for it.
          void loadIcon(effect.favicons, artifactHost ? null : options.network).then((icon) =>
            dispatch({ type: "icon.loaded", attempt: effect.attempt, icon }),
          )
      }
    })
  }

  const dispatchDialog = (event: DialogGateEvent) => {
    const next = transitionDialogGate(dialogGate, event)
    dialogGate = next.state
    next.effects.forEach((effect) => {
      if (effect.type === "publish") {
        prompts.publish()

        return publish()
      }

      if (effect.type === "dismiss")
        return void cdp.send("Page.handleJavaScriptDialog", { accept: false }).catch(() => undefined)
      const run = runs.get(effect.runID)

      if (!run) return
      runs.delete(effect.runID)

      if (effect.abort) run.controller.abort()
      run.interrupted.reject(runStopError(effect.reason))
    })

    return next
  }

  // The user's answer to a page dialog, unless the agent answers it first.
  const answerDialog = async (revision: number, accept: boolean, text: string, stop: boolean) => {
    if (dispatchDialog({ type: "dialog.answering", revision, by: "user" }).answer !== "accepted") return

    if (stop) dispatchDialog({ type: "dialog.suppressed" })
    await cdp.send("Page.handleJavaScriptDialog", { accept, promptText: text }).then(
      () => void dispatchDialog({ type: "dialog.handled", revision, at: Date.now() }),
      () => void dispatchDialog({ type: "dialog.answer-failed", revision }),
    )
  }

  // Page dialogs, permission requests, sign-ins and "Leave site?" wait for the user in the pane; see page-prompts.ts.
  const dialogs = takeDialogs(contents, {
    suppressed: () => selectSuppressed(dialogGate),
    opened: () => !!selectOpenDialog(dialogGate),
    // The dialog shows at once; its frame's origin names it once Electron reports it.
    framed: () => prompts.publish(),
    warn: (message) => options.warn?.(message),
  })

  // Set while a prompt hides the page's view and the page should get the keyboard back once the view shows.
  let refocus = false

  const prompts = createPagePrompts({
    contents,
    scope: options.serverPartition ? { kind: "server", partition: options.partition } : { kind: "profile" },
    sites: options.sites,
    // Sticky: site permissions, clipboard writes and where a prompt puts focus.
    agentDriven: () => agentDriven(activity),
    top: () => state().url,
    dialog: () => selectUserDialog(dialogGate),
    dialogFrame: () => dialogs.frame(),
    answerDialog: (revision, answer) => answerDialog(revision, answer.accept, answer.text, answer.stop),
    redo: (action) => execute(action, [], new AbortController().signal, "user").then(() => undefined, () => undefined),
    close: () => options.closeTab?.(),
    // A page that held the keyboard before a prompt gets it back once its view shows again: a dialog's still hides the
    // view until the page draws, and a hidden view cannot take focus.
    focusPage: () => {
      refocus = !view.getVisible()

      if (!refocus) options.focusPage?.()
    },
    front: () => !!options.front?.(),
    returning: () => refocus,
    system: options.system,
    quiet: (value) => {
      quiet = value

      if (!value) publish()
    },
    report: (view) => {
      if (!closed()) options.prompt?.(view)
    },
  })

  // A page's getUserMedia waits for the pane before Blink opens a device, so macOS asks only after the user's Allow.
  const media = guardMediaRequests(cdp, (ask) => prompts.gate(ask))
  // A site's passkey or security-key request fails where nothing here could answer it: always on macOS and Linux, and on
  // Windows, whose own dialog would answer, in tabs the agent drives or could script. Once per page, the notice says
  // why and a running agent command stops with the reason.
  const native = process.platform === "win32"
  const passkeyPage = { noticed: false, interrupted: false }

  const passkeys = guardWebAuthn(cdp, {
    native,
    refused: (asker) => {
      // Another site's frame does not speak for the page: its request is refused without a word.
      if (!asker.mainFrame && (!asker.origin || asker.origin !== contents.mainFrame.origin)) return
      const address = URL.parse(displayURL(contents.getURL()))

      // Any agent command in flight stops, a `wait` included, which `agentRuns` leaves out.
      if (!passkeyPage.interrupted && Array.from(runs.values()).some((run) => run.origin === "agent")) {
        passkeyPage.interrupted = true
        prompts.interruptAgent(new CodedError(Browser.FailureCode.signInRequired, agentPasskeyRefusal(address?.host)))
      }

      if (passkeyPage.noticed) return
      passkeyPage.noticed = true
      const site = address?.hostname ? cookieSite(address.hostname) : undefined
      // On Windows only an enforced tab refuses, and a new tab of the person's would reach the system's dialog.
      const reason = native ? "browser.passkey.off" : agentDriven(activity) ? "browser.passkey.agent" : "browser.passkey"
      notices.show(site && site.length <= 255 ? { reason, site } : { reason })
    },
  })

  // A page that can never reach the system's dialog, or one the agent drove or could script, refuses in the browser
  // process before its first document loads. On Windows a failure to do so, whenever it happens, leaves it with the
  // system's dialog, so the tab fails.
  const restrictPasskeys = () => {
    if (native) options.restrictPasskeys?.()

    const enforcing = passkeys.enforce()

    if (native) void enforcing.catch(() => options.fail())

    return enforcing
  }

  if (!native || agentDriven(options.activity) || options.passkeysRestricted?.())
    void restrictPasskeys().catch(() => undefined)

  constructing.defer(() => prompts.dispose())
  constructing.defer(() => dialogs.dispose())

  // Chromium uses the document URL as the title of untitled files; don't persist its internal origin as a title.
  const pageTitle = (address = state().url) => {
    const title = contents.getTitle()

    if (documentState.status !== "closed" && documentState.retry && (!title || title === "about:blank"))
      return documentState.title || documentState.retry

    return /^oc-preview:/i.test(title) ? address : title
  }

  contents.on("did-start-loading", () => dispatch({ type: "loading.started" }))
  contents.on("did-stop-loading", () => {
    dispatch({ type: "loading.stopped", title: pageTitle() })
    detail()
  })
  contents.on("did-start-navigation", (event) => {
    // A load no frame started (the address bar, a link from the conversation, history) may redirect before it commits.
    // Input in the page it leaves is not input in the page that redirects.
    if (event.isMainFrame && !event.isSameDocument && !event.initiator) documentInput = false
    navigation.nativeStart(event)
    dispatch({
      type: "navigation.started",
      url: displayURL(event.url),
      isMainFrame: event.isMainFrame,
      isSameDocument: event.isSameDocument,
    })
  })
  // The status line's reason phrase is the site's own text: only the number is kept.
  contents.on("did-navigate", (_event, url, status) =>
    dispatch({ type: "navigation.committed", url: displayURL(url), status, title: pageTitle(displayURL(url)) }),
  )
  contents.on("did-navigate", () => {
    documentInput = false
    const url = contents.getURL()

    if (options.artifacts?.display(url)) artifactHost = new URL(url).host
    notices.clear()
    passkeyPage.noticed = false
    passkeyPage.interrupted = false
    popupReport = undefined

    rendering.committed()
  })
  contents.on("did-fail-load", (_event, code, description, url, isMainFrame) =>
    dispatch({ type: "navigation.failed", code, description: options.previewFailure?.(url) ?? (options.artifacts?.display(url) ? "browser.artifact.missing" : options.remote?.needsUpdate?.() && preview(url)?.startsWith("workspace:") ? "browser.preview.unsupported" : description), url, preview: preview(url), isMainFrame }),
  )
  contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (!isMainFrame) return
    documentInput = false
    const report = (address: string) => dispatch({ type: "navigation.in-page", url: address, title: pageTitle(address), isMainFrame })

    if (!/^(?:oc-preview|file):/i.test(url)) return report(url)
    const file = preview(url)

    if (!file) return
    // History API routes never pass the protocol handler. Keep the last validated address for virtual routes.
    const exists = file.startsWith("artifact:") ? options.artifacts?.exists(file) : options.workspace?.exists(url, options.signal)

    void Promise.resolve(exists).catch(() => false).then((target) => {
      if (target && !closed() && !contents.isDestroyed() && contents.getURL() === url) report(file)
    })
  })
  contents.on("dom-ready", () => dispatch({ type: "document.ready" }))
  contents.on("page-title-updated", () => dispatch({ type: "title.updated", title: pageTitle() }))
  contents.on("page-favicon-updated", (_event, favicons) => dispatch({ type: "icon.updated", favicons }))
  contents.on("focus", () => {
    if (!closed()) options.focused?.()
  })
  contents.on("render-process-gone", () => {
    if (!closed()) options.fail()
  })
  contents.debugger.on("detach", () => {
    if (!closed()) options.fail()
  })
  contents.on("content-bounds-updated", (event) => event.preventDefault())

  // Sub-frames keep Chromium's own rules so blob:/data: viewers and sandboxed previews still load,
  // except file: documents, which must stay inside the allowed roots at every depth.
  const resource = (url: string, origin: string) => extensionResource(url, origin, (id) => contents.session.extensions.getExtension(id))

  const guard = (event: Electron.Event<Electron.WebContentsWillNavigateEventParams>) => {
    if (artifactHost && !event.url.startsWith(`oc-preview://${artifactHost}/`)) {
      event.preventDefault()

      if (event.isMainFrame && destinationOrigin(event.url)) notices.show({reason:"popup", target:event.url.slice(0,16384), action:event.url.length <= 16384 ? "tab" : undefined})

      return
    }

    if (URL.parse(event.url)?.protocol === "chrome-extension:" && !resource(event.url, event.initiator?.origin ?? "")) {
      event.preventDefault()

      return refused(event.url)
    }

    if (event.url === "about:blank") return

    const local = /^file:/i.test(event.url) || event.url.toLowerCase().startsWith(`${previewScheme}:`)

    if (local && preview(event.url)) return

    if (!local && (allowedDestination(event.url, policy) || (!event.isMainFrame && /^(?:blob:|data:|about:srcdoc$)/i.test(event.url)))) return
    event.preventDefault()
    // The same reason a typed address gets, so a blocked link and a blocked address read alike.
    refused(event.url)
  }

  contents.on("will-frame-navigate", guard)
  contents.on("will-redirect", guard)
  // Links opened with Cmd or Ctrl arrive as background tabs, and stay behind the current one as in the system browser.
  contents.setWindowOpenHandler(({ url, disposition, postBody, referrer }) => {
    const activated = popupActivated(popupReport, url)
    popupReport = undefined

    if (artifactHost) {
      if (!postBody && destinationOrigin(url) && url.length <= 16384) notices.show({reason:"popup",target:url,action:"tab"})

      return { action: "deny" }
    }

    if (url !== "about:blank" && !destinationOrigin(url) && !resource(url, referrer.url) && !preview(url)) {
      refused(url)

      return { action: "deny" }
    }

    if (!activated) {
      const target = displayURL(url)
      const replay = !postBody && target.length <= 16384 && (!!destinationOrigin(target) || !!preview(url))
      notices.show(replay ? { reason: "popup", target, action: "tab" } : { reason: "popup", target: target.slice(0, 16384) })

      return { action: "deny" }
    }

    const workspace = options.workspace?.display(url)

    if (workspace && !postBody) {
      void options.menu.open(workspace).catch(() => publish("browser.menu.failed"))

      return { action: "deny" }
    }

    return {
      action: "allow",
      outlivesOpener: true,
      overrideBrowserWindowOptions: {
        webPreferences: {
          nodeIntegration: false,
          nodeIntegrationInSubFrames: options.local === true,
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
      createWindow: (popupOptions) => options.popup(popupOptions, disposition === "background-tab", childActivity(activity)),
    }
  })

  // Called from the session's one download listener (`guardSession`) for a download this page started. One the user
  // started is left to the system's save flow, so it goes where they save it and the agent never reads it.
  const download = (item: Electron.DownloadItem) => {
    const owner = downloadOwner({
      ...activity,
      page: [contents.mainFrame.url, contents.mainFrame.origin],
      chain: item.getURLChain(),
    })

    if (owner === "user") return

    if (owner === "block") return item.cancel()

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
      item.once("done", (_event, status) => {
        file.bytes = item.getReceivedBytes()
        file.state = status === "completed" ? "completed" : "failed"
      })
    } catch {
      item.cancel()
      publish("download_failed")
    }
  }

  cdp.on("Runtime.executionContextCreated", ({ context }, sessionID) => {
    // SAFETY: CDP documents a page execution context's auxData as `{ frameId, isDefault, type }`.
    const aux = context.auxData as { frameId?: string; isDefault?: boolean } | undefined

    if (!aux?.frameId || !aux.isDefault) return

    // A frame that becomes an extension's document, as about:blank opened by one does, is no target for the agent.
    if (Browser.extensionOrigin(context.origin)) {
      contexts.delete(aux.frameId)
      extensionContexts.add(aux.frameId)
      const own = sessions.get(aux.frameId)

      // An out-of-process web frame that turned into one in place leaves the frame list and stops reporting its console
      // and network. It stays refused until the page removes it, even if it shows a web page again.
      if (own) {
        sessions.delete(aux.frameId)
        parents.delete(aux.frameId)
        void cdp.send("Target.detachFromTarget", { sessionId: own }).catch(() => undefined)
      }

      return
    }

    contexts.set(aux.frameId, { id: context.id, sessionID })
    extensionContexts.delete(aux.frameId)
  })
  cdp.on("Runtime.executionContextDestroyed", ({ executionContextId }, sessionID) => {
    contexts.forEach((context, key) => {
      if (context.id === executionContextId && context.sessionID === sessionID) contexts.delete(key)
    })
  })
  cdp.on("Runtime.executionContextsCleared", (_event, sessionID) => {
    contexts.forEach((context, key) => { if (context.sessionID === sessionID) contexts.delete(key) })
  })
  cdp.on("Target.attachedToTarget", ({ sessionId, targetInfo }, parentSessionID) => {
    // Paused at start by the auto-attach above; it must run, as it did before the tab guarded its children.
    if (targetInfo.type === "worker") return void releaseWorker(cdp, sessionId)

    if (targetInfo.type !== "iframe") return

    // An extension's frame, such as an autofill overlay, stays out of `sessions`: no frame list, snapshot, picker or
    // diagnostics reaches it. Site isolation gives it a process, and so a target, of its own. The context its first
    // document had in the embedding page's process is dropped, so its frameID cannot reach that page instead.
    if (Browser.extensionOrigin(targetInfo.url) || (parentSessionID && extensionTargets.has(parentSessionID)) ||
      (targetInfo.parentFrameId && extensionContexts.has(targetInfo.parentFrameId))) {
      extensionTargets.set(sessionId, targetInfo.targetId)
      contexts.delete(targetInfo.targetId)
      // Descendant iframe targets are excluded even if their own document is a web page. Do not enable diagnostics.
      void prepareFrame(sessionId)

      return
    }

    const parentID = targetInfo.parentFrameId ?? Array.from(sessions).find(([, id]) => id === parentSessionID)?.[0]

    if (parentID) parents.set(targetInfo.targetId, parentID)
    sessions.set(targetInfo.targetId, sessionId)
    // An isolated frame has its own renderer and needs its own UA and touch overrides.
    void Promise.all([
      device.frame(sessionId),
      diagnostics.enable(sessionId),
      cdp.send("Page.enable", {}, sessionId),
      prepareFrame(sessionId),
    ]).catch(() => undefined)
    void dispatchPicker({ type: "frame.attached", sessionID: sessionId })
  })
  // Each out-of-process frame runs its own picker; the frame under the pointer reports the click.
  cdp.on(
    "Overlay.inspectNodeRequested",
    ({ backendNodeId }, sessionID) => void dispatchPicker({ type: "node.picked", backendID: backendNodeId, sessionID }),
  )
  cdp.on("Target.detachedFromTarget", ({ sessionId }) => {
    choosers.detach(sessionId)
    // Only the session that showed the extension's document clears it: the frame keeps its target ID across a swap, and
    // the web session it replaced may detach after the extension's attached.
    extensionTargets.delete(sessionId)
    sessions.forEach((id, frameID) => {
      if (id === sessionId) {
        sessions.delete(frameID)
        parents.delete(frameID)
      }
    })
  })
  cdp.on("Page.javascriptDialogOpening", (event) =>
    dispatchDialog({
      type: "dialog.opened",
      url: displayURL(event.url),
      dialogType: event.type,
      message: event.message.slice(0, Browser.MAX_TEXT),
      defaultPrompt: event.defaultPrompt ?? "",
      at: Date.now(),
    }),
  )
  cdp.on("Page.javascriptDialogClosed", () => {
    dialogs.closed()
    dispatchDialog({ type: "dialog.closed", at: Date.now() })
  })
  contents.on("did-navigate", () => dispatchDialog({ type: "document.committed" }))
  // Hidden tabs keep a desktop-sized viewport until the renderer lays the embed out.
  view.setBounds({ x: 0, y: 0, width: 1000, height: 700 })
  const embed = options.embeds.create(view, win)
  constructing.defer(() => embed.dispose())

  const handoff = () => {
    if (closed() || contents.isDestroyed()) return
    const tab = state()
    const actual = contents.getURL()

    return pageHandoff(actual, displayURL(actual), tab.url, !!tab.loadError, options.local)
  }

  const openPage = async (expected: string) => {
    const target = handoff()

    if (!target || target.url !== expected) throw new Error("browser.menu.failed")

    if (target.kind === "web") return electron.shell.openExternal(target.url)

    const actual = contents.getURL()
    const launch = await defaultBrowser()

    const opened = await options.workspace?.external(actual, async (file) => {
      if (handoff()?.url !== expected || contents.getURL() !== actual) throw new Error("browser.menu.failed")
      await launch(file)
    })

    if (!opened) throw new Error("browser.menu.failed")
  }

  const personCommand = () => {
    recordPageInput(activity, "user")
    options.userInput()
    void choosers.update().catch(() => undefined)
  }

  const menu = attachPageMenu(win, contents, {
    ...options.menu,
    personCommand,
    canOpenPage: () => !!handoff(),
    openPage: () => openPage(state().url),
    open: (url) => {
      const current = contents.getURL()

      if (options.workspace?.host(current) && /^(?:file|workspace):/.test(url) && !options.workspace.permits(current, url)) {
        notices.show({reason:"browser.preview.restricted"})

        return Promise.resolve()
      }

      return options.menu.open(url)
    },
    policy: {
      get fileRoots() { return policy.fileRoots },
      get extensions() { return policy.extensions },
      remote: policy.remote,
      get previewHost() { return options.workspace?.host(contents.getURL()) },
      local: options.local,
    },
    cdp,
    sessions: () => sessions.values(),
    available: () => nativeMenu && !closed() && view.getVisible() && activity.agentRuns === 0,
    failed: () => publish("browser.menu.failed"),
  })

  constructing.defer(() => menu.dispose())

  // A hidden page cannot be picked from, and a comment's frozen still already shows the
  // picked element, so hiding ends the picker, any pick in progress, and the highlight.
  embed.on("visible", (visible) => {
    if (visible) {
      // Not while a prompt still shows: the view shows between two dialogs, and the next one takes the keyboard.
      if (refocus && !prompts.showing()) {
        refocus = false
        options.focusPage?.()
      }

      return
    }

    menu.close()
    void dispatchPicker({ type: "embed.hidden" })

    if (!closed()) options.hidden?.()
  })

  const navigation = navigationTurn(options.waitForFilters, url => {
    dispatch({ type: "navigation.started", url, isMainFrame: true, isSameDocument: false })
    dispatch({ type: "loading.started" })
  }, () => { if (!closed()) dispatch({ type: "loading.stopped", title: pageTitle() }) }, address => {
    dispatch({ type: "navigation.held-stopped", address })
  })

  const begin = (signal = options.signal, keepAddress = false) => navigation.begin(AbortSignal.any([pageLifetime.signal, signal, options.signal]), keepAddress)

  const load = async (url: string, retry = false, commandSignal = options.signal, keepAddress = true) => {
    const visit = begin(commandSignal, keepAddress)
    const destination = url.startsWith("artifact:") ? options.artifacts?.load(url) : localFileURL(url) || url.startsWith("workspace:") ? await options.workspace?.load(url, (guarded) => notices.show({reason: guarded ? "browser.preview.agentRestricted" : "browser.preview.restricted"}), retry ? contents.getURL() : undefined) : url

    if (!destination) return Promise.reject(new Error("Workspace preview is unavailable."))

    return visit(destination, () => loadDestination(destination, url))
  }

  const loadDestination = (destination: string, url: string) => {
    if (options.artifacts?.display(destination)) {
      artifactHost = new URL(destination).host
      contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp")
      // On first restore Chromium has no renderer yet. Its binding cannot answer until loadURL starts it.
      // The script only offers links; the native navigation and network fences above apply before the load.
      void registerArtifactLinks(artifactHost).catch(() => options.warn?.("Artifact link offers are unavailable"))
    }

    let committed = false

    const commit = () => {
      committed = true

      // Only a successful navigation directed by browser chrome (this loadURL), not a renderer callback, may leave.
      if (!options.artifacts?.display(destination)) artifactHost = undefined
    }

    contents.once("did-navigate", commit)
    const next = replacementNavigation()
    contents.on("did-start-navigation", next.start)
    contents.on("did-navigate", next.commit)
    contents.on("did-stop-loading", next.stop)
    contents.once("destroyed", next.stop)

    return navigationDeadline(contents.loadURL(destination).catch(async (error: Error) => {
      if (committedLoad(error, committed)) return

      if (destinationOrigin(destination) && await next.after(error)) return

      if (options.previewFailure?.(destination)) throw new FileVerificationError()

      if (destination.startsWith(`${previewScheme}://`))
        throw new CodedError(Browser.FailureCode.previewUnavailable, `The preview could not be loaded: ${url}`)

      if (!committed && "errno" in error && (error.errno === -2 || error.errno === -3))
        throw new CodedError("navigation_failed", "No page committed. The navigation was cancelled, failed, or became a download. Check the tab and its downloads before navigating again.")
      throw error
    })).finally(() => {
      next.stop()
      contents.off("destroyed", next.stop)
      contents.off("did-stop-loading", next.stop)
      contents.off("did-navigate", next.commit)
      contents.off("did-start-navigation", next.start)
      contents.off("did-navigate", commit)
    })
  }

  const reload = async (signal = options.signal, ignoreCache = false) => {
    const tab = state()

    if (documentState.status !== "closed" && documentState.retry) return load(documentState.retry, true, signal)

    if (tab.loadError && /^(?:file|workspace|artifact):/.test(tab.url)) return void await load(tab.url, true, signal)
    const actual = contents.getURL()

    if (options.workspace?.host(actual) && options.workspace.display(actual) === tab.url) return void await load(tab.url, true, signal)
    const address = reloadAddress(actual, tab.url, options.workspace?.host(actual), policy.fileRoots ?? [], policy.remote)

    if (address) return void await load(address, true, signal)

    return begin(signal)(actual, () => ignoreCache ? contents.reloadIgnoringCache() : contents.reload())
  }

  const ready = navigationDeadline(Promise.all([
    files.ready,
    ...(initial === undefined
      ? []
      : [
          load(initial).then(async () => {
            // Stop before the first load leaves no renderer to finish CDP setup. Start only the inert document;
            // its native events are not a navigation of the saved tab.
            if (documentState.status !== "restoring" || !documentState.retry || contents.getURL() || closed()) return
            startingBlank = true
            await contents.loadURL("about:blank").finally(() => { startingBlank = false })
          }).catch((error: Error) => {
            if (!options.restore) throw error
            // A dev server may have stopped while this page was unloaded. Keep its tab available to retry. The tab
            // itself reports a load that failed or is still under way; anything else is said beside it.
            publish(pageReports(error) ? undefined : error.message)
          }),
        ]),
    diagnostics.enable(),
    choosers.attach(),
    media.attach(),
    passkeys.attach(),
    cdp.send("Page.enable"),
    cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: RESTORE_PROMPT, runImmediately: true }),
    cdp.send("DOM.enable"),
    attachFrames(),
  ])).then(() => undefined).finally(() => opening?.[Symbol.dispose]())

  constructing.move()

  return {
    view,
    contents,
    nativeID: contents.id,
    /**
     * The top edge of the page's view in the window's content, once it has been placed, while the page fills the
     * pane's page area. Undefined with a device viewport, whose page sits inside that area, lower than its top.
     */
    areaTop: () => (metrics.applied().viewport.mode === "auto" && view.getBounds().height > 0 ? view.getBounds().y : undefined),
    state: () => state(true),
    childActivity: () => childActivity(activity),
    previewUsed: () => !!options.popupOptions || !!options.workspace?.used(),
    previewIdentity: () => options.workspace?.identity(),
    answerNotice: notices.answer,
    personCommand,
    openPage,
    reviewLink: (url: string) => notices.show(navigationNotice(url, policy, "conversation")),
    /** Refuses passkeys in the browser process from now on, for a tab the agent drives or a tab that can script one. */
    restrictPasskeys,
    ready,
    focusHost,
    setViewport,
    /** The host embed the renderer lays this page out with. */
    embed: embed.id,
    async inspect(enabled: boolean) {
      if (closed()) return
      await ready
      await dispatchPicker({ type: "inspect.set", enabled })
    },
    async highlight(ref?: Browser.Ref) {
      if (closed()) return
      await dispatchPicker({ type: "highlight.requested", target: ref ? picked.get(ref.replace(/^@/, "")) : undefined })
    },
    zoom(direction: "in" | "out" | "reset") {
      if (!closed()) zoom(direction)
    },
    async site() {
      if (closed() || retryOnly(documentState)) return { cookies: 0 }
      const url = contents.getURL()

      if (!destinationOrigin(url)) return { cookies: 0 }

      return { cookies: (await contents.session.cookies.get({ url })).length }
    },
    /**
     * Deletes what the page's site stored: the cookies its address can read, and its origin's storage. Resolves once
     * the page reloaded without them, so a count read next includes what the reload set again.
     */
    async clearSite() {
      if (closed() || retryOnly(documentState)) return
      const url = contents.getURL()
      const origin = destinationOrigin(url)

      if (!origin) return
      const cookies = await contents.session.cookies.get({ url })
      await Promise.all(cookies.map((cookie) => contents.session.cookies.remove(cookieURL(cookie), cookie.name)))
      await contents.session.clearStorageData({
        origin,
        storages: ["localstorage", "indexdb", "serviceworkers", "cachestorage", "filesystem", "shadercache"],
      })
      // The site's HTTP sign-in too. Chromium clears its auth cache only whole, so other sites ask again as well.
      await contents.session.clearAuthCache()

      if (closed()) return
      await options.menu.navigate("reload")
      // A slow page still cleared; the count then reads what it set so far.
      await waitFor(() => closed() || !contents.isLoading(), new AbortController().signal, 30_000).catch(
        () => undefined,
      )
    },
    /** Refreshes the page presentation, including Chromium's per-origin zoom. */
    detail,
    /** Takes a download this page started; see `guardSession`. */
    download,
    /** Answers this page's permission requests and checks; see `guardSession`. */
    permissions: prompts.permissions,
    /** The user's answer to what the tab waits for; only the window calls it. */
    answer: prompts.answer,
    /** Whether the user's close may go ahead, or the page asked "Leave site?". */
    leave: prompts.leave,
    /**
     * Runs one command, the agent's or the user's. The agent's never opens, reads or acts on an extension page, which
     * would run with that extension's privileges; every agent operation reaches the page through here.
     */
    async execute(command: Browser.Command, signal: AbortSignal, origin: "agent" | "user"): Promise<Browser.Result> {
      using active = new DisposableStack()

      const hidden = !view.getVisible() && win.isVisible() && !win.isMinimized() && !(process.platform === "darwin" && electron.app.isHidden())
      const shouldPaint = () => needsWakeFrame(command.action.type, documentState.status === "loaded" && !documentState.busy && !documentState.pending, !!selectOpenDialog(dialogGate))

      const hold = origin === "agent" ? active.use(rendering.hold(hidden && shouldPaint() ? async () => {
        await ready

        if (!shouldPaint() || agentRefusal({ type: "snapshot" }, mainDocument())) return
        await withFrames(false, pageLifetime.signal, async stop => {
          const frame = (await cdp.send("Page.getFrameTree")).frameTree.frame.id
          const world = await cdp.send("Page.createIsolatedWorld", { frameId: frame, worldName: "opencode-browser-paint" })
          abortError(stop)
          await cdp.send("Runtime.evaluate", { contextId: world.executionContextId, expression: "new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))", awaitPromise: true })
        })
      } : undefined)) : undefined

      const saved = navigation.interrupt(command.action.type, documentState.status === "restoring" ? documentState.url : undefined, origin)
      await Promise.all([ready, hold?.painted])
      const open = origin === "user" && leavable.includes(command.action.type) ? selectOpenDialog(dialogGate) : undefined

      // The user leaving the page dismisses its dialog, as a browser's address bar does.
      if (open) await answerDialog(open.revision, false, "", false)

      // Registers the run before any further await, and listens for its abort in the same turn, so a dialog or a
      // cancellation that arrives while it still inspects its target interrupts it.
      const reply = dispatchDialog({ type: "run.started", actionType: command.action.type, aborted: signal.aborted }).reply

      if (reply?.status !== "accepted") throw runStopError(reply?.reason ?? "closed")
      const runID = reply.runID
      // The action underneath the race keeps running after an interruption wins it; it checks this
      // signal before each further step.
      const run = { controller: new AbortController(), interrupted: Promise.withResolvers<never>(), origin }
      runs.set(runID, run)
      const cancel = () => dispatchDialog({ type: "run.cancelled", runID })
      signal.addEventListener("abort", cancel, { once: true })

      // A `wait` is the agent's command but only observes: the page gets no input from it, for up to 30 s. It is not
      // counted as the agent acting, so the person's own press, download or app link during it stays theirs.
      const acting = origin === "agent" && command.action.type !== "wait"

      if (origin === "agent") recordPageInput(activity, origin)

      if (acting) activity.agentRuns++

      // The user's navigation may stop for "Leave site?"; the agent's stops when the site asks the user to sign in.
      if (origin === "user" && leavable.includes(command.action.type)) prompts.intend(command.action)

      if (origin === "agent") prompts.agentStarted()
      const signIn = origin === "agent" ? prompts.agentWait(leavable.includes(command.action.type)) : undefined

      try {
        const intercepting = choosers.update()

        // Updating the file chooser intercept is a renderer call, which an open dialog blocks until it is answered.
        if (command.action.type === "dialog") void intercepting.catch(() => undefined)

        return await Promise.race([
          // The agent drives the tab from here on: refuse passkeys in the browser process before its action runs. The
          // refusal is the browser process's own command, which an open dialog does not block.
          afterRefusal(origin === "agent" ? restrictPasskeys : undefined, command.action.type === "dialog" ? Promise.resolve() : intercepting, () => {
            abortError(run.controller.signal)
            const act = () => perform(command, run.controller.signal, origin, saved)

            // A resize or screenshot between measuring a ref and clicking it would hit a different point.
            return pointerOperations.includes(command.action.type) ? metrics.exclusive(() => device.mouse(act)) : act()
          }),
          run.interrupted.promise,
          ...(signIn ? [signIn.promise] : []),
        ])
      } finally {
        signIn?.stop()
        signal.removeEventListener("abort", cancel)
        runs.delete(runID)
        dispatchDialog({ type: "run.finished", runID })

        if (acting) activity.agentRuns--

        if (origin === "agent") void choosers.update().catch(() => undefined)
      }
    },
    async dispose() {
      if (closed()) return
      pageLifetime.abort()
      notices.clear()
      // Even a failed cleanup of an embed, recorder or already detached debugger must not orphan its native page.
      using closing = new DisposableStack()
      closing.defer(() => { if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false }) })
      dispatch({ type: "disposed" })
      menu.dispose()
      choosers.dispose()
      media.dispose()
      passkeys.dispose()
      options.artifacts?.dispose()
      options.workspace?.dispose()
      dispatchDialog({ type: "disposed" })
      prompts.dispose()
      dialogs.dispose()
      void dispatchPicker({ type: "disposed" })
      clearTimeout(pickerTimer)
      view.off("bounds-changed", resize)
      detachNetwork?.()
      await profiling.dispose()
      cdp.dispose()
      refs.clear()
      picked.clear()
      embed.dispose()

      await files.dispose()
    },
  }

  async function perform(command: Browser.Command, signal: AbortSignal, origin: "agent" | "user", saved?: string) {
    if (origin === "user") return attempt(command, signal, origin, saved)

    // An error document has no inspectable frame. Report the artifact failure before querying Chromium.
    if (state().loadError === FileVerificationError.code && !leavable.includes(command.action.type)) throw new FileVerificationError()

    if (state().loadError === "browser.artifact.missing" && !leavable.includes(command.action.type)) throw missingArtifact()
    const refused = agentRefusal(command.action, mainDocument())

    if (refused) throw new Error(refused)
    const used = actionFrames(command.action)
    const framed = await extensionFrameRefusal(used)

    if (framed) throw new Error(framed)
    const result = await attempt(command, signal, origin, saved)
    // A redirect, or a navigation while it ran, may have brought an extension page in, in the tab or in a frame the
    // action used; its result stays here.
    const moved = agentRefusal({ type: "snapshot" }, mainDocument()) ?? (await extensionFrameRefusal(used))

    if (moved) throw new Error(moved)

    return result
  }

  function mainDocument() {
    return { url: contents.mainFrame.url, origin: contents.mainFrame.origin }
  }

  async function mainContext() {
    const context = contexts.get((await cdp.send("Page.getFrameTree")).frameTree.frame.id)

    if (!context)
      throw new CodedError(
        Browser.FailureCode.documentChanged,
        "The page's JavaScript context is unavailable; it may be loading. Wait for it with browser.wait({tabID}), then retry.",
      )

    return context
  }

  async function attempt(command: Browser.Command, signal: AbortSignal, origin: "agent" | "user", saved?: string): Promise<Browser.Result> {
    abortError(signal)

    if (leftApprovedSite(documentState, command.action.type, command.expectedSite, contents.mainFrame.url))
      throw new Error("The tab is no longer at the approved site; request the action again.")

    if (isPickerActive(pickerState) && pointerOperations.includes(command.action.type))
      await dispatchPicker({ type: "pointer.command" })

    if (command.inspect) return { value: await inspect(command.action), files: [] }

    if (command.target && JSON.stringify(await inspect(command.action)) !== JSON.stringify(command.target))
      throw new Error(
        "Browser target changed while permission was pending. Take a fresh snapshot or listing and request the action again; it was not executed.",
      )

    if (
      command.generation !== undefined &&
      command.generation !== documentGeneration(documentState) &&
      !retainedOperations.includes(command.action.type)
    )
      throw new CodedError(
        Browser.FailureCode.documentChanged,
        "The document changed before this operation ran. Call browser.tabs.list({}) to check its current URL, then browser.snapshot({tabID}) for fresh refs. Reconsider the action before retrying on the new page.",
      )
    abortError(signal)

    return execute(command.action, command.files, signal, origin, command.target, saved)
  }

  async function execute(
    action: Browser.Action,
    transfers: readonly Browser.File[],
    signal: AbortSignal,
    origin: "agent" | "user",
    approved?: Browser.Target,
    saved?: string,
  ): Promise<Browser.Result> {
    const captureSources = sourceURLs()
    const transfer = (id: Browser.FileID) => files.transfer(id, approved?.resources)
    const input = dispatchInput(origin, signal)

    const result = <T>(value: T, attached: Browser.File[] = []): Browser.Result => {
      const json = Schema.decodeUnknownSync(Schema.Json)(value)

      if (JSON.stringify(json).length > 512_000)
        throw new Error(
          "Browser result exceeds 512000 JSON characters. Request fewer entries, reduce snapshot depth, or return only selected fields from the evaluation script. Repeating the same request will not reduce its output.",
        )

      return { value: json, files: attached }
    }

    switch (action.type) {
      case "navigate": {
        const url = normalizeURL(action.url, policy)
        const cancel = () => contents.stop()
        signal.addEventListener("abort", cancel, { once: true })

        try {
          await load(url, false, signal, origin === "user")
        } finally {
          signal.removeEventListener("abort", cancel)
        }

        // The load event comes just before Chromium says the tab stopped loading; report the tab after that. A frame that
        // still loads after a moment is reported as loading, which it is.
        await waitFor(() => !contents.isLoading(), signal, 2_000).catch(() => abortError(signal))

        return result(state())
      }

      case "back":
      case "forward":
      case "reload":
      case "stop": {
        if (action.type === "back" || action.type === "forward") {
          const history = contents.navigationHistory
          const index = history.getActiveIndex() + (action.type === "back" ? -1 : 1)
          const entry = index >= 0 && index < history.length() && history.getEntryAtIndex(index)

          if (entry) await begin(signal)(entry.url, () => history.goToIndex(index), () => !closed() && contents.isLoading())
        }

        if (action.type === "reload" && (!saved || action.ignoreCache)) await reload(signal, action.ignoreCache)

        if (action.type === "stop") {
          navigation.cancel()
          contents.stop()
        }

        if (action.type !== "stop") await waitFor(() => !contents.isLoading(), signal, 30_000)

        // As the inventory reports the tab: an address kept for a load that was never issued stays its address.
        return result(state(true))
      }

      case "frames":
        return result({ tab: state(), frames: await frames() })
      case "snapshot":
      case "find":
        return result({ tab: state(), ...(await snapshot(action, signal)) })
      case "evaluate": {
        if (action.ref && action.frameID)
          throw new Error(
            "Pass either ref or frameID to browser.evaluate, not both. A ref already runs in its element's frame.",
          )
        const context = action.frameID ? await frameContext(action.frameID) : undefined
        // Pinned to the main frame's current document, so a navigation to an extension page meanwhile fails the call
        // instead of running the script there.
        const main = action.frameID || action.ref ? undefined : await mainContext()
        const element = action.ref ? target(action.ref) : undefined
        const objectId = element ? await resolve(element) : undefined

        // With a ref, the script is a function that receives the element as its argument and as `this`.
        const value = await (element && objectId
          ? cdp
              .send(
                "Runtime.callFunctionOn",
                {
                  objectId,
                  functionDeclaration: connectedFunction(action.script),
                  arguments: [{ objectId }],
                  awaitPromise: true,
                  returnByValue: true,
                },
                element.sessionID,
              )
              .finally(() => cdp.send("Runtime.releaseObject", { objectId }, element.sessionID).catch(() => undefined))
          : cdp.send(
              "Runtime.evaluate",
              {
                expression: action.script,
                contextId: (context ?? main)?.id,
                awaitPromise: true,
                returnByValue: true,
              },
              context?.sessionID,
            ))

        if (element && value.exceptionDetails?.exception?.description?.startsWith("Error: browser.detached_ref\n")) throw detachedRef()

        if (value.exceptionDetails)
          throw new Error(
            `Page JavaScript threw an exception. Check the script and ${action.ref ? "ref" : "frameID"}; inspect the page before repeating code with side effects. Details: ${(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text).slice(0, 800)}`,
          )
        abortError(signal)

        return result({ tab: state(), value: value.result.value ?? null })
      }

      case "click":
        await click(input, target(action.ref), action.button ?? "left", action.count ?? 1, action.modifiers)
        break
      case "hover":
        await input("Input.dispatchMouseEvent", { type: "mouseMoved", ...(await point(target(action.ref))) })
        break
      case "drag": {
        const source = target(action.from)
        const destination = target(action.to)
        await point(destination)
        const from = await point(source)
        const box = await rect(destination)
        const to = await elementCenter(box)
        const html5 = await call(source, "function() { return this.draggable; }")
        let data: Protocol.Input.DragData | undefined

        const off = cdp.on("Input.dragIntercepted", (event) => {
          data = event.data
        })

        await cdp.send("Input.setInterceptDrags", { enabled: true })

        try {
          await input("Input.dispatchMouseEvent", { type: "mouseMoved", ...from })
          await input("Input.dispatchMouseEvent", {
            type: "mousePressed",
            ...from,
            button: "left",
            buttons: 1,
            clickCount: 1,
          })

          for (let i = 1; i <= 10; i++) {
            abortError(signal)
            await input("Input.dispatchMouseEvent", {
              type: "mouseMoved",
              x: from.x + ((to.x - from.x) * i) / 10,
              y: from.y + ((to.y - from.y) * i) / 10,
              button: "left",
              buttons: 1,
            })
          }

          if (html5) await waitFor(() => data !== undefined, signal, 2_000)

          if (data) {
            for (const type of ["dragEnter", "dragOver", "drop"] as const)
              await input("Input.dispatchDragEvent", { type, ...to, data })
          }
        } finally {
          off()
          await cdp.send("Input.setInterceptDrags", { enabled: false })
          await input("Input.dispatchMouseEvent", { type: "mouseReleased", ...to, button: "left", clickCount: 1 })
        }

        break
      }

      case "fill":
        await fill(input, target(action.ref), action.text, signal)
        break
      case "fill_form":
        for (const field of action.fields) {
          abortError(signal)

          if (field.type === "text") await fill(input, target(field.ref), field.value, signal)

          if (field.type === "select") await select(target(field.ref), field.values)

          if (field.type === "check") await check(input, target(field.ref), field.checked)
        }

        break
      case "select":
        await select(target(action.ref), action.values)
        break
      case "check":
        await check(input, target(action.ref), action.checked)
        break
      case "press":
        await key(input, action.key)
        break
      case "scroll": {
        const { cssVisualViewport } = await cdp.send("Page.getLayoutMetrics")
        await input("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          ...inputCenter({ x: 0, y: 0, width: cssVisualViewport.clientWidth, height: cssVisualViewport.clientHeight }),
          deltaX: action.deltaX ?? 0,
          deltaY: action.deltaY,
        })
        break
      }

      case "wait": {
        if (action.condition === "delay") {
          await scheduler.wait(action.timeoutMs ?? 0, { signal })
          break
        }

        if (action.condition === "url" && action.url === undefined) throw new Error("A URL wait requires a URL pattern.")

        if ((action.condition === "text" || action.condition === "textGone") && !action.text)
          throw new Error(
            'browser.wait requires non-empty text for condition "text" or "textGone". Use condition "load" without text to wait for loading.',
          )
        const frameID = action.frameID

        // The frame is checked once; its context is read on each poll, so one that turns into an extension's
        // document while this waits fails the wait.
        if (frameID) await agentFrameOf(frameID)
        // Whether a check failed; otherwise the wait ran out of time, which the server reports as met: false.
        const checks = { failed: false }

        const holds = async () => {
          if (action.condition === "load") return !contents.isLoading()
          // A navigation to an extension page while this waits ends it: the text would be that page's.
          const page = agentRefusal({ type: "wait" }, mainDocument())

          if (page) throw new Error(page)

          if (action.condition === "url") return Browser.matchesURL(state().url, action.url ?? "")
          const context = frameID ? contexts.get(frameID) : undefined

          if (frameID && (!context || extensionFrames().has(frameID))) {
            // Names an extension's document by what it is, when that is why the context went.
            await agentFrameOf(frameID)
            throw new Error(
              "Frame context is unavailable. Call browser.frames({tabID}) and use a frameID from this tab.",
            )
          }

          const value = await cdp.send(
            "Runtime.evaluate",
            {
              expression: `document.body?.innerText.includes(${JSON.stringify(action.text)}) ?? false`,
              returnByValue: true,
              contextId: context?.id,
            },
            context?.sessionID,
          )

          return Boolean(value.result.value) === (action.condition === "text")
        }

        await waitFor(
          () =>
            holds().catch((error: Error) => {
              checks.failed = true
              throw error
            }),
          signal,
          action.timeoutMs,
        ).catch((cause: Error) => {
          if (signal.aborted) throw cause
          const text = `browser.wait failed for condition ${JSON.stringify(action.condition)} (timeoutMs: ${action.timeoutMs ?? 10_000}). Inspect browser.snapshot({tabID}) and check text/frameID before retrying; timeoutMs can be increased up to 30000 for a genuinely slow page. Details: ${cause.message}`

          throw checks.failed ? new Error(text, { cause }) : new CodedError(Browser.FailureCode.unmet, text, { cause })
        })
        break
      }

      case "screenshot": {
        if (action.ref && action.fullPage)
          throw new Error(
            "Choose either ref for an element screenshot or fullPage:true for the whole page. Remove the other argument before retrying.",
          )

        const blocked = undrawable({
          platform: process.platform,
          minimized: win.isMinimized(),
          visible: win.isVisible(),
          appHidden: process.platform === "darwin" && electron.app.isHidden(),
        })

        if (blocked) throw new Error(undrawableMessage(blocked))
        const capture = await captureFrame(action, signal)

        const id = await files.save(`screenshot.${capture.format}`, `image/${capture.format}`, capture.data, [
          ...captureSources,
          ...sourceURLs(),
        ])

        return result({ tab: state() }, [await transfer(id)])
      }

      case "dialog": {
        if (action.action !== "get") {
          const open = selectOpenDialog(dialogGate)

          // The user may answer it in the pane first; then it is closed for the agent too.
          if (!open || dispatchDialog({ type: "dialog.answering", revision: open.revision, by: "agent" }).answer !== "accepted")
            throw new Error(
              'This tab has no JavaScript dialog to handle. browser.dialog({tabID,action:"get"}) returns null when none is open; continue without accepting or dismissing one.',
            )
          await cdp
            .send("Page.handleJavaScriptDialog", { accept: action.action === "accept", promptText: action.promptText })
            .catch((error: Error) => {
              dispatchDialog({ type: "dialog.answer-failed", revision: open.revision })
              throw error
            })
          dispatchDialog({ type: "dialog.handled", revision: open.revision, at: Date.now() })
        }

        return result({ tab: state(), dialog: selectDialog(dialogGate) })
      }

      case "files.upload":
      case "files.drop": {
        if (!transfers.length)
          throw new Error(
            "Upload command has no file bytes. Supply server-local paths to browser.files.upload/drop; do not call the desktop RPC directly with desktop paths. If paths were supplied, report a client/server transfer mismatch.",
          )

        const local = await Promise.all(
          transfers.map(async (file) => files.get(await files.save(file.name, file.mime, file.data)).path),
        )

        const element = target(action.ref)

        if (action.type === "files.upload")
          await cdp.send("DOM.setFileInputFiles", { files: local, backendNodeId: element.backendID }, element.sessionID)

        if (action.type === "files.drop") {
          const position = await point(element)

          for (const type of ["dragEnter", "dragOver", "drop"] as const)
            await input("Input.dispatchDragEvent", {
              type,
              ...position,
              data: { items: [], files: local, dragOperationsMask: 1 },
            })
        }

        break
      }

      case "files.list":
        return result({ tab: state(), files: files.list() })
      case "files.get":
        return result({ tab: state() }, [await transfer(action.fileID)])
      case "console":
        return result({ tab: state(), ...diagnostics.console(action) })
      case "network.list":
        return result({ tab: state(), ...diagnostics.list(action) })
      case "network.get":
        return result({ tab: state(), ...(await diagnostics.get(action)) })
      case "trace.start":
        await profiling.startTrace(action.durationMs)

        return result({ tab: state(), recording: true })
      case "trace.stop": {
        const value = await profiling.stopTrace()

        return result({ tab: state(), durationMs: value.durationMs, incomplete: value.incomplete }, [
          await transfer(value.id),
        ])
      }

      case "cpu.start":
        await profiling.startCpu()

        return result({ tab: state(), recording: true })
      case "cpu.stop": {
        const value = await profiling.stopCpu()

        return result({ tab: state(), durationMs: value.durationMs }, [await transfer(value.id)])
      }

      case "heap.snapshot":
        return result({ tab: state() }, [await transfer(await profiling.heap())])
      case "trace.analyze":
      case "cpu.analyze":
      case "heap.summary":
      case "heap.query":
      case "heap.object":
      case "heap.compare":
        return result({ tab: state(), ...(await profiling.analyze(action)) })
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

    abortError(signal)

    return result(state())
  }

  async function inspect(action: Browser.Action): Promise<Browser.Target> {
    // Most CDP queries cannot run while a JavaScript dialog blocks the renderer.
    if (action.type === "dialog")
      return selectDialogTarget(dialogGate, documentGeneration(documentState), state().url)

    const fileIDs =
      action.type === "heap.compare" ? [action.before, action.after] : "fileID" in action ? [action.fileID] : []

    if (fileIDs.length)
      return {
        resources: [...new Set(fileIDs.flatMap((id) => files.get(id).resources))].sort(),
        key: JSON.stringify(fileIDs),
      }

    if (action.type === "network.get") return { resources: [diagnostics.info(action.id).url], key: action.id }

    if (action.type === "trace.stop" || action.type === "cpu.stop")
      return profiling.target(action.type === "trace.stop" ? "trace" : "cpu")
    const tree = await frames()
    tree.forEach((frame) => documents.set(frame.id, frame.url))
    const selected = actionRefs(action).map(target)

    const frameIDs = selected.length
      ? selected.map((element) => element.frameID)
      : "frameID" in action && action.frameID
        ? [action.frameID]
        : []

    const urls = await Promise.all(frameIDs.map(async (id) => (await agentFrameOf(id)).url))

    const capture = ["screenshot", "lighthouse", "trace.start", "cpu.start", "heap.snapshot"].includes(action.type)

    return {
      resources: [
        ...new Set(
          action.type === "navigate"
            ? [new URL(normalizeURL(action.url, policy)).href]
            : capture
              ? sourceURLs()
              : urls.length
                ? urls
                : [state().url],
        ),
      ].sort(),
      key: JSON.stringify([documentGeneration(documentState), revision, selected]),
    }
  }

  function actionRefs(action: Browser.Action) {
    if (action.type === "drag") return [action.from, action.to]

    if (action.type === "fill_form") return action.fields.map((field) => field.ref)

    return "ref" in action && action.ref ? [action.ref] : []
  }

  /** The element a ref names: one from this tab's newest snapshot, or one the user picked. */
  function lookup(ref: Browser.Ref) {
    const key = ref.replace(/^@/, "")

    return refs.get(key) ?? picked.get(key)
  }

  function target(ref: Browser.Ref): Element {
    const value = lookup(ref)

    if (!value)
      throw new CodedError(
        Browser.FailureCode.staleRef,
        "Element ref is stale or belongs to another tab. Call browser.snapshot({tabID}) and use a ref from the current document.",
      )

    return value
  }

  async function frames() {
    return agentFrames(await frameTrees()).map((frame) => ({ ...frame, url: frame.parentID ? displayURL(frame.url) : state().url }))
  }

  async function frameTrees() {
    const root = await cdp.send("Page.getFrameTree")

    const children = await Promise.all(
      Array.from(sessions, async ([id, sessionID]) => {
        const tree = await cdp.send("Page.getFrameTree", {}, sessionID).catch(() => undefined)

        return tree ? [{ parentID: parents.get(id) ?? root.frameTree.frame.id, tree: tree.frameTree }] : []
      }),
    )

    const excluded = await Promise.all(Array.from(extensionTargets.keys(), async (sessionID) => {
      const tree = await cdp.send("Page.getFrameTree", {}, sessionID).catch(() => undefined)

      return tree ? [tree.frameTree] : []
    }))

    return { root: root.frameTree, children: children.flat(), extensions: excludedFrames(extensionFrames(), excluded.flat()) }
  }

  /** The frame an agent's frameID names; every operation that takes one resolves it here. */
  async function agentFrameOf(frameID: string) {
    const access = agentFrame(await frameTrees(), frameID)

    if (access.type !== "frame") throw new Error(access.message)

    return { ...access.frame, url: access.frame.parentID ? displayURL(access.frame.url) : state().url }
  }

  async function frameContext(frameID: string) {
    await agentFrameOf(frameID)
    const context = contexts.get(frameID)

    if (!context)
      throw new Error(
        "Frame context is unavailable. Call browser.frames({tabID}) and use a current frameID from this tab, or omit frameID to target the main frame.",
      )

    return context
  }

  /** Why the agent may not use these frames: one shows an extension's document, perhaps since the call began. */
  async function extensionFrameRefusal(frameIDs: readonly string[]) {
    if (!frameIDs.length) return undefined
    const trees = await frameTrees()

    return frameIDs.map((frameID) => agentFrame(trees, frameID)).find((access) => access.type !== "frame")?.message
  }

  /** The frames an action reaches: its frameID, or the frames of the element refs it names. */
  function actionFrames(action: Browser.Action) {
    const elements = actionRefs(action).flatMap((ref) => lookup(ref)?.frameID ?? [])

    return "frameID" in action && action.frameID ? [action.frameID, ...elements] : elements
  }

  async function call(element: Element, functionDeclaration: string, args: unknown[] = []) {
    const objectId = await resolve(element)

    try {
      const result = await cdp.send(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: connectedFunction(functionDeclaration),
          arguments: args.map((value) => ({ value })),
          returnByValue: true,
          awaitPromise: true,
        },
        element.sessionID,
      )

      if (result.exceptionDetails?.exception?.description?.startsWith("Error: browser.detached_ref\n")) throw detachedRef()

      if (result.exceptionDetails)
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)

      // SAFETY: widens CDP's `any` value to unknown; every caller decodes or compares it.
      return result.result.value as unknown
    } finally {
      await cdp.send("Runtime.releaseObject", { objectId }, element.sessionID).catch(() => undefined)
    }
  }

  async function resolve(element: Element) {
    const object = await cdp.send("DOM.resolveNode", { backendNodeId: element.backendID }, element.sessionID)

    if (!object.object.objectId) throw detachedRef()

    return object.object.objectId
  }

  async function rect(element: Element, scroll = false, knownTree?: Awaited<ReturnType<typeof frames>>) {
    if (scroll) {
      await cdp.send("DOM.scrollIntoViewIfNeeded", { backendNodeId: element.backendID }, element.sessionID)
      // A one-DIP capture flushes scrolling even in a hidden tab. A resize can briefly replace the surface.
      await contents
        .capturePage({ x: 0, y: 0, width: 1, height: 1 }, { stayHidden: false, stayAwake: true })
        .catch(() => painted(element.sessionID))
    }

    const bounds = Schema.Struct({ x: Schema.Finite, y: Schema.Finite, width: Schema.Finite, height: Schema.Finite })

    const value = {
      ...Schema.decodeUnknownSync(bounds)(
        await call(
          element,
          "function() { const r = this.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; }",
        ),
      ),
    }

    const tree = knownTree ?? await frames()
    let frame = tree.find((frame) => frame.id === element.frameID)

    while (frame?.parentID) {
      const parent = { frameID: frame.parentID, sessionID: sessionFor(frame.parentID, tree) }
      const owner = await cdp.send("DOM.getFrameOwner", { frameId: frame.id }, parent.sessionID)

      // A CSS transform on the iframe scales its content box; the child's own coordinates are unscaled.
      const box = Schema.decodeUnknownSync(
        Schema.Struct({ ...bounds.fields, scaleX: Schema.Finite, scaleY: Schema.Finite }),
      )(
        await call(
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

  async function captureFrame(action: Extract<Browser.Action, { type: "screenshot" }>, signal: AbortSignal) {
    // A resize between measuring and capturing would crop another layout; captures share the viewport writer's queue.
    return metrics.exclusive(() => withFrames(view.getVisible() && win.isVisible() && !win.isMinimized(), signal, async stop => {
      if (isNavigationPending(documentState)) await waitFor(() => !isNavigationPending(documentState), stop)
      abortError(stop)

      // The restored address never opened (its preview failed, or its load was cancelled before it was issued): the
      // tab shows no document, so a redraw would pass a blank surface off as the page.
      if (documentState.status === "restoring")
        throw new Error("This restored tab has not opened its page. Reload or navigate the tab, then take the screenshot again.")
      const before = documentState
      const frame = await screenshot(action, stop)
      abortError(stop)

      if (!frameStillCurrent(before, documentState)) throw new CodedError(Browser.FailureCode.documentChanged, "The document changed during capture. Check the tab and take a new screenshot.")

      return frame
    }, action.fullPage ? FULL_PAGE_DEADLINE_MS : undefined))
  }

  // A fixed viewport is an emulated device scaled into the pane: CDP captures its own layout at the device's size, in
  // page DIPs, rather than the scaled surface.
  async function emulatedScreenshot(action: Extract<Browser.Action, { type: "screenshot" }>, signal: AbortSignal) {
    const format = action.format === "png" ? "png" : "jpeg"
    const element = action.ref ? await rect(target(action.ref), true) : undefined
    const layout = await cdp.send("Page.getLayoutMetrics")
    abortError(signal)
    const viewport = layout.cssVisualViewport

    const bounds = element
      ? { ...element, x: element.x + layout.cssLayoutViewport.pageX, y: element.y + layout.cssLayoutViewport.pageY }
      : action.fullPage
        ? layout.cssContentSize
        : { x: viewport.pageX, y: viewport.pageY, width: viewport.clientWidth, height: viewport.clientHeight }

    if (bounds.width <= 0 || bounds.height <= 0) throw new Error(noVisibleArea)
    const zoom = viewport.zoom ?? contents.getZoomFactor()
    const pixelRatio = zoom * electron.screen.getDisplayMatching(win.getBounds()).scaleFactor
    // A mobile page can initially zoom out to fit a 980 CSS px layout on a phone screen.
    const scale = Math.min(viewport.scale, (action.maxWidth ?? 2000) / (bounds.width * pixelRatio))

    if (bounds.width * bounds.height * (scale * pixelRatio) ** 2 > 16_000_000)
      throw new Error("Screenshot exceeds 16 megapixels; capture an element or use a smaller maxWidth.")

    const capture = await device.capture({
      format,
      quality: format === "png" ? undefined : (action.quality ?? 80),
      captureBeyondViewport: true,
      clip: { ...scaleRect(bounds, zoom), scale },
    })

    abortError(signal)

    return { format, data: Buffer.from(capture.data, "base64") }
  }

  async function screenshot(action: Extract<Browser.Action, { type: "screenshot" }>, signal: AbortSignal) {
    if (metrics.applied().viewport.mode === "fixed") return emulatedScreenshot(action, signal)

    if (!action.fullPage && !action.ref) return captureViewport(action, signal)

    const element = action.ref ? await rect(target(action.ref), true) : undefined
    const layout = await cdp.send("Page.getLayoutMetrics")
    abortError(signal)
    const viewport = layout.cssVisualViewport
    const onscreen = view.getVisible() && win.isVisible() && !win.isMinimized()

    if (action.fullPage) return beyondViewport(action, layout.cssContentSize)

    if (
      element &&
      onscreen &&
      (element.x < 0 ||
        element.y < 0 ||
        element.x + element.width > viewport.clientWidth ||
        element.y + element.height > viewport.clientHeight)
    )
      return beyondViewport(action, { ...element, x: element.x + viewport.pageX, y: element.y + viewport.pageY })

    // Crop the requested redraw to the element's visible part without changing the page's viewport.
    const clip = element && {
      x: Math.max(0, element.x),
      y: Math.max(0, element.y),
      width: Math.min(viewport.clientWidth, element.x + element.width) - Math.max(0, element.x),
      height: Math.min(viewport.clientHeight, element.y + element.height) - Math.max(0, element.y),
    }

    if (clip && (clip.width <= 0 || clip.height <= 0)) throw new Error(noVisibleArea)

    return captureViewport(action, signal, clip)
  }

  async function captureViewport(action: Extract<Browser.Action, { type: "screenshot" }>, signal: AbortSignal, clip?: Electron.Rectangle) {
    const viewWidth = view.getBounds().width
    const zoom = contents.getZoomFactor()
    const maxWidth = action.maxWidth ?? 2000
    const format = action.format === "png" ? "png" : "jpeg"
    // Request the final encoding when the viewport fits. Use a lossless intermediate for cropping or resizing.
    const encoding = !clip && viewWidth * electron.screen.getDisplayMatching(win.getNormalBounds()).scaleFactor <= maxWidth ? format : "png"

    const shot = await cdp.send("Page.captureScreenshot", {
      format: encoding,
      quality: encoding === "jpeg" ? action.quality ?? 80 : undefined,
      fromSurface: true,
      captureBeyondViewport: false,
      optimizeForSpeed: true,
    })

    abortError(signal)
    const bytes = Buffer.from(shot.data, "base64")

    if (!clip && encoding === format && (format === "png" ? pngFits : jpegFits)(bytes, maxWidth, Browser.MAX_FILE_BYTES))
      return { format, data: bytes }

    const viewportImage = electron.nativeImage.createFromBuffer(bytes)

    if (viewportImage.isEmpty()) throw new Error(undrawableMessage("stalled"))
    const area = clip && cropPixels(clip, viewportImage.getSize(), viewWidth, zoom)

    if (clip && !area) throw new Error(noVisibleArea)
    const image = area ? viewportImage.crop(area) : viewportImage

    if (image.isEmpty()) throw new Error(noVisibleArea)

    if (!clip && encoding === format && image.getSize().width <= maxWidth && bytes.length <= Browser.MAX_FILE_BYTES)
      return { format, data: bytes }

    const scaled = image.getSize().width > maxWidth ? image.resize({ width: maxWidth, quality: "good" }) : image

    // A rendered frame encodes only as PNG or JPEG, so WebP comes back as JPEG.
    return action.format === "png"
      ? { format: "png", data: scaled.toPNG() }
      : { format: "jpeg", data: scaled.toJPEG(action.quality ?? 80) }
  }

  async function beyondViewport(
    action: Extract<Browser.Action, { type: "screenshot" }>,
    bounds: { x: number; y: number; width: number; height: number },
  ) {
    const pixelRatio = contents.getZoomFactor() * electron.screen.getDisplayMatching(win.getNormalBounds()).scaleFactor
    const scale = captureScale(bounds, pixelRatio, action.maxWidth ?? 2000)
    const format = action.format ?? "jpeg"

    const capture = await cdp.send("Page.captureScreenshot", {
      format,
      quality: format === "png" ? undefined : (action.quality ?? 80),
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { ...bounds, scale },
    })

    return { format, data: Buffer.from(capture.data, "base64") }
  }

  async function point(element: Element) {
    return elementCenter(await rect(element, true))
  }

  async function elementCenter(box: PaneElement["rect"]) {
    if (!device.mobile()) return inputCenter(box)
    // Focusing a field can pan the visual viewport inside the layout viewport. CDP adds that offset on dispatch.
    const { cssVisualViewport } = await cdp.send("Page.getLayoutMetrics")

    return inputCenter({ ...box, x: box.x - cssVisualViewport.offsetX, y: box.y - cssVisualViewport.offsetY })
  }

  // Input.dispatch* applies page zoom itself. Its coordinates are relative to the full scaled view, even when panned.
  function inputCenter(box: PaneElement["rect"]) {
    const scale = metrics.applied().scale

    return { x: (box.x + box.width / 2) * scale, y: (box.y + box.height / 2) * scale }
  }

  // CDP can't condition a native input event on a hit test. Check the compositor's actual hit after scrolling,
  // and check again after resolving the node. Do not dispatch into a frame owner whose inner hit is unknown.
  function dispatchInput(origin: "agent" | "user", signal: AbortSignal) {
    return async (
      method: "Input.dispatchMouseEvent" | "Input.dispatchDragEvent" | "Input.dispatchKeyEvent" | "Input.insertText",
      params: Protocol.Input.DispatchMouseEventRequest | Protocol.Input.DispatchDragEventRequest | Protocol.Input.DispatchKeyEventRequest | Protocol.Input.InsertTextRequest,
    ) => {
      if (origin === "user") return cdp.send(method, params)
      // Context-menu delivery can follow the CDP reply. A later user input, not the end of the command, re-arms it.
      nativeMenu = false

      if (process.platform === "linux" && "button" in params && params.button === "middle")
        throw new Error("Middle-click can paste the system selection. Use fill/type to enter text and evaluate to read page text.")
      const changed = "Input target changed or could not be verified. Take a fresh snapshot and use the page outside extension UI."

      // The user sees a still of the page under "Leave site?" or a sign-in, not the page the input would reach.
      if (prompts.covered())
        throw new Error("The user is answering a prompt over this page. Wait for them, or use another tab; no input was sent.")

      if ("x" in params) {
        const version = revision
        const trees = await frameTrees()
        const position = { x: Math.round(params.x), y: Math.round(params.y) }
        const hitTest = () => cdp.send("DOM.getNodeForLocation", { ...position, ignorePointerEventsNone: false })
        const hit = await hitTest()
        const access = agentFrame(trees, hit.frameId)

        if (access.type !== "frame") throw new Error(access.message)
        const sessionID = sessionFor(hit.frameId, agentFrames(trees))
        const { node } = await cdp.send("DOM.describeNode", { backendNodeId: hit.backendNodeId }, sessionID)

        if (/^(?:iframe|frame|object|embed)$/i.test(node.nodeName)) throw new Error(changed)
        const last = await hitTest()

        if (version !== revision || last.backendNodeId !== hit.backendNodeId || last.frameId !== hit.frameId || extensionFrames().has(hit.frameId)) throw new Error(changed)

        if (!inputDocument(contents.mainFrame.url, contents.mainFrame.origin)) throw new Error(changed)
        abortError(signal)

        // Counted before it is sent and never taken back: a press that fails to arrive costs the person one press
        // read as the agent's, never the reverse.
        if ("type" in params && params.type === "mousePressed") agentPresses++

        return cdp.send(method, { ...params, ...position })
      }

      const focused = contents.focusedFrame

      if (!focused) throw new Error(changed)

      for (let frame: Electron.WebFrameMain | null = focused; frame; frame = frame.parent) {
        if (frame.detached || !inputDocument(frame.url, frame.origin)) throw new Error(changed)

        if (!frame.parent && frame.frameTreeNodeId !== contents.mainFrame.frameTreeNodeId) throw new Error(changed)
      }

      abortError(signal)

      return cdp.send(method, params)
    }
  }

  async function click(input: ReturnType<typeof dispatchInput>, element: Element, button: Protocol.Input.MouseButton = "left", count = 1, modifiers: readonly string[] = []) {
    const position = await point(element)
    const flags = modifiers.reduce((mask, key) => mask | ({ Alt: 1, Control: 2, Meta: 4, Shift: 8 }[key] ?? 0), 0)
    await input("Input.dispatchMouseEvent", { type: "mouseMoved", ...position, modifiers: flags })

    for (let clickCount = 1; clickCount <= count; clickCount++) {
      await input("Input.dispatchMouseEvent", {
        type: "mousePressed",
        ...position,
        button,
        clickCount,
        modifiers: flags,
      })
      await input("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        ...position,
        button,
        clickCount,
        modifiers: flags,
      })
    }
  }

  async function fill(input: ReturnType<typeof dispatchInput>, element: Element, value: string, signal: AbortSignal) {
    const kind = await call(
      element,
      "function() { if (this.disabled || this.readOnly) return; if (this instanceof HTMLTextAreaElement || this.isContentEditable) return 'text'; if (!(this instanceof HTMLInputElement)) return; if (['date','time','datetime-local','month','week'].includes(this.type)) return 'structured'; if (!['file','checkbox','radio','button','submit','reset','image','hidden','range','color'].includes(this.type)) return 'text'; }",
    )

    if (!kind)
      throw new Error(
        "Target is not an enabled editable text field. Take a fresh snapshot and choose a textbox; use browser.select for dropdowns, browser.check for checkboxes/radios, or browser.files.upload for file inputs.",
      )

    // Keyboard input cannot compose a date or time control's value; Chromium clears a malformed one.
    if (kind === "structured") {
      await call(
        element,
        "function(value) { const previous = this.value; this.focus(); this.value = value; if (this.value !== value) { this.value = previous; throw new Error('The ' + this.type + ' input rejected this value and keeps its previous one. Use its required format, for example 2026-09-07 for date, 14:45 for time, 2026-09-07T14:45 for datetime-local, 2026-09 for month, or 2026-W37 for week.'); } this.dispatchEvent(new Event('input',{bubbles:true})); this.dispatchEvent(new Event('change',{bubbles:true})); }",
        [value],
      )

      return
    }

    await cdp.send("DOM.focus", { backendNodeId: element.backendID }, element.sessionID)
    // Focusing this field blurs the previous one; a validation dialog from that blur must stop here.
    abortError(signal)
    await key(input, process.platform === "darwin" ? "Meta+A" : "Control+A")
    await key(input, "Backspace")
    abortError(signal)
    await input("Input.insertText", { text: value })
  }

  async function select(element: Element, values: readonly string[]) {
    await call(
      element,
      `function(values) { if (!(this instanceof HTMLSelectElement) || this.disabled) throw new Error('Target is not an enabled HTML select. Take a fresh snapshot and choose an enabled dropdown ref.'); if (!this.multiple && values.length !== 1) throw new Error('This dropdown accepts exactly one value; pass a one-item values array.'); for (const value of values) if (!Array.from(this.options).some(option => option.value === value && !option.disabled)) throw new Error('Option value was not found or is disabled. Inspect option values with browser.evaluate before retrying browser.select; values are not visible labels.'); for (const option of this.options) option.selected = values.includes(option.value); this.dispatchEvent(new Event('input',{bubbles:true})); this.dispatchEvent(new Event('change',{bubbles:true})); }`,
      [values],
    )
  }

  async function check(input: ReturnType<typeof dispatchInput>, element: Element, checked: boolean) {
    const current = await call(
      element,
      "function(checked) { if (!(this instanceof HTMLInputElement) || !['checkbox','radio'].includes(this.type) || this.disabled) throw new Error('Target is not an enabled checkbox or radio. Take a fresh snapshot and choose the correct ref.'); if (this.type === 'radio' && this.checked && !checked) throw new Error('A selected radio cannot be cleared by clicking it. Select a different radio in its group instead.'); return this.checked; }",
      [checked],
    )

    if (current !== checked) await click(input, element)

    if ((await call(element, "function() { return this.checked; }")) !== checked)
      throw new Error(
        "The page did not keep the requested checked state. Inspect the current snapshot and page validation before retrying; do not blindly toggle the control again.",
      )
  }

  async function key(input: ReturnType<typeof dispatchInput>, chord: string) {
    if (!chord)
      throw new Error(
        "A key is required. Use a named key such as Enter or ArrowDown, a single character, or a chord such as Control+A.",
      )
    const parts = (chord.endsWith("+") ? chord.slice(0, -1) : chord).split("+")
    const key = parts.pop() || "+"

    const modifiers = parts.reduce((mask, key) => {
      const bit = { Alt: 1, Control: 2, Meta: 4, Shift: 8 }[key]

      if (!bit)
        throw new Error(
          `Unknown key modifier ${JSON.stringify(key)}. Supported modifiers are Alt, Control, Meta, and Shift; for example Control+A. Use Meta for macOS command shortcuts.`,
        )

      return mask | bit
    }, 0)

    const codes: KeyCodes = {
      Enter: 13,
      Tab: 9,
      Escape: 27,
      Backspace: 8,
      Delete: 46,
      ArrowUp: 38,
      ArrowDown: 40,
      ArrowLeft: 37,
      ArrowRight: 39,
      PageUp: 33,
      PageDown: 34,
      Home: 36,
      End: 35,
      Space: 32,
    }

    const code =
      codes[key] ??
      (key.length === 1
        ? key.toUpperCase().charCodeAt(0)
        : /^F([1-9]|1[0-2])$/.test(key)
          ? 111 + Number(key.slice(1))
          : undefined)

    const refusal = agentKeyRefusal(key, modifiers, code)

    if (refusal) throw new Error(refusal)

    if (code === undefined)
      throw new Error(
        `Unknown key ${JSON.stringify(key)}. Use Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right, PageUp/Down, Home, End, Space, F1–F12, or one character. Use browser.fill for text.`,
      )
    // Named keys need their character data too: Enter submits forms and inserts newlines only with "\r".
    const text = key === "Enter" ? "\r" : key === "Space" ? " " : key.length === 1 ? key : undefined

    const event = { key: key === "Space" ? " " : key, windowsVirtualKeyCode: code, modifiers }
    const params = text !== undefined && !(modifiers & 6) ? { ...event, text } : event

    await input("Input.dispatchKeyEvent", { type: "keyDown", ...params })
    await input("Input.dispatchKeyEvent", { type: "keyUp", ...params })
  }

  async function snapshot(action: Extract<Browser.Action, { type: "snapshot" | "find" }>, signal: AbortSignal) {
    const generation = documentGeneration(documentState)
    const tree = await frames()
    const selected = action.type === "snapshot" && action.ref ? target(action.ref) : undefined
    const named = selected?.frameID ?? action.frameID
    const frameID = named ? (await agentFrameOf(named)).id : tree[0]?.id

    if (!frameID)
      throw new Error(
        "Frame is unavailable. Call browser.frames({tabID}) and use a current frameID from this tab; omit frameID for the main frame.",
      )
    const sessionID = sessionFor(frameID, tree)
    const ax = await cdp.send("Accessibility.getFullAXTree", { frameId: frameID }, sessionID)
    abortError(signal)

    const byNode = (source: Map<string, Element>) => new Map(Array.from(source)
      .filter(([, element]) => element.frameID === frameID && element.sessionID === sessionID)
      .map(([ref, element]) => [element.backendID, ref]))

    const snapshot = await accessibilitySnapshot(ax.nodes, {
      root: selected?.backendID,
      depth: action.type === "snapshot" ? action.depth : undefined,
      text: action.type === "find" ? action.text : undefined,
      interactive: action.interactive,
      maxLines: action.maxLines,
      maxChars: action.maxChars,
      signal,
      previous: refs.previous(frameID, sessionID),
      picked: byNode(picked),
      ref: options.shared.ref,
      // AX does not distinguish password textboxes. Fail closed if the backing field is gone or sensitive.
      readableValue: async (backendID, name) => {
        abortError(signal)
        const field = await call({ backendID, frameID, sessionID }, describeField).catch(() => undefined)

        return Schema.is(Field)(field) && readableField(field, name)
      },
      box: action.type === "snapshot" && action.boxes ? async (backendID) => {
        abortError(signal)
        const box = await rect({ backendID, frameID, sessionID }, false, tree).catch(() => undefined)

        return box ? ` box=${JSON.stringify(box)}` : ""
      } : undefined,
    })

    abortError(signal)

    if (documentGeneration(documentState) !== generation) throw new CodedError(Browser.FailureCode.documentChanged, "Document changed during snapshot; request a fresh snapshot.")
    refs.add(frameID, sessionID, snapshot.refs)

    return { content: snapshot.content, truncated: snapshot.truncated }
  }

  /** Moves the picker and runs its effects; resolves once they ran, so input waits for the picker to disarm. */
  async function dispatchPicker(event: PickerEvent): Promise<void> {
    const next = transitionPicker(pickerState, event)
    pickerState = next.state
    await Promise.all(next.effects.map(runPicker))
  }

  async function runPicker(effect: PickerEffect): Promise<void> {
    switch (effect.type) {
      case "arm": {
        const attempt = effect.attempt
        // Each out-of-process frame arms its own picker; the main target decides whether the picker started.
        const frames = Array.from(sessions.values(), (id) => arm(attempt, id).catch(() => undefined))

        return Promise.all([arm(attempt), ...frames]).then(
          () => dispatchPicker({ type: "arm.succeeded", attempt }),
          () => dispatchPicker({ type: "arm.failed", attempt }),
        )
      }

      case "arm-frame":
        return arm(effect.attempt, effect.sessionID).catch(() => undefined)
      case "disarm":
        return disarm()
      case "describe": {
        const attempt = effect.attempt

        return metrics
          .exclusive(() => describePick(effect.backendID, effect.sessionID))
          .then(
            (pick) =>
              dispatchPicker({ type: "describe.succeeded", attempt, target: pick.target, element: pick.element }),
            () => dispatchPicker({ type: "describe.failed", attempt }),
          )
      }

      case "pick": {
        const ref = options.shared.ref()
        picked.set(ref, effect.target)
        focusHost()
        options.inspect?.({ active: false, element: { ref: Browser.Ref.make(ref), ...effect.element } })

        return
      }

      case "flash": {
        const attempt = effect.attempt
        const target = effect.target

        return cdp
          .send("DOM.scrollIntoViewIfNeeded", { backendNodeId: target.backendID }, target.sessionID)
          .then(() =>
            cdp.send(
              "Overlay.highlightNode",
              { backendNodeId: target.backendID, highlightConfig: pickedHighlight },
              target.sessionID,
            ),
          )
          .then(
            () => dispatchPicker({ type: "flash.shown", attempt }),
            () => dispatchPicker({ type: "flash.failed", attempt }),
          )
      }

      case "hide-highlight":
        return hideHighlight()
      case "report":
        options.inspect?.({ active: effect.active })

        return
      case "timer": {
        const attempt = effect.attempt
        const phase = effect.phase
        clearTimeout(pickerTimer)
        pickerTimer = setTimeout(
          () => void dispatchPicker({ type: "timeout", phase, attempt }),
          PICKER_TIMEOUT_MS[phase],
        )
      }
    }
  }

  async function arm(attempt: number, sessionID?: string) {
    // The main target enables DOM at startup; frame targets only need it for the picker.
    if (sessionID) await cdp.send("DOM.enable", {}, sessionID)
    await cdp.send("Overlay.enable", {}, sessionID)

    // The picker may have been turned off while the domains were enabling.
    if (pickerAttempt(pickerState) !== attempt) return
    await cdp.send("Overlay.setInspectMode", { mode: "searchForNode", highlightConfig: inspectHighlight }, sessionID)
  }

  async function disarm() {
    await Promise.all(
      [undefined, ...sessions.values()].map((id) =>
        cdp.send("Overlay.setInspectMode", inspectOff, id).catch(() => undefined),
      ),
    )
  }

  async function describePick(backendID: number, sessionID?: string) {
    await disarm()
    // Keep the box model on the picked element, without the tooltip, while the renderer freezes the page.
    await cdp.send("Overlay.highlightNode", { backendNodeId: backendID, highlightConfig: pickedHighlight }, sessionID)
    const target = { backendID, frameID: await frameOf(backendID, sessionID), sessionID }

    const [details, box, accessible, layout] = await Promise.all([
      describe(target),
      rect(target),
      accessibility(target),
      cdp.send("Page.getLayoutMetrics"),
    ])

    await painted(sessionID)
    const visual = layout.cssVisualViewport
    const scale = contents.getZoomFactor() * metrics.applied().scale * visual.scale

    return {
      target,
      element: {
        ...details,
        ...accessible,
        rect: scaleRect({ ...box, x: box.x - visual.offsetX, y: box.y - visual.offsetY }, scale),
      },
    }
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
      await call(
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

  // Give the picker or scrolled input target a chance to lay out. This is not a compositor acknowledgement;
  // screenshots wait for their own redraw instead.
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

function scaleRect(box: PaneElement["rect"], scale: number) {
  return { x: box.x * scale, y: box.y * scale, width: box.width * scale, height: box.height * scale }
}
