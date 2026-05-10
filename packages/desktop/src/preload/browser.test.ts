import { describe, expect, test } from "bun:test"

import { createBrowserApi } from "./browser"
import type { BrowserAnnotationData } from "../main/browser/types"

describe("createBrowserApi", () => {
  test("exposes browser panel and agent tool methods on the expected IPC channels", async () => {
    const calls: { type: "send" | "invoke"; channel: string; args: unknown[] }[] = []
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const invoke = (channel: string, ...args: unknown[]) => {
      calls.push({ type: "invoke", channel, args })
      return Promise.resolve(channel)
    }
    const send = (channel: string, ...args: unknown[]) => {
      calls.push({ type: "send", channel, args })
    }

    const api = createBrowserApi({
      invoke,
      send,
      on(channel: string, listener: (...args: unknown[]) => void) {
        listeners.set(channel, listener)
      },
      removeListener(channel: string) {
        listeners.delete(channel)
      },
    })

    expect(Object.keys(api).sort()).toEqual([
      "attach",
      "back",
      "clearAnnotationMarkers",
      "clearConsoleMessages",
      "clearData",
      "closeBrowser",
      "createBrowser",
      "forward",
      "getAnnotationData",
      "getConsoleMessages",
      "getState",
      "hide",
      "navigate",
      "onOpenRequested",
      "open",
      "reload",
      "screenshot",
      "setActiveBrowser",
      "setBounds",
      "show",
      "startInspectMode",
      "stopInspectMode",
      "storeAnnotationDetail",
      "toolClick",
      "toolClickElement",
      "toolConsoleClear",
      "toolConsoleMessages",
      "toolDrag",
      "toolGetAnnotationDetail",
      "toolGetSnapshot",
      "toolHandleDialog",
      "toolHover",
      "toolInspect",
      "toolListDownloads",
      "toolNavigatePage",
      "toolOpenBrowserPage",
      "toolPress",
      "toolReadPage",
      "toolRunBrowserCode",
      "toolRunPlaywrightCode",
      "toolScreenshotPage",
      "toolType",
      "toolTypeInPage",
      "toolUploadFile",
    ])

    const bounds = { x: 1, y: 2, width: 3, height: 4 }
    api.setBounds(bounds)
    api.setBounds(bounds, "browser-1")
    api.show()
    api.hide()
    api.attach()
    await api.open()
    await api.createBrowser({ url: "https://opencode.ai/new" })
    await api.navigate("https://opencode.ai")
    await api.back()
    await api.forward()
    await api.reload()
    await api.clearData()
    await api.clearAnnotationMarkers()
    await api.getConsoleMessages({ levels: ["error"], limit: 10 })
    await api.clearConsoleMessages({ browserId: "browser-1" })
    await api.getState()
    await api.screenshot()
    await api.startInspectMode()
    await api.stopInspectMode()
    await api.getAnnotationData("button.primary")
    await api.toolClick("button.primary")
    await api.toolDrag("#source", "#target")
    await api.toolDrag("#source-secondary", "#target-secondary", "browser-1")
    await api.toolHandleDialog("accept", "typed prompt")
    await api.toolHandleDialog("dismiss", undefined, "browser-1")
    await api.toolRunBrowserCode("() => document.title")
    await api.toolRunBrowserCode("() => location.href", "browser-1")
    await api.toolRunPlaywrightCode("() => document.title")
    await api.toolRunPlaywrightCode("() => location.href", "browser-1")
    await api.toolHover("button.primary")
    await api.toolHover("button.secondary", "browser-1")
    await api.toolType("input[name='email']", "hello@example.com")
    await api.toolPress("Enter")
    await api.toolUploadFile("input[type='file']", "fixtures/upload.txt")
    await api.toolListDownloads()
    await api.toolInspect()
    await api.toolInspect("button.primary")
    await api.toolGetAnnotationDetail("annotation-1")
    await api.toolGetSnapshot()
    await api.toolConsoleMessages({ browserId: "browser-1", levels: ["warn"], limit: 5 })
    await api.toolConsoleClear({ browserId: "browser-1" })
    await api.storeAnnotationDetail("annotation-1", {
      context: { nearbyDomSanitized: "checkout summary" },
      element: {
        selector: "button.primary",
        tagName: "button",
        attributes: { role: "button" },
        boundingBox: { x: 1, y: 2, width: 3, height: 4 },
      },
      id: "annotation-1",
      pageTitle: "Checkout",
      pageUrl: "https://opencode.ai/checkout",
      preview: { screenshotCrop: "data:image/png;base64,AAA" },
      userComment: "Primary CTA is misleading",
    })
    await api.setActiveBrowser("browser-1")
    await api.closeBrowser("browser-1")

    const unsubscribe = api.onOpenRequested(() => undefined)

    expect(listeners.has("browser-open-requested")).toBe(true)
    unsubscribe()
    expect(listeners.has("browser-open-requested")).toBe(false)

    expect(calls).toEqual([
      { type: "send", channel: "browser-set-bounds", args: [bounds] },
      { type: "send", channel: "browser-set-bounds", args: [bounds, "browser-1"] },
      { type: "send", channel: "browser-show", args: [] },
      { type: "send", channel: "browser-hide", args: [] },
      { type: "send", channel: "browser-attach", args: [] },
      { type: "invoke", channel: "browser-open", args: [] },
      { type: "invoke", channel: "browser-create", args: [{ url: "https://opencode.ai/new" }] },
      { type: "invoke", channel: "browser-navigate", args: ["https://opencode.ai"] },
      { type: "invoke", channel: "browser-back", args: [] },
      { type: "invoke", channel: "browser-forward", args: [] },
      { type: "invoke", channel: "browser-reload", args: [] },
      { type: "invoke", channel: "browser-clear-data", args: [] },
      { type: "invoke", channel: "browser-annotation-markers-clear", args: [] },
      { type: "invoke", channel: "browser-console-messages", args: [{ levels: ["error"], limit: 10 }] },
      { type: "invoke", channel: "browser-console-clear", args: [{ browserId: "browser-1" }] },
      { type: "invoke", channel: "browser-state", args: [] },
      { type: "invoke", channel: "browser-screenshot", args: [] },
      { type: "invoke", channel: "browser-inspect-start", args: [] },
      { type: "invoke", channel: "browser-inspect-stop", args: [] },
      { type: "invoke", channel: "browser-get-annotation-data", args: ["button.primary"] },
      { type: "invoke", channel: "browser-click", args: ["button.primary"] },
      { type: "invoke", channel: "browser-drag", args: ["#source", "#target"] },
      { type: "invoke", channel: "browser-drag", args: [{ selector: "#source-secondary", targetSelector: "#target-secondary", browserId: "browser-1" }] },
      { type: "invoke", channel: "browser-handle-dialog", args: [{ action: "accept", promptText: "typed prompt" }] },
      { type: "invoke", channel: "browser-handle-dialog", args: [{ action: "dismiss", browserId: "browser-1" }] },
      { type: "invoke", channel: "browser-run-code", args: ["() => document.title"] },
      { type: "invoke", channel: "browser-run-code", args: [{ code: "() => location.href", browserId: "browser-1" }] },
      { type: "invoke", channel: "browser-run-playwright-code", args: ["() => document.title"] },
      { type: "invoke", channel: "browser-run-playwright-code", args: [{ code: "() => location.href", browserId: "browser-1" }] },
      { type: "invoke", channel: "browser-hover", args: ["button.primary"] },
      { type: "invoke", channel: "browser-hover", args: [{ selector: "button.secondary", browserId: "browser-1" }] },
      { type: "invoke", channel: "browser-type", args: ["input[name='email']", "hello@example.com"] },
      { type: "invoke", channel: "browser-press", args: ["Enter"] },
      { type: "invoke", channel: "browser-upload-file", args: ["input[type='file']", "fixtures/upload.txt"] },
      { type: "invoke", channel: "browser-downloads-list", args: [] },
      { type: "invoke", channel: "browser-inspect", args: [undefined] },
      { type: "invoke", channel: "browser-inspect", args: ["button.primary"] },
      { type: "invoke", channel: "browser-annotation-get-detail", args: ["annotation-1"] },
      { type: "invoke", channel: "browser-get-snapshot", args: [] },
      { type: "invoke", channel: "browser-console-messages", args: [{ browserId: "browser-1", levels: ["warn"], limit: 5 }] },
      { type: "invoke", channel: "browser-console-clear", args: [{ browserId: "browser-1" }] },
      {
        type: "invoke",
        channel: "browser-store-annotation-detail",
        args: [
          "annotation-1",
          {
            context: { nearbyDomSanitized: "checkout summary" },
            element: {
              selector: "button.primary",
              tagName: "button",
              attributes: { role: "button" },
              boundingBox: { x: 1, y: 2, width: 3, height: 4 },
            },
            id: "annotation-1",
            pageTitle: "Checkout",
            pageUrl: "https://opencode.ai/checkout",
            preview: { screenshotCrop: "data:image/png;base64,AAA" },
            userComment: "Primary CTA is misleading",
          },
        ],
      },
      { type: "invoke", channel: "browser-activate", args: [{ browserId: "browser-1" }] },
      { type: "invoke", channel: "browser-close", args: [{ browserId: "browser-1" }] },
    ])
  })

  test("returns null from toolInspect when selector annotation is missing", async () => {
    const api = createBrowserApi({
      invoke: (channel: string, ...args: unknown[]) => {
        if (channel === "browser-inspect" && args[0] === "missing") return Promise.resolve(null)
        return Promise.resolve(channel)
      },
      on() {},
      removeListener() {},
      send() {},
    })

    const missing: BrowserAnnotationData | null = await api.toolInspect("missing")

    expect(missing).toBeNull()
  })

  test("forwards open-request notifications to renderer listeners", async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const seen: string[] = []
    const api = createBrowserApi({
      invoke: () => Promise.resolve(undefined),
      on(channel: string, listener: (...args: unknown[]) => void) {
        listeners.set(channel, listener)
      },
      removeListener(channel: string) {
        listeners.delete(channel)
      },
      send() {},
    })

    const unsubscribe = api.onOpenRequested(() => {
      seen.push("opened")
    })

    listeners.get("browser-open-requested")?.()
    unsubscribe()
    listeners.get("browser-open-requested")?.()

    expect(seen).toEqual(["opened"])
  })

  test("exposes user-facing browser tool aliases on matching IPC channels", async () => {
    const calls: { channel: string; args: unknown[] }[] = []
    const api = createBrowserApi({
      invoke: (channel: string, ...args: unknown[]) => {
        calls.push({ channel, args })
        return Promise.resolve(channel)
      },
      on() {},
      removeListener() {},
      send() {},
    })

    await api.toolOpenBrowserPage()
    await api.toolOpenBrowserPage("browser-1")
    await api.toolNavigatePage("https://opencode.ai")
    await api.toolNavigatePage("https://opencode.ai/browser-1", "browser-1")
    await api.toolReadPage()
    await api.toolReadPage("browser-1")
    await api.toolScreenshotPage()
    await api.toolScreenshotPage("browser-1")
    await api.toolClickElement("button.primary")
    await api.toolClickElement("button.secondary", "browser-1")
    await api.toolTypeInPage("input[name='email']", "hello@example.com")
    await api.toolTypeInPage("input[name='name']", "Ada", "browser-1")
    await api.toolConsoleMessages()
    await api.toolConsoleMessages({ browserId: "browser-1", levels: ["error"], limit: 20 })
    await api.toolConsoleClear()
    await api.toolConsoleClear({ browserId: "browser-1" })

    expect(calls).toEqual([
      { channel: "browser-open", args: [] },
      { channel: "browser-open", args: [{ browserId: "browser-1" }] },
      { channel: "browser-navigate", args: ["https://opencode.ai"] },
      { channel: "browser-navigate", args: [{ url: "https://opencode.ai/browser-1", browserId: "browser-1" }] },
      { channel: "browser-get-snapshot", args: [] },
      { channel: "browser-get-snapshot", args: [{ browserId: "browser-1" }] },
      { channel: "browser-screenshot", args: [] },
      { channel: "browser-screenshot", args: [{ browserId: "browser-1" }] },
      { channel: "browser-click", args: ["button.primary"] },
      { channel: "browser-click", args: [{ selector: "button.secondary", browserId: "browser-1" }] },
      { channel: "browser-type", args: ["input[name='email']", "hello@example.com"] },
      { channel: "browser-type", args: [{ selector: "input[name='name']", text: "Ada", browserId: "browser-1" }] },
      { channel: "browser-console-messages", args: [] },
      { channel: "browser-console-messages", args: [{ browserId: "browser-1", levels: ["error"], limit: 20 }] },
      { channel: "browser-console-clear", args: [] },
      { channel: "browser-console-clear", args: [{ browserId: "browser-1" }] },
    ])
  })
})
