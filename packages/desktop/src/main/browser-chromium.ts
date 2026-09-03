import { Browser } from "@opencode-ai/schema/browser"
import electron, { type BrowserWindow, type WebContents } from "electron"
import type { Protocol } from "devtools-protocol"
import { Schema } from "effect"
import { createCdp, abortError, waitFor } from "./browser/cdp"
import { createBrowserFiles } from "./browser/files"
import { createDiagnostics } from "./browser/diagnostics"
import { createProfiling } from "./browser/profiling"

type Element = { backendID: number; frameID: string; sessionID?: string }
let nextRef = 0
// Captures and downloads belong to the tab, not whichever document it now shows.
const retainedOperations = new Set<Browser.Method>([
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
])
export type BrowserPage = ReturnType<typeof createBrowserPage>

export function createBrowserPage(
  win: BrowserWindow,
  options: {
    id: Browser.TabID
    partition: string
    publish: (error?: string) => void
    fail: () => void
    popup: (options: Electron.BrowserWindowConstructorOptions) => WebContents
    initialize?: boolean
    popupOptions?: Electron.BrowserWindowConstructorOptions
  },
) {
  const view = new electron.WebContentsView({
    ...options.popupOptions,
    webPreferences: {
      partition: options.partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      devTools: false,
      backgroundThrottling: false,
    },
  })
  const contents = view.webContents
  const cdp = createCdp(contents)
  const files = createBrowserFiles()
  const diagnostics = createDiagnostics(cdp)
  const profiling = createProfiling(contents, cdp, files)
  const refs = new Map<string, Element>()
  const sessions = new Map<string, string>()
  const parents = new Map<string, string>()
  const contexts = new Map<string, { id: number; sessionID?: string }>()
  const dialogs = new Set<() => void>()
  let dialog: { type: string; message: string; defaultValue: string } | null = null
  let generation = 0
  let closed = false
  const state = (): Browser.Tab => ({
    id: options.id,
    url: contents.getURL().slice(0, 16_384),
    title: contents.getTitle().slice(0, 2_048),
    loading: contents.isLoading(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
    generation,
  })
  const publish = () => {
    if (!closed) options.publish()
  }
  const reset = (event: Electron.Event<{ isMainFrame: boolean; isSameDocument: boolean }>) => {
    if (!event.isMainFrame || event.isSameDocument) return
    generation++
    refs.clear()
    diagnostics.clear()
    publish()
  }
  contents.on("did-start-navigation", reset)
  contents.on("did-stop-loading", publish)
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
  const guard = (event: Electron.Event<{ url: string }>) => {
    if (event.url === "about:blank" || destinationOrigin(event.url)) return
    event.preventDefault()
    options.publish("ERR_BLOCKED_BY_CLIENT")
  }
  contents.on("will-frame-navigate", guard)
  contents.on("will-redirect", guard)
  contents.setWindowOpenHandler(({ url }) =>
    url === "about:blank" || destinationOrigin(url)
      ? {
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
              partition: options.partition,
            },
          },
          createWindow: (popupOptions) => options.popup(popupOptions),
        }
      : { action: "deny" },
  )
  const download = (_event: Electron.Event, item: Electron.DownloadItem, source: WebContents) => {
    if (source !== contents) return
    try {
      const file = files.add(item.getFilename(), item.getMimeType() || "application/octet-stream")
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
      options.publish("download_failed")
    }
  }
  contents.session.on("will-download", download)
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
    ]).catch(() => undefined)
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
    dialog = {
      type: event.type,
      message: event.message.slice(0, Browser.MAX_TEXT),
      defaultValue: event.defaultPrompt ?? "",
    }
    dialogs.forEach((reject) => reject())
    publish()
  })
  cdp.on("Page.javascriptDialogClosed", () => {
    dialog = null
    publish()
  })
  view.setBounds({ x: 0, y: 0, width: 1000, height: 700 })
  view.setVisible(false)
  view.setBorderRadius(10)
  win.contentView.addChildView(view)
  const ready = Promise.all([
    files.ready,
    ...(options.initialize === false ? [] : [contents.loadURL("about:blank")]),
    diagnostics.enable(),
    cdp.send("Page.enable"),
    cdp.send("DOM.enable"),
    cdp.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
      filter: [{ type: "iframe", exclude: false }, { exclude: true }],
    }),
  ]).then(() => undefined)

  return {
    view,
    contents,
    state,
    ready,
    async execute(command: Browser.Command, signal: AbortSignal): Promise<Browser.Result> {
      await ready
      abortError(signal)
      if (closed) throw new Error("Browser tab was closed.")
      if (
        command.generation !== undefined &&
        command.generation !== generation &&
        !retainedOperations.has(command.action.type)
      )
        throw new Error("The document changed. Take a new snapshot and retry deliberately.")
      if (dialog && command.action.type !== "dialog")
        throw new Error("A JavaScript dialog is open. Use browser.dialog before continuing.")
      const modal = Promise.withResolvers<never>()
      const cancelled = Promise.withResolvers<never>()
      const cancel = () => cancelled.reject(new Error("Browser operation was cancelled."))
      signal.addEventListener("abort", cancel, { once: true })
      const reject = () =>
        modal.reject(new Error("A JavaScript dialog opened. Use browser.dialog to accept or dismiss it."))
      if (command.action.type !== "dialog") dialogs.add(reject)
      try {
        return await Promise.race([execute(command.action, command.files, signal), modal.promise, cancelled.promise])
      } finally {
        signal.removeEventListener("abort", cancel)
        dialogs.delete(reject)
      }
    },
    async dispose() {
      if (closed) return
      closed = true
      contents.session.off("will-download", download)
      await profiling.dispose()
      cdp.dispose()
      refs.clear()
      if (!win.isDestroyed()) win.contentView.removeChildView(view)
      if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false })
      await files.dispose()
    },
  }

  async function execute(
    action: Browser.Action,
    transfers: readonly Browser.File[],
    signal: AbortSignal,
  ): Promise<Browser.Result> {
    const result = (value: unknown, attached: Browser.File[] = []): Browser.Result => {
      const json = Schema.decodeUnknownSync(Schema.Json)(value)
      if (JSON.stringify(json).length > 512_000)
        throw new Error("Result is too large. Request fewer entries or a smaller snapshot.")
      return { value: json, files: attached }
    }
    switch (action.type) {
      case "navigate": {
        const url = normalizeURL(action.url)
        const cancel = () => contents.stop()
        signal.addEventListener("abort", cancel, { once: true })
        try {
          await contents.loadURL(url)
        } finally {
          signal.removeEventListener("abort", cancel)
        }
        abortError(signal)
        return result(state())
      }
      case "back":
      case "forward":
      case "reload":
      case "stop": {
        if (action.type === "back" && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
        if (action.type === "forward" && contents.navigationHistory.canGoForward())
          contents.navigationHistory.goForward()
        if (action.type === "reload") contents.reload()
        if (action.type === "stop") contents.stop()
        if (action.type !== "stop") await waitFor(() => !contents.isLoading(), signal, 30_000)
        return result(state())
      }
      case "frames":
        return result({ tab: state(), frames: await frames() })
      case "snapshot":
      case "find":
        return result({ tab: state(), ...(await snapshot(action)) })
      case "evaluate": {
        const context = action.frameID ? contexts.get(action.frameID) : undefined
        if (action.frameID && !context) throw new Error("Frame context is unavailable. Call browser.frames again.")
        const value = await cdp.send(
          "Runtime.evaluate",
          {
            expression: action.script,
            contextId: context?.id,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true,
          },
          context?.sessionID,
        )
        if (value.exceptionDetails)
          throw new Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text)
        abortError(signal)
        return result({ tab: state(), value: value.result.value ?? null })
      }
      case "click":
        await click(target(action.ref), action.button ?? "left", action.count ?? 1, action.modifiers)
        break
      case "hover":
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...(await point(target(action.ref))) })
        break
      case "drag": {
        const source = target(action.from)
        const destination = target(action.to)
        await point(destination)
        const from = await point(source)
        const box = await rect(destination)
        const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        const html5 = await call(source, "function() { return this.draggable; }")
        let data: Protocol.Input.DragData | undefined
        const off = cdp.on("Input.dragIntercepted", (event) => {
          data = event.data
        })
        await cdp.send("Input.setInterceptDrags", { enabled: true })
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...from })
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          ...from,
          button: "left",
          buttons: 1,
          clickCount: 1,
        })
        try {
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
        await fill(target(action.ref), action.text)
        break
      case "fill_form":
        for (const field of action.fields) {
          abortError(signal)
          if (field.type === "text") await fill(target(field.ref), field.value)
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
        const bounds = view.getBounds()
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: bounds.width / 2,
          y: bounds.height / 2,
          deltaX: action.deltaX ?? 0,
          deltaY: action.deltaY,
        })
        break
      }
      case "wait": {
        if (action.condition !== "load" && !action.text) throw new Error("text is required for a text/textGone wait.")
        await waitFor(
          async () => {
            if (action.condition === "load") return !contents.isLoading()
            const context = action.frameID ? contexts.get(action.frameID) : undefined
            if (action.frameID && !context) throw new Error("Frame context is unavailable.")
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
        )
        break
      }
      case "screenshot": {
        if (action.ref && action.fullPage) throw new Error("Choose an element ref or fullPage, not both.")
        const metrics = await cdp.send("Page.getLayoutMetrics")
        const bounds = action.ref
          ? await rect(target(action.ref))
          : action.fullPage
            ? metrics.cssContentSize
            : {
                x: metrics.cssVisualViewport.pageX,
                y: metrics.cssVisualViewport.pageY,
                width: metrics.cssVisualViewport.clientWidth,
                height: metrics.cssVisualViewport.clientHeight,
              }
        const scale = Math.min(1, (action.maxWidth ?? 2000) / bounds.width)
        if (!bounds.width || !bounds.height || bounds.width * bounds.height * scale * scale > 16_000_000)
          throw new Error("Screenshot exceeds 16 megapixels; capture an element or use a smaller maxWidth.")
        const format = action.format ?? "png"
        const capture = await cdp.send("Page.captureScreenshot", {
          format,
          quality: format === "png" ? undefined : (action.quality ?? 80),
          captureBeyondViewport: true,
          clip: { ...bounds, scale },
        })
        const id = await files.save(`screenshot.${format}`, `image/${format}`, Buffer.from(capture.data, "base64"))
        return result({ tab: state() }, [await files.transfer(id)])
      }
      case "dialog": {
        if (action.action !== "get") {
          if (!dialog) throw new Error("This tab has no JavaScript dialog.")
          await cdp.send("Page.handleJavaScriptDialog", {
            accept: action.action === "accept",
            promptText: action.promptText,
          })
          dialog = null
        }
        return result({ tab: state(), dialog })
      }
      case "files.upload":
      case "files.drop": {
        if (!transfers.length) throw new Error("Upload did not include file bytes from the server.")
        const local = await Promise.all(
          transfers.map(async (file) => files.get(await files.save(file.name, file.mime, file.data)).path),
        )
        const element = target(action.ref)
        if (action.type === "files.upload")
          await cdp.send("DOM.setFileInputFiles", { files: local, backendNodeId: element.backendID }, element.sessionID)
        if (action.type === "files.drop") {
          const position = await point(element)
          for (const type of ["dragEnter", "dragOver", "drop"])
            await cdp.send("Input.dispatchDragEvent", {
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
        return result({ tab: state() }, [await files.transfer(action.fileID)])
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
          await files.transfer(value.id),
        ])
      }
      case "cpu.start":
        await profiling.startCpu()
        return result({ tab: state(), recording: true })
      case "cpu.stop": {
        const value = await profiling.stopCpu()
        return result({ tab: state(), durationMs: value.durationMs }, [await files.transfer(value.id)])
      }
      case "heap.snapshot":
        return result({ tab: state() }, [await files.transfer(await profiling.heap())])
      case "trace.analyze":
      case "cpu.analyze":
      case "heap.summary":
      case "heap.query":
      case "heap.object":
      case "heap.compare":
        return result({ tab: state(), ...(await profiling.analyze(action)) })
      case "lighthouse": {
        const { audit } = await import("./browser/lighthouse")
        const report = await audit(contents, files, cdp)
        return result(
          { tab: state(), scores: report.scores, failures: report.failures },
          await Promise.all(report.files.map((id) => files.transfer(id))),
        )
      }
      default:
        throw new Error("Tab management is handled by the browser session, not a page.")
    }
    abortError(signal)
    return result(state())
  }

  function target(ref: Browser.Ref): Element {
    const value = refs.get(ref.replace(/^@/, ""))
    if (!value) throw new Error("Element ref is stale or belongs to another tab. Take a new snapshot.")
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
    const object = await cdp.send("DOM.resolveNode", { backendNodeId: element.backendID }, element.sessionID)
    const objectId = object.object.objectId
    if (!objectId) throw new Error("Element is no longer available.")
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

  async function rect(element: Element, scroll = false) {
    if (scroll) {
      await cdp.send("DOM.scrollIntoViewIfNeeded", { backendNodeId: element.backendID }, element.sessionID)
      // Force a compositor update after scrolling. requestAnimationFrame can
      // stall in a hidden WebContentsView, even with background throttling off.
      await contents.capturePage(undefined, { stayHidden: false, stayAwake: true })
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
      const owner = await cdp.send("DOM.getFrameOwner", { frameId: frame.id }, sessions.get(frame.parentID))
      const offset = Schema.decodeUnknownSync(shape)(
        await call(
          { backendID: owner.backendNodeId, frameID: frame.parentID, sessionID: sessions.get(frame.parentID) },
          "function() { const r = this.getBoundingClientRect(); return {x:r.x+this.clientLeft,y:r.y+this.clientTop,width:r.width,height:r.height}; }",
        ),
      )
      value.x += offset.x
      value.y += offset.y
      frame = tree.find((item) => item.id === frame?.parentID)
    }
    return value
  }

  async function point(element: Element) {
    const box = await rect(element, true)
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }

  async function click(element: Element, button = "left", count = 1, modifiers: readonly string[] = []) {
    const position = await point(element)
    const flags = modifiers.reduce((mask, key) => mask | ({ Alt: 1, Control: 2, Meta: 4, Shift: 8 }[key] ?? 0), 0)
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...position, modifiers: flags })
    for (let clickCount = 1; clickCount <= count; clickCount++) {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        ...position,
        button,
        clickCount,
        modifiers: flags,
      })
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        ...position,
        button,
        clickCount,
        modifiers: flags,
      })
    }
  }

  async function fill(element: Element, value: string) {
    const editable = await call(
      element,
      "function() { return (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement || this.isContentEditable) && !this.disabled && !this.readOnly; }",
    )
    if (!editable) throw new Error("Element is not an editable field.")
    await cdp.send("DOM.focus", { backendNodeId: element.backendID }, element.sessionID)
    await key(process.platform === "darwin" ? "Meta+A" : "Control+A")
    await key("Backspace")
    await cdp.send("Input.insertText", { text: value })
  }

  async function select(element: Element, values: readonly string[]) {
    await call(
      element,
      `function(values) { if (!(this instanceof HTMLSelectElement) || this.disabled) throw new Error('Element is not an enabled select.'); if (!this.multiple && values.length !== 1) throw new Error('Select accepts one value.'); for (const value of values) if (!Array.from(this.options).some(option => option.value === value && !option.disabled)) throw new Error('Option value was not found.'); for (const option of this.options) option.selected = values.includes(option.value); this.dispatchEvent(new Event('input',{bubbles:true})); this.dispatchEvent(new Event('change',{bubbles:true})); }`,
      [values],
    )
  }

  async function check(element: Element, checked: boolean) {
    const current = await call(
      element,
      "function() { if (!(this instanceof HTMLInputElement) || !['checkbox','radio'].includes(this.type) || this.disabled) throw new Error('Element is not an enabled checkbox or radio.'); return this.checked; }",
    )
    if (current !== checked) await click(element)
    if ((await call(element, "function() { return this.checked; }")) !== checked)
      throw new Error("Element did not reach the requested checked state.")
  }

  async function key(chord: string) {
    const parts = chord.split("+")
    const key = parts.pop() ?? ""
    const modifiers = parts.reduce((mask, key) => {
      const bit = { Alt: 1, Control: 2, Meta: 4, Shift: 8 }[key]
      if (!bit) throw new Error(`Unknown key modifier: ${key}`)
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
      (key.length === 1
        ? key.toUpperCase().charCodeAt(0)
        : /^F([1-9]|1[0-2])$/.test(key)
          ? 111 + Number(key.slice(1))
          : undefined)
    if (code === undefined) throw new Error(`Unknown key: ${key}`)
    const params = {
      key: key === "Space" ? " " : key,
      windowsVirtualKeyCode: code,
      modifiers,
      ...(key.length === 1 && !(modifiers & 6) ? { text: key } : {}),
    }
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...params })
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...params })
  }

  async function snapshot(action: Extract<Browser.Action, { type: "snapshot" | "find" }>) {
    const tree = await frames()
    const selected = action.type === "snapshot" && action.ref ? target(action.ref) : undefined
    const frameID = selected?.frameID ?? action.frameID ?? tree[0]?.id
    if (!frameID || !tree.some((frame) => frame.id === frameID))
      throw new Error("Frame is unavailable. Call browser.frames again.")
    const sessionID = sessions.get(frameID)
    const depth = action.type === "snapshot" ? (action.depth ?? 8) : 8
    const ax = await cdp.send("Accessibility.getFullAXTree", { frameId: frameID, depth }, sessionID)
    const nodes = new Map(ax.nodes.map((node) => [node.nodeId, node]))
    const root = selected ? ax.nodes.find((node) => node.backendDOMNodeId === selected.backendID) : ax.nodes[0]
    if (!root) throw new Error("Element is absent from the accessibility snapshot.")
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
      const properties = new Map(node.properties?.map((property) => [property.name, property.value.value]) ?? [])
      if (!node.ignored) {
        const actionable =
          role !== "RootWebArea" &&
          (properties.get("focusable") || /^(button|link|textbox|combobox|checkbox|radio|option)$/.test(role))
        const ref = actionable && node.backendDOMNodeId ? `e${++nextRef}` : ""
        const element = node.backendDOMNodeId ? { backendID: node.backendDOMNodeId, frameID, sessionID } : undefined
        if (ref && element) refs.set(ref, element)
        const flags = (["checked", "disabled", "expanded", "selected"] as const).flatMap((name) =>
          properties.has(name) ? [`${name}=${properties.get(name)}`] : [],
        )
        const box =
          action.type === "snapshot" && action.boxes && ref && element
            ? await rect(element).catch(() => undefined)
            : undefined
        lines.push(
          `${"  ".repeat(level)}${ref ? `@${ref} ` : ""}[${role}] ${JSON.stringify(
            String(node.name?.value ?? "")
              .replace(/\s+/g, " ")
              .slice(0, 300),
          )} ${flags.join(" ")}${box ? ` box=${JSON.stringify(box)}` : ""}`,
        )
      }
      if (["textbox", "searchbox"].includes(role) || properties.get("editable")) return
      for (const childID of node.childIds ?? []) {
        const child = nodes.get(childID)
        if (child) await walk(child, level + 1)
      }
    }
    await walk(root, 0)
    const content = (
      action.type === "find" ? lines.filter((line) => line.toLowerCase().includes(action.text.toLowerCase())) : lines
    ).join("\n")
    return { content: content.slice(0, Browser.MAX_TEXT), truncated: truncated || content.length > Browser.MAX_TEXT }
  }
}

export function destinationOrigin(input: string) {
  if (!URL.canParse(input)) return
  const url = new URL(input)
  return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.origin : undefined
}

export function normalizeURL(input: string) {
  const value = input.trim() || "about:blank"
  const local = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value)
  const url =
    value === "about:blank" || /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `${local ? "http" : "https"}://${value}`
  if (url !== "about:blank" && !destinationOrigin(url))
    throw new Error("Only HTTP, HTTPS, and about:blank URLs are supported.")
  return url
}
