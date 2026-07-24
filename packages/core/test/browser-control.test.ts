import { describe, expect, test } from "bun:test"
import { BrowserControl } from "@opencode-ai/core/browser-control"

const state: BrowserControl.State = {
  url: "http://localhost:3000/",
  title: "App",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  generation: 1,
}

describe("BrowserControl", () => {
  test("accepts leased commands and status responses", () => {
    expect(
      BrowserControl.isRequest({
        type: "desktop.browser.request",
        version: BrowserControl.VERSION,
        requestID: "request",
        sessionID: "session",
        lease: "lease",
        command: { type: "click", ref: "e2", generation: 1 },
      }),
    ).toBe(true)
    expect(
      BrowserControl.isResponse({
        type: "desktop.browser.response",
        version: BrowserControl.VERSION,
        requestID: "request",
        result: { type: "status", attached: true, lease: "lease", state },
      }),
    ).toBe(true)
  })

  test("accepts every semantic command shape", () => {
    const commands = [
      { type: "navigate", url: "https://example.com", generation: 1 },
      { type: "snapshot", generation: 1 },
      { type: "click", ref: "@e1", generation: 1 },
      { type: "fill", ref: "e2", text: "value", generation: 1 },
      { type: "press", key: "Enter", generation: 1 },
      { type: "scroll", direction: "down", amount: 600, generation: 1 },
      { type: "screenshot", generation: 1 },
    ]
    for (const command of commands) {
      expect(
        BrowserControl.isRequest({
          type: "desktop.browser.request",
          version: BrowserControl.VERSION,
          requestID: command.type,
          sessionID: "session",
          lease: "lease",
          command,
        }),
      ).toBe(true)
    }
  })

  test("requires a captured document generation for navigation", () => {
    const request = {
      type: "desktop.browser.request",
      version: BrowserControl.VERSION,
      requestID: "navigate",
      sessionID: "session",
      lease: "lease",
    }
    expect(BrowserControl.isRequest({ ...request, command: { type: "navigate", url: "https://example.com" } })).toBe(
      false,
    )
    expect(
      BrowserControl.isRequest({
        ...request,
        command: { type: "navigate", url: "https://example.com", generation: 1 },
      }),
    ).toBe(true)
  })

  test("rejects unleased actions and malformed bridge messages", () => {
    expect(
      BrowserControl.isRequest({
        type: "desktop.browser.request",
        version: BrowserControl.VERSION,
        requestID: "request",
        sessionID: "session",
        command: { type: "snapshot", generation: 1 },
      }),
    ).toBe(false)
    expect(
      BrowserControl.isRequest({
        type: "desktop.browser.request",
        version: BrowserControl.VERSION,
        requestID: "request",
        sessionID: "session",
        lease: "lease",
        command: { type: "press", key: "LaunchMissiles", generation: 1 },
      }),
    ).toBe(false)
    expect(
      BrowserControl.isResponse({
        type: "desktop.browser.response",
        version: BrowserControl.VERSION,
        requestID: "request",
        result: { type: "status", attached: true, state },
      }),
    ).toBe(false)
  })

  test("normalizes supported URLs and refs", () => {
    expect(BrowserControl.normalizeURL("localhost:3000/test")).toBe("http://localhost:3000/test")
    expect(BrowserControl.normalizeURL("example.com")).toBe("https://example.com/")
    expect(BrowserControl.normalizeURL("file:///tmp/clicker/index.html")).toBe("file:///tmp/clicker/index.html")
    expect(BrowserControl.normalizeRef("e2")).toBe("@e2")
    expect(BrowserControl.normalizeRef("@e2")).toBe("@e2")
  })

  test("rejects unsafe URLs", () => {
    expect(() => BrowserControl.normalizeURL("javascript:alert(1)")).toThrow()
    expect(() => BrowserControl.normalizeURL("https://user:pass@example.com")).toThrow()
    expect(BrowserControl.allowedURL("data:text/html,test")).toBe(false)
  })
})
