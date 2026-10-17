import { describe, expect, test } from "bun:test"
import { titlebarOverlay, windowFrame } from "./frame"

describe("native window frame", () => {
  test.each(["linux", "win32"] as const)("enables native caption overlays on %s", (platform) => {
    expect(windowFrame(platform, "dark")).toEqual({
      frame: false,
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#00000000", symbolColor: "white", height: 44 },
    })
  })

  test("preserves macOS traffic lights without an overlay", () => {
    expect(windowFrame("darwin", "light")).toEqual({
      titleBarStyle: "hidden",
      trafficLightPosition: { x: 14, y: 14 },
    })
  })

  test("leaves other platforms' frame defaults alone", () => {
    expect(windowFrame("freebsd", "light")).toEqual({})
  })

  test("uses dark symbols for a light renderer theme", () => {
    expect(windowFrame("linux", "light").titleBarOverlay?.symbolColor).toBe("black")
  })

  test.each([
    [0.2, 44],
    [1, 44],
    [1.25, 55],
    [2, 88],
  ])("keeps native controls usable at zoom %s", (zoom, height) => {
    expect(titlebarOverlay("dark", zoom).height).toBe(height)
  })
})
