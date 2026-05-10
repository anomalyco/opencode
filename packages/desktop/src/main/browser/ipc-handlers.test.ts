import { beforeEach, describe, expect, mock, test } from "bun:test"

const calls = {
  attachBrowserView: [] as unknown[],
  getAnnotationDetail: [] as string[],
  setBrowserViewBounds: [] as Array<{ bounds: unknown; browserId?: string }>,
  showBrowserView: 0,
  hideBrowserView: 0,
  navigate: [] as string[],
  navigateBrowserIds: [] as Array<string | undefined>,
  goBack: 0,
  goForward: 0,
  reload: 0,
  clearBrowserData: 0,
  click: [] as string[],
  clickBrowserIds: [] as Array<string | undefined>,
  hoverElement: [] as string[],
  hoverBrowserIds: [] as Array<string | undefined>,
  dragElement: [] as Array<{ selector: string; targetSelector: string }>,
  dragBrowserIds: [] as Array<string | undefined>,
  handleDialog: [] as Array<{ action: string; promptText?: string; browserId?: string }>,
  runBrowserCode: [] as Array<{ code: string; browserId?: string }>,
  runPlaywrightCode: [] as Array<{ code: string; browserId?: string }>,
  typeText: [] as { selector: string; text: string }[],
  typeBrowserIds: [] as Array<string | undefined>,
  pressKey: [] as string[],
  uploadFile: [] as { selector: string; fileRef: string; workspaceRoot?: string; browserId?: string }[],
  listDownloads: 0,
  storeAnnotationDetail: [] as { id: string; detail: unknown }[],
  clearAnnotationMarkers: 0,
  startInspectMode: 0,
  stopInspectMode: 0,
  getSnapshot: 0,
  getAnnotationData: [] as string[],
  getCurrentTitle: [] as Array<string | undefined>,
  getBrowserPanelState: [] as Array<string | undefined>,
  createdByTitleRead: [] as Array<string | undefined>,
}

const onCalls: string[] = []
const handleCalls: string[] = []
const listeners = new Map<string, (...args: unknown[]) => unknown>()
const handlers = new Map<string, (...args: unknown[]) => unknown>()
const browserWindow = {
  id: "window",
  contentView: {
    children: [] as unknown[],
    addChildView(view: unknown) {
      this.children.push(view)
    },
    removeChildView(view: unknown) {
      this.children = this.children.filter((child) => child !== view)
    },
  },
}
let browserView: {
  webContents: {
    capturePage: () => Promise<{ toPNG: () => Buffer }>
  }
} | null = null
const openRequestEvents: string[] = []

const browserState = {
  visible: true,
  url: "https://state.example",
  canGoBack: true,
  canGoForward: false,
  isLoading: true,
  inspectMode: false,
}

const emptyBrowserState = {
  visible: false,
  url: "",
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  inspectMode: false,
}

let hasReadableBrowser = true

const downloads = [
  {
    createdAt: 1,
    modifiedAt: 2,
    name: "download.txt",
    path: "/tmp/browser-downloads/download.txt",
    size: 123,
  },
]

mock.module("electron", () => ({
  BrowserWindow: {
    fromWebContents: () => browserWindow,
    getAllWindows: () => [],
  },
  Notification: class {
    show() {}
  },
  app: {
    exit() {},
    relaunch() {},
  },
  clipboard: {
    readImage: () => ({
      isEmpty: () => true,
    }),
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
  },
  ipcMain: {
    on(channel: string, listener: (...args: unknown[]) => unknown) {
      onCalls.push(channel)
      listeners.set(channel, listener)
    },
    handle(channel: string, handler: (...args: unknown[]) => unknown) {
      handleCalls.push(channel)
      handlers.set(channel, handler)
    },
  },
  shell: {
    openExternal() {},
    openPath: async () => "",
  },
  WebContentsView: class {
    bounds = { x: 0, y: 0, width: 0, height: 0 }
    visible = false
    webContents: {
      on: (event: string, listener: () => void) => void
      getTitle: () => string
      getURL: () => string
      canGoBack: () => boolean
      canGoForward: () => boolean
      isLoading: () => boolean
      isDestroyed: () => boolean
      close: () => void
    }

    constructor() {
      const listeners = new Map<string, () => void>()
      let destroyed = false
      this.webContents = {
        on: (event: string, listener: () => void) => {
          listeners.set(event, listener)
        },
        getTitle: () => "Browser Title",
        getURL: () => "https://browser.example",
        canGoBack: () => false,
        canGoForward: () => false,
        isLoading: () => false,
        isDestroyed: () => destroyed,
        close: () => {
          destroyed = true
          listeners.get("destroyed")?.()
        },
      }
    }

    setBounds(bounds: { x: number; y: number; width: number; height: number }) {
      this.bounds = bounds
    }

    setVisible(visible: boolean) {
      this.visible = visible
    }
  },
  session: {
    fromPartition() {
      return {
        clearCache: async () => {},
      }
    },
  },
}))

mock.module("./BrowserManager", () => ({
  attachBrowserView(win: unknown) {
    calls.attachBrowserView.push(win)
  },
  getAnnotationDetail(id: string) {
    calls.getAnnotationDetail.push(id)
    return Promise.resolve(id === "missing" ? null : { id, pageTitle: "Checkout" })
  },
  setBrowserViewBounds(bounds: unknown, browserId?: string) {
    calls.setBrowserViewBounds.push({ bounds, browserId })
  },
  showBrowserView() {
    calls.showBrowserView += 1
  },
  hideBrowserView() {
    calls.hideBrowserView += 1
  },
  navigate(url: string, browserId?: string) {
    calls.navigate.push(url)
    calls.navigateBrowserIds.push(browserId)
    return Promise.resolve()
  },
  goBack() {
    calls.goBack += 1
  },
  goForward() {
    calls.goForward += 1
  },
  reload() {
    calls.reload += 1
  },
  clearBrowserData() {
    calls.clearBrowserData += 1
    return Promise.resolve()
  },
  uploadFile(selector: string, fileRef: string, workspaceRoot?: string, browserId?: string) {
    calls.uploadFile.push({ selector, fileRef, workspaceRoot, browserId })
    return Promise.resolve()
  },
  listDownloads() {
    calls.listDownloads += 1
    return Promise.resolve(downloads)
  },
  storeAnnotationDetail(id: string, detail: unknown) {
    calls.storeAnnotationDetail.push({ id, detail })
    return Promise.resolve()
  },
  clearAnnotationMarkers() {
    calls.clearAnnotationMarkers += 1
    return Promise.resolve()
  },
    click(selector: string, browserId?: string) {
    calls.click.push(selector)
    calls.clickBrowserIds.push(browserId)
    return Promise.resolve()
   },
   hoverElement(selector: string, browserId?: string) {
    calls.hoverElement.push(selector)
    calls.hoverBrowserIds.push(browserId)
     return Promise.resolve()
    },
   dragElement(selector: string, targetSelector: string, browserId?: string) {
    calls.dragElement.push({ selector, targetSelector })
    calls.dragBrowserIds.push(browserId)
     return Promise.resolve(selector !== "#missing-source")
    },
    handleDialog(action: string, promptText?: string, browserId?: string) {
      calls.handleDialog.push({ action, promptText, browserId })
      return Promise.resolve({ success: false, unsupported: true, message: "unsupported" })
    },
    runBrowserCode(code: string, browserId?: string) {
      calls.runBrowserCode.push({ code, browserId })
      return Promise.resolve({ result: `browser:${code}:${browserId ?? "active"}` })
    },
    runPlaywrightCode(code: string, browserId?: string) {
      calls.runPlaywrightCode.push({ code, browserId })
      return Promise.resolve({ result: `playwright:${code}:${browserId ?? "active"}` })
    },
    typeText(selector: string, text: string, browserId?: string) {
    calls.typeText.push({ selector, text })
    calls.typeBrowserIds.push(browserId)
    return Promise.resolve()
   },
   pressKey(key: string) {
     calls.pressKey.push(key)
     return Promise.resolve()
    },
    startInspectMode() {
      calls.startInspectMode += 1
      return Promise.resolve({ kind: "annotation", selector: "button.inspect" })
    },
    stopInspectMode() {
      calls.stopInspectMode += 1
      return Promise.resolve()
    },
    getSnapshot() {
      calls.getSnapshot += 1
      return Promise.resolve({ kind: "snapshot" })
   },
   getAnnotationData(selector: string) {
    calls.getAnnotationData.push(selector)
    return Promise.resolve(selector === "missing" ? null : { kind: "annotation", selector })
   },
  getBrowserView() {
    return browserView
  },
  getBrowserPanelState(browserId?: string) {
    calls.getBrowserPanelState.push(browserId)
    return hasReadableBrowser ? browserState : emptyBrowserState
  },
  getCurrentUrl() {
    return "https://current.example"
  },
  getCurrentTitle(browserId?: string) {
    calls.getCurrentTitle.push(browserId)
    return hasReadableBrowser ? "Current Title" : ""
  },
}))

const { addBrowserConsoleEntry, clearBrowserConsoleEntries } = await import("./console-store")
const { registerBrowserIpcHandlers } = await import("./ipc-handlers")

describe("registerBrowserIpcHandlers", () => {
  beforeEach(() => {
    onCalls.length = 0
    handleCalls.length = 0
    listeners.clear()
    handlers.clear()
    calls.attachBrowserView = []
    calls.getAnnotationDetail = []
    calls.setBrowserViewBounds = []
    calls.showBrowserView = 0
    calls.hideBrowserView = 0
    calls.navigate = []
    calls.navigateBrowserIds = []
    calls.goBack = 0
    calls.goForward = 0
    calls.reload = 0
    calls.clearBrowserData = 0
    calls.click = []
    calls.clickBrowserIds = []
    calls.hoverElement = []
    calls.hoverBrowserIds = []
    calls.dragElement = []
    calls.dragBrowserIds = []
    calls.handleDialog = []
    calls.runBrowserCode = []
    calls.runPlaywrightCode = []
    calls.typeText = []
    calls.typeBrowserIds = []
    calls.pressKey = []
    calls.uploadFile = []
    calls.listDownloads = 0
    calls.storeAnnotationDetail = []
    calls.clearAnnotationMarkers = 0
    calls.startInspectMode = 0
    calls.stopInspectMode = 0
    calls.getSnapshot = 0
    calls.getAnnotationData = []
    calls.getCurrentTitle = []
    calls.getBrowserPanelState = []
    calls.createdByTitleRead = []
    hasReadableBrowser = true
    browserView = {
      webContents: {
        capturePage: async () => ({
          toPNG: () => Buffer.from("png-data"),
        }),
      },
    }
    openRequestEvents.length = 0
    clearBrowserConsoleEntries()
  })

  test("registers browser event and invoke handlers", () => {
    registerBrowserIpcHandlers({ completed: false })

    expect([...listeners.keys()]).toEqual([
      "browser-attach",
      "browser-set-bounds",
      "browser-show",
      "browser-hide",
    ])
    expect([...handlers.keys()]).toEqual([
      "browser-open",
      "browser-navigate",
      "browser-back",
      "browser-forward",
        "browser-reload",
         "browser-clear-data",
         "browser-state",
         "browser-screenshot",
          "browser-inspect-start",
          "browser-inspect-stop",
          "browser-annotation-markers-clear",
           "browser-click",
           "browser-hover",
             "browser-drag",
             "browser-handle-dialog",
             "browser-run-code",
             "browser-run-playwright-code",
             "browser-type",
         "browser-press",
         "browser-upload-file",
          "browser-downloads-list",
          "browser-annotation-get-detail",
          "browser-inspect",
          "browser-get-snapshot",
          "browser-get-annotation-data",
           "browser-store-annotation-detail",
           "browser-console-messages",
           "browser-console-clear",
           "browser-create",
          "browser-list",
          "browser-activate",
          "browser-close",
       ])
  })

  test("routes browser annotation marker cleanup through dedicated IPC", async () => {
    registerBrowserIpcHandlers({ completed: false })

    await handlers.get("browser-annotation-markers-clear")?.({})

    expect(calls.clearAnnotationMarkers).toBe(1)
  })

  test("reads browser console messages with active fallback, level filters, and bounded limits", async () => {
    registerBrowserIpcHandlers({ completed: false })
    const created = (await handlers.get("browser-create")?.({ sender: {} }, { bounds: { x: 0, y: 0, width: 100, height: 100 } })) as {
      browser: { id: string }
    }

    addBrowserConsoleEntry({ browserId: created.browser.id, level: "log", message: "first", source: "console", line: 1, timestamp: 1 })
    addBrowserConsoleEntry({ browserId: created.browser.id, level: "error", message: "second", source: "console", line: 2, timestamp: 2 })
    addBrowserConsoleEntry({ browserId: created.browser.id, level: "warn", message: "third", source: "console", line: 3, timestamp: 3 })
    addBrowserConsoleEntry({ browserId: "other-browser", level: "error", message: "other", source: "console", line: 4, timestamp: 4 })

    await expect(handlers.get("browser-console-messages")?.({}, { levels: ["error", "warn"], limit: 1 })).resolves.toEqual({
      browserId: created.browser.id,
      entries: [
        {
          browserId: created.browser.id,
          level: "warn",
          line: 3,
          message: "third",
          source: "console",
          timestamp: 3,
        },
      ],
      truncated: true,
    })

    await expect(handlers.get("browser-console-messages")?.({}, { browserId: "other-browser" })).resolves.toEqual({
      browserId: "other-browser",
      entries: [
        {
          browserId: "other-browser",
          level: "error",
          line: 4,
          message: "other",
          source: "console",
          timestamp: 4,
        },
      ],
    })
  })

  test("clears browser console messages without creating browsers", async () => {
    registerBrowserIpcHandlers({ completed: false })
    const before = (await handlers.get("browser-list")?.()) as { browsers: Array<{ id: string }> }

    addBrowserConsoleEntry({ browserId: "missing-browser", level: "error", message: "stale", source: "console", line: null, timestamp: 5 })

    await expect(handlers.get("browser-console-clear")?.({}, { browserId: "missing-browser" })).resolves.toEqual({
      browserId: "missing-browser",
      count: 1,
    })
    await expect(handlers.get("browser-console-messages")?.({}, { browserId: "missing-browser" })).resolves.toEqual({
      browserId: "missing-browser",
      entries: [],
    })
    const after = (await handlers.get("browser-list")?.()) as { browsers: Array<{ id: string }> }

    expect(after.browsers).toHaveLength(before.browsers.length)
  })

  test("does not clear console messages when no browser is active and browserId is omitted", async () => {
    registerBrowserIpcHandlers({ completed: false })
    const before = (await handlers.get("browser-list")?.()) as { browsers: Array<{ id: string }> }
    await Promise.all(before.browsers.map((browser) => handlers.get("browser-close")?.({}, { browserId: browser.id })))

    addBrowserConsoleEntry({ browserId: "other-browser", level: "error", message: "stays", source: "console", line: null, timestamp: 6 })

    await expect(handlers.get("browser-console-clear")?.({})).resolves.toEqual({
      browserId: "",
      count: 0,
    })
    await expect(handlers.get("browser-console-messages")?.({}, { browserId: "other-browser" })).resolves.toEqual({
      browserId: "other-browser",
      entries: [
        {
          browserId: "other-browser",
          level: "error",
          line: null,
          message: "stays",
          source: "console",
          timestamp: 6,
        },
      ],
    })
  })

  test("rejects malformed console IPC payloads", async () => {
    registerBrowserIpcHandlers({ completed: false })

    await expect(handlers.get("browser-console-messages")?.({}, { browserId: 123 })).rejects.toThrow("browserId must be a string")
    await expect(handlers.get("browser-console-messages")?.({}, { levels: "error" })).rejects.toThrow("levels must be an array")
    await expect(handlers.get("browser-console-messages")?.({}, { levels: ["error", "trace"] })).rejects.toThrow("levels must contain valid console levels")
    await expect(handlers.get("browser-console-messages")?.({}, { limit: 0 })).rejects.toThrow("limit must be a finite positive number")
    await expect(handlers.get("browser-console-messages")?.({}, { limit: Number.POSITIVE_INFINITY })).rejects.toThrow("limit must be a finite positive number")
    await expect(handlers.get("browser-console-clear")?.({}, { levels: ["error"] })).rejects.toThrow("levels is not supported for browser-console-clear")
  })

  test("validates and routes run-code IPC params", async () => {
    registerBrowserIpcHandlers({ completed: false })

    await expect(handlers.get("browser-run-code")?.({}, { code: "() => 1", browserId: "browser-1" })).resolves.toEqual({
      result: "browser:() => 1:browser-1",
    })
    await expect(handlers.get("browser-run-code")?.({}, "() => 2")).resolves.toEqual({ result: "browser:() => 2:active" })
    await expect(handlers.get("browser-run-playwright-code")?.({}, { code: "() => 3" })).resolves.toEqual({
      result: "playwright:() => 3:active",
    })

    expect(calls.runBrowserCode).toEqual([
      { code: "() => 1", browserId: "browser-1" },
      { code: "() => 2", browserId: undefined },
    ])
    expect(calls.runPlaywrightCode).toEqual([{ code: "() => 3", browserId: undefined }])
    expect(() => handlers.get("browser-run-code")?.({}, { code: 1 })).toThrow("code must be a string")
    expect(() => handlers.get("browser-run-code")?.({}, { code: "() => 1", browserId: 1 })).toThrow("browserId must be a string")
  })

  test("registers multi-browser lifecycle handlers and returns renderer-safe state", async () => {
    registerBrowserIpcHandlers({ completed: false })

    const created = (await handlers.get("browser-create")?.({ sender: {} }, { url: "created.example", bounds: { x: 5, y: 6, width: 700, height: 500 } })) as {
      browser: {
        id: string
        title: string
        url: string
        bounds: { x: number; y: number; width: number; height: number }
        state: typeof browserState
        inspectMode: boolean
      }
      state: { activeBrowserId?: string; browsers: Array<{ id: string; view?: unknown }> }
    }

    expect(created.browser).toEqual({
      id: created.browser.id,
      title: "Current Title",
      url: "https://current.example",
      bounds: { x: 5, y: 6, width: 700, height: 500 },
      state: browserState,
      inspectMode: browserState.inspectMode,
    })
    expect(created.state.activeBrowserId).toBe(created.browser.id)
    expect(created.state.browsers.some((browser) => browser.id === created.browser.id)).toBe(true)
    expect(created.state.browsers.some((browser) => "view" in browser)).toBe(false)

    const listed = (await handlers.get("browser-list")?.()) as { activeBrowserId?: string; browsers: Array<{ id: string; view?: unknown }> }
    expect(listed.activeBrowserId).toBe(created.browser.id)
    expect(listed.browsers.some((browser) => browser.id === created.browser.id)).toBe(true)
    expect(listed.browsers.some((browser) => "view" in browser)).toBe(false)

    const activated = (await handlers.get("browser-activate")?.({}, { browserId: created.browser.id })) as {
      success: boolean
      state: { activeBrowserId?: string; browsers: Array<{ id: string; view?: unknown }> }
    }
    expect(activated.success).toBe(true)
    expect(activated.state.activeBrowserId).toBe(created.browser.id)
    expect(activated.state.browsers.some((browser) => browser.id === created.browser.id)).toBe(true)
    expect(activated.state.browsers.some((browser) => "view" in browser)).toBe(false)
    const closed = (await handlers.get("browser-close")?.({}, { browserId: created.browser.id })) as {
      success: boolean
      state: { browsers: Array<{ id: string; view?: unknown }> }
    }
    expect(closed.success).toBe(true)
    expect(closed.state.browsers.some((browser) => browser.id === created.browser.id)).toBe(false)
    expect(closed.state.browsers.some((browser) => "view" in browser)).toBe(false)

    expect(calls.setBrowserViewBounds).toEqual([{ bounds: { x: 5, y: 6, width: 700, height: 500 }, browserId: created.browser.id }])
    expect(calls.navigate).toEqual(["created.example"])
    expect(calls.navigateBrowserIds).toEqual([created.browser.id])
  })

  test("proxies attach, bounds, visibility, navigation, state, and screenshot", async () => {
    registerBrowserIpcHandlers({ completed: false })

    listeners.get("browser-attach")?.({ sender: {} })
    listeners.get("browser-set-bounds")?.({}, { x: 1, y: 2, width: 3, height: 4 })
    listeners.get("browser-set-bounds")?.({}, { x: 5, y: 6, width: 7, height: 8 }, "browser-1")
    listeners.get("browser-show")?.()
    listeners.get("browser-hide")?.()

    expect(calls.attachBrowserView).toEqual([browserWindow])
    expect(calls.setBrowserViewBounds).toEqual([
      { bounds: { x: 1, y: 2, width: 3, height: 4 }, browserId: undefined },
      { bounds: { x: 5, y: 6, width: 7, height: 8 }, browserId: "browser-1" },
    ])
    expect(calls.showBrowserView).toBe(1)
    expect(calls.hideBrowserView).toBe(1)

    expect(
      await handlers.get("browser-open")?.({
        sender: {
          send(channel: string) {
            openRequestEvents.push(channel)
          },
        },
      }),
    ).toEqual({
      ...browserState,
      title: "Current Title",
    })
    expect(await handlers.get("browser-navigate")?.({}, "opencode.dev")).toEqual({
      title: "Current Title",
      url: "https://current.example",
    })
    expect(await handlers.get("browser-back")?.()).toEqual({
      title: "Current Title",
      url: "https://current.example",
    })
    expect(await handlers.get("browser-forward")?.()).toEqual({
      title: "Current Title",
      url: "https://current.example",
    })
    expect(await handlers.get("browser-reload")?.()).toBeUndefined()
    expect(await handlers.get("browser-clear-data")?.()).toBeUndefined()
    expect(await handlers.get("browser-state")?.()).toEqual({
      ...browserState,
      title: "Current Title",
    })
    expect(await handlers.get("browser-screenshot")?.()).toBe(Buffer.from("png-data").toString("base64"))
    expect(await handlers.get("browser-inspect-start")?.()).toEqual({ kind: "annotation", selector: "button.inspect" })
    expect(await handlers.get("browser-inspect-stop")?.()).toBeUndefined()
    expect(await handlers.get("browser-click")?.({}, "button.primary")).toBeUndefined()
    expect(await handlers.get("browser-hover")?.({}, "button.primary")).toBeUndefined()
    expect(await handlers.get("browser-drag")?.({}, "#source", "#target")).toBe(true)
    expect(await handlers.get("browser-handle-dialog")?.({}, "accept", "typed prompt")).toEqual({ success: false, unsupported: true, message: "unsupported" })
    expect(await handlers.get("browser-type")?.({}, "input[name='email']", "hello@example.com")).toBeUndefined()
    expect(await handlers.get("browser-press")?.({}, "Enter")).toBeUndefined()
    expect(await handlers.get("browser-upload-file")?.({}, "input[type='file']", "fixtures/upload.txt")).toBeUndefined()
    expect(await handlers.get("browser-downloads-list")?.()).toEqual(downloads)
    expect(await handlers.get("browser-annotation-get-detail")?.({}, "annotation-1")).toEqual({ id: "annotation-1", pageTitle: "Checkout" })
    expect(await handlers.get("browser-inspect")?.({}, undefined)).toEqual({ kind: "snapshot" })
    expect(await handlers.get("browser-inspect")?.({}, "button.primary")).toEqual({
      kind: "annotation",
      selector: "button.primary",
    })
    expect(await handlers.get("browser-get-snapshot")?.()).toEqual({ kind: "snapshot" })
    expect(await handlers.get("browser-get-annotation-data")?.({}, "missing")).toBeNull()
    expect(
      await handlers.get("browser-store-annotation-detail")?.({}, "annotation-1", { pageTitle: "Checkout" }),
    ).toBeUndefined()

    expect(openRequestEvents).toEqual(["browser-open-requested"])
    expect(calls.navigate).toEqual(["opencode.dev"])
    expect(calls.navigateBrowserIds).toEqual([undefined])
    expect(calls.goBack).toBe(1)
    expect(calls.goForward).toBe(1)
    expect(calls.reload).toBe(1)
    expect(calls.clearBrowserData).toBe(1)
    expect(calls.click).toEqual(["button.primary"])
    expect(calls.clickBrowserIds).toEqual([undefined])
    expect(calls.hoverElement).toEqual(["button.primary"])
    expect(calls.hoverBrowserIds).toEqual([undefined])
    expect(calls.dragElement).toEqual([{ selector: "#source", targetSelector: "#target" }])
    expect(calls.dragBrowserIds).toEqual([undefined])
    expect(calls.handleDialog).toEqual([{ action: "accept", promptText: "typed prompt", browserId: undefined }])
    expect(calls.typeText).toEqual([{ selector: "input[name='email']", text: "hello@example.com" }])
    expect(calls.typeBrowserIds).toEqual([undefined])
    expect(calls.pressKey).toEqual(["Enter"])
    expect(calls.uploadFile).toEqual([{ selector: "input[type='file']", fileRef: "fixtures/upload.txt", workspaceRoot: undefined, browserId: undefined }])
    expect(calls.listDownloads).toBe(1)
    expect(calls.getAnnotationDetail).toEqual(["annotation-1"])
    expect(calls.storeAnnotationDetail).toEqual([{ id: "annotation-1", detail: { pageTitle: "Checkout" } }])
    expect(calls.startInspectMode).toBe(1)
    expect(calls.stopInspectMode).toBe(1)
    expect(calls.getSnapshot).toBe(2)
    expect(calls.getAnnotationData).toEqual(["button.primary", "missing"])
  })

  test("routes optional browserId params while keeping legacy IPC calls compatible", async () => {
    registerBrowserIpcHandlers({ completed: false })

    await handlers.get("browser-navigate")?.({}, { url: "first.example", browserId: "browser-1" })
    await handlers.get("browser-click")?.({}, { selector: "button.first", browserId: "browser-1" })
    await handlers.get("browser-hover")?.({}, { selector: "button.hover", browserId: "browser-1" })
    await handlers.get("browser-drag")?.({}, { selector: "#card", targetSelector: "#lane", browserId: "browser-1" })
    await handlers.get("browser-handle-dialog")?.({}, { action: "dismiss", browserId: "browser-1" })
    await handlers.get("browser-type")?.({}, { selector: "input.first", text: "hello", browserId: "browser-1" })

    expect(calls.navigate).toEqual(["first.example"])
    expect(calls.navigateBrowserIds).toEqual(["browser-1"])
    expect(calls.click).toEqual(["button.first"])
    expect(calls.clickBrowserIds).toEqual(["browser-1"])
    expect(calls.hoverElement).toEqual(["button.hover"])
    expect(calls.hoverBrowserIds).toEqual(["browser-1"])
    expect(calls.dragElement).toEqual([{ selector: "#card", targetSelector: "#lane" }])
    expect(calls.dragBrowserIds).toEqual(["browser-1"])
    expect(calls.handleDialog).toEqual([{ action: "dismiss", promptText: undefined, browserId: "browser-1" }])
    expect(calls.typeText).toEqual([{ selector: "input.first", text: "hello" }])
    expect(calls.typeBrowserIds).toEqual(["browser-1"])
  })

  test("returns false when browser-drag cannot dispatch in the page", async () => {
    registerBrowserIpcHandlers({ completed: false })

    await expect(handlers.get("browser-drag")?.({}, { selector: "#missing-source", targetSelector: "#target", browserId: "browser-1" })).resolves.toBe(false)

    expect(calls.dragElement).toEqual([{ selector: "#missing-source", targetSelector: "#target" }])
    expect(calls.dragBrowserIds).toEqual(["browser-1"])
  })

  test("rejects object payloads with invalid browserId instead of falling back", async () => {
    registerBrowserIpcHandlers({ completed: false })

    await expect(handlers.get("browser-navigate")?.({}, { url: "blocked.example", browserId: 123 })).rejects.toThrow("browserId must be a string")
    await expect(handlers.get("browser-activate")?.({}, { browserId: 123 })).rejects.toThrow("browserId must be a string")

    expect(calls.navigate).toEqual([])
  })

  test("rejects object payloads missing required keys", async () => {
    registerBrowserIpcHandlers({ completed: false })

    await expect(handlers.get("browser-navigate")?.({}, { browserId: "browser-1" })).rejects.toThrow("url must be a string")
    await expect(handlers.get("browser-click")?.({}, { browserId: "browser-1" })).rejects.toThrow("selector must be a string")
    await expect(handlers.get("browser-hover")?.({}, { browserId: "browser-1" })).rejects.toThrow("selector must be a string")
    await expect(handlers.get("browser-drag")?.({}, { selector: "#card", browserId: "browser-1" })).rejects.toThrow("targetSelector must be a string")
    await expect(handlers.get("browser-handle-dialog")?.({}, { promptText: "missing action" })).rejects.toThrow("action must be accept or dismiss")
    await expect(handlers.get("browser-handle-dialog")?.({}, { action: "accept", promptText: 123 })).rejects.toThrow("promptText must be a string")

    expect(calls.navigate).toEqual([])
    expect(calls.click).toEqual([])
    expect(calls.hoverElement).toEqual([])
    expect(calls.dragElement).toEqual([])
    expect(calls.handleDialog).toEqual([])
  })

  test("rejects malformed bounds object payloads", async () => {
    registerBrowserIpcHandlers({ completed: false })
    const before = (await handlers.get("browser-list")?.()) as { browsers: Array<{ id: string }> }

    expect(() => listeners.get("browser-set-bounds")?.({}, { bounds: { x: 1, y: 2, width: "wide", height: 4 }, browserId: "browser-1" })).toThrow(
      "bounds.width must be a number",
    )
    await expect(handlers.get("browser-create")?.({ sender: {} }, { bounds: { x: 1, y: 2, width: 3 } })).rejects.toThrow("bounds.height must be a number")
    const after = (await handlers.get("browser-list")?.()) as { browsers: Array<{ id: string }> }

    expect(calls.setBrowserViewBounds).toEqual([])
    expect(after.browsers).toHaveLength(before.browsers.length)
  })

  test("routes explicit nonexistent string browserId without creating an accidental browser", async () => {
    registerBrowserIpcHandlers({ completed: false })

    const before = (await handlers.get("browser-list")?.()) as { browsers: Array<{ id: string }> }

    await handlers.get("browser-navigate")?.({}, { url: "missing.example", browserId: "missing-browser" })
    const activated = (await handlers.get("browser-activate")?.({}, { browserId: "missing-browser" })) as { success: boolean }
    const after = (await handlers.get("browser-list")?.()) as { browsers: Array<{ id: string }> }

    expect(calls.navigate).toEqual(["missing.example"])
    expect(calls.navigateBrowserIds).toEqual(["missing-browser"])
    expect(activated.success).toBe(false)
    expect(after.browsers).toHaveLength(before.browsers.length)
    expect(after.browsers.some((browser) => browser.id === "missing-browser")).toBe(false)
  })

  test("routes upload object params with browserId while keeping legacy positional args compatible", async () => {
    registerBrowserIpcHandlers({ completed: false })

    await handlers.get("browser-upload-file")?.({}, { selector: "input.upload", fileRef: "fixtures/avatar.png", workspaceRoot: "C:/workspace", browserId: "browser-2" })
    await handlers.get("browser-upload-file")?.({}, "input.legacy", "fixtures/legacy.txt", "C:/legacy")

    expect(calls.uploadFile).toEqual([
      { selector: "input.upload", fileRef: "fixtures/avatar.png", workspaceRoot: "C:/workspace", browserId: "browser-2" },
      { selector: "input.legacy", fileRef: "fixtures/legacy.txt", workspaceRoot: "C:/legacy", browserId: undefined },
    ])
  })

  test("browser-state returns closed empty state without creating a browser when no active browser exists", async () => {
    browserView = null
    hasReadableBrowser = false
    registerBrowserIpcHandlers({ completed: false })

    expect(await handlers.get("browser-state")?.()).toEqual({
      ...emptyBrowserState,
      title: "",
    })
    expect(calls.getBrowserPanelState).toEqual([undefined])
    expect(calls.createdByTitleRead).toEqual([])
    expect(await handlers.get("browser-screenshot")?.()).toBeNull()
  })

  test("browser-state with an explicit missing browserId returns closed empty state without creating", async () => {
    hasReadableBrowser = false
    registerBrowserIpcHandlers({ completed: false })

    expect(await handlers.get("browser-state")?.({}, { browserId: "missing-browser" })).toEqual({
      ...emptyBrowserState,
      title: "",
    })
    expect(calls.getBrowserPanelState).toEqual(["missing-browser"])
    expect(calls.createdByTitleRead).toEqual([])
  })

  test("skips duplicate registration when called twice", () => {
    const registration = { completed: false }

    registerBrowserIpcHandlers(registration)
    registerBrowserIpcHandlers(registration)

    expect(onCalls).toEqual([
      "browser-attach",
      "browser-set-bounds",
      "browser-show",
      "browser-hide",
    ])
    expect(handleCalls).toEqual([
      "browser-open",
      "browser-navigate",
      "browser-back",
      "browser-forward",
      "browser-reload",
      "browser-clear-data",
      "browser-state",
      "browser-screenshot",
      "browser-inspect-start",
      "browser-inspect-stop",
      "browser-annotation-markers-clear",
       "browser-click",
       "browser-hover",
       "browser-drag",
       "browser-handle-dialog",
       "browser-run-code",
       "browser-run-playwright-code",
       "browser-type",
       "browser-press",
        "browser-upload-file",
        "browser-downloads-list",
        "browser-annotation-get-detail",
        "browser-inspect",
        "browser-get-snapshot",
        "browser-get-annotation-data",
        "browser-store-annotation-detail",
        "browser-console-messages",
        "browser-console-clear",
        "browser-create",
        "browser-list",
        "browser-activate",
        "browser-close",
    ])
  })
})
