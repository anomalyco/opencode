// Page operations for one Chrome tab. Ported from packages/gui-extensions/src/browser/chromium.ts,
// which drives an Electron WebContents; this drives a real browser tab through chrome.debugger.
// Keep the operation semantics and agent-facing error text in step with the desktop version.
import { Browser } from "@opencode/plugin-browser/rpc"
import type { Protocol } from "devtools-protocol"
import { Schema } from "effect"
import { abortError, createCdp, waitFor } from "./cdp"
import { CURSOR } from "./cursor"
import { createDiagnostics } from "./diagnostics"
import { createBrowserFiles } from "./files"
import { normalizeURL } from "./policy"
import { createProfiling, type Recording } from "./profiling"

type Element = { backendID: number; frameID: string; sessionID?: string }

const mac = /mac/i.test(navigator.userAgent)
// Captures and downloads belong to the tab, not whichever document it now shows.
const retainedOperations: readonly Browser.Method[] = [
  "navigate",
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
// Lighthouse runs in Node on the desktop; it is not bundled into the extension.
const unsupportedOperations: readonly Browser.Method[] = ["lighthouse"]

export type BrowserPage = ReturnType<typeof createBrowserPage>

export function createBrowserPage(options: {
  tabId: number
  /** The tab's current inventory entry; the inventory owns url, title, loading, and generation. */
  state: () => Browser.Tab
  /** Allocates element refs; shared by every page of the attachment so refs never collide. */
  ref: () => string
  /** The debugger detached without this page closing (the user cancelled it, or the tab crashed). */
  detached: (reason: string) => void
  /** Navigation history changed; the inventory republishes state. */
  history: (value: { canGoBack: boolean; canGoForward: boolean }) => void
  /** The one performance trace the session may record at a time. */
  shared: { recording?: Recording }
}) {
  const cdp = createCdp(options.tabId, {
    detached: (reason) => {
      ready = undefined
      sessions.clear()
      parents.clear()
      contexts.clear()
      options.detached(reason)
    },
  })
  const diagnostics = createDiagnostics(cdp)
  const documents = new Map<string, string>()
  const sourceURLs = () => [...new Set([options.state().url, ...documents.values()])].sort()
  const files = createBrowserFiles({ source: sourceURLs, readBlob })
  const profiling = createProfiling({ tabId: options.tabId, cdp, files, source: sourceURLs, shared: options.shared })
  const refs = new Map<string, Element>()
  const sessions = new Map<string, string>()
  const parents = new Map<string, string>()
  const contexts = new Map<string, { id: number; sessionID?: string }>()
  const dialogs = new Set<() => void>()
  let dialog: { type: string; message: string; defaultValue: string } | null = null
  let dialogURL = ""
  let dialogRevision = 0
  let revision = 0
  let closed = false
  let ready: Promise<void> | undefined

  cdp.on("Page.frameNavigated", ({ frame }) => {
    documents.set(frame.id, frame.url)
    revision++
    if (!frame.parentId) void refreshHistory()
  })
  cdp.on("Page.navigatedWithinDocument", () => void refreshHistory())
  cdp.on("Page.frameDetached", ({ frameId }) => {
    documents.delete(frameId)
    revision++
  })
  cdp.on("Runtime.executionContextCreated", ({ context }, sessionID) => {
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
      cdp.send("Target.setAutoAttach", autoAttach, sessionId),
    ]).catch(() => undefined)
  })
  cdp.on("Target.detachedFromTarget", ({ sessionId }) => {
    sessions.forEach((id, frameID) => {
      if (id !== sessionId) return
      sessions.delete(frameID)
      parents.delete(frameID)
    })
  })
  cdp.on("Page.javascriptDialogOpening", (event) => {
    dialogURL = event.url
    dialogRevision++
    dialog = { type: event.type, message: event.message.slice(0, Browser.MAX_TEXT), defaultValue: event.defaultPrompt ?? "" }
    dialogs.forEach((reject) => reject())
  })
  cdp.on("Page.javascriptDialogClosed", () => {
    dialogRevision++
    dialog = null
  })

  const prepare = () => {
    ready ??= Promise.all([
      diagnostics.enable(),
      cdp.send("Page.enable"),
      cdp.send("DOM.enable"),
      cdp.send("Target.setAutoAttach", autoAttach),
    ])
      .then(() => refreshHistory())
      .catch((error: unknown) => {
        ready = undefined
        throw error
      })
    return ready
  }

  return {
    /** A new document replaced the old one; refs, frames, and diagnostics belong to the old one. */
    reset() {
      refs.clear()
      documents.clear()
      diagnostics.clear()
      revision++
    },
    download: (item: chrome.downloads.DownloadItem) => files.download(item),
    downloadChanged: (item: chrome.downloads.DownloadItem) => files.downloadChanged(item),
    async execute(command: Browser.Command, signal: AbortSignal): Promise<Browser.Result> {
      abortError(signal)
      if (closed)
        throw new Error(
          "Browser tab was closed. Call browser.tabs.list({}) and choose an existing tabID; do not reuse the closed tab's refs.",
        )
      if (unsupportedOperations.includes(command.action.type)) throw new UnsupportedOperation()
      await prepare()
      if (dialog && command.action.type !== "dialog")
        throw new Error(
          'A JavaScript dialog is open. Inspect it with browser.dialog({tabID,action:"get"}), then explicitly accept or dismiss it before continuing.',
        )
      if (command.inspect) return { value: await inspect(command.action), files: [] }
      if (command.target && JSON.stringify(await inspect(command.action)) !== JSON.stringify(command.target))
        throw new Error(
          "Browser target changed while permission was pending. Take a fresh snapshot or listing and request the action again; it was not executed.",
        )
      if (
        command.generation !== undefined &&
        command.generation !== options.state().generation &&
        !retainedOperations.includes(command.action.type)
      )
        throw new Error(
          "The document changed before this operation ran. Call browser.tabs.list({}) to check its current URL, then browser.snapshot({tabID}) for fresh refs. Reconsider the action before retrying on the new page.",
        )
      const modal = Promise.withResolvers<never>()
      const cancelled = Promise.withResolvers<never>()
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
      const reject = () => {
        if (command.action.type !== "navigate") run.abort()
        modal.reject(
          new Error(
            'A JavaScript dialog opened while the action was running. Inspect it with browser.dialog({tabID,action:"get"}) and accept or dismiss it. Do not repeat the original action just to close the dialog.',
          ),
        )
      }
      if (command.action.type !== "dialog") dialogs.add(reject)
      try {
        return await Promise.race([
          execute(command.action, command.files, run.signal, command.target),
          modal.promise,
          cancelled.promise,
        ])
      } finally {
        signal.removeEventListener("abort", cancel)
        dialogs.delete(reject)
      }
    },
    async dispose() {
      if (closed) return
      closed = true
      refs.clear()
      await profiling.dispose()
      files.clear()
      await cdp.dispose()
    },
  }

  /** Reads a blob: download inside the page that created it, while it still exists. */
  async function readBlob(url: string) {
    const value = await cdp
      .send("Runtime.evaluate", {
        expression: `fetch(${JSON.stringify(url)}).then((r) => r.blob()).then((b) => b.size > ${Browser.MAX_FILE_BYTES} ? null : new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.readAsDataURL(b) })).catch(() => null)`,
        awaitPromise: true,
        returnByValue: true,
      })
      .catch(() => undefined)
    const encoded = value?.result.value
    return typeof encoded === "string" ? Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)) : null
  }

  async function refreshHistory() {
    if (!cdp.attached) return
    const history = await cdp.send("Page.getNavigationHistory").catch(() => undefined)
    if (!history) return
    options.history({
      canGoBack: history.currentIndex > 0,
      canGoForward: history.currentIndex < history.entries.length - 1,
    })
  }

  async function tab() {
    return chrome.tabs.get(options.tabId)
  }

  async function loaded(signal: AbortSignal, timeoutMs = 30_000) {
    // Chrome reports "loading" from navigation start until the load event.
    await waitFor(async () => (await tab()).status === "complete", signal, timeoutMs)
  }

  async function execute(
    action: Browser.Action,
    transfers: readonly Browser.File[],
    signal: AbortSignal,
    approved?: Browser.Target,
  ): Promise<Browser.Result> {
    const result = (value: unknown, attached: Browser.File[] = []): Browser.Result => {
      const json = Schema.decodeUnknownSync(Schema.Json)(value)
      if (JSON.stringify(json).length > 512_000)
        throw new Error(
          "Browser result exceeds 512000 JSON characters. Request fewer entries, reduce snapshot depth, or return only selected fields from the evaluation script. Repeating the same request will not reduce its output.",
        )
      return { value: json, files: attached }
    }
    switch (action.type) {
      case "navigate": {
        const url = normalizeURL(action.url)
        const cancel = () => void cdp.send("Page.stopLoading").catch(() => undefined)
        signal.addEventListener("abort", cancel, { once: true })
        try {
          const navigation = await cdp.send("Page.navigate", { url })
          if (navigation.errorText) throw new Error(navigation.errorText)
          await loaded(signal)
        } finally {
          signal.removeEventListener("abort", cancel)
        }
        abortError(signal)
        return result(options.state())
      }
      case "back":
      case "forward":
      case "reload":
      case "stop": {
        if (action.type === "back" && options.state().canGoBack) await chrome.tabs.goBack(options.tabId)
        if (action.type === "forward" && options.state().canGoForward) await chrome.tabs.goForward(options.tabId)
        if (action.type === "reload") await chrome.tabs.reload(options.tabId)
        if (action.type === "stop") await cdp.send("Page.stopLoading")
        if (action.type !== "stop") await loaded(signal)
        return result(options.state())
      }
      case "frames":
        return result({ tab: options.state(), frames: await frames() })
      case "snapshot":
      case "find":
        return result({ tab: options.state(), ...(await snapshot(action)) })
      case "evaluate": {
        if (action.ref && action.frameID)
          throw new Error(
            "Pass either ref or frameID to browser.evaluate, not both. A ref already runs in its element's frame.",
          )
        const context = action.frameID ? contexts.get(action.frameID) : undefined
        if (action.frameID && !context)
          throw new Error(
            "Frame context is unavailable. Call browser.frames({tabID}) and use a current frameID from this tab, or omit frameID to target the main frame.",
          )
        const element = action.ref ? target(action.ref) : undefined
        const objectId = element ? await resolve(element) : undefined
        const value = await (element && objectId
          ? cdp
              .send(
                "Runtime.callFunctionOn",
                {
                  objectId,
                  functionDeclaration: action.script,
                  arguments: [{ objectId }],
                  awaitPromise: true,
                  returnByValue: true,
                  userGesture: true,
                },
                element.sessionID,
              )
              .finally(() => cdp.send("Runtime.releaseObject", { objectId }, element.sessionID).catch(() => undefined))
          : cdp.send(
              "Runtime.evaluate",
              {
                expression: action.script,
                contextId: context?.id,
                awaitPromise: true,
                returnByValue: true,
                userGesture: true,
              },
              context?.sessionID,
            ))
        if (value.exceptionDetails)
          throw new Error(
            `Page JavaScript threw an exception. Check the script and ${action.ref ? "ref" : "frameID"}; inspect the page before repeating code with side effects. Details: ${(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text).slice(0, 800)}`,
          )
        abortError(signal)
        return result({ tab: options.state(), value: value.result.value ?? null })
      }
      case "click":
        await click(target(action.ref), action.button ?? "left", action.count ?? 1, action.modifiers)
        break
      case "hover": {
        const position = await point(target(action.ref))
        await cursor(position)
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...position })
        break
      }
      case "drag": {
        const source = target(action.from)
        const destination = target(action.to)
        await point(destination)
        const from = await point(source)
        const box = await rect(destination)
        const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        const html5 = await call(source, "function() { return this.draggable; }")
        await cursor(from, true)
        let data: Protocol.Input.DragData | undefined
        const off = cdp.on("Input.dragIntercepted", (event) => {
          data = event.data
        })
        await cdp.send("Input.setInterceptDrags", { enabled: true })
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...from })
        await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...from, button: "left", buttons: 1, clickCount: 1 })
        try {
          void cursor(to)
          for (let i = 1; i <= 10; i++) {
            abortError(signal)
            await cdp.send("Input.dispatchMouseEvent", {
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
          await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...to, button: "left", clickCount: 1 })
        }
        break
      }
      case "fill":
        await fill(target(action.ref), action.text, signal)
        break
      case "fill_form":
        for (const field of action.fields) {
          abortError(signal)
          if (field.type === "text") await fill(target(field.ref), field.value, signal)
          if (field.type === "select") await select(target(field.ref), field.values)
          if (field.type === "check") await check(target(field.ref), field.checked)
        }
        break
      case "select":
        await select(target(action.ref), action.values)
        break
      case "check":
        await check(target(action.ref), action.checked)
        break
      case "press":
        await key(action.key)
        break
      case "scroll": {
        const metrics = await cdp.send("Page.getLayoutMetrics")
        const center = { x: metrics.cssLayoutViewport.clientWidth / 2, y: metrics.cssLayoutViewport.clientHeight / 2 }
        await cursor(center)
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          ...center,
          deltaX: action.deltaX ?? 0,
          deltaY: action.deltaY,
        })
        break
      }
      case "wait": {
        if (action.condition !== "load" && !action.text)
          throw new Error(
            'browser.wait requires non-empty text for condition "text" or "textGone". Use condition "load" without text to wait for loading.',
          )
        await waitFor(
          async () => {
            if (action.condition === "load") return (await tab()).status === "complete"
            const context = action.frameID ? contexts.get(action.frameID) : undefined
            if (action.frameID && !context)
              throw new Error("Frame context is unavailable. Call browser.frames({tabID}) and use a frameID from this tab.")
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
          },
          signal,
          action.timeoutMs,
        ).catch((error) => {
          if (signal.aborted) throw error
          throw new Error(
            `browser.wait failed for condition ${JSON.stringify(action.condition)} (timeoutMs: ${action.timeoutMs ?? 10_000}). Inspect browser.snapshot({tabID}) and check text/frameID before retrying; timeoutMs can be increased up to 30000 for a genuinely slow page. Details: ${error instanceof Error ? error.message : String(error)}`,
          )
        })
        break
      }
      case "screenshot": {
        if (action.ref && action.fullPage)
          throw new Error(
            "Choose either ref for an element screenshot or fullPage:true for the whole page. Remove the other argument before retrying.",
          )
        // A background tab or minimized window has no rendered frame to capture.
        const current = await tab()
        const window = await chrome.windows.get(current.windowId)
        if (!current.active || window.state === "minimized")
          throw new Error("Screenshot needs a visible tab. Call browser.tabs.focus({tabID}) first, then retry.")
        const element = action.ref ? await rect(target(action.ref), true) : undefined
        const metrics = await cdp.send("Page.getLayoutMetrics")
        const bounds = element
          ? { ...element, x: element.x + metrics.cssVisualViewport.pageX, y: element.y + metrics.cssVisualViewport.pageY }
          : action.fullPage
            ? metrics.cssContentSize
            : {
                x: metrics.cssVisualViewport.pageX,
                y: metrics.cssVisualViewport.pageY,
                width: metrics.cssVisualViewport.clientWidth,
                height: metrics.cssVisualViewport.clientHeight,
              }
        const ratio = await cdp.send("Runtime.evaluate", { expression: "window.devicePixelRatio", returnByValue: true })
        const pixelRatio = Number(ratio.result.value) || 1
        const scale = Math.min(1, (action.maxWidth ?? 2000) / (bounds.width * pixelRatio))
        if (bounds.width <= 0 || bounds.height <= 0)
          throw new Error(
            "Element or page has no visible screenshot area. Take a fresh snapshot and choose a visible element, or omit ref to capture the viewport.",
          )
        if (bounds.width * bounds.height * (scale * pixelRatio) ** 2 > 16_000_000)
          throw new Error("Screenshot exceeds 16 megapixels; capture an element or use a smaller maxWidth.")
        const format = action.format ?? "png"
        const capture = await cdp.send("Page.captureScreenshot", {
          format,
          quality: format === "png" ? undefined : (action.quality ?? 80),
          captureBeyondViewport: true,
          clip: { ...bounds, scale },
        })
        const id = files.save(
          `screenshot.${format}`,
          `image/${format}`,
          Uint8Array.from(atob(capture.data), (char) => char.charCodeAt(0)),
        )
        return result({ tab: options.state() }, [await files.transfer(id)])
      }
      case "dialog": {
        if (action.action !== "get") {
          if (!dialog)
            throw new Error(
              'This tab has no JavaScript dialog to handle. browser.dialog({tabID,action:"get"}) returns null when none is open; continue without accepting or dismissing one.',
            )
          await cdp.send("Page.handleJavaScriptDialog", { accept: action.action === "accept", promptText: action.promptText })
          dialog = null
        }
        return result({ tab: options.state(), dialog })
      }
      case "files.upload":
      case "files.drop": {
        if (!transfers.length)
          throw new Error(
            "Upload command has no file bytes. Supply server-local paths to browser.files.upload/drop; if paths were supplied, report a client/server transfer mismatch.",
          )
        // The browser cannot read server files, and an extension cannot write local ones, so the bytes
        // become page-side File objects: assigned to a file input, or carried by synthetic drop events.
        const payload = transfers.map((file) => ({ name: file.name, mime: file.mime, data: base64(file.data) }))
        await call(
          target(action.ref),
          action.type === "files.upload"
            ? `function(files) { if (!(this instanceof HTMLInputElement) || this.type !== 'file' || this.disabled) throw new Error('Target is not an enabled file input. Call browser.snapshot({tabID}) and choose an input[type=file] ref for browser.files.upload, or use browser.files.drop for a drop area.'); if (!this.multiple && files.length > 1) throw new Error('This file input accepts one file; upload a single path.'); const transfer = new DataTransfer(); for (const file of files) transfer.items.add(new File([Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0))], file.name, { type: file.mime })); this.files = transfer.files; this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true })); }`
            : `function(files) { const transfer = new DataTransfer(); for (const file of files) transfer.items.add(new File([Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0))], file.name, { type: file.mime })); const r = this.getBoundingClientRect(); const init = { bubbles: true, cancelable: true, composed: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, dataTransfer: transfer }; for (const type of ['dragenter', 'dragover', 'drop']) this.dispatchEvent(new DragEvent(type, init)); }`,
          [payload],
        )
        break
      }
      case "files.list":
        return result({ tab: options.state(), files: files.list() })
      case "files.get":
        return result({ tab: options.state() }, [await files.transfer(action.fileID, approved?.resources)])
      case "trace.start":
        await profiling.startTrace(action.durationMs)
        return result({ tab: options.state(), recording: true })
      case "trace.stop": {
        const value = await profiling.stopTrace()
        return result({ tab: options.state(), durationMs: value.durationMs, incomplete: value.incomplete }, [
          await files.transfer(value.id),
        ])
      }
      case "cpu.start":
        await profiling.startCpu()
        return result({ tab: options.state(), recording: true })
      case "cpu.stop": {
        const value = await profiling.stopCpu()
        return result({ tab: options.state(), durationMs: value.durationMs }, [await files.transfer(value.id)])
      }
      case "heap.snapshot":
        return result({ tab: options.state() }, [await files.transfer(await profiling.heap())])
      case "trace.analyze":
      case "cpu.analyze":
      case "heap.summary":
      case "heap.query":
      case "heap.object":
      case "heap.compare":
        return result({ tab: options.state(), ...(await profiling.analyze(action)) })
      case "console":
        return result({ tab: options.state(), ...diagnostics.console(action) })
      case "network.list":
        return result({ tab: options.state(), ...diagnostics.list(action) })
      case "network.get":
        return result({ tab: options.state(), ...(await diagnostics.get(action)) })
      default:
        throw new Error(
          "This operation was routed to a page instead of the tab manager. Report an extension/plugin routing mismatch; changing tab IDs or repeating the operation will not fix it.",
        )
    }
    abortError(signal)
    return result(options.state())
  }

  async function inspect(action: Browser.Action): Promise<Browser.Target> {
    // Most CDP queries cannot run while a JavaScript dialog blocks the renderer.
    if (action.type === "dialog")
      return {
        resources: [dialog ? dialogURL : options.state().url],
        key: `${options.state().generation}:${dialogRevision}:${Boolean(dialog)}`,
      }
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
    const selected = (
      action.type === "drag"
        ? [action.from, action.to]
        : action.type === "fill_form"
          ? action.fields.map((field) => field.ref)
          : "ref" in action && action.ref
            ? [action.ref]
            : []
    ).map(target)
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
    return {
      resources: [
        ...new Set(
          action.type === "navigate"
            ? [new URL(normalizeURL(action.url)).href]
            : ["screenshot", "trace.start", "cpu.start", "heap.snapshot"].includes(action.type)
              ? sourceURLs()
              : urls.length
                ? urls
                : [options.state().url],
        ),
      ].sort(),
      key: JSON.stringify([options.state().generation, revision, selected]),
    }
  }

  function target(ref: Browser.Ref): Element {
    const value = refs.get(ref.replace(/^@/, ""))
    if (!value)
      throw new Error(
        "Element ref is stale or belongs to another tab. Call browser.snapshot({tabID}) and use a ref from that tab's newest snapshot. Do not reuse refs after navigation or a newer snapshot.",
      )
    return value
  }

  async function frames() {
    const root = await cdp.send("Page.getFrameTree")
    const result: { id: string; parentID?: string; url: string; name: string }[] = []
    const walk = (tree: Protocol.Page.FrameTree, parentID?: string) => {
      if (!result.some((frame) => frame.id === tree.frame.id))
        result.push({
          id: tree.frame.id,
          ...(tree.frame.parentId || parentID ? { parentID: tree.frame.parentId ?? parentID } : {}),
          url: tree.frame.url,
          name: tree.frame.name ?? "",
        })
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

  async function call(element: Element, functionDeclaration: string, args: unknown[] = []) {
    const objectId = await resolve(element)
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
      return result.result.value as unknown
    } finally {
      await cdp.send("Runtime.releaseObject", { objectId }, element.sessionID).catch(() => undefined)
    }
  }

  async function resolve(element: Element) {
    const object = await cdp.send("DOM.resolveNode", { backendNodeId: element.backendID }, element.sessionID)
    if (!object.object.objectId)
      throw new Error(
        "Element is no longer available. Call browser.snapshot({tabID}) and use a fresh ref; the page may have replaced the element.",
      )
    return object.object.objectId
  }

  async function rect(element: Element, scroll = false) {
    if (scroll) {
      await cdp.send("DOM.scrollIntoViewIfNeeded", { backendNodeId: element.backendID }, element.sessionID)
      await painted(element.sessionID)
    }
    const shape = Schema.Struct({ x: Schema.Finite, y: Schema.Finite, width: Schema.Finite, height: Schema.Finite })
    const value = {
      ...Schema.decodeUnknownSync(shape)(
        await call(
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
      const box = Schema.decodeUnknownSync(Schema.Struct({ ...shape.fields, scaleX: Schema.Finite, scaleY: Schema.Finite }))(
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

  async function point(element: Element) {
    const box = await rect(element, true)
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }

  async function click(element: Element, button = "left", count = 1, modifiers: readonly string[] = []) {
    const position = await point(element)
    const flags = modifiers.reduce((mask, key) => mask | ({ Alt: 1, Control: 2, Meta: 4, Shift: 8 }[key] ?? 0), 0)
    await cursor(position, true)
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...position, modifiers: flags })
    for (let clickCount = 1; clickCount <= count; clickCount++) {
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...position, button, clickCount, modifiers: flags })
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...position, button, clickCount, modifiers: flags })
    }
  }

  async function fill(element: Element, value: string, signal: AbortSignal) {
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
    await cursor(await point(element), true)
    await cdp.send("DOM.focus", { backendNodeId: element.backendID }, element.sessionID)
    // Focusing this field blurs the previous one; a validation dialog from that blur must stop here.
    abortError(signal)
    await key(mac ? "Meta+A" : "Control+A")
    await key("Backspace")
    abortError(signal)
    await cdp.send("Input.insertText", { text: value })
  }

  async function select(element: Element, values: readonly string[]) {
    await cursor(await point(element), true)
    await call(
      element,
      `function(values) { if (!(this instanceof HTMLSelectElement) || this.disabled) throw new Error('Target is not an enabled HTML select. Take a fresh snapshot and choose an enabled dropdown ref.'); if (!this.multiple && values.length !== 1) throw new Error('This dropdown accepts exactly one value; pass a one-item values array.'); for (const value of values) if (!Array.from(this.options).some(option => option.value === value && !option.disabled)) throw new Error('Option value was not found or is disabled. Inspect option values with browser.evaluate before retrying browser.select; values are not visible labels.'); for (const option of this.options) option.selected = values.includes(option.value); this.dispatchEvent(new Event('input',{bubbles:true})); this.dispatchEvent(new Event('change',{bubbles:true})); }`,
      [values],
    )
  }

  async function check(element: Element, checked: boolean) {
    const current = await call(
      element,
      "function(checked) { if (!(this instanceof HTMLInputElement) || !['checkbox','radio'].includes(this.type) || this.disabled) throw new Error('Target is not an enabled checkbox or radio. Take a fresh snapshot and choose the correct ref.'); if (this.type === 'radio' && this.checked && !checked) throw new Error('A selected radio cannot be cleared by clicking it. Select a different radio in its group instead.'); return this.checked; }",
      [checked],
    )
    if (current !== checked) await click(element)
    if ((await call(element, "function() { return this.checked; }")) !== checked)
      throw new Error(
        "The page did not keep the requested checked state. Inspect the current snapshot and page validation before retrying; do not blindly toggle the control again.",
      )
  }

  async function key(chord: string) {
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
    const codes: Record<string, number> = {
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
      (key.length === 1 ? key.toUpperCase().charCodeAt(0) : /^F([1-9]|1[0-2])$/.test(key) ? 111 + Number(key.slice(1)) : undefined)
    if (code === undefined)
      throw new Error(
        `Unknown key ${JSON.stringify(key)}. Use Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right, PageUp/Down, Home, End, Space, F1–F12, or one character. Use browser.fill for text.`,
      )
    // Named keys need their character data too: Enter submits forms and inserts newlines only with "\r".
    const text = key === "Enter" ? "\r" : key === "Space" ? " " : key.length === 1 ? key : undefined
    // Without native key commands, Chrome ignores editing shortcuts such as select-all from synthetic events.
    const commands = modifiers & (mac ? 4 : 2) && key.toLowerCase() === "a" ? { commands: ["selectAll"] } : {}
    const params = {
      key: key === "Space" ? " " : key,
      windowsVirtualKeyCode: code,
      modifiers,
      ...(text !== undefined && !(modifiers & 6) ? { text } : {}),
      ...commands,
    }
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...params })
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...params })
  }

  async function snapshot(action: Extract<Browser.Action, { type: "snapshot" | "find" }>) {
    const tree = await frames()
    const selected = action.type === "snapshot" && action.ref ? target(action.ref) : undefined
    const frameID = selected?.frameID ?? action.frameID ?? tree[0]?.id
    if (!frameID || !tree.some((frame) => frame.id === frameID))
      throw new Error(
        "Frame is unavailable. Call browser.frames({tabID}) and use a current frameID from this tab; omit frameID for the main frame.",
      )
    const sessionID = sessionFor(frameID, tree)
    const depth = action.type === "snapshot" ? (action.depth ?? 8) : 8
    const ax = await cdp.send("Accessibility.getFullAXTree", { frameId: frameID, depth }, sessionID)
    const nodes = new Map(ax.nodes.map((node) => [node.nodeId, node]))
    const root = selected ? ax.nodes.find((node) => node.backendDOMNodeId === selected.backendID) : ax.nodes[0]
    if (!root)
      throw new Error(
        "Element is absent from this frame's accessibility snapshot. Retry browser.snapshot with the same tabID and no ref to refresh the frame, then choose a returned ref.",
      )
    refs.clear()
    const lines: string[] = []
    let truncated = false
    const walk = async (node: Protocol.Accessibility.AXNode, level: number): Promise<void> => {
      if (level > depth || lines.length >= 500) {
        truncated = true
        return
      }
      const role = String(node.role?.value ?? "node")
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 40)
      // Each text run repeats its StaticText parent's name; listing both doubles the snapshot.
      if (role === "InlineTextBox") return
      const properties = new Map(node.properties?.map((property) => [property.name, property.value.value]) ?? [])
      if (!node.ignored) {
        const actionable =
          role !== "RootWebArea" &&
          (properties.get("focusable") || /^(button|link|textbox|combobox|checkbox|radio|option)$/.test(role))
        const ref = actionable && node.backendDOMNodeId ? options.ref() : ""
        const element = node.backendDOMNodeId ? { backendID: node.backendDOMNodeId, frameID, sessionID } : undefined
        if (ref && element) refs.set(ref, element)
        const flags = (["checked", "disabled", "expanded", "selected"] as const).flatMap((name) =>
          properties.has(name) ? [`${name}=${properties.get(name)}`] : [],
        )
        const box =
          action.type === "snapshot" && action.boxes && ref && element ? await rect(element).catch(() => undefined) : undefined
        lines.push(
          `${"  ".repeat(level)}${ref ? `@${ref} ` : ""}[${role}] ${JSON.stringify(
            String(node.name?.value ?? "")
              .replace(/\s+/g, " ")
              .slice(0, 300),
          )} ${flags.join(" ")}${box ? ` box=${JSON.stringify(box)}` : ""}`,
        )
      }
      if (["textbox", "searchbox"].includes(role) || properties.get("editable")) return
      // Adjacent text runs become one line. Pages that wrap each letter in its own element would
      // otherwise spend the whole line budget on single characters before reaching any control.
      let text: string[] = []
      const flush = () => {
        if (!text.length) return
        const joined = text.join("").replace(/\s+/g, " ").trim()
        text = []
        if (!joined) return
        if (lines.length >= 500) {
          truncated = true
          return
        }
        lines.push(`${"  ".repeat(level + 1)}[StaticText] ${JSON.stringify(joined.slice(0, 300))}`)
      }
      for (const childID of node.childIds ?? []) {
        const child = nodes.get(childID)
        if (!child) continue
        if (child.role?.value === "StaticText" && !child.ignored) {
          text.push(String(child.name?.value ?? ""))
          continue
        }
        flush()
        await walk(child, level + 1)
      }
      flush()
    }
    await walk(root, 0)
    const content = (
      action.type === "find" ? lines.filter((line) => line.toLowerCase().includes(action.text.toLowerCase())) : lines
    ).join("\n")
    return { content: content.slice(0, Browser.MAX_TEXT), truncated: truncated || content.length > Browser.MAX_TEXT }
  }

  /** Glides the visible agent cursor to a top-viewport point; drawing must never fail the action. */
  async function cursor(position: { x: number; y: number }, press = false) {
    await cdp
      .send("Runtime.evaluate", {
        expression: `(${CURSOR})(${position.x}, ${position.y}, ${press})`,
        awaitPromise: true,
        silent: true,
      })
      .catch(() => undefined)
  }

  // Wait for the compositor to apply a scroll before measuring; a stalled page must not hold input back.
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

export class UnsupportedOperation extends Error {}

const autoAttach = {
  autoAttach: true,
  waitForDebuggerOnStart: false,
  flatten: true,
  filter: [{ type: "iframe", exclude: false }, { exclude: true }],
}

function base64(data: Uint8Array) {
  let binary = ""
  for (let index = 0; index < data.length; index += 0x8000)
    binary += String.fromCharCode(...data.subarray(index, index + 0x8000))
  return btoa(binary)
}
