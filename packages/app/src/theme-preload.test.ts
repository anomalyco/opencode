import { COLOR_SCHEME, THEME_ID } from "@opencode-ai/ui/theme/pin"
import { beforeEach, describe, expect, test } from "bun:test"

const src = await Bun.file(new URL("../public/oc-theme-preload.js", import.meta.url)).text()

const run = () => Function(src)()

beforeEach(() => {
  document.head.innerHTML = ""
  document.documentElement.removeAttribute("data-theme")
  document.documentElement.removeAttribute("data-color-scheme")
  localStorage.clear()
  Object.defineProperty(window, "matchMedia", {
    value: () =>
      ({
        matches: false,
      }) as MediaQueryList,
    configurable: true,
  })
})

describe("theme preload", () => {
  test("pins codle and system when no theme is stored", () => {
    run()

    expect(document.documentElement.dataset.theme).toBe(THEME_ID)
    expect(document.documentElement.dataset.colorScheme).toBe("light")
    expect(localStorage.getItem("opencode-theme-id")).toBe(THEME_ID)
    expect(localStorage.getItem("opencode-color-scheme")).toBe(COLOR_SCHEME)
    expect(document.getElementById("oc-theme-preload")).toBeNull()
  })

  test("migrates legacy oc-1 to codle before mount", () => {
    localStorage.setItem("opencode-theme-id", "oc-1")
    localStorage.setItem("opencode-theme-css-light", "--background-base:#fff;")
    localStorage.setItem("opencode-theme-css-dark", "--background-base:#000;")

    run()

    expect(document.documentElement.dataset.theme).toBe(THEME_ID)
    expect(localStorage.getItem("opencode-theme-id")).toBe(THEME_ID)
    expect(localStorage.getItem("opencode-color-scheme")).toBe(COLOR_SCHEME)
    expect(document.getElementById("oc-theme-preload")?.textContent).toContain("--background-base:#fff;")
  })

  test("migrates legacy lovable to codle before mount", () => {
    localStorage.setItem("opencode-theme-id", "lovable")

    run()

    expect(document.documentElement.dataset.theme).toBe(THEME_ID)
    expect(localStorage.getItem("opencode-theme-id")).toBe(THEME_ID)
    expect(localStorage.getItem("opencode-color-scheme")).toBe(COLOR_SCHEME)
  })

  test("pins stored themes to codle", () => {
    localStorage.setItem("opencode-theme-id", "nightowl")
    localStorage.setItem("opencode-color-scheme", "dark")
    localStorage.setItem("opencode-theme-css-light", "--background-base:#fff;")

    run()

    expect(document.documentElement.dataset.theme).toBe(THEME_ID)
    expect(localStorage.getItem("opencode-theme-id")).toBe(THEME_ID)
    expect(localStorage.getItem("opencode-color-scheme")).toBe(COLOR_SCHEME)
    expect(document.getElementById("oc-theme-preload")?.textContent).toContain("--background-base:#fff;")
  })
})
