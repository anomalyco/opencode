import { describe, expect, test } from "bun:test"
import { hasBrowserOpener } from "../../src/cli/cmd/web"

describe("web browser opener", () => {
  test("skips the browser on Linux when xdg-open is missing", () => {
    expect(hasBrowserOpener("linux", null)).toBe(false)
    expect(hasBrowserOpener("linux", "/usr/bin/xdg-open")).toBe(true)
    expect(hasBrowserOpener("darwin", null)).toBe(true)
  })
})
