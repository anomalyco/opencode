import { describe, expect, test } from "bun:test"
import { destroyedWindowURL, safeWebContentsURL, safeWindowURL } from "./window-state"

const webContents = (input: { destroyed?: boolean; url?: string; throws?: boolean }) => ({
  isDestroyed: () => input.destroyed === true,
  getURL: () => {
    if (input.throws) throw new Error("Object has been destroyed")
    return input.url ?? "oc://renderer/index.html"
  },
})

const windowState = (input: { destroyed?: boolean; webContents?: ReturnType<typeof webContents>; throws?: boolean }) => ({
  isDestroyed: () => input.destroyed === true,
  get webContents() {
    if (input.throws) throw new Error("Object has been destroyed")
    return input.webContents ?? webContents({})
  },
})

describe("safeWindowURL", () => {
  test("returns the current renderer URL while the window is alive", () => {
    expect(safeWindowURL(windowState({ webContents: webContents({ url: "oc://renderer/session" }) }))).toBe(
      "oc://renderer/session",
    )
  })

  test("returns a destroyed marker when Electron objects are already disposed", () => {
    expect(safeWindowURL(windowState({ destroyed: true }))).toBe(destroyedWindowURL)
    expect(safeWindowURL(windowState({ webContents: webContents({ destroyed: true }) }))).toBe(destroyedWindowURL)
    expect(safeWindowURL(windowState({ throws: true }))).toBe(destroyedWindowURL)
    expect(safeWindowURL(windowState({ webContents: webContents({ throws: true }) }))).toBe(destroyedWindowURL)
    expect(safeWebContentsURL(webContents({ destroyed: true }))).toBe(destroyedWindowURL)
  })
})
