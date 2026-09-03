import { afterEach, beforeEach, expect, test } from "bun:test"
import { MemoryRouter, createMemoryHistory } from "@solidjs/router"
import { createComponent, render } from "solid-js/web"
import { isStandalone, PwaRoutePersistence, restorePwaRoute } from "../src/runtime/platform/pwa"

const key = "opencode.pwa.last-route"
const originalUrl = window.location.href

beforeEach(() => {
  window.location.href = "http://localhost/"
})

afterEach(() => {
  localStorage.removeItem(key)
  window.location.href = originalUrl
})

test("normal browser windows are not standalone", () => {
  expect(isStandalone()).toBe(false)
})

test("detects iOS home-screen apps when the standalone media query does not match", () => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "standalone")
  Object.defineProperty(navigator, "standalone", { configurable: true, value: true })
  try {
    expect(window.matchMedia("(display-mode: standalone)").matches).toBe(false)
    expect(isStandalone()).toBe(true)
  } finally {
    if (descriptor) Object.defineProperty(navigator, "standalone", descriptor)
    if (!descriptor) Reflect.deleteProperty(navigator, "standalone")
  }
})

test("restores the last PWA route including query and hash without adding history", () => {
  window.history.replaceState({ retained: true }, "", "http://localhost/")
  const length = window.history.length
  localStorage.setItem(key, "/server/local/session/session-1?view=files#file")

  restorePwaRoute()

  expect(window.location.pathname + window.location.search + window.location.hash).toBe(
    "/server/local/session/session-1?view=files#file",
  )
  expect(window.history.length).toBe(length)
  expect(window.history.state).toEqual({ retained: true })
})

test("preserves explicit launch routes, queries, and hashes", () => {
  localStorage.setItem(key, "/server/local/session/saved")
  for (const route of ["/server/local/session/linked", "/new-session?draftId=123", "/?launch=1", "/#launch"]) {
    window.history.replaceState(null, "", `http://localhost${route}`)
    restorePwaRoute()
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(route)
  }
})

test("ignores missing, invalid, external, and auth-bearing saved routes", () => {
  window.history.replaceState(null, "", "http://localhost/")
  restorePwaRoute()
  expect(window.location.pathname).toBe("/")

  for (const value of [
    "/removed-route",
    "https://example.com/new-session",
    "//example.com/new-session",
    "http://[",
    "/new-session?auth_token=secret",
  ]) {
    localStorage.setItem(key, value)
    restorePwaRoute()
    expect(window.location.href).toBe("http://localhost/")
  }
})

test("persists router navigation including returning home", async () => {
  const host = document.createElement("div")
  const history = createMemoryHistory()
  history.set({ value: "/new-session?draftId=123", replace: true, scroll: false })
  const dispose = render(() => createComponent(MemoryRouter, { history, root: PwaRoutePersistence }), host)
  try {
    expect(localStorage.getItem(key)).toBe("/new-session?draftId=123")
    history.set({ value: "/server/local/session/next#file", scroll: false })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(localStorage.getItem(key)).toBe("/server/local/session/next#file")
    history.set({ value: "/", scroll: false })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(localStorage.getItem(key)).toBe("/")
  } finally {
    dispose()
  }
})
