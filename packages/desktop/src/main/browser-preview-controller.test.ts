import { describe, expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

class FakeWebContents extends EventEmitter {
  static nextId = 1
  readonly id = FakeWebContents.nextId++
  private picker = deferred<unknown>()
  cancelGate: ReturnType<typeof deferred> | undefined
  url = ""

  async loadURL(url: string) {
    this.url = url
  }

  executeJavaScriptInIsolatedWorld(_worldId: number, scripts: { code: string }[]) {
    if (scripts[0]?.code.includes("?.cancel?.()")) {
      return (async () => {
        await this.cancelGate?.promise
        this.picker.resolve({ cancelled: true })
      })()
    }
    this.picker = deferred<unknown>()
    return this.picker.promise
  }

  setWindowOpenHandler() {}
  canGoBack() {
    return false
  }
  canGoForward() {
    return false
  }
  isDestroyed() {
    return false
  }
  close() {}
}

const views: FakeWebContents[] = []

const electronMock = {
  app: {
    on() {},
    getPath() {
      return ""
    },
  },
  BrowserWindow: function BrowserWindow() {},
  WebContentsView: class {
    readonly webContents = new FakeWebContents()
    constructor() {
      views.push(this.webContents)
    }
    setBounds() {}
  },
  session: {
    fromPartition: () => ({
      setPermissionRequestHandler() {},
      setPermissionCheckHandler() {},
      on() {},
      clearStorageData: async () => {},
      clearCache: async () => {},
    }),
  },
  shell: { openExternal: async () => {} },
}

mock.module("electron", () => ({ ...electronMock, default: electronMock }))

const { BrowserPreviewController } = await import("./browser-preview")

function setup() {
  views.length = 0
  const children: unknown[] = []
  const win = {
    contentView: {
      children,
      addChildView(view: unknown) {
        children.push(view)
      },
      removeChildView(view: unknown) {
        const index = children.indexOf(view)
        if (index >= 0) children.splice(index, 1)
      },
    },
    webContents: {
      send() {},
      isDestroyed: () => false,
      getZoomFactor: () => 1,
    },
    getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    isDestroyed: () => false,
  }
  return new BrowserPreviewController(win)
}

describe("BrowserPreviewController picker lifecycle", () => {
  test("opens Google by default", async () => {
    const controller = setup()

    await controller.show()

    expect(controller.state().tabs[0]?.url).toBe("https://www.google.com/")
  })

  test("waits for picker cancellation before navigation completes", async () => {
    const controller = setup()
    await controller.show()
    const contents = views[0]
    const picking = controller.command({ type: "pick-element" })
    contents.cancelGate = deferred()

    let navigated = false
    const navigation = controller.command({ type: "navigate", url: "https://example.com" }).then(() => {
      navigated = true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(navigated).toBe(false)
    contents.cancelGate.resolve()
    await navigation
    expect(await picking).toEqual({ type: "none" })

    const restarted = controller.command({ type: "pick-element" })
    await controller.command({ type: "cancel-element-picker" })
    expect(await restarted).toEqual({ type: "none" })
  })

  test("waits for picker cancellation before activating another tab", async () => {
    const controller = setup()
    await controller.show()
    const firstTab = controller.state().activeTabId!
    await controller.command({ type: "new-tab", url: "https://example.com" })
    const secondTab = controller.state().activeTabId!
    await controller.command({ type: "activate-tab", tabId: firstTab })

    const contents = views[0]
    const picking = controller.command({ type: "pick-element" })
    contents.cancelGate = deferred()
    let activated = false
    const activation = controller.command({ type: "activate-tab", tabId: secondTab }).then(() => {
      activated = true
    })
    await Promise.resolve()

    expect(activated).toBe(false)
    contents.cancelGate.resolve()
    await activation
    expect(controller.state().activeTabId).toBe(secondTab)
    expect(await picking).toEqual({ type: "none" })
  })
})
