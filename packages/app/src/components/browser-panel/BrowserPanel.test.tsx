/** @jsxImportSource solid-js */
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import type {
  BrowserAPI,
  BrowserAnnotation,
  BrowserBounds,
  BrowserConsoleEntry,
  BrowserInspectResult,
  BrowserState,
} from "@/context/browser-types"
import type { ContentPart, Prompt } from "@/context/prompt"

let BrowserPanel: typeof import("./BrowserPanel").BrowserPanel
let applyInspectResult: typeof import("./BrowserPanel").applyInspectResult
let getBrowserPanelBounds: typeof import("./BrowserPanel").getBrowserPanelBounds
let createAnnotationStoreForTest: typeof import("../../context/annotation-store").createAnnotationStoreForTest
let getNextBrowserIdAfterClose: typeof import("../../context/browser-store").getNextBrowserIdAfterClose
let annotations: ReturnType<typeof import("../../context/annotation-store").createAnnotationStoreForTest>
let createSignal: typeof import("solid-js").createSignal
let createStore: typeof import("solid-js/store").createStore
let render: typeof import("solid-js/web").render
let dispose: VoidFunction | undefined
let dialogActive = () => false
let setDialogActive: ((active: boolean) => void) | undefined
let browsers: {
  store: {
    activeId: string | null
    instances?: Record<string, { id: string; title: string; url: string; visible: boolean }>
  }
  addBrowser?: (id: string) => void
  removeBrowser?: (id: string) => void
  setActiveBrowser?: (id: string) => void
}
let resizeObserverCallback: VoidFunction | undefined
let promptParts: Prompt
let promptCursor: number | undefined

function createPanelController(opened = false) {
  const calls = {
    close: 0,
    open: 0,
    toggle: 0,
  }
  let value = opened

  return {
    calls,
    controller: {
      opened: () => value,
      open() {
        calls.open += 1
        value = true
      },
      close() {
        calls.close += 1
        value = false
      },
      toggle() {
        calls.toggle += 1
        value = !value
      },
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function createBrowserApi(state: Partial<BrowserState> = {}) {
  const currentState: BrowserState = {
    visible: false,
    url: "https://opencode.ai",
    title: "OpenCode",
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    inspectMode: false,
    ...state,
  }
  type InspectResult = Awaited<ReturnType<BrowserAPI["startInspectMode"]>>
  const inspectQueue = [deferred<InspectResult>()]
  let consoleEntries: BrowserConsoleEntry[] = []
  function toolInspect(): Promise<import("@/context/browser-types").BrowserSnapshot>
  function toolInspect(selector: string): Promise<import("@/context/browser-types").BrowserAnnotationData | null>
  function toolInspect(
    selector?: string,
  ): Promise<import("@/context/browser-types").BrowserSnapshot | import("@/context/browser-types").BrowserAnnotationData | null> {
    if (selector) return Promise.resolve(null)
    return Promise.resolve({ elements: [], title: currentState.title, url: currentState.url })
  }
  const calls = {
    attach: [] as Array<string | undefined>,
    back: 0,
    closeBrowser: [] as string[],
    clearConsoleMessages: [] as Array<{ browserId?: string } | undefined>,
    createBrowser: [] as Array<{ bounds?: BrowserBounds; url?: string } | undefined>,
    forward: 0,
    getConsoleMessages: [] as Array<{ browserId?: string; levels?: BrowserConsoleEntry["level"][]; limit?: number } | undefined>,
    getState: 0,
    hide: [] as Array<string | undefined>,
    navigate: [] as string[],
    onOpenRequested: 0,
    open: 0,
    reload: 0,
    screenshot: 0,
    setActiveBrowser: [] as string[],
    setBounds: [] as Array<{ bounds: BrowserBounds; browserId?: string }>,
    show: [] as Array<string | undefined>,
    startInspectMode: 0,
    storeAnnotationDetail: [] as Array<{ id: string; detail: unknown }>,
    stopInspectMode: 0,
  }
  let openRequested: (() => void) | undefined

  const browser: BrowserAPI = {
    attach(browserId?: string) {
      calls.attach.push(browserId)
    },
    back() {
      calls.back += 1
      return Promise.resolve({ title: currentState.title, url: currentState.url })
    },
    clearData() {
      return Promise.resolve()
    },
    closeBrowser(browserId: string) {
      calls.closeBrowser.push(browserId)
      return Promise.resolve({ success: true, state: { activeBrowserId: "browser-1", browsers: [] } })
    },
    clearConsoleMessages(params?: { browserId?: string }) {
      calls.clearConsoleMessages.push(params)
      const browserId = params?.browserId ?? "default"
      const count = consoleEntries.filter((entry) => entry.browserId === browserId).length
      consoleEntries = consoleEntries.filter((entry) => entry.browserId !== browserId)
      return Promise.resolve({ browserId, count })
    },
    createBrowser(params?: { bounds?: BrowserBounds; url?: string }) {
      calls.createBrowser.push(params)
      return Promise.resolve({
        browser: {
          id: "browser-created",
          title: "",
          url: "",
          state: { ...currentState },
        },
        state: { activeBrowserId: "browser-created", browsers: [] },
      })
    },
    forward() {
      calls.forward += 1
      return Promise.resolve({ title: currentState.title, url: currentState.url })
    },
    getAnnotationData() {
      return Promise.resolve(null)
    },
    getConsoleMessages(params?: { browserId?: string; levels?: BrowserConsoleEntry["level"][]; limit?: number }) {
      calls.getConsoleMessages.push(params)
      const browserId = params?.browserId ?? "default"
      const entries = consoleEntries.filter((entry) => entry.browserId === browserId)
      return Promise.resolve({ browserId, entries })
    },
    getState() {
      calls.getState += 1
      return Promise.resolve({ ...currentState })
    },
    hide(browserId?: string) {
      calls.hide.push(browserId)
    },
    onOpenRequested(callback: () => void) {
      calls.onOpenRequested += 1
      openRequested = callback
      return () => {
        if (openRequested === callback) openRequested = undefined
      }
    },
    navigate(url: string) {
      calls.navigate.push(url)
      currentState.url = url
      return Promise.resolve({ title: currentState.title, url })
    },
    open() {
      calls.open += 1
      openRequested?.()
      return Promise.resolve({ ...currentState })
    },
    reload() {
      calls.reload += 1
      return Promise.resolve()
    },
    screenshot() {
      calls.screenshot += 1
      return Promise.resolve(null)
    },
    setActiveBrowser(browserId: string) {
      calls.setActiveBrowser.push(browserId)
      return Promise.resolve({ success: true, state: { activeBrowserId: browserId, browsers: [] } })
    },
    setBounds(bounds: BrowserBounds, browserId?: string) {
      calls.setBounds.push({ bounds, browserId })
    },
    show(browserId?: string) {
      calls.show.push(browserId)
    },
    startInspectMode() {
      calls.startInspectMode += 1
      if (!inspectQueue[calls.startInspectMode - 1]) inspectQueue.push(deferred<InspectResult>())
      return (inspectQueue[calls.startInspectMode - 1] ?? inspectQueue.at(-1))!.promise
    },
    storeAnnotationDetail(id, detail) {
      calls.storeAnnotationDetail.push({ detail, id })
      return Promise.resolve()
    },
    stopInspectMode() {
      calls.stopInspectMode += 1
      return Promise.resolve()
    },
    toolClick() {
      return Promise.resolve()
    },
    toolGetAnnotationDetail() {
      return Promise.resolve(null)
    },
    toolGetSnapshot() {
      return Promise.resolve({ elements: [], title: currentState.title, url: currentState.url })
    },
    toolInspect,
    toolPress() {
      return Promise.resolve()
    },
    toolType() {
      return Promise.resolve()
    },
  }

  return {
    browser,
    calls,
    inspect: inspectQueue[0]!,
    nextInspect() {
      const inspect = deferred<InspectResult>()
      inspectQueue.push(inspect)
      return inspect
    },
    requestOpen() {
      openRequested?.()
    },
    setConsoleEntries(entries: BrowserConsoleEntry[]) {
      consoleEntries = entries
    },
    state: currentState,
  }
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function captureUnhandledRejections(action: () => void | Promise<void>) {
  const reasons: unknown[] = []
  const handler = (reason: unknown) => reasons.push(reason)
  process.on("unhandledRejection", handler)
  await action()
  await flush()
  process.off("unhandledRejection", handler)
  return reasons
}

function getButton(text: string) {
  const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === text)
  expect(button).toBeTruthy()
  return button as HTMLButtonElement
}

function getButtonByLabel(label: string) {
  const button = document.querySelector(`button[aria-label="${label}"]`)
  expect(button).toBeTruthy()
  return button as HTMLButtonElement
}

function getInput() {
  const input = document.querySelector('input[aria-label="Browser URL"]')
  expect(input).toBeTruthy()
  return input as HTMLInputElement
}

function createBrowserAnnotation(id: string, x: number, y: number): BrowserAnnotation {
  return {
    id,
    createdAt: 1,
    pageTitle: "Checkout",
    pageUrl: "https://opencode.ai/checkout",
    userComment: `Note ${id}`,
    element: {
      attributes: {},
      boundingBox: { height: 24, width: 96, x, y },
      selector: `#${id}`,
      tagName: "button",
      visibleText: `Target ${id}`,
    },
    preview: {},
    context: {},
  }
}

function createPendingAnnotation(x = 48, y = 72) {
  return {
    element: {
      attributes: {},
      boundingBox: { height: 24, width: 96, x, y },
      nearbyDomSanitized: "Buy now Secure checkout",
      selector: "#pending-target",
      tagName: "button",
      visibleText: "Buy now",
    },
    pageTitle: "Checkout",
    pageUrl: "https://opencode.ai/checkout",
    preview: {},
  }
}

function promptImageAttachments() {
  return promptParts.filter((part) => part.type === "image")
}

function getAnnotationMarker(number: number) {
  const marker = document.querySelector(`[aria-label="Annotation ${number}"]`)
  expect(marker).toBeTruthy()
  return marker as HTMLElement
}

function getAnnotationMarkerTexts() {
  return [...document.querySelectorAll('[aria-label^="Annotation "]')].map((marker) => marker.textContent?.trim())
}

function getAnnotationEditor() {
  const editor = document.querySelector('[role="dialog"][aria-label="Annotation note"]')
  expect(editor).toBeTruthy()
  return editor as HTMLElement
}

function getAnnotationCommentInput() {
  const input = document.querySelector('textarea[aria-label="Annotation comment"]')
  expect(input).toBeTruthy()
  return input as HTMLTextAreaElement
}

function writeAnnotationComment(value: string) {
  const input = getAnnotationCommentInput()
  input.value = value
  input.dispatchEvent(new InputEvent("input", { bubbles: true }))
  return input
}

async function mountPanel(
  initial?: Parameters<typeof createAnnotationStoreForTest>[0],
  panel?: ReturnType<typeof createPanelController>["controller"],
) {
  annotations = createAnnotationStoreForTest(initial)
  const host = document.createElement("div")
  document.body.append(host)
  dispose = render(() => BrowserPanel({ panel }), host)
  await flush()
  return host
}

beforeAll(async () => {
  mock.module("solid-js", () => import("solid-js/dist/solid.js"))
  mock.module("solid-js/store", () => import("solid-js/store/dist/store.js"))
  mock.module("solid-js/web", () => import("solid-js/web/dist/web.js"))
  const { default: h } = await import("solid-js/h")
  render = (await import("solid-js/web")).render
  Object.assign(globalThis, {
    React: { Fragment: h.Fragment, createElement: h },
  })
  createAnnotationStoreForTest = (await import("../../context/annotation-store")).createAnnotationStoreForTest
  createSignal = (await import("solid-js")).createSignal
  createStore = (await import("solid-js/store")).createStore
  mock.module("@solid-primitives/resize-observer", () => ({
    createResizeObserver(_target: unknown, callback: VoidFunction) {
      resizeObserverCallback = callback
    },
  }))
  mock.module("@/context/annotation-store", () => ({
    useAnnotationStore: () => annotations,
  }))
  mock.module("@/context/prompt", () => ({
    usePrompt: () => ({
      current: () => promptParts,
      cursor: () => promptCursor,
      set(next: Prompt, cursor?: number) {
        promptParts = next.map((part): ContentPart => ({ ...part }))
        promptCursor = cursor
      },
      reset() {
        promptParts = [{ type: "text", content: "", start: 0, end: 0 }]
        promptCursor = 0
      },
    }),
  }))
  getNextBrowserIdAfterClose = (await import("../../context/browser-store")).getNextBrowserIdAfterClose
  mock.module("@/context/browser-store", () => ({
    getNextBrowserIdAfterClose,
    useBrowserStore: () => browsers,
  }))
  mock.module("@opencode-ai/ui/context/dialog", () => ({
    useDialog: () => ({
      get active() {
        return dialogActive() ? { id: "dialog" } : undefined
      },
    }),
  }))

  const mod = await import("./BrowserPanel")
  BrowserPanel = mod.BrowserPanel
  applyInspectResult = mod.applyInspectResult
  getBrowserPanelBounds = mod.getBrowserPanelBounds
})

beforeEach(() => {
  annotations = createAnnotationStoreForTest()
  const [browserStore] = createStore({ activeId: null as string | null })
  browsers = { store: browserStore }
  dispose = undefined
  resizeObserverCallback = undefined
  promptParts = [{ type: "text", content: "", start: 0, end: 0 }]
  promptCursor = undefined
  document.body.innerHTML = ""
  const [active, setActive] = createSignal(false)
  dialogActive = active
  setDialogActive = setActive
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  delete window.api
  document.body.innerHTML = ""
})

describe("BrowserPanel", () => {
  test("clamps and rounds browser view bounds before syncing them to desktop", () => {
    expect(
      getBrowserPanelBounds({
        height: 199.6,
        left: -12.2,
        top: 20.4,
        width: 320.8,
      } as Pick<DOMRect, "height" | "left" | "top" | "width">),
    ).toEqual({
      height: 200,
      width: 321,
      x: 0,
      y: 20,
    })
  })

  test("stores completed inspect results from the page overlay", () => {
    const calls: BrowserInspectResult[] = []

    expect(
      applyInspectResult(
        {
          addAnnotationFromInspectResult(result) {
            calls.push(result)
            return undefined
          },
        },
        {
          annotation: {
            accessibleName: "Buy now",
            attributes: { role: "button" },
            boundingBox: { height: 24, width: 96, x: 12, y: 24 },
            nearbyDomSanitized: "Buy now Secure checkout",
            role: "button",
            selector: "button.buy-now",
            tagName: "button",
            visibleText: "Buy now",
            xpath: "/html/body/button[1]",
          },
          pageTitle: "Checkout",
          pageUrl: "https://opencode.ai/checkout",
          userComment: "Primary CTA is misleading",
        },
      ),
    ).toBe(true)

    expect(calls).toEqual([
      {
        annotation: {
          accessibleName: "Buy now",
          attributes: { role: "button" },
          boundingBox: { height: 24, width: 96, x: 12, y: 24 },
          nearbyDomSanitized: "Buy now Secure checkout",
          role: "button",
          selector: "button.buy-now",
          tagName: "button",
          visibleText: "Buy now",
          xpath: "/html/body/button[1]",
        },
        pageTitle: "Checkout",
        pageUrl: "https://opencode.ai/checkout",
        userComment: "Primary CTA is misleading",
      },
    ])
  })

  test("ignores canceled inspect sessions", () => {
    const calls: BrowserInspectResult[] = []

    expect(
      applyInspectResult(
        {
          addAnnotationFromInspectResult(result) {
            calls.push(result)
            return undefined
          },
        },
        null,
      ),
    ).toBe(false)

    expect(calls).toEqual([])
  })

  test("opens the rendered panel through the desktop browser lifecycle", async () => {
    const api = createBrowserApi()
    const panel = createPanelController()
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel(undefined, panel.controller)
    getButtonByLabel("Navigate to URL").click()
    await flush()

    expect(panel.calls.open).toBe(1)
    expect(annotations.store.panelOpen).toBe(true)
    expect(api.calls.attach).toHaveLength(1)
    expect(api.calls.show).toHaveLength(1)
    expect(api.calls.onOpenRequested).toBe(1)
  })

  test("opens the browser panel when the desktop process requests it", async () => {
    const api = createBrowserApi()
    const panel = createPanelController()
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel(undefined, panel.controller)
    api.requestOpen()
    await flush()

    expect(panel.calls.open).toBe(1)
    expect(annotations.store.panelOpen).toBe(true)
    expect(api.calls.attach).toHaveLength(1)
    expect(api.calls.show).toHaveLength(1)
  })

  test("attaches and shows the desktop browser when the top-right panel toggle opens it", async () => {
    const api = createBrowserApi()
    const [opened, setOpened] = createSignal(false)
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel(undefined, {
      opened,
      open: () => setOpened(true),
      close: () => setOpened(false),
      toggle: () => setOpened(!opened()),
    })
    setOpened(true)
    await flush()

    expect(annotations.store.panelOpen).toBe(true)
    expect(api.calls.attach).toHaveLength(1)
    expect(api.calls.show).toHaveLength(1)

    await flush()

    expect(api.calls.attach).toHaveLength(1)
    expect(api.calls.show).toHaveLength(1)
  })

  test("keeps the layout panel controller and annotation panel state synchronized on close", async () => {
    const api = createBrowserApi()
    const panel = createPanelController(true)
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true }, panel.controller)
    getButtonByLabel("Close browser panel").click()
    await flush()

    expect(panel.calls.close).toBe(1)
    expect(panel.controller.opened()).toBe(false)
    expect(annotations.store.panelOpen).toBe(false)
    expect(api.calls.hide).toHaveLength(1)
  })

  test("hides the desktop WebContentsView when the browser panel unmounts", async () => {
    const api = createBrowserApi()
    const panel = createPanelController(true)
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true }, panel.controller)
    dispose?.()
    dispose = undefined
    await flush()

    expect(api.calls.hide).toHaveLength(1)
  })

  test("hides the desktop WebContentsView while a dialog overlays the browser panel and restores it when closed", async () => {
    const api = createBrowserApi()
    const [opened, setOpened] = createSignal(true)
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true }, {
      opened,
      open: () => setOpened(true),
      close: () => setOpened(false),
      toggle: () => setOpened(!opened()),
    })
    await flush()

    expect(api.calls.show).toHaveLength(1)

    setDialogActive?.(true)
    await flush()

    expect(api.calls.hide).toHaveLength(1)

    setDialogActive?.(false)
    await flush()

    expect(api.calls.show).toHaveLength(2)
  })

  test("syncs bounds and closes the rendered panel when already visible", async () => {
    const api = createBrowserApi()
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })

    const view = document.querySelector(".browser-panel-view") as HTMLDivElement
    expect(view).toBeTruthy()
    view.getBoundingClientRect = () => ({ height: 199.6, left: -12.2, top: 20.4, width: 320.8 } as DOMRect)
    getButtonByLabel("Navigate to URL").click()
    await flush()

    expect(api.calls.setBounds).toContainEqual({ bounds: { height: 200, width: 321, x: 0, y: 20 }, browserId: undefined })

    getButtonByLabel("Close browser panel").click()
    await flush()

    expect(annotations.store.panelOpen).toBe(false)
    expect(api.calls.hide).toHaveLength(1)
    expect(api.calls.stopInspectMode).toBe(1)
  })

  test("drives navigation actions from the rendered toolbar", async () => {
    const api = createBrowserApi({ url: "https://opencode.ai/start" })
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })

    const input = getInput()
    input.value = " https://opencode.ai/docs "
    input.dispatchEvent(new InputEvent("input", { bubbles: true }))
    getButtonByLabel("Navigate to URL").click()
    getButtonByLabel("Reload page").click()
    await flush()

    expect(api.calls.navigate).toEqual(["https://opencode.ai/docs"])
    expect(api.calls.reload).toBe(1)
  })

  test("adds a successful screenshot to the prompt and announces capture feedback", async () => {
    const api = createBrowserApi()
    api.browser.screenshot = () => {
      api.calls.screenshot += 1
      return Promise.resolve("SCREENSHOT_BASE64")
    }
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })
    getButtonByLabel("Take screenshot").click()
    await flush()

    expect(api.calls.screenshot).toBe(1)
    expect(promptImageAttachments()).toHaveLength(1)
    expect(promptImageAttachments()[0]).toMatchObject({
      dataUrl: "data:image/png;base64,SCREENSHOT_BASE64",
      mime: "image/png",
      type: "image",
    })
    expect(promptImageAttachments()[0]?.filename).toStartWith("screenshot-")
    expect(getButtonByLabel("Screenshot captured").getAttribute("title")).toBe("Screenshot captured")
  })

  test("does not add a prompt attachment when screenshot capture returns no data", async () => {
    const api = createBrowserApi()
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })
    getButtonByLabel("Take screenshot").click()
    await flush()

    expect(api.calls.screenshot).toBe(1)
    expect(promptImageAttachments()).toEqual([])
  })

  test("keeps screenshot failures quiet without unhandled rejections", async () => {
    const api = createBrowserApi()
    api.browser.screenshot = () => {
      api.calls.screenshot += 1
      return Promise.reject(new Error("screenshot failed"))
    }
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })
    const reasons = await captureUnhandledRejections(() => {
      getButtonByLabel("Take screenshot").click()
    })

    expect(api.calls.screenshot).toBe(1)
    expect(promptImageAttachments()).toEqual([])
    expect(reasons).toEqual([])
  })

  test("keeps navigate failures quiet without unhandled rejections", async () => {
    const api = createBrowserApi({ url: "https://opencode.ai/start" })
    api.browser.navigate = (url: string) => {
      api.calls.navigate.push(url)
      return Promise.reject(new Error("navigate failed"))
    }
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })

    const input = getInput()
    input.value = " https://opencode.ai/docs "
    input.dispatchEvent(new InputEvent("input", { bubbles: true }))
    const reasons = await captureUnhandledRejections(() => {
      getButtonByLabel("Navigate to URL").click()
    })

    expect(api.calls.navigate).toEqual(["https://opencode.ai/docs"])
    expect(reasons).toEqual([])
  })

  test("keeps state sync failures quiet without unhandled rejections", async () => {
    const api = createBrowserApi()
    api.browser.getState = () => {
      api.calls.getState += 1
      return Promise.reject(new Error("getState failed"))
    }
    window.api = { browser: api.browser } as typeof window.api

    const reasons = await captureUnhandledRejections(async () => {
      await mountPanel({ panelOpen: true })
    })

    expect(api.calls.getState).toBeGreaterThan(0)
    expect(reasons).toEqual([])
  })

  test("keeps reload failures quiet without unhandled rejections", async () => {
    const api = createBrowserApi()
    api.browser.reload = () => {
      api.calls.reload += 1
      return Promise.reject(new Error("reload failed"))
    }
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })
    const reasons = await captureUnhandledRejections(() => {
      getButtonByLabel("Reload page").click()
    })

    expect(api.calls.reload).toBe(1)
    expect(reasons).toEqual([])
  })

  test("keeps back failures quiet without unhandled rejections", async () => {
    const api = createBrowserApi({ canGoBack: true })
    api.browser.back = () => {
      api.calls.back += 1
      return Promise.reject(new Error("back failed"))
    }
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })
    await flush()
    getButtonByLabel("Go back").disabled = false
    const reasons = await captureUnhandledRejections(() => {
      getButtonByLabel("Go back").click()
    })

    expect(api.calls.back).toBe(1)
    expect(reasons).toEqual([])
  })

  test("keeps forward failures quiet without unhandled rejections", async () => {
    const api = createBrowserApi({ canGoForward: true })
    api.browser.forward = () => {
      api.calls.forward += 1
      return Promise.reject(new Error("forward failed"))
    }
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })
    await flush()
    getButtonByLabel("Go forward").disabled = false
    const reasons = await captureUnhandledRejections(() => {
      getButtonByLabel("Go forward").click()
    })

    expect(api.calls.forward).toBe(1)
    expect(reasons).toEqual([])
  })

  test("keeps active browser activation failures quiet without unhandled rejections", async () => {
    const api = createBrowserApi()
    const [browserStore] = createStore({ activeId: "browser-1" as string | null })
    browsers = { store: browserStore }
    api.browser.setActiveBrowser = (browserId: string) => {
      api.calls.setActiveBrowser.push(browserId)
      return Promise.reject(new Error("activate failed"))
    }
    window.api = { browser: api.browser } as typeof window.api

    const reasons = await captureUnhandledRejections(async () => {
      await mountPanel({ panelOpen: true })
    })

    expect(api.calls.setActiveBrowser).toContain("browser-1")
    expect(reasons).toEqual([])
  })

  test("starts inspect mode from the rendered toolbar and persists the completed annotation", async () => {
    const api = createBrowserApi()
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })
    getButtonByLabel("Annotate page").click()
    await flush()

    expect(api.calls.startInspectMode).toBe(1)
    expect(getButtonByLabel("Annotate page").getAttribute("aria-pressed")).toBe("true")

    api.inspect.resolve({
      annotation: {
        accessibleName: "Buy now",
        attributes: { role: "button" },
        boundingBox: { height: 32, width: 120, x: 12, y: 24 },
        nearbyDomSanitized: "Buy now Secure checkout",
        role: "button",
        selector: "button.buy-now",
        tagName: "button",
        visibleText: "Buy now",
        xpath: "/html/body/button[1]",
      },
      context: {
        accessibilitySnapshotNearby: { role: "button" },
        nearbyDomSanitized: "Buy now Secure checkout",
      },
      pageTitle: "Checkout",
      pageUrl: "https://opencode.ai/checkout",
      preview: {
        screenshotCrop: "data:image/png;base64,AAA",
        viewportScreenshotId: "browser-screenshot-1",
      },
      userComment: "Primary CTA is misleading",
      viewportScreenshot: {
        createdAt: 1,
        id: "browser-screenshot-1",
        imageData: "data:image/png;base64,VIEWPORT",
        pageTitle: "Checkout",
        pageUrl: "https://opencode.ai/checkout",
        viewport: { deviceScaleFactor: 1, height: 768, width: 1280 },
      },
    })
    await flush()

    expect(annotations.store.pendingAnnotation).toBeNull()
    expect(annotations.store.inspectMode).toBe(true)
    expect(getButtonByLabel("Annotate page").getAttribute("aria-pressed")).toBe("true")
    expect(annotations.store.annotations).toHaveLength(1)
    expect(annotations.store.annotations[0]).toMatchObject({
      context: {
        accessibilitySnapshotNearby: { role: "button" },
      },
      pageTitle: "Checkout",
      pageUrl: "https://opencode.ai/checkout",
      preview: {
        screenshotCrop: "data:image/png;base64,AAA",
        viewportScreenshotId: "browser-screenshot-1",
      },
      userComment: "Primary CTA is misleading",
      element: {
        selector: "button.buy-now",
      },
    })
    expect(api.calls.storeAnnotationDetail).toEqual([
      {
        id: annotations.store.annotations[0]?.id,
        detail: {
          context: {
            accessibilitySnapshotNearby: { role: "button" },
            nearbyDomSanitized: "Buy now Secure checkout",
          },
          element: {
            accessibleName: "Buy now",
            attributes: { role: "button" },
            boundingBox: { height: 32, width: 120, x: 12, y: 24 },
            role: "button",
            selector: "button.buy-now",
            tagName: "button",
            visibleText: "Buy now",
            xpath: "/html/body/button[1]",
          },
          id: annotations.store.annotations[0]?.id,
          pageTitle: "Checkout",
          pageUrl: "https://opencode.ai/checkout",
          preview: {
            screenshotCrop: "data:image/png;base64,AAA",
            viewportScreenshotId: "browser-screenshot-1",
          },
          userComment: "Primary CTA is misleading",
          viewportScreenshot: {
            createdAt: 1,
            id: "browser-screenshot-1",
            imageData: "data:image/png;base64,VIEWPORT",
            pageTitle: "Checkout",
            pageUrl: "https://opencode.ai/checkout",
            viewport: { deviceScaleFactor: 1, height: 768, width: 1280 },
          },
        },
      },
    ])
  })

  test("re-arms browser inspect after a completed annotation while the toolbar remains pressed", async () => {
    const api = createBrowserApi()
    const nextInspect = api.nextInspect()
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })
    getButtonByLabel("Annotate page").click()
    await flush()

    api.inspect.resolve({
      annotation: {
        attributes: {},
        boundingBox: { height: 32, width: 120, x: 12, y: 24 },
        nearbyDomSanitized: "Buy now Secure checkout",
        selector: "button.buy-now",
        tagName: "button",
        visibleText: "Buy now",
      },
      pageTitle: "Checkout",
      pageUrl: "https://opencode.ai/checkout",
      userComment: "Primary CTA is misleading",
    })
    await flush()

    expect(api.calls.startInspectMode).toBe(2)
    expect(annotations.store.inspectMode).toBe(true)
    expect(getButtonByLabel("Annotate page").getAttribute("aria-pressed")).toBe("true")

    nextInspect.resolve(null)
    await flush()

    expect(annotations.store.inspectMode).toBe(false)
    expect(getButtonByLabel("Annotate page").getAttribute("aria-pressed")).toBe("false")
  })

  test("turns inspect mode off when the pressed annotation toolbar button is clicked again", async () => {
    const api = createBrowserApi()
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ inspectMode: true, panelOpen: true })
    const annotate = getButtonByLabel("Annotate page")

    expect(annotate.getAttribute("aria-pressed")).toBe("true")
    annotate.click()
    await flush()

    expect(annotations.store.inspectMode).toBe(false)
    expect(annotate.getAttribute("aria-pressed")).toBe("false")
    expect(api.calls.stopInspectMode).toBe(1)
    expect(api.calls.startInspectMode).toBe(0)
  })

  test("turns inspect mode off during a pending inspect session and prevents re-arm", async () => {
    const api = createBrowserApi()
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })
    const annotate = getButtonByLabel("Annotate page")
    annotate.click()
    await flush()

    expect(api.calls.startInspectMode).toBe(1)
    expect(annotations.store.inspectMode).toBe(true)
    expect(annotate.disabled).toBe(false)

    annotate.click()
    await flush()

    expect(annotations.store.inspectMode).toBe(false)
    expect(api.calls.stopInspectMode).toBe(1)

    api.inspect.resolve({
      annotation: {
        attributes: {},
        boundingBox: { height: 32, width: 120, x: 12, y: 24 },
        nearbyDomSanitized: "Buy now Secure checkout",
        selector: "button.buy-now",
        tagName: "button",
        visibleText: "Buy now",
      },
      pageTitle: "Checkout",
      pageUrl: "https://opencode.ai/checkout",
      userComment: "Primary CTA is misleading",
    })
    await flush()

    expect(api.calls.startInspectMode).toBe(1)
    expect(annotations.store.annotations).toHaveLength(0)
    expect(getButtonByLabel("Annotate page").getAttribute("aria-pressed")).toBe("false")
  })

  test("keeps annotation detail persistence failures quiet without unhandled rejections", async () => {
    const api = createBrowserApi()
    api.browser.storeAnnotationDetail = (id, detail) => {
      api.calls.storeAnnotationDetail.push({ detail, id })
      return Promise.reject(new Error("detail persistence failed"))
    }
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })
    getButtonByLabel("Annotate page").click()
    await flush()

    const reasons = await captureUnhandledRejections(async () => {
      api.inspect.resolve({
        annotation: {
          accessibleName: "Buy now",
          attributes: { role: "button" },
          boundingBox: { height: 32, width: 120, x: 12, y: 24 },
          nearbyDomSanitized: "Buy now Secure checkout",
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
    })

    expect(annotations.store.annotations).toHaveLength(1)
    expect(api.calls.storeAnnotationDetail).toHaveLength(1)
    expect(reasons).toEqual([])
  })

  test("renders existing browser annotations as numbered markers positioned from their bounding boxes", async () => {
    const api = createBrowserApi()
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({
      annotations: [
        createBrowserAnnotation("first", 12, 24),
        createBrowserAnnotation("second", 140, 80),
        createBrowserAnnotation("third", 260, 160),
      ],
      panelOpen: true,
    })

    expect(getAnnotationMarkerTexts()).toEqual(["1", "2", "3"])
    expect(getAnnotationMarker(1).style.left).toBe("12px")
    expect(getAnnotationMarker(1).style.top).toBe("24px")
    expect(getAnnotationMarker(2).style.left).toBe("140px")
    expect(getAnnotationMarker(2).style.top).toBe("80px")
    expect(getAnnotationMarker(3).style.left).toBe("260px")
    expect(getAnnotationMarker(3).style.top).toBe("160px")
    expect(document.body.textContent).toContain("3 annotations")
  })

  test("numbers annotation markers in annotation order", async () => {
    const api = createBrowserApi()
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({
      annotations: [
        createBrowserAnnotation("later-positioned-first", 300, 180),
        createBrowserAnnotation("earlier-positioned-second", 20, 30),
        createBrowserAnnotation("middle-positioned-third", 120, 90),
      ],
      panelOpen: true,
    })

    expect(getAnnotationMarker(1).style.left).toBe("300px")
    expect(getAnnotationMarker(2).style.left).toBe("20px")
    expect(getAnnotationMarker(3).style.left).toBe("120px")
  })

  test("removes rendered annotation markers when annotations are cleared", async () => {
    const api = createBrowserApi()
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ annotations: [createBrowserAnnotation("first", 12, 24)], panelOpen: true })

    expect(getAnnotationMarkerTexts()).toEqual(["1"])
    annotations.clearAnnotations()
    await flush()

    expect(getAnnotationMarkerTexts()).toEqual([])
    expect(document.body.textContent).toContain("No annotations")
  })

  test("keeps a numbered marker visible after an annotation is submitted", async () => {
    const api = createBrowserApi()
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })
    getButtonByLabel("Annotate page").click()
    await flush()

    api.inspect.resolve({
      annotation: {
        accessibleName: "Buy now",
        attributes: { role: "button" },
        boundingBox: { height: 32, width: 120, x: 44, y: 72 },
        nearbyDomSanitized: "Buy now Secure checkout",
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
    await flush()
    await flush()

    expect(annotations.store.annotations).toHaveLength(1)
    expect(getAnnotationMarker(1).textContent?.trim()).toBe("1")
    expect(getAnnotationMarker(1).style.left).toBe("44px")
    expect(getAnnotationMarker(1).style.top).toBe("72px")
  })

  test("renders the annotation editor with browser panel theme styling instead of a white card", async () => {
    const api = createBrowserApi()
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true, pendingAnnotation: createPendingAnnotation() })

    const editor = getAnnotationEditor()
    expect(editor.className).toContain("browser-annotation-editor")
    expect(editor.getAttribute("style") ?? "").not.toContain("#ffffff")
    expect(editor.textContent).not.toContain("Add a note")
  })

  test("focuses the annotation input when the editor opens", async () => {
    const api = createBrowserApi()
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true, pendingAnnotation: createPendingAnnotation() })
    await flush()

    expect(document.activeElement).toBe(getAnnotationCommentInput())
  })

  test("does not render visible Cancel or Save buttons in the annotation editor", async () => {
    const api = createBrowserApi()
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true, pendingAnnotation: createPendingAnnotation() })

    expect(getAnnotationEditor()).toBeTruthy()
    expect([...document.querySelectorAll("button")].map((button) => button.textContent?.trim())).not.toContain("Cancel")
    expect([...document.querySelectorAll("button")].map((button) => button.textContent?.trim())).not.toContain("Save")
  })

  test("submits the annotation editor with Enter", async () => {
    const api = createBrowserApi()
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true, pendingAnnotation: createPendingAnnotation(44, 72) })
    const input = writeAnnotationComment("Primary CTA is misleading")
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }))
    await flush()

    expect(annotations.store.pendingAnnotation).toBeNull()
    expect(annotations.store.annotations).toHaveLength(1)
    expect(annotations.store.annotations[0]).toMatchObject({
      element: { selector: "#pending-target" },
      userComment: "Primary CTA is misleading",
    })
    expect(getAnnotationMarker(1).style.left).toBe("44px")
  })

  test("allows Shift+Enter in the annotation editor without submitting", async () => {
    const api = createBrowserApi()
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true, pendingAnnotation: createPendingAnnotation() })
    const input = writeAnnotationComment("Line one")
    const allowed = input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", shiftKey: true }))
    input.value = "Line one\nLine two"
    input.dispatchEvent(new InputEvent("input", { bubbles: true }))
    await flush()

    expect(allowed).toBe(true)
    expect(annotations.store.pendingAnnotation).toBeTruthy()
    expect(annotations.store.annotations).toHaveLength(0)
    expect(getAnnotationCommentInput().value).toBe("Line one\nLine two")
  })

  test("cancels the annotation editor with Escape", async () => {
    const api = createBrowserApi()
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true, pendingAnnotation: createPendingAnnotation() })
    getAnnotationCommentInput().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
    await flush()

    expect(annotations.store.pendingAnnotation).toBeNull()
    expect([...document.body.querySelectorAll('[role="dialog"]')].filter((item) => item.getAttribute("aria-label") === "Annotation note")).toHaveLength(0)
    expect(annotations.store.annotations).toHaveLength(0)
  })

  test("keeps empty trimmed annotation text from submitting", async () => {
    const api = createBrowserApi()
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true, pendingAnnotation: createPendingAnnotation() })
    const input = writeAnnotationComment("   ")
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }))
    await flush()

    expect(annotations.store.pendingAnnotation).toBeTruthy()
    expect(annotations.store.annotations).toHaveLength(0)
    expect(getAnnotationEditor()).toBeTruthy()
  })

  test("syncs panel bounds for the active browser id when the active browser changes", async () => {
    const api = createBrowserApi()
    const [browserStore, setBrowserStore] = createStore({ activeId: "browser-1" as string | null })
    browsers = { store: browserStore }
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })

    const view = document.querySelector(".browser-panel-view") as HTMLDivElement
    expect(view).toBeTruthy()
    view.getBoundingClientRect = () => ({ height: 240.4, left: 10.2, top: 20.6, width: 400.5 } as DOMRect)

    setBrowserStore("activeId", "browser-2")
    await flush()

    expect(api.calls.setActiveBrowser).toEqual(["browser-1", "browser-2"])
    expect(api.calls.setBounds).toContainEqual({ bounds: { height: 240, width: 401, x: 10, y: 21 }, browserId: "browser-2" })
  })

  test("renders browser tabs above the toolbar and selects tabs through the renderer browser store", async () => {
    const api = createBrowserApi()
    const selected: string[] = []
    const [browserStore] = createStore({
      activeId: "browser-1" as string | null,
      instances: {
        "browser-1": { id: "browser-1", title: "Docs", url: "https://opencode.ai/docs", visible: true },
        "browser-2": { id: "browser-2", title: "API", url: "https://opencode.ai/api", visible: true },
      },
    })
    browsers = {
      store: browserStore,
      setActiveBrowser: (id) => selected.push(id),
    }
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })

    expect(document.querySelector('[role="list"]')?.getAttribute("aria-label")).toBe("Browser tabs")
    expect([...document.querySelectorAll("button.browser-tab-button")].map((tab) => tab.textContent?.trim())).toEqual(["Docs", "API"])
    expect(document.querySelector(".browser-panel-shell")?.firstElementChild?.getAttribute("role")).toBe("list")

    ;([...document.querySelectorAll("button.browser-tab-button")][1] as HTMLButtonElement).click()
    await flush()

    expect(selected).toContain("browser-2")
    expect(api.calls.setActiveBrowser).toContain("browser-2")
  })

  test("creates a real desktop browser tab and stores it as active", async () => {
    const api = createBrowserApi()
    const added: string[] = []
    const [browserStore] = createStore({ activeId: null as string | null, instances: {} })
    browsers = {
      store: browserStore,
      addBrowser: (id) => added.push(id),
    }
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })
    ;(document.querySelector('button[aria-label="New browser tab"]') as HTMLButtonElement).click()
    await flush()

    expect(api.calls.createBrowser).toEqual([undefined])
    expect(added).toEqual(["browser-created"])
  })

  test("closes the real desktop browser tab and applies active fallback", async () => {
    const api = createBrowserApi()
    const removed: string[] = []
    const selected: string[] = []
    const [browserStore] = createStore({
      activeId: "browser-2" as string | null,
      instances: {
        "browser-1": { id: "browser-1", title: "Docs", url: "https://opencode.ai/docs", visible: true },
        "browser-2": { id: "browser-2", title: "API", url: "https://opencode.ai/api", visible: true },
      },
    })
    browsers = {
      store: browserStore,
      removeBrowser: (id) => removed.push(id),
      setActiveBrowser: (id) => selected.push(id),
    }
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })
    ;([...document.querySelectorAll('button[aria-label="Close tab"]')][1] as HTMLButtonElement).click()
    await flush()

    expect(api.calls.closeBrowser).toEqual(["browser-2"])
    expect(removed).toEqual(["browser-2"])
    expect(selected).toContain("browser-1")
  })

  test("closing the active browser tab activates the tab to the right automatically", async () => {
    const api = createBrowserApi()
    const selected: string[] = []
    const removed: string[] = []
    const [browserStore, setBrowserStore] = createStore({
      activeId: "browser-1" as string | null,
      instances: {
        "browser-1": { id: "browser-1", title: "Docs", url: "https://opencode.ai/docs", visible: true },
        "browser-2": { id: "browser-2", title: "API", url: "https://opencode.ai/api", visible: true },
        "browser-3": { id: "browser-3", title: "Blog", url: "https://opencode.ai/blog", visible: true },
      },
    })
    browsers = {
      store: browserStore,
      removeBrowser: (id) => {
        removed.push(id)
        setBrowserStore("instances", (instances) => Object.fromEntries(Object.entries(instances).filter(([key]) => key !== id)))
      },
      setActiveBrowser: (id) => {
        selected.push(id)
        setBrowserStore("activeId", id)
      },
    }
    api.browser.closeBrowser = (browserId: string) => {
      api.calls.closeBrowser.push(browserId)
      return Promise.resolve({ success: true, state: { activeBrowserId: "browser-3", browsers: [] } })
    }
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })
    selected.length = 0
    setBrowserStore("activeId", "browser-1")
    api.calls.setActiveBrowser.length = 0
    ;([...document.querySelectorAll('button[aria-label="Close tab"]')][0] as HTMLButtonElement).click()
    await flush()

    expect(api.calls.closeBrowser).toEqual(["browser-1"])
    expect(removed).toEqual(["browser-1"])
    expect(browserStore.activeId).toBe("browser-2")
  })

  test("closing the active last browser tab activates the previous tab automatically", async () => {
    const api = createBrowserApi()
    const selected: string[] = []
    const [browserStore, setBrowserStore] = createStore({
      activeId: "browser-3" as string | null,
      instances: {
        "browser-1": { id: "browser-1", title: "Docs", url: "https://opencode.ai/docs", visible: true },
        "browser-2": { id: "browser-2", title: "API", url: "https://opencode.ai/api", visible: true },
        "browser-3": { id: "browser-3", title: "Blog", url: "https://opencode.ai/blog", visible: true },
      },
    })
    browsers = {
      store: browserStore,
      removeBrowser: (id) => setBrowserStore("instances", (instances) => Object.fromEntries(Object.entries(instances).filter(([key]) => key !== id))),
      setActiveBrowser: (id) => {
        selected.push(id)
        setBrowserStore("activeId", id)
      },
    }
    api.browser.closeBrowser = (browserId: string) => {
      api.calls.closeBrowser.push(browserId)
      return Promise.resolve({ success: true, state: { activeBrowserId: "browser-1", browsers: [] } })
    }
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })
    selected.length = 0
    setBrowserStore("activeId", "browser-3")
    api.calls.setActiveBrowser.length = 0
    ;([...document.querySelectorAll('button[aria-label="Close tab"]')][2] as HTMLButtonElement).click()
    await flush()

    expect(api.calls.closeBrowser).toEqual(["browser-3"])
    expect(browserStore.activeId).toBe("browser-2")
  })

  test("closing an inactive browser tab preserves the current active tab", async () => {
    const api = createBrowserApi()
    const selected: string[] = []
    const [browserStore, setBrowserStore] = createStore({
      activeId: "browser-2" as string | null,
      instances: {
        "browser-1": { id: "browser-1", title: "Docs", url: "https://opencode.ai/docs", visible: true },
        "browser-2": { id: "browser-2", title: "API", url: "https://opencode.ai/api", visible: true },
        "browser-3": { id: "browser-3", title: "Blog", url: "https://opencode.ai/blog", visible: true },
      },
    })
    browsers = {
      store: browserStore,
      removeBrowser: (id) => setBrowserStore("instances", (instances) => Object.fromEntries(Object.entries(instances).filter(([key]) => key !== id))),
      setActiveBrowser: (id) => {
        selected.push(id)
        setBrowserStore("activeId", id)
      },
    }
    api.browser.closeBrowser = (browserId: string) => {
      api.calls.closeBrowser.push(browserId)
      return Promise.resolve({ success: true, state: { activeBrowserId: "browser-3", browsers: [] } })
    }
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })
    selected.length = 0
    setBrowserStore("activeId", "browser-2")
    api.calls.setActiveBrowser.length = 0
    ;([...document.querySelectorAll('button[aria-label="Close tab"]')][0] as HTMLButtonElement).click()
    await flush()

    expect(api.calls.closeBrowser).toEqual(["browser-1"])
    expect(selected).toEqual([])
    expect(browserStore.activeId).toBe("browser-2")
  })

  test("closing an active tab ignores stale native active browser results", async () => {
    const api = createBrowserApi()
    const selected: string[] = []
    const [browserStore, setBrowserStore] = createStore({
      activeId: "browser-1" as string | null,
      instances: {
        "browser-1": { id: "browser-1", title: "Docs", url: "https://opencode.ai/docs", visible: true },
        "browser-2": { id: "browser-2", title: "API", url: "https://opencode.ai/api", visible: true },
        "browser-3": { id: "browser-3", title: "Blog", url: "https://opencode.ai/blog", visible: true },
      },
    })
    browsers = {
      store: browserStore,
      removeBrowser: (id) => setBrowserStore("instances", (instances) => Object.fromEntries(Object.entries(instances).filter(([key]) => key !== id))),
      setActiveBrowser: (id) => {
        selected.push(id)
        setBrowserStore("activeId", id)
      },
    }
    api.browser.closeBrowser = (browserId: string) => {
      api.calls.closeBrowser.push(browserId)
      return Promise.resolve({ success: true, state: { activeBrowserId: "browser-3", browsers: [] } })
    }
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })
    selected.length = 0
    setBrowserStore("activeId", "browser-1")
    api.calls.setActiveBrowser.length = 0
    ;([...document.querySelectorAll('button[aria-label="Close tab"]')][0] as HTMLButtonElement).click()
    await flush()

    expect(api.calls.closeBrowser).toEqual(["browser-1"])
    expect(api.calls.setActiveBrowser).toEqual(["browser-2"])
    expect(selected).toEqual(["browser-2"])
    expect(browserStore.activeId).toBe("browser-2")
  })

  test("waits for active browser activation before attaching, showing, or syncing bounds", async () => {
    const api = createBrowserApi()
    const activation = deferred<{ success: boolean; state: unknown }>()
    const order: string[] = []
    const [browserStore, setBrowserStore] = createStore({ activeId: "browser-1" as string | null })
    browsers = { store: browserStore }
    api.browser.setActiveBrowser = (browserId: string) => {
      api.calls.setActiveBrowser.push(browserId)
      order.push(`activate:${browserId}`)
      return browserId === "browser-2" ? activation.promise : Promise.resolve({ success: true, state: {} })
    }
    api.browser.attach = (browserId?: string) => {
      api.calls.attach.push(browserId)
      order.push(`attach:${browserId ?? "default"}`)
    }
    api.browser.show = (browserId?: string) => {
      api.calls.show.push(browserId)
      order.push(`show:${browserId ?? "default"}`)
    }
    api.browser.setBounds = (bounds: BrowserBounds, browserId?: string) => {
      api.calls.setBounds.push({ bounds, browserId })
      order.push(`bounds:${browserId ?? "default"}`)
    }
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })
    const view = document.querySelector(".browser-panel-view") as HTMLDivElement
    expect(view).toBeTruthy()
    view.getBoundingClientRect = () => ({ height: 240, left: 10, top: 20, width: 400 } as DOMRect)
    order.length = 0
    api.calls.attach.length = 0
    api.calls.show.length = 0
    api.calls.setBounds.length = 0

    setBrowserStore("activeId", "browser-2")
    await Promise.resolve()

    expect(order).toEqual(["activate:browser-2"])
    expect(api.calls.attach).toEqual([])
    expect(api.calls.show).toEqual([])
    expect(api.calls.setBounds).toEqual([])

    window.dispatchEvent(new Event("resize"))
    resizeObserverCallback?.()
    await Promise.resolve()

    expect(order).toEqual(["activate:browser-2"])
    expect(api.calls.setBounds).toEqual([])

    activation.resolve({ success: true, state: {} })
    await flush()

    expect(order).toEqual(["activate:browser-2", "attach:browser-2", "show:browser-2", "bounds:browser-2"])
    expect(api.calls.setBounds).toEqual([{ bounds: { height: 240, width: 400, x: 10, y: 20 }, browserId: "browser-2" }])
  })

  test("keeps the page view selected by default and switches to an empty console view", async () => {
    const api = createBrowserApi()
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })

    expect(document.querySelector(".browser-panel-view")).toBeTruthy()

    getButton("Console").click()
    await flush()

    expect(api.calls.getConsoleMessages).toEqual([undefined])
    expect(document.body.textContent).toContain("No console messages yet.")
  })

  test("exposes the page and console switch as segmented buttons without fake tab semantics", async () => {
    const api = createBrowserApi()
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })

    expect(document.querySelector('[role="tablist"]')).toBeNull()
    expect(document.querySelector('[role="tab"]')).toBeNull()
    expect(document.querySelector('[role="tabpanel"]')).toBeNull()
    expect(getButton("Page").getAttribute("aria-pressed")).toBe("true")
    expect(getButton("Console").getAttribute("aria-pressed")).toBe("false")

    getButton("Console").click()
    await flush()

    expect(getButton("Page").getAttribute("aria-pressed")).toBe("false")
    expect(getButton("Console").getAttribute("aria-pressed")).toBe("true")
    expect(document.body.textContent).toContain("No console messages yet.")
    getButton("Page").focus()
    expect(document.activeElement).toBe(getButton("Page"))
  })

  test("renders console entries with source, line, timestamp, and truncation state", async () => {
    const api = createBrowserApi()
    api.setConsoleEntries([
      {
        browserId: "browser-1",
        level: "error",
        line: 42,
        message: "Failed to load widget",
        source: "https://opencode.ai/app.js",
        timestamp: Date.UTC(2026, 4, 10, 12, 30, 0),
        truncated: true,
      },
    ])
    const [browserStore] = createStore({ activeId: "browser-1" as string | null })
    browsers = { store: browserStore }
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })
    getButton("Console").click()
    await flush()

    expect(api.calls.getConsoleMessages).toEqual([{ browserId: "browser-1" }])
    expect(document.body.textContent).toContain("error")
    expect(document.body.textContent).toContain("Failed to load widget")
    expect(document.body.textContent).toContain("https://opencode.ai/app.js:42")
    expect(document.body.textContent).toContain("12:30:00")
    expect(document.body.textContent).toContain("truncated")
  })

  test("reloads console reads when the active browser changes", async () => {
    const api = createBrowserApi()
    api.setConsoleEntries([
      {
        browserId: "browser-2",
        level: "info",
        line: null,
        message: "Ready from second tab",
        source: "",
        timestamp: Date.UTC(2026, 4, 10, 12, 45, 0),
      },
    ])
    const [browserStore, setBrowserStore] = createStore({ activeId: "browser-1" as string | null })
    browsers = { store: browserStore }
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })
    getButton("Console").click()
    await flush()
    setBrowserStore("activeId", "browser-2")
    await flush()

    expect(api.calls.getConsoleMessages).toEqual([{ browserId: "browser-1" }, { browserId: "browser-2" }])
    expect(document.body.textContent).toContain("Ready from second tab")
  })

  test("ignores stale console reads when active browser changes before an older read resolves", async () => {
    const api = createBrowserApi()
    const reads = {
      "browser-1": deferred<{ browserId: string; entries: BrowserConsoleEntry[] }>(),
      "browser-2": deferred<{ browserId: string; entries: BrowserConsoleEntry[] }>(),
    }
    const [browserStore, setBrowserStore] = createStore({ activeId: "browser-1" as string | null })
    browsers = { store: browserStore }
    api.browser.getConsoleMessages = (params?: { browserId?: string }) => {
      api.calls.getConsoleMessages.push(params)
      return reads[params?.browserId === "browser-2" ? "browser-2" : "browser-1"].promise
    }
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })
    getButton("Console").click()
    await Promise.resolve()
    setBrowserStore("activeId", "browser-2")
    await Promise.resolve()
    reads["browser-2"].resolve({
      browserId: "browser-2",
      entries: [
        {
          browserId: "browser-2",
          level: "info",
          line: null,
          message: "Fresh second tab message",
          source: "",
          timestamp: Date.UTC(2026, 4, 10, 12, 45, 0),
        },
      ],
    })
    await flush()
    reads["browser-1"].resolve({
      browserId: "browser-1",
      entries: [
        {
          browserId: "browser-1",
          level: "error",
          line: null,
          message: "Stale first tab message",
          source: "",
          timestamp: Date.UTC(2026, 4, 10, 12, 0, 0),
        },
      ],
    })
    await flush()

    expect(api.calls.getConsoleMessages).toEqual([{ browserId: "browser-1" }, { browserId: "browser-2" }])
    expect(document.body.textContent).toContain("Fresh second tab message")
    expect(document.body.textContent).not.toContain("Stale first tab message")
  })

  test("clears console messages for the active browser and refreshes the list", async () => {
    const api = createBrowserApi()
    api.setConsoleEntries([
      {
        browserId: "browser-1",
        level: "warn",
        line: 7,
        message: "Deprecated API",
        source: "console.js",
        timestamp: Date.UTC(2026, 4, 10, 13, 0, 0),
      },
    ])
    const [browserStore] = createStore({ activeId: "browser-1" as string | null })
    browsers = { store: browserStore }
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })
    getButton("Console").click()
    await flush()
    getButton("Clear").click()
    await flush()

    expect(api.calls.clearConsoleMessages).toEqual([{ browserId: "browser-1" }])
    expect(api.calls.getConsoleMessages).toEqual([{ browserId: "browser-1" }, { browserId: "browser-1" }])
    expect(document.body.textContent).toContain("No console messages yet.")
  })

  test("does not double-activate the active browser when opening from the toolbar", async () => {
    const api = createBrowserApi()
    const [browserStore] = createStore({ activeId: "browser-1" as string | null })
    browsers = { store: browserStore }
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel()
    api.calls.setActiveBrowser.length = 0
    getButtonByLabel("Navigate to URL").click()
    await flush()

    expect(api.calls.setActiveBrowser).toEqual(["browser-1"])
  })

  test("syncs panel bounds when the window is resized", async () => {
    const api = createBrowserApi()
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })

    const view = document.querySelector(".browser-panel-view") as HTMLDivElement
    expect(view).toBeTruthy()
    view.getBoundingClientRect = () => ({ height: 360.1, left: 30.2, top: 40.8, width: 640.4 } as DOMRect)

    window.dispatchEvent(new Event("resize"))
    await flush()

    expect(api.calls.setBounds).toContainEqual({ bounds: { height: 360, width: 640, x: 30, y: 41 }, browserId: undefined })
  })

  test("syncs panel bounds for the current active browser when ResizeObserver fires", async () => {
    const api = createBrowserApi()
    const [browserStore] = createStore({ activeId: "browser-1" as string | null })
    browsers = { store: browserStore }
    window.api = { browser: api.browser } as typeof window.api

    await mountPanel({ panelOpen: true })

    const view = document.querySelector(".browser-panel-view") as HTMLDivElement
    expect(view).toBeTruthy()
    view.getBoundingClientRect = () => ({ height: 450.2, left: 12.4, top: 18.7, width: 810.6 } as DOMRect)
    api.calls.setBounds.length = 0

    resizeObserverCallback?.()
    await flush()

    expect(api.calls.setBounds).toEqual([{ bounds: { height: 450, width: 811, x: 12, y: 19 }, browserId: "browser-1" }])
  })
})
