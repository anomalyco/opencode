import { beforeEach, afterEach, describe, expect, test } from "bun:test"
import { appBasePath, appPath, serverRequestURL } from "./base-path"

const originalURL = location.href
beforeEach(() => {
  location.href = "http://localhost/"
})

afterEach(() => {
  delete window.__OPENCODE_BASE_PATH__
  document.querySelectorAll("base").forEach((base) => base.remove())
  location.href = originalURL
})

describe("appBasePath", () => {
  test("does not confuse a reloaded route with the server prefix", () => {
    history.replaceState(null, "", "/project/session/test")
    expect(appBasePath()).toBe("")
  })
  test("uses the injected prefix, including an explicitly empty prefix", () => {
    history.replaceState(null, "", "/apps/opencode/project/session/test")
    window.__OPENCODE_BASE_PATH__ = "/apps/opencode/"
    expect(appBasePath()).toBe("/apps/opencode")
    window.__OPENCODE_BASE_PATH__ = ""
    expect(appBasePath()).toBe("")
  })
  test("supports an explicit same-origin proxy base element", () => {
    const base = document.createElement("base")
    base.href = "/nested/proxy/service/"
    document.head.append(base)
    expect(appBasePath()).toBe("/nested/proxy/service")
    base.href = "https://unrelated.example/other/"
    expect(appBasePath()).toBe("")
  })
})

test.each(["", "/", "/proxy", "/proxy/", "/nested/proxy%20path/"])("server URL preserves prefix %j", (prefix) => {
  expect(serverRequestURL("https://example.com" + prefix, "/api/health?test=a%3Fb").href).toBe(
    "https://example.com" + prefix.replace(/\/+$/, "") + "/api/health?test=a%3Fb",
  )
})

test("application route matching strips exactly one prefix at a segment boundary", () => {
  window.__OPENCODE_BASE_PATH__ = "/apps/opencode"
  expect(appPath("/apps/opencode/new-session")).toBe("/new-session")
  expect(appPath("/apps/opencode/server/test/session/ses_test")).toBe("/server/test/session/ses_test")
  expect(appPath("/apps/opencode")).toBe("/")
  expect(appPath("/apps/opencode/")).toBe("/")
  expect(appPath("/apps/opencode-other/new-session")).toBe("/apps/opencode-other/new-session")
  window.__OPENCODE_BASE_PATH__ = ""
  expect(appPath("/new-session")).toBe("/new-session")
})
