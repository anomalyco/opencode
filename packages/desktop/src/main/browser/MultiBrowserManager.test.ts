import { beforeEach, describe, expect, mock, test } from "bun:test"

const viewInstances: FakeWebContentsView[] = []

class FakeWebContentsView {
  bounds = { x: 0, y: 0, width: 0, height: 0 }
  visible = false
  title = ""
  url = ""
  loading = false
  closed = false
  preventClose = false
  canNavigateBack = false
  canNavigateForward = false
  listeners = new Map<string, Array<(...args: unknown[]) => void>>()

  webContents = {
    canGoBack: () => this.canNavigateBack,
    canGoForward: () => this.canNavigateForward,
    getTitle: () => this.title,
    getURL: () => this.url,
    isLoading: () => this.loading,
    isDestroyed: () => this.closed,
    close: () => {
      if (this.preventClose) return
      if (this.closed) return
      this.closed = true
      this.emit("destroyed")
    },
    on: (event: string, listener: (...args: unknown[]) => void) => {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    },
  }

  constructor() {
    viewInstances.push(this)
  }

  emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((listener) => listener(...args))
  }

  setBounds(bounds: { x: number; y: number; width: number; height: number }) {
    this.bounds = bounds
  }

  setVisible(visible: boolean) {
    this.visible = visible
  }
}

mock.module("electron", () => ({
  WebContentsView: FakeWebContentsView,
}))

const manager = await import("./MultiBrowserManager")
const consoleStore = await import("./console-store")

function createWindow() {
  const children: unknown[] = []
  return {
    contentView: {
      children,
      addChildView(view: unknown) {
        children.push(view)
      },
      removeChildView(view: unknown) {
        if (view instanceof FakeWebContentsView && view.closed) throw new Error("Object has been destroyed")
        children.splice(children.indexOf(view), 1)
      },
    },
  }
}

describe("MultiBrowserManager", () => {
  beforeEach(() => {
    manager.getAllBrowsers().map((browser) => manager.closeBrowser(browser.id))
    consoleStore.clearBrowserConsoleEntries()
    viewInstances.length = 0
  })

  test("creates browser metadata and makes new browsers active", () => {
    const win = createWindow()
    const firstId = manager.createBrowser(win as never)
    const secondId = manager.createBrowser(win as never)

    expect(manager.getActiveBrowserId()).toBe(secondId)
    expect(manager.getActiveBrowser()?.id).toBe(secondId)
    expect(manager.getAllBrowsers().map((browser) => browser.id)).toEqual([firstId, secondId])
    expect(win.contentView.children).toEqual(viewInstances)
    expect(manager.getBrowser(firstId)?.state).toMatchObject({ visible: false, url: "", inspectMode: false })
  })

  test("activates existing browsers and hides inactive views", () => {
    const firstId = manager.createBrowser()
    const secondId = manager.createBrowser()

    manager.showBrowser(firstId)
    manager.showBrowser(secondId)

    expect(manager.activateBrowser(firstId)?.id).toBe(firstId)
    expect(manager.getActiveBrowserId()).toBe(firstId)
    expect(manager.getBrowserState(secondId)?.visible).toBe(false)
    expect(viewInstances[1]?.visible).toBe(false)
  })

  test("activation hides the previously visible browser before the new browser is shown", () => {
    const firstId = manager.createBrowser()
    const secondId = manager.createBrowser()

    manager.showBrowser(firstId)

    expect(viewInstances[0]?.visible).toBe(true)
    expect(viewInstances[1]?.visible).toBe(false)

    expect(manager.activateBrowser(secondId)?.id).toBe(secondId)

    expect(viewInstances[0]?.visible).toBe(false)
    expect(viewInstances[1]?.visible).toBe(false)

    manager.showBrowser(secondId)

    expect(viewInstances[0]?.visible).toBe(false)
    expect(viewInstances[1]?.visible).toBe(true)
  })

  test("closes active browser and activates the next available browser", () => {
    const firstId = manager.createBrowser()
    const secondId = manager.createBrowser()

    expect(manager.closeBrowser(secondId)).toBe(true)
    expect(manager.getActiveBrowserId()).toBe(firstId)
    expect(manager.getBrowser(secondId)).toBeUndefined()

    expect(manager.closeBrowser(firstId)).toBe(true)
    expect(manager.getActiveBrowserId()).toBeUndefined()
    expect(manager.getAllBrowsers()).toEqual([])
  })

  test("closes browser webContents when closing browser metadata", () => {
    const id = manager.createBrowser()

    expect(manager.closeBrowser(id)).toBe(true)
    expect(viewInstances[0]?.closed).toBe(true)
  })

  test("does not detach a destroyed browser view during destroyed cleanup", () => {
    const win = createWindow()
    const id = manager.createBrowser(win as never)

    viewInstances[0]!.closed = true

    expect(() => viewInstances[0]!.emit("destroyed")).not.toThrow()
    expect(manager.getBrowser(id)).toBeUndefined()
  })

  test("cleans up browser when webContents is already absent during destroyed cleanup", () => {
    const win = createWindow()
    const id = manager.createBrowser(win as never)

    Object.defineProperty(viewInstances[0]!, "webContents", { value: undefined })

    expect(() => viewInstances[0]!.emit("destroyed")).not.toThrow()
    expect(manager.getBrowser(id)).toBeUndefined()
  })

  test("keeps browser tracked when webContents close is prevented", () => {
    const firstId = manager.createBrowser()
    const id = manager.createBrowser()

    viewInstances[1]!.preventClose = true

    expect(manager.closeBrowser(id)).toBe(true)
    expect(manager.getBrowser(id)?.id).toBe(id)
    expect(manager.getActiveBrowserId()).toBe(id)
    expect(manager.getBrowserState(id)?.visible).toBe(false)
    expect(viewInstances[1]?.visible).toBe(false)

    viewInstances[1]!.preventClose = false
    viewInstances[1]!.emit("destroyed")

    expect(manager.getBrowser(id)).toBeUndefined()
    expect(manager.getActiveBrowserId()).toBe(firstId)
  })

  test("tracks bounds and visibility per browser", () => {
    const firstId = manager.createBrowser()
    const secondId = manager.createBrowser()

    expect(manager.setBrowserBounds(firstId, { x: 1, y: 2, width: 300, height: 200 })).toBe(true)
    expect(manager.setBrowserBounds(secondId, { x: 10, y: 20, width: 400, height: 240 })).toBe(true)
    expect(manager.showBrowser(firstId)).toBe(true)
    expect(manager.hideBrowser(secondId)).toBe(true)

    expect(manager.getBrowser(firstId)?.bounds).toEqual({ x: 1, y: 2, width: 300, height: 200 })
    expect(manager.getBrowser(secondId)?.bounds).toEqual({ x: 10, y: 20, width: 400, height: 240 })
    expect(viewInstances[0]?.bounds).toEqual({ x: 1, y: 2, width: 300, height: 200 })
    expect(viewInstances[1]?.bounds).toEqual({ x: 10, y: 20, width: 400, height: 240 })
    expect(manager.getBrowserState(firstId)?.visible).toBe(true)
    expect(manager.getBrowserState(secondId)?.visible).toBe(false)
  })

  test("updates browser state from webContents lifecycle events", () => {
    const id = manager.createBrowser()

    viewInstances[0]!.title = "Example"
    viewInstances[0]!.url = "https://example.com"
    viewInstances[0]!.canNavigateBack = true
    viewInstances[0]!.loading = true
    viewInstances[0]!.emit("did-navigate")

    expect(manager.getBrowser(id)).toMatchObject({ title: "Example", url: "https://example.com" })
    expect(manager.getBrowserState(id)).toMatchObject({
      canGoBack: true,
      canGoForward: false,
      isLoading: true,
      url: "https://example.com",
    })
  })

  test("stores console entries per browser with a 200-entry cap", () => {
    Array.from({ length: 205 }, (_, index) =>
      consoleStore.addBrowserConsoleEntry({
        browserId: "browser-a",
        level: "log",
        line: index,
        message: `message-${index}`,
        source: "console",
      }),
    )
    consoleStore.addBrowserConsoleEntry({
      browserId: "browser-b",
      level: "error",
      line: 1,
      message: "other browser",
      source: "console",
    })

    const result = consoleStore.queryBrowserConsoleEntries({ browserId: "browser-a", limit: 250 })

    expect(result.browserId).toBe("browser-a")
    expect(result.entries).toHaveLength(100)
    expect(result.truncated).toBe(true)
    expect(result.entries[0]).toMatchObject({ browserId: "browser-a", message: "message-105" })
    expect(result.entries.at(-1)).toMatchObject({ browserId: "browser-a", message: "message-204" })
    expect(consoleStore.queryBrowserConsoleEntries({ browserId: "browser-b" }).entries).toHaveLength(1)
    expect(consoleStore.clearBrowserConsoleEntries("browser-a")).toBe(200)
  })

  test("defaults console reads to 50 entries and reports truncation", () => {
    Array.from({ length: 60 }, (_, index) =>
      consoleStore.addBrowserConsoleEntry({
        browserId: "browser-a",
        level: "log",
        line: index,
        message: `message-${index}`,
        source: "console",
      }),
    )

    const result = consoleStore.queryBrowserConsoleEntries({ browserId: "browser-a" })

    expect(result.entries).toHaveLength(50)
    expect(result.truncated).toBe(true)
    expect(result.entries[0]).toMatchObject({ message: "message-10" })
    expect(result.entries.at(-1)).toMatchObject({ message: "message-59" })
  })

  test("clamps console read limits to 100 entries and reports truncation", () => {
    Array.from({ length: 150 }, (_, index) =>
      consoleStore.addBrowserConsoleEntry({
        browserId: "browser-a",
        level: "log",
        line: index,
        message: `message-${index}`,
        source: "console",
      }),
    )

    const result = consoleStore.queryBrowserConsoleEntries({ browserId: "browser-a", limit: 250 })

    expect(result.entries).toHaveLength(100)
    expect(result.truncated).toBe(true)
    expect(result.entries[0]).toMatchObject({ message: "message-50" })
    expect(result.entries.at(-1)).toMatchObject({ message: "message-149" })
  })

  test("omits truncation when console read returns all matching entries", () => {
    Array.from({ length: 5 }, (_, index) =>
      consoleStore.addBrowserConsoleEntry({
        browserId: "browser-a",
        level: index % 2 === 0 ? "error" : "log",
        line: index,
        message: `message-${index}`,
        source: "console",
      }),
    )

    const result = consoleStore.queryBrowserConsoleEntries({ browserId: "browser-a", levels: ["error"], limit: 10 })

    expect(result.entries).toHaveLength(3)
    expect(result.truncated).toBeUndefined()
  })

  test("filters, limits, clears, redacts, and truncates console entries", () => {
    consoleStore.addBrowserConsoleEntry({ browserId: "browser-a", level: "log", line: null, message: "visible", source: "console" })
    consoleStore.addBrowserConsoleEntry({
      browserId: "browser-a",
      level: "error",
      line: 10,
      message: `authorization: bearer secret-token data:image/png;base64,${"a".repeat(2_000)}`,
      source: "https://example.com/app.js?token=secret",
    })
    consoleStore.addBrowserConsoleEntry({ browserId: "browser-b", level: "warn", line: 1, message: "keep me", source: "console" })

    const result = consoleStore.queryBrowserConsoleEntries({ browserId: "browser-a", levels: ["error"], limit: 1 })

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({ browserId: "browser-a", level: "error", line: 10 })
    expect(result.entries[0]?.message).toContain("[REDACTED]")
    expect(result.entries[0]?.message).not.toContain("secret-token")
    expect(result.entries[0]?.message).not.toContain("data:image/png;base64")
    expect(result.entries[0]?.message.length).toBeLessThanOrEqual(1_000)
    expect(result.entries[0]?.source).toBe("https://example.com/app.js?token=%5BREDACTED%5D")

    expect(consoleStore.clearBrowserConsoleEntries("browser-a")).toBe(2)
    expect(consoleStore.queryBrowserConsoleEntries({ browserId: "browser-a" }).entries).toEqual([])
    expect(consoleStore.queryBrowserConsoleEntries({ browserId: "browser-b" }).entries).toHaveLength(1)
  })

  test("marks per-entry message truncation when console messages exceed the storage limit", () => {
    consoleStore.addBrowserConsoleEntry({ browserId: "browser-a", level: "log", line: null, message: "safe ".repeat(250), source: "console" })

    const result = consoleStore.queryBrowserConsoleEntries({ browserId: "browser-a", limit: 1 })

    expect(result.entries[0]?.message).toHaveLength(1_000)
    expect(result.entries[0]?.truncated).toBe(true)
  })

  test("captures console messages and load failures and removes console state on close", () => {
    const id = manager.createBrowser()

    viewInstances[0]!.emit("console-message", {}, 2, "api_key=secret", 42, "https://example.com/app.js?api_key=secret")
    viewInstances[0]!.emit("did-fail-load", {}, -105, "Name not resolved", "https://example.com/login?token=secret", true)

    const result = consoleStore.queryBrowserConsoleEntries({ browserId: id, levels: ["warn", "error"], limit: 10 })

    expect(result.entries).toHaveLength(2)
    expect(result.entries[0]).toMatchObject({
      browserId: id,
      level: "warn",
      line: 42,
      message: "api_key=[REDACTED]",
      source: "https://example.com/app.js?api_key=%5BREDACTED%5D",
    })
    expect(result.entries[1]).toMatchObject({
      browserId: id,
      level: "error",
      line: null,
      message: "Failed to load https://example.com/login?token=%5BREDACTED%5D: Name not resolved (-105)",
      source: "did-fail-load",
    })

    expect(manager.closeBrowser(id)).toBe(true)
    expect(consoleStore.queryBrowserConsoleEntries({ browserId: id }).entries).toEqual([])
  })

  test("ignores did-fail-load events for subframes", () => {
    const id = manager.createBrowser()

    viewInstances[0]!.emit("did-fail-load", {}, -105, "Name not resolved", "https://example.com/frame", false)

    expect(consoleStore.queryBrowserConsoleEntries({ browserId: id, levels: ["error"], limit: 10 }).entries).toEqual([])
  })

  test("ignores did-fail-load aborted cancellations", () => {
    const id = manager.createBrowser()

    viewInstances[0]!.emit("did-fail-load", {}, -3, "Aborted", "https://example.com/cancelled", true)

    expect(consoleStore.queryBrowserConsoleEntries({ browserId: id, levels: ["error"], limit: 10 }).entries).toEqual([])
  })

  test("stores did-fail-load entries for real main-frame failures", () => {
    const id = manager.createBrowser()

    viewInstances[0]!.emit("did-fail-load", {}, -105, "Name not resolved", "https://example.com/login?token=secret", true)

    expect(consoleStore.queryBrowserConsoleEntries({ browserId: id, levels: ["error"], limit: 10 }).entries).toEqual([
      expect.objectContaining({
        browserId: id,
        level: "error",
        line: null,
        message: "Failed to load https://example.com/login?token=%5BREDACTED%5D: Name not resolved (-105)",
        source: "did-fail-load",
      }),
    ])
  })
})
