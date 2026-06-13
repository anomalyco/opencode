import { beforeEach, expect, mock, test } from "bun:test"

const webviewContents = new Map<number, ReturnType<typeof webview>>()
const allContents: ReturnType<typeof webview>[] = []
const allWindows: ReturnType<typeof browserWindow>[] = []
const sentActivations: { channel: string; payload: unknown }[] = []

function webview(id: number, destroyed = false, url = `https://example-${id}.com`) {
  return {
    isDestroyed: () => destroyed,
    getType: () => "webview",
    getURL: () => url,
    getTitle: () => `Example ${id}`,
    executeJavaScript: async (script: string) => (script === "document.readyState" ? "complete" : undefined),
  }
}

function browserWindow(destroyed = false) {
  return {
    isDestroyed: () => destroyed,
    show: () => undefined,
    focus: () => undefined,
    webContents: {
      send: (channel: string, payload: unknown) => sentActivations.push({ channel, payload }),
    },
  }
}

mock.module("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => allWindows,
  },
  ipcMain: {
    handle: () => undefined,
  },
  webContents: {
    fromId: (id: number) => webviewContents.get(id),
    getAllWebContents: () => allContents,
  },
}))

mock.module("./computer-use", () => ({
  executeComputerUse: async () => ({ success: true }),
}))

beforeEach(async () => {
  webviewContents.clear()
  allContents.splice(0, allContents.length)
  allWindows.splice(0, allWindows.length)
  sentActivations.splice(0, sentActivations.length)
  const browserAutomation = await import("./browser-automation")
  browserAutomation.clearActiveWebview()
})

test("clears only the matching active browser webview registration", async () => {
  const first = webview(1)
  const second = webview(2)
  webviewContents.set(1, first)
  webviewContents.set(2, second)
  allContents.splice(0, allContents.length, first, second)

  const browserAutomation = await import("./browser-automation")

  browserAutomation.registerActiveWebview(2)
  expect(browserAutomation.getActiveWebview()?.getURL()).toBe("https://example-2.com")

  browserAutomation.clearActiveWebview(1)
  expect(browserAutomation.getActiveWebview()?.getURL()).toBe("https://example-2.com")

  browserAutomation.clearActiveWebview(2)
  expect(browserAutomation.getActiveWebview()?.getURL()).toBe("https://example-1.com")
})

test("adopts a single live embedded webview after activating the browser tab", async () => {
  const first = webview(1)
  allContents.push(first)
  allWindows.push(browserWindow())

  const browserAutomation = await import("./browser-automation")
  const result = await browserAutomation.executeBrowserAction({ action: "getUrl" })

  expect(result).toEqual({
    success: true,
    url: "https://example-1.com",
    title: "Example 1",
  })
  expect(sentActivations).toEqual([
    {
      channel: "activate-browser-tab",
      payload: { url: undefined },
    },
  ])
})

test("activates the browser with the requested url for navigation", async () => {
  const first = webview(1, false, "https://target.example")
  allContents.push(first)
  allWindows.push(browserWindow())

  const browserAutomation = await import("./browser-automation")
  const result = await browserAutomation.executeBrowserAction({ action: "navigate", url: "https://target.example" })

  expect(result.success).toBe(true)
  expect(sentActivations[0]).toEqual({
    channel: "activate-browser-tab",
    payload: { url: "https://target.example" },
  })
})
