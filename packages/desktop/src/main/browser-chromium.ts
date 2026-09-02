import type { Browser } from "@opencode-ai/schema/browser"
import electron, { type BrowserWindow } from "electron"

type AXNode = {
  nodeId: string
  backendDOMNodeId?: number
  childIds?: string[]
  ignored?: boolean
  role?: { value?: string }
  name?: { value?: unknown }
  properties?: Array<{ name: string; value?: { value?: unknown } }>
}

export type BrowserPage = ReturnType<typeof createBrowserPage>

export function createBrowserPage(win: BrowserWindow, publish: (error?: string) => void, fail: () => void) {
  const view = new electron.WebContentsView({
    webPreferences: {
      partition: `opencode-browser-${crypto.randomUUID()}`,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      devTools: false,
      disableDialogs: true,
    },
  })
  const contents = view.webContents
  const refs = new Map<string, { id: number; editable: boolean }>()
  let generation = 0
  let nextRef = 0
  let closed = false
  const state = (): Browser.State => ({
    url: contents.getURL().slice(0, 16_384),
    title: contents.getTitle().slice(0, 1_024),
    loading: contents.isLoading(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
    generation,
  })
  const update = () => {
    if (!closed) publish()
  }
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.alt || !(process.platform === "darwin" ? input.meta : input.control)) return
    const step =
      input.key === "=" || input.key === "+" || input.code === "NumpadAdd"
        ? 0.5
        : input.key === "-" || input.code === "NumpadSubtract"
          ? -0.5
          : 0
    if (!step && input.key !== "0") return
    event.preventDefault()
    contents.setZoomLevel(input.key === "0" ? 0 : contents.getZoomLevel() + step)
  })
  const session = contents.session
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
  session.setDevicePermissionHandler(() => false)
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}))
  session.on("will-download", (event) => event.preventDefault())
  contents.setWindowOpenHandler(() => ({ action: "deny" }))
  contents.on("content-bounds-updated", (event) => event.preventDefault())
  const guard = (event: Electron.Event<{ url: string }>) => {
    if (event.url === "about:blank" || destinationOrigin(event.url)) return
    event.preventDefault()
    publish("ERR_BLOCKED_BY_CLIENT")
  }
  contents.on("will-frame-navigate", guard)
  contents.on("will-redirect", guard)
  contents.on("did-stop-loading", update)
  contents.on("did-navigate-in-page", update)
  contents.on("page-title-updated", update)
  contents.on("did-start-navigation", (event) => {
    if (!event.isMainFrame) return
    generation++
    refs.clear()
    update()
  })
  contents.on("did-fail-load", (_event, code, error, _url, mainFrame) => {
    if (!closed && mainFrame && code !== -3) publish(error)
  })
  contents.on("render-process-gone", () => {
    if (!closed) fail()
  })
  contents.debugger.on("detach", () => {
    if (!closed) fail()
  })
  view.setVisible(false)
  // Match the review pane card so the page does not leak past its rounded bottom corners.
  view.setBorderRadius(10)
  win.contentView.addChildView(view)
  return {
    view,
    state,
    execute,
    ready: Promise.resolve().then(() => contents.loadURL("about:blank")),
    dispose() {
      if (closed) return
      closed = true
      refs.clear()
      if (!win.isDestroyed()) win.contentView.removeChildView(view)
      if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false })
    },
  }

  async function execute(command: Browser.Command, signal: AbortSignal): Promise<Browser.Result> {
    const action = command.action
    check()
    if (action.type === "navigate") {
      await navigate(action.url, signal)
      return { type: "state", state: state() }
    }
    if (["open", "back", "forward", "reload", "stop"].includes(action.type)) {
      if (action.type === "stop") contents.stop()
      if (action.type === "reload") contents.reload()
      if (action.type === "back" && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
      if (action.type === "forward" && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
      return { type: "state", state: state() }
    }
    if (action.type === "evaluate") {
      const value: unknown = await contents.executeJavaScript(action.script)
      check()
      return { type: "evaluate", state: state(), content: (JSON.stringify(value) ?? "null").slice(0, 100_000) }
    }
    if (action.type === "snapshot") {
      const tree = (await send("Accessibility.getFullAXTree", { depth: 6 })) as { nodes: AXNode[] }
      refs.clear()
      const nodes = new Map(tree.nodes.map((node) => [node.nodeId, node]))
      const lines = [`Page: ${clean(state().title)}`, `URL: ${state().url}`, ""]
      if (tree.nodes[0]) walk(tree.nodes[0], 0)
      return {
        type: "snapshot",
        state: state(),
        content: lines.join("\n").slice(0, 40_960),
      }

      function walk(node: AXNode, depth: number) {
        if (depth > 6 || lines.length >= 503) return
        const role = (node.role?.value ?? "node").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40)
        const properties = new Map((node.properties ?? []).map((item) => [item.name, item.value?.value]))
        const editable =
          ["textbox", "searchbox", "combobox", "spinbutton"].includes(role) || !!properties.get("editable")
        if (!node.ignored) {
          const actionable = properties.get("focusable") || /^(button|link|textbox|combobox)$/.test(role)
          const ref = actionable && node.backendDOMNodeId ? `e${++nextRef}` : ""
          if (ref && node.backendDOMNodeId)
            refs.set(ref, {
              id: node.backendDOMNodeId,
              editable: editable && !properties.get("disabled") && !properties.get("readonly"),
            })
          const flags = ["checked", "disabled", "expanded", "selected"].flatMap((flag) =>
            properties.has(flag) ? [`${flag}=${properties.get(flag)}`] : [],
          )
          lines.push(
            `${"  ".repeat(depth)}${ref ? `@${ref}` : ""} [${role}] ${JSON.stringify(clean(node.name?.value))} ${flags.join(" ")}`,
          )
        }
        // Editable descendants can repeat the field's value as static text.
        if (!editable)
          node.childIds?.forEach((id) => {
            const child = nodes.get(id)
            if (child) walk(child, depth + 1)
          })
      }
    }
    if (action.type === "screenshot") {
      const source = await contents.capturePage()
      check()
      const size = source.getSize()
      if (!size.width || !size.height) throw new Error("internal")
      const scale = Math.min(1, 2_000 / Math.max(size.width, size.height))
      const image = source.resize({
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
      })
      const data = new Uint8Array(image.toPNG())
      if (data.byteLength > 5 * 1_024 * 1_024) throw new Error("result_too_large")
      return { type: "screenshot", state: state(), data }
    }
    if (action.type === "click" || action.type === "fill") {
      const target = refs.get(action.ref.replace(/^@/, ""))
      if (!target || (action.type === "fill" && !target.editable)) throw new Error("stale_ref")
      if (action.type === "fill") {
        await send("DOM.focus", { backendNodeId: target.id })
        await key({ key: "a", code: "KeyA", modifiers: process.platform === "darwin" ? 4 : 2 })
        await key({ key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 })
        await send("Input.insertText", { text: action.text })
      }
      if (action.type === "click") {
        await send("DOM.scrollIntoViewIfNeeded", { backendNodeId: target.id })
        const result = (await send("DOM.getBoxModel", { backendNodeId: target.id })) as {
          model: { content: number[] }
        }
        const box = result.model.content
        const point = { x: (box[0] + box[4]) / 2, y: (box[1] + box[5]) / 2 }
        for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
          await send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 })
        }
      }
    }
    if (action.type === "press") {
      const codes: Record<Browser.Key, number> = {
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
      await key({
        key: action.key === "Space" ? " " : action.key,
        code: action.key,
        windowsVirtualKeyCode: codes[action.key],
      })
    }
    if (action.type === "scroll") {
      const bounds = view.getBounds()
      await send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: bounds.width / 2,
        y: bounds.height / 2,
        deltaX: action.direction === "left" ? -action.pixels : action.direction === "right" ? action.pixels : 0,
        deltaY: action.direction === "up" ? -action.pixels : action.direction === "down" ? action.pixels : 0,
      })
    }
    check()
    return { type: "state", state: state() }

    function check() {
      if (closed) throw new Error("not_attached")
      if (signal.aborted) throw new Error("aborted")
      // Opening may create a new document before the command runs.
      if (action.type !== "open" && generation !== command.generation) throw new Error("stale_ref")
    }

    function key(params: Record<string, unknown>) {
      return send("Input.dispatchKeyEvent", { type: "keyDown", ...params }).finally(() =>
        contents.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", ...params }),
      )
    }

    async function send(method: string, params: Record<string, unknown>): Promise<unknown> {
      check()
      if (!contents.debugger.isAttached()) contents.debugger.attach("1.3")
      const result: unknown = await contents.debugger.sendCommand(method, params)
      check()
      return result
    }
  }

  async function navigate(input: string, signal: AbortSignal) {
    const value = input.trim() || "about:blank"
    const local = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value)
    const url =
      value === "about:blank" || /^[a-z][a-z\d+.-]*:\/\//i.test(value)
        ? value
        : `${local ? "http" : "https"}://${value}`
    if (url.length > 16_384 || (url !== "about:blank" && !destinationOrigin(url))) throw new Error("invalid_url")
    const cancel = () => {
      if (!closed) contents.stop()
    }
    signal.addEventListener("abort", cancel, { once: true })
    await contents.loadURL(url).finally(() => signal.removeEventListener("abort", cancel))
    if (signal.aborted) throw new Error("aborted")
  }
}

function clean(value: unknown) {
  return typeof value === "string" ? value.replaceAll(/\s+/g, " ").trim().slice(0, 300) : ""
}

export function destinationOrigin(input: string) {
  if (!URL.canParse(input)) return
  const url = new URL(input)
  return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.origin : undefined
}
