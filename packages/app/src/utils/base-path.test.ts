import { afterEach, describe, expect, test } from "bun:test"
import { currentServerUrl, runtimeBasePath, stripBrowserBasePath } from "./base-path"

const originalHead = document.head.innerHTML

afterEach(() => {
  document.head.innerHTML = originalHead
})

describe("base path runtime helpers", () => {
  test("reads the injected base path from document metadata", () => {
    document.head.innerHTML = '<meta name="opencode-base-path" content="/opencode/">'

    expect(runtimeBasePath(document)).toBe("/opencode")
  })

  test("builds the current server url from origin and base path", () => {
    document.head.innerHTML = '<meta name="opencode-base-path" content="/opencode">'

    expect(currentServerUrl(new URL("https://example.com/opencode/session/abc"), document)).toBe("https://example.com/opencode")
  })

  test("strips the browser mount path before app-specific pathname logic", () => {
    expect(stripBrowserBasePath("/opencode/session/abc", "/opencode")).toBe("/session/abc")
    expect(stripBrowserBasePath("/session/abc", "/opencode")).toBe("/session/abc")
  })
})
