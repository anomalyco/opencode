import { mkdtempSync, mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { beforeEach, describe, expect, mock, test } from "bun:test"

const calls = {
  fromPartition: [] as string[],
  clearStorageData: [] as unknown[],
  clearCache: 0,
  capturePage: [] as unknown[],
  executeJavaScript: [] as string[],
  executeJavaScriptByView: [] as { viewId: number; script: string }[],
  loadURL: [] as { viewId: number; url: string }[],
  debuggerAttach: [] as string[],
  debuggerDetach: 0,
  debuggerCommands: [] as { command: string; payload: unknown }[],
}

const scriptResults = new Map<string, unknown>()
const debuggerCommandFailures = new Map<string, Error>()
const viewInstances: Array<{ id: number }> = []
const dispatchedEvents: Array<{ target: FakeElement; event: FakeEvent }> = []
let executeJavaScriptImpl: (script: string, viewId: number) => Promise<unknown> = (script) =>
  Promise.resolve(scriptResults.has(script) ? scriptResults.get(script) : script)
let debuggerAttached = false
let userDataPath = mkdtempSync(join(tmpdir(), "opencode-browser-manager-"))

mock.module("electron", () => ({
  app: {
    getPath(name: string) {
      if (name !== "userData") throw new Error(`unexpected app path ${name}`)
      return userDataPath
    },
    exit() {},
    relaunch() {},
  },
  BrowserWindow: class {
    static fromWebContents() {
      return null
    }

    static getAllWindows() {
      return []
    }
  },
  Notification: class {
    show() {}
  },
  clipboard: {
    readImage() {
      return {
        getSize() {
          return { height: 0, width: 0 }
        },
        isEmpty() {
          return true
        },
        toPNG() {
          return Buffer.alloc(0)
        },
      }
    },
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
  },
  ipcMain: {
    on() {},
    handle() {},
  },
  shell: {
    openExternal() {},
    openPath: async () => "",
  },
  WebContentsView: class {
    id = viewInstances.length + 1
    closed = false
    listeners = new Map<string, Array<() => void>>()
    webContents = {
      executeJavaScript: (script: string) => {
        calls.executeJavaScript.push(script)
        calls.executeJavaScriptByView.push({ viewId: this.id, script })
        return executeJavaScriptImpl(script, this.id)
      },
      on: (event: string, listener: () => void) => {
        this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
      },
      getURL() {
        return "https://current.example"
      },
      getTitle() {
        return "Current Title"
      },
      canGoBack() {
        return false
      },
      canGoForward() {
        return false
      },
      isLoading() {
        return false
      },
      loadURL: (url: string) => {
        calls.loadURL.push({ viewId: this.id, url })
        return Promise.resolve()
      },
      isDestroyed: () => this.closed,
      close: () => {
        if (this.closed) return
        this.closed = true
        this.listeners.get("destroyed")?.forEach((listener) => listener())
      },
      capturePage(bounds?: unknown) {
        calls.capturePage.push(bounds)
        return Promise.resolve({
          toDataURL() {
            return bounds ? "data:image/png;base64,CROP" : "data:image/png;base64,VIEWPORT"
          },
          toPNG() {
            return Buffer.from(bounds ? "crop" : "viewport")
          },
        })
      },
      debugger: {
        attach(version: string) {
          debuggerAttached = true
          calls.debuggerAttach.push(version)
        },
        detach() {
          debuggerAttached = false
          calls.debuggerDetach += 1
        },
        isAttached() {
          return debuggerAttached
        },
        sendCommand(command: string, payload: unknown) {
          calls.debuggerCommands.push({ command, payload })
          const failure = debuggerCommandFailures.get(command)
          if (failure) return Promise.reject(failure)
          if (command === "DOM.getDocument") return Promise.resolve({ root: { nodeId: 1 } })
          if (command === "DOM.querySelector") return Promise.resolve({ nodeId: 42 })
          return Promise.resolve(undefined)
        },
      },
      goBack() {},
      goForward() {},
      reload() {},
    }

    constructor() {
      viewInstances.push(this)
    }

    setBounds() {}
    setVisible() {}
  },
  session: {
    fromPartition(partition: string) {
      calls.fromPartition.push(partition)
        return {
          clearStorageData(options?: unknown) {
            calls.clearStorageData.push(options)
            return Promise.resolve()
          },
          clearCache() {
            calls.clearCache += 1
            return Promise.resolve()
          },
          on() {},
        }
      },
    },
}))

const {
  BROWSER_PARTITION,
  clearBrowserData,
  click,
  getAnnotationDetail,
  getBrowserPanelState,
  getCurrentTitle,
  getSnapshot,
  listDownloads,
  navigate,
  pressKey,
  resolveBrowserUploadPath,
  getAnnotationData,
  startInspectMode,
  storeAnnotationDetail,
  typeText,
  uploadFile,
  hoverElement,
  dragElement,
  handleDialog,
  hideBrowserView,
  runBrowserCode,
  runPlaywrightCode,
} = await import("./BrowserManager")

class FakeEvent {
  constructor(public type: string, public init?: Record<string, unknown>) {}
}

class FakeDataTransfer {}

class FakeDragEvent extends FakeEvent {}

class FakeElement {
  attributes: { name: string; value: string }[]
  classList: string[]
  parentElement: FakeElement | null
  children: FakeElement[]
  innerText: string
  textContent: string
  id: string
  value = ""
  isContentEditable = false
  clickCount = 0
  focusCount = 0
  events: FakeEvent[] = []

  constructor(
    public tagName: string,
    options: {
      attributes?: Record<string, string>
      className?: string
      id?: string
      innerText?: string
      textContent?: string
      parentElement?: FakeElement | null
      children?: FakeElement[]
      isContentEditable?: boolean
    } = {},
  ) {
    this.attributes = Object.entries(options.attributes ?? {}).map(([name, value]) => ({ name, value }))
    this.classList = (options.className ?? "").split(/\s+/).filter(Boolean)
    this.parentElement = options.parentElement ?? null
    this.children = options.children ?? []
    this.innerText = options.innerText ?? ""
    this.textContent = options.textContent ?? options.innerText ?? ""
    this.id = options.id ?? options.attributes?.id ?? ""
    this.isContentEditable = options.isContentEditable ?? false
    for (const child of this.children) child.parentElement = this
  }

  getAttribute(name: string) {
    return this.attributes.find((attribute) => attribute.name === name)?.value ?? null
  }

  getBoundingClientRect() {
    return { x: 1, y: 2, width: 3, height: 4 }
  }

  click() {
    this.clickCount += 1
  }

  focus() {
    this.focusCount += 1
  }

  dispatchEvent(event: FakeEvent) {
    this.events.push(event)
    dispatchedEvents.push({ target: this, event })
    return true
  }
}

class FakeInputElement extends FakeElement {}

class FakeTextAreaElement extends FakeElement {}

class FakeSelectElement extends FakeElement {}

function withBrowserScriptEnvironment<T>(
  execute: () => T,
  options: {
    querySelector?: (selector: string) => unknown
    querySelectorAll?: (selector: string) => unknown[]
    getElementById?: (id: string) => FakeElement | null
    activeElement?: unknown
    title?: string
    href?: string
  } = {},
) {
  const previous = {
    document: globalThis.document,
    location: globalThis.location,
    window: globalThis.window,
    HTMLElement: globalThis.HTMLElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
    HTMLSelectElement: globalThis.HTMLSelectElement,
    Element: globalThis.Element,
    Event: globalThis.Event,
    InputEvent: globalThis.InputEvent,
    KeyboardEvent: globalThis.KeyboardEvent,
    MouseEvent: globalThis.MouseEvent,
    DragEvent: globalThis.DragEvent,
    DataTransfer: globalThis.DataTransfer,
  }

  Object.assign(globalThis, {
    document: {
      querySelector: options.querySelector ?? (() => null),
      querySelectorAll: options.querySelectorAll ?? (() => []),
      getElementById: options.getElementById ?? (() => null),
      activeElement: options.activeElement ?? null,
      title: options.title ?? "Snapshot Title",
    },
    location: { href: options.href ?? "https://snapshot.example" },
    window: { location: { href: options.href ?? "https://snapshot.example" } },
    HTMLElement: FakeElement,
    HTMLInputElement: FakeInputElement,
    HTMLTextAreaElement: FakeTextAreaElement,
    HTMLSelectElement: FakeSelectElement,
    Element: FakeElement,
    Event: FakeEvent,
    InputEvent: FakeEvent,
    KeyboardEvent: FakeEvent,
    MouseEvent: FakeEvent,
    DragEvent: FakeDragEvent,
    DataTransfer: FakeDataTransfer,
  })

  try {
    return execute()
  } finally {
    Object.assign(globalThis, previous)
  }
}

function runScript<T>(script: string, options?: Parameters<typeof withBrowserScriptEnvironment>[1]) {
  return withBrowserScriptEnvironment(() => Function(`return (${script.trim()})`)() as T, options)
}

describe("BrowserManager", () => {
  beforeEach(async () => {
    calls.fromPartition = []
    calls.clearStorageData = []
    calls.clearCache = 0
    calls.capturePage = []
    calls.executeJavaScript = []
    calls.executeJavaScriptByView = []
    calls.loadURL = []
    calls.debuggerAttach = []
    calls.debuggerDetach = 0
    calls.debuggerCommands = []
    const manager = await import("./MultiBrowserManager")
    manager.getAllBrowsers().map((browser) => manager.closeBrowser(browser.id))
    viewInstances.length = 0
    debuggerCommandFailures.clear()
    scriptResults.clear()
    executeJavaScriptImpl = (script) => Promise.resolve(scriptResults.has(script) ? scriptResults.get(script) : script)
    dispatchedEvents.length = 0
    debuggerAttached = false
    rmSync(userDataPath, { force: true, recursive: true })
    userDataPath = mkdtempSync(join(tmpdir(), "opencode-browser-manager-"))
  })

  test("clearBrowserData clears cache without clearing persistent storage", async () => {
    await clearBrowserData()

    expect(calls.fromPartition).toEqual([BROWSER_PARTITION])
    expect(calls.clearStorageData).toEqual([undefined])
    expect(calls.clearCache).toBe(1)
  })

  test("routes navigation to explicit browser ids and active browser by default", async () => {
    const manager = await import("./MultiBrowserManager")
    const firstId = manager.createBrowser()
    const secondId = manager.createBrowser()

    await navigate("first.example", firstId)
    await navigate("active.example")

    expect(calls.loadURL).toEqual([
      { viewId: viewInstances[0]?.id, url: "https://first.example" },
      { viewId: viewInstances[1]?.id, url: "https://active.example" },
    ])
    expect(manager.getActiveBrowserId()).toBe(secondId)
  })

  test("routes page script automation to explicit browser ids and active browser by default", async () => {
    const manager = await import("./MultiBrowserManager")
    const firstId = manager.createBrowser()
    manager.createBrowser()

    await click("button.first", firstId)
    await typeText("input.active", "hello")

    expect(calls.executeJavaScriptByView.map((call) => call.viewId)).toEqual([
      viewInstances[0]?.id,
      viewInstances[1]?.id,
    ])
    expect(calls.executeJavaScriptByView[0]?.script).toContain('safeQuerySelector("button.first")')
    expect(calls.executeJavaScriptByView[1]?.script).toContain('safeQuerySelector("input.active")')
  })

  test("hoverElement routes to explicit browser ids and active browser by default", async () => {
    const manager = await import("./MultiBrowserManager")
    const firstId = manager.createBrowser()
    manager.createBrowser()

    await hoverElement("button.first", firstId)
    await hoverElement("button.active")

    expect(calls.executeJavaScriptByView.map((call) => call.viewId)).toEqual([
      viewInstances[0]?.id,
      viewInstances[1]?.id,
    ])
    expect(calls.executeJavaScriptByView[0]?.script).toContain('safeQuerySelector("button.first")')
    expect(calls.executeJavaScriptByView[1]?.script).toContain('safeQuerySelector("button.active")')
  })

  test("hoverElement dispatches hover mouse events for matching HTMLElements", async () => {
    await hoverElement("button.hover")
    const hoverScript = calls.executeJavaScript.at(-1)
    if (!hoverScript) throw new Error("missing hover script")
    const element = new FakeElement("button")

    expect(runScript(hoverScript, { querySelector: () => element })).toBe(true)
    expect(element.events.map((event) => [event.type, event.init?.bubbles])).toEqual([
      ["mouseenter", false],
      ["mouseover", true],
      ["mousemove", true],
    ])
    expect(runScript(hoverScript, { querySelector: () => null })).toBe(false)
  })

  test("hoverElement returns false for invalid selectors and non-HTMLElement matches", async () => {
    await hoverElement("[")
    const hoverScript = calls.executeJavaScript.at(-1)
    if (!hoverScript) throw new Error("missing hover script")

    expect(runScript(hoverScript, { querySelector: () => { throw new Error("invalid selector") } })).toBe(false)
    expect(runScript(hoverScript, { querySelector: () => ({ tagName: "button" }) })).toBe(false)
  })

  test("click focuses the target and dispatches a realistic pointer and mouse sequence", async () => {
    await click("button.checkout")
    const clickScript = calls.executeJavaScript.at(-1)
    if (!clickScript) throw new Error("missing click script")
    const element = new FakeElement("button")

    expect(runScript(clickScript, { querySelector: () => element })).toBe(true)
    expect(element.focusCount).toBe(1)
    expect(element.clickCount).toBe(0)
    expect(element.events.map((event) => [event.type, event.init?.bubbles, event.init?.cancelable])).toEqual([
      ["pointerdown", true, true],
      ["mousedown", true, true],
      ["pointerup", true, true],
      ["mouseup", true, true],
      ["click", true, true],
    ])
    expect(element.events.map((event) => [event.type, event.init?.button, event.init?.buttons])).toEqual([
      ["pointerdown", 0, 1],
      ["mousedown", 0, 1],
      ["pointerup", 0, 0],
      ["mouseup", 0, 0],
      ["click", 0, 0],
    ])
  })

  test("typeText uses native value setters and dispatches bubbling input and change events", async () => {
    await typeText("input.email", "hello@example.com")
    const typeScript = calls.executeJavaScript.at(-1)
    if (!typeScript) throw new Error("missing type script")
    const input = new FakeInputElement("input")
    const original = Object.getOwnPropertyDescriptor(FakeInputElement.prototype, "value")
    const setterCalls: string[] = []
    Object.defineProperty(input, "value", { configurable: true, value: "controlled-stale", writable: true })
    Object.defineProperty(FakeInputElement.prototype, "value", {
      configurable: true,
      set(value) {
        setterCalls.push(String(value))
        Object.defineProperty(this, "value", { configurable: true, value, writable: true })
      },
    })

    try {
      expect(runScript(typeScript, { querySelector: () => input })).toBe(true)
    } finally {
      if (original) Object.defineProperty(FakeInputElement.prototype, "value", original)
      else delete (FakeInputElement.prototype as { value?: string }).value
    }

    expect(setterCalls).toEqual(["hello@example.com"])
    expect(input.value).toBe("hello@example.com")
    expect(input.focusCount).toBe(1)
    expect(input.events.map((event) => [event.type, event.init?.bubbles])).toEqual([
      ["input", true],
      ["change", true],
    ])
  })

  test("dragElement routes to explicit browser ids and active browser by default", async () => {
    const manager = await import("./MultiBrowserManager")
    const firstId = manager.createBrowser()
    manager.createBrowser()

    await dragElement("#card-a", "#lane-a", firstId)
    await dragElement("#card-b", "#lane-b")

    expect(calls.executeJavaScriptByView.map((call) => call.viewId)).toEqual([
      viewInstances[0]?.id,
      viewInstances[1]?.id,
    ])
    expect(calls.executeJavaScriptByView[0]?.script).toContain('safeQuerySelector("#card-a")')
    expect(calls.executeJavaScriptByView[0]?.script).toContain('safeQuerySelector("#lane-a")')
    expect(calls.executeJavaScriptByView[1]?.script).toContain('safeQuerySelector("#card-b")')
    expect(calls.executeJavaScriptByView[1]?.script).toContain('safeQuerySelector("#lane-b")')
  })

  test("dragElement dispatches drag and mouse events when both targets are HTMLElements", async () => {
    await dragElement("#source", "#target")
    const dragScript = calls.executeJavaScript.at(-1)
    if (!dragScript) throw new Error("missing drag script")
    const source = new FakeElement("div")
    const target = new FakeElement("section")

    expect(runScript(dragScript, { querySelector: (selector) => selector === "#source" ? source : target })).toBe(true)
    expect(source.events.map((event) => [event.type, event.init?.bubbles])).toEqual([
      ["mousedown", true],
      ["dragstart", true],
      ["dragend", true],
      ["mouseup", true],
    ])
    expect(target.events.map((event) => [event.type, event.init?.bubbles])).toEqual([
      ["dragenter", true],
      ["dragover", true],
      ["drop", true],
    ])
    expect(runScript(dragScript, { querySelector: (selector) => selector === "#source" ? source : null })).toBe(false)
    expect(runScript(dragScript, { querySelector: (selector) => selector === "#source" ? null : target })).toBe(false)
  })

  test("dragElement dispatches a drag-oriented sequence with shared dataTransfer", async () => {
    await dragElement("#source", "#target")
    const dragScript = calls.executeJavaScript.at(-1)
    if (!dragScript) throw new Error("missing drag script")
    const source = new FakeElement("div")
    const target = new FakeElement("section")

    expect(runScript(dragScript, { querySelector: (selector) => selector === "#source" ? source : target })).toBe(true)
    expect(dispatchedEvents.map((entry) => [entry.target, entry.event.type])).toEqual([
      [source, "mousedown"],
      [source, "dragstart"],
      [target, "dragenter"],
      [target, "dragover"],
      [target, "drop"],
      [source, "dragend"],
      [source, "mouseup"],
    ])
    const dragEvents = [...source.events, ...target.events].filter((event) => event.type.startsWith("drag") || event.type === "drop")
    const dataTransfer = dragEvents[0]?.init?.dataTransfer
    expect(dataTransfer).toBeInstanceOf(FakeDataTransfer)
    expect(dragEvents.map((event) => event.init?.dataTransfer)).toEqual([
      dataTransfer,
      dataTransfer,
      dataTransfer,
      dataTransfer,
      dataTransfer,
    ])
  })

  test("dragElement returns false for invalid selectors and non-HTMLElement matches", async () => {
    await dragElement("[", "#target")
    const dragScript = calls.executeJavaScript.at(-1)
    if (!dragScript) throw new Error("missing drag script")
    const target = new FakeElement("section")

    expect(runScript(dragScript, { querySelector: () => { throw new Error("invalid selector") } })).toBe(false)
    expect(runScript(dragScript, { querySelector: (selector) => selector === "[" ? { tagName: "div" } : target })).toBe(false)
    expect(runScript(dragScript, { querySelector: (selector) => selector === "[" ? new FakeElement("div") : { tagName: "section" } })).toBe(false)
  })

  test("handleDialog honestly reports unsupported native JavaScript dialog control", async () => {
    const result = await handleDialog("accept", "typed prompt text", "browser-1")

    expect(result).toEqual({
      success: false,
      unsupported: true,
      message: "Electron WebContentsView does not expose a reliable API to accept, dismiss, or fill JavaScript dialogs after they are shown.",
    })
    expect(calls.executeJavaScript).toEqual([])
    expect(viewInstances).toHaveLength(0)
  })

  test("hideBrowserView returns safely without creating a browser when no browser is active", async () => {
    const manager = await import("./MultiBrowserManager")

    hideBrowserView()

    expect(manager.getAllBrowsers()).toEqual([])
    expect(viewInstances).toHaveLength(0)
  })

  test("getBrowserPanelState returns closed empty state without creating a browser when no browser is active", async () => {
    const manager = await import("./MultiBrowserManager")

    expect(getBrowserPanelState()).toEqual({
      visible: false,
      url: "",
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
      inspectMode: false,
    })
    expect(manager.getAllBrowsers()).toEqual([])
    expect(viewInstances).toHaveLength(0)
  })

  test("getCurrentTitle returns empty title without creating a browser when no browser is active", async () => {
    const manager = await import("./MultiBrowserManager")

    expect(getCurrentTitle()).toBe("")
    expect(manager.getAllBrowsers()).toEqual([])
    expect(viewInstances).toHaveLength(0)
  })

  test("hideBrowserView, getBrowserPanelState, and getCurrentTitle do not create an explicit missing browser", async () => {
    const manager = await import("./MultiBrowserManager")

    hideBrowserView("missing-browser")

    expect(getBrowserPanelState("missing-browser")).toEqual({
      visible: false,
      url: "",
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
      inspectMode: false,
    })
    expect(getCurrentTitle("missing-browser")).toBe("")

    expect(manager.getBrowser("missing-browser")).toBeUndefined()
    expect(manager.getAllBrowsers()).toEqual([])
    expect(viewInstances).toHaveLength(0)
  })

  test("runBrowserCode returns No active browser without creating a browser when browserId is omitted", async () => {
    await expect(runBrowserCode("() => 1")).resolves.toEqual({ result: null, error: "No active browser" })

    expect(calls.executeJavaScript).toEqual([])
    expect(viewInstances).toHaveLength(0)
  })

  test("runBrowserCode routes to explicit browser ids and active browser without creating missing explicit browsers", async () => {
    const manager = await import("./MultiBrowserManager")
    const firstId = manager.createBrowser()
    manager.createBrowser()
    executeJavaScriptImpl = (_script, viewId) => Promise.resolve({ result: `view-${viewId}` })

    await expect(runBrowserCode("() => 1", firstId)).resolves.toEqual({ result: `view-${viewInstances[0]?.id}` })
    await expect(runBrowserCode("() => 2")).resolves.toEqual({ result: `view-${viewInstances[1]?.id}` })
    await expect(runBrowserCode("() => 3", "missing-browser")).resolves.toEqual({ result: null, error: "Browser not found" })

    expect(calls.executeJavaScriptByView.map((call) => call.viewId)).toEqual([viewInstances[0]?.id, viewInstances[1]?.id])
    expect(viewInstances).toHaveLength(2)
  })

  test("runBrowserCode executes constrained page-context code without Node or Electron bindings", async () => {
    const manager = await import("./MultiBrowserManager")
    manager.createBrowser()
    executeJavaScriptImpl = (script) => Promise.resolve(runScript(script, {
      href: "https://run.example",
      title: "Run Page",
    }))

    await expect(runBrowserCode("() => ({ href: window.location.href, title: document.title })")).resolves.toEqual({
      result: { href: "https://run.example", title: "Run Page" },
    })
    await expect(runPlaywrightCode("() => typeof require + ':' + typeof process + ':' + typeof window.electron")).resolves.toEqual({
      result: "undefined:undefined:undefined",
    })

    expect(calls.executeJavaScript[0]).toContain("const require = undefined")
    expect(calls.executeJavaScript[0]).toContain("const process = undefined")
    expect(calls.executeJavaScript[0]).toContain("const module = undefined")
    expect(calls.executeJavaScript[0]).toContain("const Buffer = undefined")
  })

  test("runBrowserCode catches page and main execution errors into typed result shape", async () => {
    const manager = await import("./MultiBrowserManager")
    manager.createBrowser()
    executeJavaScriptImpl = (script) => Promise.resolve(runScript(script))

    await expect(runBrowserCode("() => { throw new Error('page exploded') }")).resolves.toEqual({
      result: null,
      error: "page exploded",
    })

    executeJavaScriptImpl = () => Promise.reject(new Error("main exploded"))
    await expect(runBrowserCode("() => 1")).resolves.toEqual({
      result: null,
      error: "main exploded",
    })
  })

  test("runBrowserCode bounds serialized output to 10KB and marks truncation", async () => {
    const manager = await import("./MultiBrowserManager")
    manager.createBrowser()
    executeJavaScriptImpl = (script) => Promise.resolve(runScript(script))

    const result = await runBrowserCode(`() => "${"x".repeat(11_000)}"`)

    expect(result.truncated).toBe(true)
    expect(JSON.stringify(result.result).length).toBeLessThanOrEqual(10 * 1024)
  })

  test("runBrowserCode returns JSON-safe bounded results for non-JSON-safe output", async () => {
    const manager = await import("./MultiBrowserManager")
    manager.createBrowser()
    executeJavaScriptImpl = (script) => Promise.resolve(runScript(script))

    await expect(runBrowserCode("() => undefined")).resolves.toEqual({ result: null })
    await expect(runBrowserCode("() => () => 1")).resolves.toEqual({ result: "[Function]" })
    await expect(runBrowserCode("() => 42n")).resolves.toEqual({ result: "42n" })
    await expect(runBrowserCode("() => { const value = { name: 'root' }; value.self = value; return value }")).resolves.toEqual({
      result: { name: "root", self: "[Circular]" },
    })
  })

  test("runBrowserCode returns a timeout result when page execution does not settle", async () => {
    const manager = await import("./MultiBrowserManager")
    manager.createBrowser()
    const originalSetTimeout = globalThis.setTimeout
    const originalClearTimeout = globalThis.clearTimeout
    let timeoutCallback: (() => void) | undefined
    executeJavaScriptImpl = () => new Promise(() => undefined)

    Object.assign(globalThis, {
      setTimeout: (callback: () => void, delay: number) => {
        expect(delay).toBe(30_000)
        timeoutCallback = callback
        return 1
      },
      clearTimeout: () => undefined,
    })

    try {
      const pending = runBrowserCode("() => new Promise(() => {})")
      timeoutCallback?.()

      await expect(pending).resolves.toEqual({ result: null, error: "Browser code execution timed out after 30000ms" })
    } finally {
      Object.assign(globalThis, { setTimeout: originalSetTimeout, clearTimeout: originalClearTimeout })
    }
  })

  test("runBrowserCode handles executeJavaScript rejection after timeout without unhandled rejection", async () => {
    const manager = await import("./MultiBrowserManager")
    manager.createBrowser()
    const originalSetTimeout = globalThis.setTimeout
    const originalClearTimeout = globalThis.clearTimeout
    const unhandled: unknown[] = []
    let timeoutCallback: (() => void) | undefined
    let rejectExecution: ((error: Error) => void) | undefined
    let lateRejectionHandlerAttached = false

    process.on("unhandledRejection", unhandled.push)
    Object.assign(globalThis, {
      setTimeout: (callback: () => void, delay: number) => {
        expect(delay).toBe(30_000)
        timeoutCallback = callback
        return 1
      },
      clearTimeout: () => undefined,
    })

    try {
      executeJavaScriptImpl = () => {
        const execution = new Promise<unknown>((_resolve, reject) => {
          rejectExecution = reject
        })
        const originalCatch = execution.catch.bind(execution)
        execution.catch = ((onRejected) => {
          lateRejectionHandlerAttached = true
          return originalCatch(onRejected)
        }) as typeof execution.catch
        return execution
      }
      const pending = runBrowserCode("() => new Promise(() => {})")
      expect(lateRejectionHandlerAttached).toBe(true)
      timeoutCallback?.()

      await expect(pending).resolves.toEqual({ result: null, error: "Browser code execution timed out after 30000ms" })

      rejectExecution?.(new Error("late exploded"))
      await Promise.resolve()

      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", unhandled.push)
      Object.assign(globalThis, { setTimeout: originalSetTimeout, clearTimeout: originalClearTimeout })
    }
  })

  test("stores and clears extended annotation detail by id", async () => {
    await storeAnnotationDetail("annotation-1", {
      context: { nearbyDomSanitized: "checkout summary" },
      element: {
        attributes: { role: "button" },
        boundingBox: { x: 1, y: 2, width: 3, height: 4 },
        selector: "button.primary",
        tagName: "button",
      },
      id: "annotation-1",
      pageTitle: "Checkout",
      pageUrl: "https://opencode.ai/checkout",
      preview: { screenshotCrop: "data:image/png;base64,CROP" },
      userComment: "Primary CTA is misleading",
    })

    expect(await getAnnotationDetail("annotation-1")).toMatchObject({
      id: "annotation-1",
      preview: { screenshotCrop: "data:image/png;base64,CROP" },
    })

    await clearBrowserData()

    expect(await getAnnotationDetail("annotation-1")).toBeNull()
  })

  test("browser automation scripts bound snapshot and annotation data", async () => {
    await getSnapshot()
    const snapshotScript = calls.executeJavaScript.at(-1)
    if (!snapshotScript) throw new Error("missing snapshot script")
    const longText = "x".repeat(400)
    const longValue = "v".repeat(400)
    const elements = Array.from({ length: 120 }, (_, index) => {
      const element = new FakeElement("button", {
        attributes: {
          id: `button-${index}`,
          role: "button",
          href: `https://example.com/${index}`,
          "data-testid": `cta-${index}`,
          style: "display:block",
          onclick: "alert(1)",
          value: longValue,
        },
        className: "primary secondary tertiary quaternary",
        innerText: `${index}-${longText}`,
      })
      return element
    })

    const snapshotResult = runScript<{
      url: string
      title: string
      elements: Array<{ visibleText: string; attributes: Record<string, string> }>
    }>(snapshotScript, {
      querySelectorAll: () => elements,
    })

    expect(snapshotResult.url).toBe("https://snapshot.example")
    expect(snapshotResult.title).toBe("Snapshot Title")
    expect(snapshotResult.elements).toHaveLength(100)
    expect(snapshotResult.elements[0].visibleText.length).toBeLessThanOrEqual(200)
    expect(snapshotResult.elements[0].attributes).toEqual({
      "data-testid": "cta-0",
      href: "https://example.com/0",
      id: "button-0",
      role: "button",
      value: longValue.slice(0, 200),
    })

    await getAnnotationData("input[name='email']")
    const annotationScript = calls.executeJavaScript.at(-1)
    if (!annotationScript) throw new Error("missing annotation script")
    const annotationElement = new FakeInputElement("input", {
      attributes: {
        id: "email",
        name: "email",
        placeholder: "Email address",
        autocomplete: "email",
        value: longValue,
      },
      innerText: longText,
    })
    const parent = new FakeElement("form", {
      innerText: `label ${"nearby ".repeat(200)}`,
      children: [annotationElement],
    })
    annotationElement.parentElement = parent

    const annotationResult = runScript<{
      visibleText: string
      attributes: Record<string, string>
      nearbyDomSanitized: string
    } | null>(annotationScript, {
      querySelector: () => annotationElement,
    })

    expect(annotationResult).not.toBeNull()
    expect(annotationResult?.visibleText.length).toBeLessThanOrEqual(200)
    expect(annotationResult?.nearbyDomSanitized.length).toBeLessThanOrEqual(500)
    expect(annotationResult?.attributes).toEqual({
      id: "email",
      name: "email",
      placeholder: "Email address",
      value: longValue.slice(0, 200),
    })
  })

  test("browser automation scripts handle invalid selectors gracefully", async () => {
    const invalidSelector = "["

    await click(invalidSelector)
    const clickScript = calls.executeJavaScript.at(-1)
    if (!clickScript) throw new Error("missing click script")
    expect(
      withBrowserScriptEnvironment(
        () => {
          Function(clickScript)()
        },
        {
          querySelector: () => {
            throw new Error("invalid selector")
          },
        },
      ),
    ).toBeUndefined()

    await typeText(invalidSelector, "hello@example.com")
    const typeScript = calls.executeJavaScript.at(-1)
    if (!typeScript) throw new Error("missing type script")
    expect(
      withBrowserScriptEnvironment(
        () => {
          Function(typeScript)()
        },
        {
          querySelector: () => {
            throw new Error("invalid selector")
          },
        },
      ),
    ).toBeUndefined()

    await getAnnotationData(invalidSelector)
    const annotationScript = calls.executeJavaScript.at(-1)
    if (!annotationScript) throw new Error("missing annotation script")
    expect(
      runScript(annotationScript, {
        querySelector: () => {
          throw new Error("invalid selector")
        },
      }),
    ).toBeNull()
  })

  test("resolveBrowserUploadPath keeps uploads inside the workspace", () => {
    const workspace = mkdtempSync(join(tmpdir(), "opencode-browser-workspace-"))
    const nested = join(workspace, "fixtures")
    mkdirSync(nested, { recursive: true })
    const file = join(nested, "upload.txt")
    writeFileSync(file, "hello upload")

    expect(resolveBrowserUploadPath("fixtures/upload.txt", workspace)).toBe(file)
    expect(resolveBrowserUploadPath("fixtures\\upload.txt", workspace)).toBe(file)
    expect(() => resolveBrowserUploadPath("fixtures/upload.txt", "")).toThrow(/workspace root/i)
    expect(() => resolveBrowserUploadPath("../upload.txt", workspace)).toThrow(/workspace/i)
    expect(() => resolveBrowserUploadPath(file, workspace)).toThrow(/workspace-relative/i)
  })

  test.if(process.platform === "win32")(
    "resolveBrowserUploadPath rejects junction escapes that resolve outside the workspace",
    () => {
      const workspace = mkdtempSync(join(tmpdir(), "opencode-browser-workspace-"))
      const outside = mkdtempSync(join(tmpdir(), "opencode-browser-outside-"))
      const escapeDir = join(workspace, "fixtures")
      const escapedFile = join(outside, "upload.txt")
      writeFileSync(escapedFile, "hello upload")
      symlinkSync(outside, escapeDir, "junction")

      expect(() => resolveBrowserUploadPath("fixtures\\upload.txt", workspace)).toThrow(/workspace/i)
    },
  )

  test("uploadFile uses DOM.setFileInputFiles with the resolved workspace file", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "opencode-browser-workspace-"))
    const nested = join(workspace, "fixtures")
    mkdirSync(nested, { recursive: true })
    const file = join(nested, "upload.txt")
    writeFileSync(file, "hello upload")

    await uploadFile("input[type=file]", "fixtures/upload.txt", workspace)

    expect(calls.debuggerAttach).toEqual(["1.3"])
    expect(calls.debuggerDetach).toBe(1)
    expect(calls.debuggerCommands).toEqual([
      { command: "DOM.getDocument", payload: { depth: -1 } },
      { command: "DOM.querySelector", payload: { nodeId: 1, selector: "input[type=file]" } },
      { command: "DOM.setFileInputFiles", payload: { files: [file], nodeId: 42 } },
    ])
  })

  test("uploadFile detaches the debugger when a command fails after attaching", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "opencode-browser-workspace-"))
    const nested = join(workspace, "fixtures")
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, "upload.txt"), "hello upload")
    debuggerCommandFailures.set("DOM.querySelector", new Error("query failed"))

    await expect(uploadFile("input[type=file]", "fixtures/upload.txt", workspace)).rejects.toThrow("query failed")

    expect(calls.debuggerAttach).toEqual(["1.3"])
    expect(calls.debuggerDetach).toBe(1)
    expect(debuggerAttached).toBe(false)
  })

  test("uploadFile keeps an already attached debugger session attached", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "opencode-browser-workspace-"))
    const nested = join(workspace, "fixtures")
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, "upload.txt"), "hello upload")
    debuggerAttached = true

    await uploadFile("input[type=file]", "fixtures/upload.txt", workspace)

    expect(calls.debuggerAttach).toEqual([])
    expect(calls.debuggerDetach).toBe(0)
    expect(debuggerAttached).toBe(true)
  })

  test("listDownloads returns safe metadata for controlled browser downloads", async () => {
    const downloadDir = join(userDataPath, "browser-downloads")
    mkdirSync(downloadDir, { recursive: true })
    const older = join(downloadDir, "older.txt")
    const newer = join(downloadDir, "newer.txt")
    const nestedDir = join(downloadDir, "nested")
    writeFileSync(older, "old")
    writeFileSync(newer, "new content")
    mkdirSync(nestedDir, { recursive: true })
    utimesSync(older, new Date("2024-01-01T00:00:00.000Z"), new Date("2024-01-01T00:00:00.000Z"))
    utimesSync(newer, new Date("2024-01-02T00:00:00.000Z"), new Date("2024-01-02T00:00:00.000Z"))

    expect(await listDownloads()).toEqual([
      {
        createdAt: expect.any(Number),
        modifiedAt: expect.any(Number),
        name: "newer.txt",
        path: newer,
        size: 11,
      },
      {
        createdAt: expect.any(Number),
        modifiedAt: expect.any(Number),
        name: "older.txt",
        path: older,
        size: 3,
      },
    ])
  })

  test("browser automation methods execute focused page scripts and return structured data", async () => {
    await click("button.primary")
    await typeText("input[name='email']", "hello@example.com")
    await pressKey("Enter")

    const snapshotResult = {
      url: "https://snapshot.example/?token=secret&tab=1#access_token=fragment",
      title: "Snapshot Title",
      elements: [
        {
          selector: "button.primary",
          tagName: "button",
          role: "button",
          accessibleName: "Submit",
          visibleText: "Submit",
          attributes: {
            class: "primary",
            href: "https://example.com/account?api_key=secret&next=%2Fhome",
          },
          boundingBox: { x: 1, y: 2, width: 3, height: 4 },
        },
      ],
    }

    const annotationResult = {
      tagName: "input",
      role: "textbox",
      accessibleName: "Password",
      visibleText: "hunter2",
      attributes: {
        name: "password",
        placeholder: "Password",
        type: "password",
        value: "hunter2",
        href: "https://example.com/reset?token=secret&ok=1",
      },
      selector: "input[name='password']",
      xpath: "//*[@id='password']",
      boundingBox: { x: 5, y: 6, width: 7, height: 8 },
      nearbyDomSanitized: "Password: hunter2 Authorization: Bearer abc.def.ghi Cookie: session=abc ok",
    }

    const snapshotKey = await getSnapshot()
    if (!snapshotKey) throw new Error("missing snapshot script")
    scriptResults.set(String(snapshotKey), snapshotResult)
    expect(await getSnapshot()).toEqual({
      ...snapshotResult,
      url: "https://snapshot.example/?token=%5BREDACTED%5D&tab=1#access_token=%5BREDACTED%5D",
      elements: [
        {
          ...snapshotResult.elements[0],
          attributes: {
            class: "primary",
            href: "https://example.com/account?api_key=%5BREDACTED%5D&next=%2Fhome",
          },
        },
      ],
    })

    const annotationScript = await getAnnotationData("input[name='email']")
    if (!annotationScript) throw new Error("missing annotation script")
    scriptResults.set(String(annotationScript), annotationResult)
    const annotation = await getAnnotationData("input[name='email']")
    expect(annotation).toBeTruthy()
    expect(annotation?.accessibleName).toBe("[REDACTED]")
    expect(annotation?.visibleText).toBe("[REDACTED]")
    expect(annotation?.attributes).toEqual({
      href: "https://example.com/reset?token=%5BREDACTED%5D&ok=1",
      name: "[REDACTED]",
      placeholder: "[REDACTED]",
      type: "[REDACTED]",
      value: "[REDACTED]",
    })
    expect(annotation?.selector).toBe("[REDACTED]")
    expect(annotation?.xpath).toBe("[REDACTED]")
    expect(annotation?.nearbyDomSanitized).toContain("[REDACTED]")
    expect(annotation?.nearbyDomSanitized).not.toContain("hunter2")
    expect(annotation?.nearbyDomSanitized).not.toContain("session=abc")
    expect(annotation?.nearbyDomSanitized).not.toContain("abc.def.ghi")

    const safeAnnotationResult = {
      tagName: "button",
      role: "button",
      accessibleName: "Continue",
      visibleText: "Continue",
      attributes: {
        class: "primary",
      },
      selector: "button.primary",
      xpath: "/html/body/main/button[1]",
      boundingBox: { x: 9, y: 10, width: 11, height: 12 },
      nearbyDomSanitized: "Continue to checkout",
    }

    const safeAnnotationScript = await getAnnotationData("button.primary")
    if (!safeAnnotationScript) throw new Error("missing safe annotation script")
    scriptResults.set(String(safeAnnotationScript), safeAnnotationResult)
    expect(await getAnnotationData("button.primary")).toMatchObject({
      selector: "button.primary",
      xpath: "/html/body/main/button[1]",
    })

    expect(calls.executeJavaScript).toHaveLength(9)
    expect(calls.executeJavaScript[0]).toContain('const element = safeQuerySelector("button.primary")')
    expect(calls.executeJavaScript[1]).toContain(`const element = safeQuerySelector("input[name='email']")`)
    expect(calls.executeJavaScript[1]).toContain('"hello@example.com"')
    expect(calls.executeJavaScript[2]).toContain('"Enter"')
    expect(calls.executeJavaScript[3]).toContain('LIMITS.maxSnapshotElements')
    expect(calls.executeJavaScript[3]).toContain('SAFE_ATTRIBUTE_NAMES')
    expect(calls.executeJavaScript[5]).toContain('LIMITS.maxNearbyTextLength')
    expect(calls.executeJavaScript[5]).toContain(`const element = safeQuerySelector("input[name='email']")`)
    expect(calls.executeJavaScript[6]).toContain(`const element = safeQuerySelector("input[name='email']")`)
    expect(calls.executeJavaScript[7]).toContain('const element = safeQuerySelector("button.primary")')
    expect(calls.executeJavaScript[8]).toContain('const element = safeQuerySelector("button.primary")')
  })

  test("clearAnnotationMarkers removes only injected browser annotation markers", async () => {
    const manager = await import("./MultiBrowserManager")
    const { clearAnnotationMarkers } = await import("./BrowserManager")
    manager.createBrowser()

    await clearAnnotationMarkers()

    const markerScript = calls.executeJavaScript.at(-1)
    if (!markerScript) throw new Error("missing marker cleanup script")

    expect(markerScript).toContain('document.querySelectorAll(".opencode-browser-annotation-marker")')
    expect(markerScript).toContain("marker.remove()")
    expect(markerScript).not.toContain("innerHTML")
    expect(markerScript).not.toContain("removeChild(document.documentElement")
  })

  test("startInspectMode injects an in-page comment bubble and returns completed annotation metadata", async () => {
    await startInspectMode()

    const inspectScript = calls.executeJavaScript.at(-1)
    if (!inspectScript) throw new Error("missing inspect script")

    expect(inspectScript).toContain('const textarea = document.createElement("textarea")')
    expect(inspectScript).toContain('const cursorStyle = document.createElement("style")')
    expect(inspectScript).toContain("cursor: crosshair !important")
    expect(inspectScript).toContain("window.__opencodeAnnotationMarkerCount")
    expect(inspectScript).toContain('marker.className = "opencode-browser-annotation-marker"')
    expect(inspectScript).toContain('textarea.setAttribute("aria-label", "Annotation comment")')
    expect(inspectScript).not.toContain('const saveButton = document.createElement("button")')
    expect(inspectScript).not.toContain('const cancelButton = document.createElement("button")')
    expect(inspectScript).not.toContain('background: "#ffffff"')
    expect(inspectScript).toContain('if (event.key !== "Enter" || event.shiftKey || bubble.style.display !== "block") return')
    expect(inspectScript).toContain('userComment: textarea.value.trim()')
    expect(inspectScript).toContain('pageTitle: document.title')
    expect(inspectScript).toContain('pageUrl: window.location.href')

    scriptResults.set(inspectScript, {
      annotation: {
        accessibleName: "Buy now",
        attributes: { role: "button" },
        boundingBox: { x: 12.4, y: 24.6, width: 119.2, height: 31.4 },
        nearbyDomSanitized: "Checkout summary",
        role: "button",
        selector: "button.buy-now",
        tagName: "button",
        visibleText: "Buy now",
        xpath: "/html/body/button[1]",
      },
      pageTitle: "Checkout",
      pageUrl: "https://opencode.ai/checkout",
      userComment: "Primary CTA is misleading",
    })

    expect(await startInspectMode()).toMatchObject({
      annotation: {
        selector: "button.buy-now",
      },
      context: {
        nearbyDomSanitized: "Checkout summary",
      },
      preview: {
        screenshotCrop: "data:image/png;base64,CROP",
        viewportScreenshotId: expect.any(String),
      },
      viewportScreenshot: {
        createdAt: expect.any(Number),
        id: expect.any(String),
        imageData: "data:image/png;base64,VIEWPORT",
        pageTitle: "Checkout",
        pageUrl: "https://opencode.ai/checkout",
        viewport: {
          deviceScaleFactor: 1,
          height: 0,
          width: 0,
        },
      },
    })
    expect(calls.capturePage).toEqual([undefined, { height: 31, width: 119, x: 12, y: 25 }])
    expect(getBrowserPanelState().inspectMode).toBe(true)
  })
})
