import { randomUUID } from "node:crypto"
import { BrowserControl } from "@opencode-ai/core/browser-control"
import { BrowserWindow, View, WebContentsView } from "electron"
import type { BrowserPaneCommand, BrowserPaneLayout, BrowserPaneState } from "../preload/types"
import {
  allowedBrowserURL,
  boundedBrowserOperation,
  browserBottomMasks,
  invalidateBrowserRefs,
  normalizeBrowserBounds,
  normalizeBrowserRef,
  normalizeBrowserURL,
  runBrowserInputPair,
  stopBrowserOperation,
} from "./browser-pane-policy"

type Ref = { readonly snapshot: number; readonly backendNodeID: number }
type Entry = {
  readonly win: BrowserWindow
  readonly view: WebContentsView
  readonly masks: View[]
  attached: boolean
  sessionID?: string
  lease?: string
  attachment: number
  document: number
  snapshot: number
  readonly refs: Map<string, Ref>
  readonly requests: Set<AbortController>
  active?: AbortController
  state: BrowserPaneState
  queue: Promise<void>
}

type AXNode = {
  readonly nodeId?: string
  readonly parentId?: string
  readonly backendDOMNodeId?: number
  readonly ignored?: boolean
  readonly role?: { readonly value?: unknown }
  readonly name?: { readonly value?: unknown }
  readonly value?: { readonly value?: unknown }
  readonly properties?: { readonly name?: unknown; readonly value?: { readonly value?: unknown } }[]
}

const interactiveRoles = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "menuitem",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
])
const readableRoles = new Set([
  "article",
  "cell",
  "heading",
  "image",
  "list",
  "listitem",
  "paragraph",
  "region",
  "row",
  "StaticText",
])
const debuggerCommandTimeout = 10_000

export function createBrowserPaneController() {
  const entries = new Map<number, Entry>()

  const publish = (entry: Entry, error?: string) => {
    const contents = entry.view.webContents
    const state = {
      url: contents.getURL(),
      title: contents.getTitle(),
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      ...(error ? { error } : {}),
    }
    entry.state = state
    if (!entry.win.isDestroyed()) entry.win.webContents.send("browser-pane-state", state)
    return state
  }

  const create = (win: BrowserWindow) => {
    const view = new WebContentsView({
      webPreferences: {
        partition: `opencode-browser-${win.id}`,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        plugins: false,
        experimentalFeatures: false,
        safeDialogs: true,
        navigateOnDragDrop: false,
        autoplayPolicy: "document-user-activation-required",
        devTools: false,
      },
    })
    view.setVisible(false)
    view.setBorderRadius(0)
    view.setBackgroundColor("#ffffff")
    win.contentView.addChildView(view)
    const masks = Array.from({ length: 8 }, () => new View())
    for (const mask of masks) {
      mask.setVisible(false)
      win.contentView.addChildView(mask)
    }

    const entry: Entry = {
      win,
      view,
      masks,
      attached: false,
      attachment: 0,
      document: 0,
      snapshot: 0,
      refs: new Map(),
      requests: new Set(),
      state: emptyState(),
      queue: Promise.resolve(),
    }
    entries.set(win.id, entry)

    const contents = view.webContents
    const browserSession = contents.session
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    browserSession.setPermissionCheckHandler(() => false)
    browserSession.setDevicePermissionHandler(() => false)
    browserSession.setDisplayMediaRequestHandler((_request, callback) => callback({}))
    browserSession.on("will-download", (event) => event.preventDefault())

    const preventUnsafeNavigation = (event: Electron.Event<{ url: string }>) => {
      if (allowedBrowserURL(event.url)) return
      event.preventDefault()
      publish(entry, "Navigation was blocked by the browser security policy")
    }
    contents.on("will-navigate", preventUnsafeNavigation)
    contents.on("will-redirect", preventUnsafeNavigation)
    contents.setWindowOpenHandler((details) => {
      if (allowedBrowserURL(details.url)) {
        void navigate(entry, details.url).catch((error) =>
          publish(entry, error instanceof Error ? error.message : String(error)),
        )
      }
      return { action: "deny" }
    })
    contents.on("content-bounds-updated", (event) => event.preventDefault())
    contents.on("did-start-loading", () => publish(entry))
    contents.on("did-stop-loading", () => publish(entry))
    contents.on("did-navigate", () => publish(entry))
    contents.on("did-navigate-in-page", () => publish(entry))
    contents.on("page-title-updated", () => publish(entry))
    contents.on("did-start-navigation", (_event, _url, _inPlace, isMainFrame) => {
      if (!isMainFrame) return
      entry.document++
      invalidateBrowserRefs(entry)
    })
    contents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return
      publish(entry, description)
    })
    contents.on("render-process-gone", () => {
      entry.document++
      invalidateBrowserRefs(entry)
      publish(entry, "The browser page crashed")
    })
    win.webContents.on("did-start-navigation", () => detach(entry))
    win.webContents.on("render-process-gone", () => detach(entry))
    contents.debugger.on("detach", () => {
      invalidateBrowserRefs(entry)
    })
    win.once("closed", () => disposeEntry(entry))
    void contents.loadURL("about:blank")
    return entry
  }

  const setLayout = (win: BrowserWindow, layout: BrowserPaneLayout) => {
    const entry = entries.get(win.id)
    if (layout.destroy) {
      if (entry) disposeEntry(entry)
      return
    }
    if (!layout.attached || !layout.sessionID) {
      if (entry && layout.sessionID && entry.sessionID !== layout.sessionID) return
      if (entry) detach(entry)
      return
    }

    const next = entry ?? create(win)
    const owner = [...entries.values()].find(
      (item) => item !== next && item.attached && item.sessionID === layout.sessionID,
    )
    if (owner) {
      detach(next)
      publish(next, "Browser tools for this session are attached in another window")
    }
    if (!owner && (!next.attached || next.sessionID !== layout.sessionID)) {
      cancelEntry(next)
      next.attached = true
      next.sessionID = layout.sessionID
      next.lease = randomUUID()
    }
    if (!layout.visible || !layout.bounds || !next.attached) {
      hideEntry(next)
      return
    }
    const bounds = normalizeBrowserBounds(layout.bounds, win.contentView.getBounds())
    if (!bounds) {
      hideEntry(next)
      return
    }
    next.view.setBounds(bounds)
    next.view.setVisible(true)
    const masks = browserBottomMasks(bounds)
    next.masks.forEach((mask, index) => {
      const maskBounds = masks[index]
      if (!maskBounds) {
        mask.setVisible(false)
        return
      }
      mask.setBackgroundColor(layout.background ?? "#000000")
      mask.setBounds(maskBounds)
      mask.setVisible(true)
    })
  }

  const command = async (win: BrowserWindow, input: BrowserPaneCommand) => {
    const entry = entries.get(win.id)
    if (!entry?.attached) throw new Error("Open the Browser pane before using browser controls")
    if (input.type === "stop") {
      stopBrowserOperation({ active: entry.active, stop: () => entry.view.webContents.stop() })
      return
    }
    return enqueue(entry, async () => {
      const controller = new AbortController()
      return active(entry, controller, async () => {
        switch (input.type) {
          case "navigate":
            await navigate(entry, input.url, controller.signal)
            return
          case "back":
            if (entry.view.webContents.navigationHistory.canGoBack()) entry.view.webContents.navigationHistory.goBack()
            return
          case "forward":
            if (entry.view.webContents.navigationHistory.canGoForward())
              entry.view.webContents.navigationHistory.goForward()
            return
          case "reload":
            entry.view.webContents.reload()
            return
        }
      })
    })
  }

  const state = (win: BrowserWindow) => entries.get(win.id)?.state ?? emptyState()

  const request = async (input: BrowserControl.Request, abort?: AbortSignal): Promise<BrowserControl.Result> => {
    const matches = [...entries.values()].filter((entry) => entry.attached && entry.sessionID === input.sessionID)
    const command = input.command
    if (command.type === "status") {
      const entry = input.lease
        ? matches.find((entry) => entry.lease === input.lease)
        : matches.length === 1
          ? matches[0]
          : undefined
      if (!entry?.lease) return { type: "status", attached: false }
      return {
        type: "status",
        attached: true,
        lease: entry.lease,
        state: contractState(publish(entry), entry.document),
      }
    }
    const entry = matches.find((entry) => entry.lease === input.lease)
    if (!entry)
      throw browserError("not_attached", "The browser pane lease is no longer attached to this session.", true)
    if (matches.length > 1) {
      throw browserError("internal", "More than one browser pane is attached to this session.", false)
    }
    const attachment = entry.attachment
    const lease = entry.lease
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    abort?.addEventListener("abort", onAbort, { once: true })
    entry.requests.add(controller)
    return enqueue(entry, () =>
      active(entry, controller, async () => {
        const verify = () => assertActive(entry, input.sessionID, lease, attachment, controller.signal)
        verify()
        return execute(entry, command, controller.signal, verify)
      }),
    ).finally(() => {
      abort?.removeEventListener("abort", onAbort)
      entry.requests.delete(controller)
    })
  }

  const dispose = () => {
    for (const entry of entries.values()) disposeEntry(entry)
    entries.clear()
  }

  function disposeEntry(entry: Entry) {
    entries.delete(entry.win.id)
    cancelEntry(entry)
    if (!entry.win.isDestroyed()) {
      entry.win.contentView.removeChildView(entry.view)
      for (const mask of entry.masks) entry.win.contentView.removeChildView(mask)
    }
    if (entry.view.webContents.isDestroyed()) return
    entry.view.webContents.close()
  }

  return { setLayout, command, state, request, dispose }
}

export type BrowserPaneController = ReturnType<typeof createBrowserPaneController>

async function execute(
  entry: Entry,
  command: Exclude<BrowserControl.Command, { readonly type: "status" }>,
  abort: AbortSignal,
  verify: () => void,
) {
  throwIfAborted(abort)
  assertDocument(entry, command.generation)
  switch (command.type) {
    case "navigate":
      await navigate(entry, command.url, abort, verify)
      return { type: "action" as const, state: contractState(entry.state, entry.document) }
    case "snapshot":
      return snapshot(entry, command.generation, abort, verify)
    case "click":
      await click(entry, command.ref, command.generation, abort, verify)
      return { type: "action" as const, state: contractState(publishState(entry), entry.document) }
    case "fill":
      await fill(entry, command.ref, command.text, command.generation, abort, verify)
      return { type: "action" as const, state: contractState(publishState(entry), entry.document) }
    case "press":
      await press(entry, command.key, command.generation, abort, verify)
      return { type: "action" as const, state: contractState(publishState(entry), entry.document) }
    case "scroll":
      await scroll(entry, command.direction, command.amount, command.generation, abort, verify)
      return { type: "action" as const, state: contractState(publishState(entry), entry.document) }
    case "screenshot":
      return screenshot(entry, command.generation, abort, verify)
  }
  throw new Error("Unsupported browser command")
}

async function navigate(entry: Entry, input: string, abort?: AbortSignal, verify?: () => void) {
  const url = normalizeBrowserURL(input)
  if (!allowedBrowserURL(url)) {
    throw browserError("invalid_url", "Only HTTP, HTTPS, and file URLs are supported.", false)
  }
  throwIfAborted(abort)
  const onAbort = () => entry.view.webContents.stop()
  abort?.addEventListener("abort", onAbort, { once: true })
  await boundedBrowserOperation(() => entry.view.webContents.loadURL(url), {
    signal: abort,
    timeout: 30_000,
    aborted: () => browserError("aborted", "The browser navigation was aborted.", true),
    timedOut: () => browserError("timeout", "The browser navigation timed out.", true),
  })
    .catch((error) => {
      if (abort?.aborted) throw browserError("aborted", "The browser navigation was aborted.", true)
      if (error instanceof Error && "code" in error) throw error
      throw browserError("navigation_failed", String(error), true)
    })
    .finally(() => abort?.removeEventListener("abort", onAbort))
  throwIfAborted(abort)
  verify?.()
  publishState(entry)
}

async function snapshot(
  entry: Entry,
  generation: number,
  abort?: AbortSignal,
  verify?: () => void,
): Promise<BrowserControl.Result> {
  throwIfAborted(abort)
  await debuggerCommand(entry, "Accessibility.enable", undefined, abort)
  const response = await debuggerCommand(entry, "Accessibility.getFullAXTree", undefined, abort)
  verify?.()
  throwIfAborted(abort)
  assertDocument(entry, generation)
  const nodes = readAXNodes(response).slice(0, 500)
  const parents = new Map(nodes.flatMap((node) => (node.nodeId ? [[node.nodeId, node.parentId] as const] : [])))
  const depth = (node: AXNode) => {
    let current = node.parentId
    let value = 0
    while (current && value < 6) {
      value++
      current = parents.get(current)
    }
    return value
  }

  invalidateBrowserRefs(entry)
  let index = 0
  const lines = nodes.flatMap((node) => {
    if (node.ignored) return []
    const role = axString(node.role) || "node"
    const name = axString(node.name)
    const value = axString(node.value)
    const focusable = node.properties?.some(
      (property) => property.name === "focusable" && property.value?.value === true,
    )
    const interactive = interactiveRoles.has(role) || focusable
    if (!interactive && !readableRoles.has(role)) return []
    if (!interactive && !name && !value) return []
    const ref = interactive && typeof node.backendDOMNodeId === "number" ? `@e${++index}` : undefined
    if (ref && node.backendDOMNodeId) {
      entry.refs.set(ref, { snapshot: entry.snapshot, backendNodeID: node.backendDOMNodeId })
    }
    const properties = node.properties?.flatMap((property) => {
      const name = String(property.name)
      if (!["checked", "disabled", "expanded", "selected"].includes(name)) return []
      return [`${name}=${String(property.value?.value)}`]
    })
    const detail = [
      name ? JSON.stringify(name) : undefined,
      value && value !== name ? `value=${JSON.stringify(value)}` : undefined,
    ]
      .filter((item): item is string => item !== undefined)
      .join(" ")
    return [
      `${"  ".repeat(depth(node))}${ref ? `${ref} ` : ""}[${role}]${detail ? ` ${detail}` : ""}${properties?.length ? ` ${properties.join(" ")}` : ""}`,
    ]
  })
  const content = [
    `Page: ${entry.view.webContents.getTitle()}`,
    `URL: ${entry.view.webContents.getURL()}`,
    "",
    ...lines,
  ]
    .join("\n")
    .slice(0, 40 * 1024)
  assertDocument(entry, generation)
  verify?.()
  return { type: "snapshot", state: contractState(publishState(entry), entry.document), content }
}

async function click(entry: Entry, ref: string, generation: number, abort: AbortSignal, verify: () => void) {
  const node = resolveRef(entry, ref)
  await debuggerCommand(entry, "DOM.scrollIntoViewIfNeeded", { backendNodeId: node.backendNodeID }, abort)
  verify()
  assertDocument(entry, generation)
  const response = await debuggerCommand(entry, "DOM.getBoxModel", { backendNodeId: node.backendNodeID }, abort)
  verify()
  const quad = readBoxQuad(response)
  const point = {
    x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4,
    y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4,
  }
  throwIfAborted(abort)
  assertDocument(entry, generation)
  await debuggerCommand(entry, "Input.dispatchMouseEvent", { type: "mouseMoved", ...point }, abort)
  verify()
  assertDocument(entry, generation)
  await runBrowserInputPair({
    assert: () => {
      verify()
      assertDocument(entry, generation)
    },
    press: () =>
      debuggerCommand(
        entry,
        "Input.dispatchMouseEvent",
        { type: "mousePressed", button: "left", clickCount: 1, ...point },
        abort,
      ).then(() => undefined),
    release: () =>
      debuggerCommand(entry, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        button: "left",
        clickCount: 1,
        ...point,
      }).then(() => undefined),
  })
}

async function fill(
  entry: Entry,
  ref: string,
  text: string,
  generation: number,
  abort: AbortSignal,
  verify: () => void,
) {
  if (text.length > 10_000) {
    throw browserError("result_too_large", "Browser fill text exceeds 10,000 characters.", false)
  }
  throwIfAborted(abort)
  const node = resolveRef(entry, ref)
  await debuggerCommand(entry, "DOM.focus", { backendNodeId: node.backendNodeID }, abort)
  verify()
  assertDocument(entry, generation)
  const modifiers = process.platform === "darwin" ? 4 : 2
  const assert = () => {
    verify()
    assertDocument(entry, generation)
  }
  await runBrowserInputPair({
    assert,
    press: () =>
      debuggerCommand(
        entry,
        "Input.dispatchKeyEvent",
        { type: "keyDown", key: "a", code: "KeyA", modifiers },
        abort,
      ).then(() => undefined),
    release: () =>
      debuggerCommand(entry, "Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers }).then(
        () => undefined,
      ),
  })
  await runBrowserInputPair({
    assert,
    press: () =>
      debuggerCommand(
        entry,
        "Input.dispatchKeyEvent",
        { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
        abort,
      ).then(() => undefined),
    release: () =>
      debuggerCommand(entry, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Backspace",
        code: "Backspace",
        windowsVirtualKeyCode: 8,
      }).then(() => undefined),
  })
  await debuggerCommand(entry, "Input.insertText", { text }, abort)
  verify()
}

async function press(
  entry: Entry,
  key: Extract<BrowserControl.Command, { readonly type: "press" }>["key"],
  generation: number,
  abort: AbortSignal,
  verify: () => void,
) {
  throwIfAborted(abort)
  assertDocument(entry, generation)
  const info = keyInfo(key)
  await runBrowserInputPair({
    assert: () => {
      verify()
      assertDocument(entry, generation)
    },
    press: () =>
      debuggerCommand(entry, "Input.dispatchKeyEvent", { type: "keyDown", ...info }, abort).then(() => undefined),
    release: () => debuggerCommand(entry, "Input.dispatchKeyEvent", { type: "keyUp", ...info }).then(() => undefined),
  })
}

async function scroll(
  entry: Entry,
  direction: Extract<BrowserControl.Command, { readonly type: "scroll" }>["direction"],
  amount: number,
  generation: number,
  abort: AbortSignal,
  verify: () => void,
) {
  throwIfAborted(abort)
  assertDocument(entry, generation)
  const bounds = entry.view.getBounds()
  const distance = Math.min(2000, Math.max(1, amount))
  await debuggerCommand(
    entry,
    "Input.dispatchMouseEvent",
    {
      type: "mouseWheel",
      x: Math.max(0, Math.round(bounds.width / 2)),
      y: Math.max(0, Math.round(bounds.height / 2)),
      deltaX: direction === "left" ? -distance : direction === "right" ? distance : 0,
      deltaY: direction === "up" ? -distance : direction === "down" ? distance : 0,
    },
    abort,
  )
  verify()
}

async function screenshot(
  entry: Entry,
  generation: number,
  abort?: AbortSignal,
  verify?: () => void,
): Promise<BrowserControl.Result> {
  throwIfAborted(abort)
  const source = await entry.view.webContents.capturePage()
  verify?.()
  throwIfAborted(abort)
  assertDocument(entry, generation)
  verify?.()
  const size = source.getSize()
  const scale = Math.min(1, 2000 / Math.max(size.width, size.height))
  const image =
    scale < 1
      ? source.resize({
          width: Math.round(size.width * scale),
          height: Math.round(size.height * scale),
          quality: "good",
        })
      : source
  const output = image.toPNG()
  if (output.byteLength > 5 * 1024 * 1024) {
    throw browserError("result_too_large", "The browser screenshot exceeds 5 MiB.", false)
  }
  const dimensions = image.getSize()
  assertDocument(entry, generation)
  verify?.()
  return {
    type: "screenshot",
    state: contractState(publishState(entry), entry.document),
    data: output.toString("base64"),
    width: dimensions.width,
    height: dimensions.height,
  }
}

function resolveRef(entry: Entry, ref: string) {
  const node = entry.refs.get(normalizeBrowserRef(ref))
  if (!node || node.snapshot !== entry.snapshot) {
    throw browserError("stale_ref", "The element reference is stale. Call browser_snapshot again.", true)
  }
  return node
}

async function debuggerCommand(entry: Entry, method: string, params?: Record<string, unknown>, abort?: AbortSignal) {
  throwIfAborted(abort)
  const api = entry.view.webContents.debugger
  if (!api.isAttached()) api.attach("1.3")
  return boundedBrowserOperation(() => api.sendCommand(method, params), {
    signal: abort,
    timeout: debuggerCommandTimeout,
    aborted: () => browserError("aborted", "The browser action was aborted.", true),
    timedOut: () => browserError("timeout", "The browser command timed out.", true),
  })
}

function readAXNodes(input: unknown): AXNode[] {
  if (!record(input) || !Array.isArray(input.nodes)) throw new Error("Invalid accessibility snapshot response")
  return input.nodes.filter(record) as AXNode[]
}

function readBoxQuad(input: unknown) {
  if (!record(input) || !record(input.model)) throw new Error("Invalid DOM.getBoxModel response")
  const quad = input.model.border ?? input.model.content
  if (!Array.isArray(quad) || quad.length < 8 || !quad.every((value) => typeof value === "number")) {
    throw new Error("Browser element has no clickable bounds")
  }
  return quad
}

function axString(input: { readonly value?: unknown } | undefined) {
  if (typeof input?.value === "string") return input.value.replaceAll(/\s+/g, " ").trim()
  if (typeof input?.value === "number" || typeof input?.value === "boolean") return String(input.value)
  return ""
}

function keyInfo(key: Extract<BrowserControl.Command, { readonly type: "press" }>["key"]) {
  const value = key === "Space" ? " " : key
  const code = key === "Space" ? "Space" : key
  const windowsVirtualKeyCode =
    key === "Enter"
      ? 13
      : key === "Tab"
        ? 9
        : key === "Escape"
          ? 27
          : key === "Backspace"
            ? 8
            : key === "Delete"
              ? 46
              : key === "Space"
                ? 32
                : undefined
  return { key: value, code, ...(windowsVirtualKeyCode ? { windowsVirtualKeyCode } : {}) }
}

function publishState(entry: Entry) {
  const contents = entry.view.webContents
  const state = {
    url: contents.getURL(),
    title: contents.getTitle(),
    loading: contents.isLoading(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
  }
  entry.state = state
  if (!entry.win.isDestroyed()) entry.win.webContents.send("browser-pane-state", state)
  return state
}

function contractState(state: BrowserPaneState, generation: number): BrowserControl.State {
  return {
    url: state.url,
    title: state.title,
    loading: state.loading,
    canGoBack: state.canGoBack,
    canGoForward: state.canGoForward,
    generation,
  }
}

function emptyState(): BrowserPaneState {
  return { url: "", title: "", loading: false, canGoBack: false, canGoForward: false }
}

function enqueue<T>(entry: Entry, run: () => Promise<T>) {
  const result = entry.queue.then(run, run)
  entry.queue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

function assertActive(
  entry: Entry,
  sessionID: string,
  lease: string | undefined,
  attachment: number,
  abort?: AbortSignal,
) {
  throwIfAborted(abort)
  if (!entry.attached || entry.sessionID !== sessionID || entry.lease !== lease || entry.attachment !== attachment) {
    throw browserError("not_attached", "The browser pane is no longer attached to this session.", true)
  }
}

function cancelEntry(entry: Entry) {
  entry.attachment++
  invalidateBrowserRefs(entry)
  entry.active?.abort()
  entry.active = undefined
  for (const request of entry.requests) request.abort()
  entry.requests.clear()
  if (!entry.view.webContents.isDestroyed()) entry.view.webContents.stop()
}

async function active<T>(entry: Entry, controller: AbortController, run: () => Promise<T>) {
  entry.active = controller
  try {
    return await run()
  } finally {
    if (entry.active === controller) entry.active = undefined
  }
}

function detach(entry: Entry) {
  if (entry.attached || entry.sessionID || entry.lease) cancelEntry(entry)
  entry.attached = false
  entry.sessionID = undefined
  entry.lease = undefined
  hideEntry(entry)
}

function hideEntry(entry: Entry) {
  entry.view.setVisible(false)
  for (const mask of entry.masks) mask.setVisible(false)
}

function assertDocument(entry: Entry, generation: number) {
  if (entry.document !== generation) {
    throw browserError("stale_ref", "The browser page changed. Call browser_snapshot again.", true)
  }
}

function throwIfAborted(abort?: AbortSignal) {
  if (abort?.aborted) throw browserError("aborted", "The browser action was aborted.", true)
}

function browserError(code: BrowserControl.ErrorCode, message: string, retryable: boolean) {
  return Object.assign(new Error(message), { code, retryable })
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
