import { beforeEach, describe, expect, test } from "bun:test"

import { createIntegratedBrowserAgentTools, getIntegratedBrowserAgentTools, integratedBrowserAgentToolNames, shouldExposeIntegratedBrowserAgentTools } from "./agent-tools"

type ScreenshotImage = { toPNG: () => Buffer } | null | undefined

const calls = {
  navigate: [] as Array<{ url: string; browserId?: string }>,
  getSnapshot: [] as Array<string | undefined>,
  getAnnotationData: [] as Array<{ selector: string; browserId?: string }>,
  click: [] as Array<{ selector: string; browserId?: string }>,
  typeText: [] as Array<{ selector: string; text: string; browserId?: string }>,
  screenshot: [] as Array<string | undefined>,
  consoleMessages: [] as Array<{ browserId: string; levels?: string[]; limit?: number }>,
  consoleClear: [] as Array<string | undefined>,
  goBack: [] as Array<string | undefined>,
  goForward: [] as Array<string | undefined>,
  reload: [] as Array<string | undefined>,
}

function createTools(input: { screenshotImage?: ScreenshotImage } = {}) {
  return Object.fromEntries(
    createIntegratedBrowserAgentTools({
      navigate(url, browserId) {
        calls.navigate.push({ url, browserId })
        return Promise.resolve()
      },
      getSnapshot(browserId) {
        calls.getSnapshot.push(browserId)
        return Promise.resolve({ url: "https://snapshot.example", title: "Snapshot", elements: [] })
      },
      getAnnotationData(selector, browserId) {
        calls.getAnnotationData.push({ selector, browserId })
        return Promise.resolve({ selector, tagName: "button", attributes: {}, boundingBox: { x: 1, y: 2, width: 3, height: 4 }, nearbyDomSanitized: "Checkout" })
      },
      click(selector, browserId) {
        calls.click.push({ selector, browserId })
        return Promise.resolve()
      },
      typeText(selector, text, browserId) {
        calls.typeText.push({ selector, text, browserId })
        return Promise.resolve()
      },
      screenshot(browserId) {
        calls.screenshot.push(browserId)
        if ("screenshotImage" in input) return Promise.resolve(input.screenshotImage)
        return Promise.resolve({ imageBase64: Buffer.from(`screenshot:${browserId ?? "active"}`).toString("base64") })
      },
      queryConsole(query) {
        calls.consoleMessages.push(query)
        return { browserId: query.browserId, entries: [{ browserId: query.browserId, level: "error", message: "boom", source: "app.js", line: 7, timestamp: 1 }] }
      },
      clearConsole(browserId) {
        calls.consoleClear.push(browserId)
        return Promise.resolve(3)
      },
      getActiveBrowserId() {
        return "browser-active"
      },
      goBack(browserId) {
        calls.goBack.push(browserId)
      },
      goForward(browserId) {
        calls.goForward.push(browserId)
      },
      reload(browserId) {
        calls.reload.push(browserId)
      },
    }).map((tool) => [tool.name, tool]),
  )
}

describe("integrated browser agent tools", () => {
  beforeEach(() => {
    calls.navigate = []
    calls.getSnapshot = []
    calls.getAnnotationData = []
    calls.click = []
    calls.typeText = []
    calls.screenshot = []
    calls.consoleMessages = []
    calls.consoleClear = []
    calls.goBack = []
    calls.goForward = []
    calls.reload = []
  })

  test("defines stable model-callable tools for the OpenCode integrated browser", () => {
    const tools = createIntegratedBrowserAgentTools()

    expect(tools.map((tool) => tool.name)).toEqual(integratedBrowserAgentToolNames)
    expect(tools.every((tool) => /^[a-zA-Z0-9_-]+$/.test(tool.name))).toBe(true)
    expect(tools.map((tool) => tool.name)).toEqual([
      "browser_navigate",
      "browser_inspect",
      "browser_click",
      "browser_type",
      "browser_screenshot",
      "browser_console_messages",
      "browser_console_clear",
      "browser_back",
      "browser_forward",
      "browser_reload",
    ])
    expect(tools.every((tool) => tool.description.includes("OpenCode integrated browser"))).toBe(true)
    expect(tools.map((tool) => Object.keys(tool.inputSchema.properties ?? {}))).toEqual([
      ["url", "browserId"],
      ["selector", "browserId"],
      ["selector", "browserId"],
      ["selector", "text", "browserId"],
      ["browserId"],
      ["browserId", "levels", "limit"],
      ["browserId"],
      ["browserId"],
      ["browserId"],
      ["browserId"],
    ])
  })

  test("prepares the desktop client and enabled setting registration hook", () => {
    expect(shouldExposeIntegratedBrowserAgentTools({ client: "desktop", enabled: true })).toBe(true)
    expect(shouldExposeIntegratedBrowserAgentTools({ client: "desktop", enabled: undefined })).toBe(false)
    expect(shouldExposeIntegratedBrowserAgentTools({ client: "desktop", enabled: false })).toBe(false)
    expect(shouldExposeIntegratedBrowserAgentTools({ client: "cli", enabled: true })).toBe(false)
  })

  test("returns no integrated browser tools from the registration catalog when disabled", () => {
    expect(getIntegratedBrowserAgentTools({ client: "desktop", enabled: false })).toEqual([])
    expect(getIntegratedBrowserAgentTools({ client: "cli", enabled: true })).toEqual([])
  })

  test("returns integrated browser tools from the registration catalog only for desktop with enabled setting", () => {
    expect(getIntegratedBrowserAgentTools({ client: "desktop", enabled: true }).map((tool) => tool.name)).toEqual(integratedBrowserAgentToolNames)
    expect(getIntegratedBrowserAgentTools({ client: "desktop", enabled: undefined })).toEqual([])
  })

  test("delegates navigation, inspection, page interaction, and screenshot to BrowserManager dependencies", async () => {
    const tools = createTools()

    await tools["browser_navigate"]?.handler({ url: "opencode.ai", browserId: "browser-1" })
    await expect(tools["browser_inspect"]?.handler({ browserId: "browser-1" })).resolves.toEqual({ url: "https://snapshot.example", title: "Snapshot", elements: [] })
    await expect(tools["browser_inspect"]?.handler({ selector: "button.checkout", browserId: "browser-2" })).resolves.toMatchObject({ selector: "button.checkout" })
    await tools["browser_click"]?.handler({ selector: "button.checkout", browserId: "browser-3" })
    await tools["browser_type"]?.handler({ selector: "input.email", text: "hello@example.com", browserId: "browser-4" })
    await expect(tools["browser_screenshot"]?.handler({ browserId: "browser-5" })).resolves.toEqual({ imageBase64: Buffer.from("screenshot:browser-5").toString("base64") })

    expect(calls.navigate).toEqual([{ url: "opencode.ai", browserId: "browser-1" }])
    expect(calls.getSnapshot).toEqual(["browser-1"])
    expect(calls.getAnnotationData).toEqual([{ selector: "button.checkout", browserId: "browser-2" }])
    expect(calls.click).toEqual([{ selector: "button.checkout", browserId: "browser-3" }])
    expect(calls.typeText).toEqual([{ selector: "input.email", text: "hello@example.com", browserId: "browser-4" }])
    expect(calls.screenshot).toEqual(["browser-5"])
  })

  test("throws a clear error when the integrated browser screenshot returns no image", async () => {
    const tools = createTools({ screenshotImage: undefined })

    await expect(tools["browser_screenshot"]?.handler({ browserId: "browser-empty" })).rejects.toThrow("Integrated browser screenshot did not return an image")
    await expect(createTools({ screenshotImage: null })["browser_screenshot"]?.handler({ browserId: "browser-empty" })).rejects.toThrow("Integrated browser screenshot did not return an image")
  })

  test("throws a clear error when the integrated browser screenshot returns an empty PNG", async () => {
    const tools = createTools({
      screenshotImage: {
        toPNG() {
          return Buffer.alloc(0)
        },
      },
    })

    await expect(tools["browser_screenshot"]?.handler({ browserId: "browser-empty" })).rejects.toThrow("Integrated browser screenshot did not return an image")
  })

  test("delegates console and history tools to integrated browser dependencies", async () => {
    const tools = createTools()

    await expect(tools["browser_console_messages"]?.handler({ levels: ["error"], limit: 10 })).resolves.toMatchObject({ browserId: "browser-active" })
    await expect(tools["browser_console_clear"]?.handler({ browserId: "browser-console" })).resolves.toEqual({ browserId: "browser-console", count: 3 })
    await tools["browser_back"]?.handler({ browserId: "browser-back" })
    await tools["browser_forward"]?.handler({ browserId: "browser-forward" })
    await tools["browser_reload"]?.handler({ browserId: "browser-reload" })

    expect(calls.consoleMessages).toEqual([{ browserId: "browser-active", levels: ["error"], limit: 10 }])
    expect(calls.consoleClear).toEqual(["browser-console"])
    expect(calls.goBack).toEqual(["browser-back"])
    expect(calls.goForward).toEqual(["browser-forward"])
    expect(calls.reload).toEqual(["browser-reload"])
  })

  test("uses the active browser id dependency when navigation omits browserId", async () => {
    const tools = createTools()

    await tools["browser_navigate"]?.handler({ url: "opencode.ai" })

    expect(calls.navigate).toEqual([{ url: "opencode.ai", browserId: "browser-active" }])
  })

  test("uses the active browser id dependency when console tools omit browserId", async () => {
    const tools = createTools()

    await expect(tools["browser_console_messages"]?.handler({ levels: ["error"], limit: 10 })).resolves.toMatchObject({ browserId: "browser-active" })
    await expect(tools["browser_console_clear"]?.handler({})).resolves.toEqual({ browserId: "browser-active", count: 3 })

    expect(calls.consoleMessages).toEqual([{ browserId: "browser-active", levels: ["error"], limit: 10 }])
    expect(calls.consoleClear).toEqual(["browser-active"])
  })
})
