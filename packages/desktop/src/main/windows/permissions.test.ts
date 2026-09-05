import { describe, expect, test } from "bun:test"
import { isMainWindowWebContents, isRendererPermission } from "./permissions"

describe("renderer permissions", () => {
  test("allows only required renderer permissions", () => {
    expect(isRendererPermission("notifications")).toBe(true)
    expect(isRendererPermission("clipboard-sanitized-write")).toBe(true)
    expect(isRendererPermission("media")).toBe(false)
  })

  test("accepts every current main window", () => {
    const windows = [11, 22]
    expect(isMainWindowWebContents(11, windows)).toBe(true)
    expect(isMainWindowWebContents(22, windows)).toBe(true)
    expect(isMainWindowWebContents(33, windows)).toBe(false)
  })
})
