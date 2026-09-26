import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { readWindowState, resolveWindowState } from "./window-state"

const defaults = { width: 1280, height: 800 }
const primary = { x: 0, y: 0, width: 1920, height: 1080 }
const displays = {
  all: () => [primary, { x: 1920, y: 0, width: 2560, height: 1440 }],
  primary: () => primary,
  matching: () => primary,
}

describe("window state", () => {
  test("keeps bounds that still fit on a display", () => {
    const saved = { x: 2000, y: 100, width: 1000, height: 700, displayBounds: { x: 1920, y: 0, width: 2560, height: 1440 } }
    expect(resolveWindowState(saved, defaults, displays)).toEqual(saved)
  })

  test("falls back to the default size on the primary display when the saved display is gone", () => {
    const saved = { x: 5000, y: 100, width: 1000, height: 700, displayBounds: { x: 4480, y: 0, width: 1920, height: 1080 } }
    expect(resolveWindowState(saved, defaults, displays)).toEqual({ ...defaults, x: 0, y: 0, displayBounds: primary })
  })

  test("uses defaults without a position when nothing usable was saved", () => {
    expect(resolveWindowState(undefined, defaults, displays)).toEqual(defaults)
    expect(resolveWindowState({ width: 0, height: -1 }, defaults, displays)).toEqual(defaults)
    expect(resolveWindowState("junk", defaults, displays)).toEqual(defaults)
  })

  test("keeps a maximized flag even without bounds", () => {
    expect(resolveWindowState({ isMaximized: true }, defaults, displays)).toEqual({ ...defaults, isMaximized: true })
  })

  test("reads the file electron-window-state wrote and ignores an unreadable one", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "opencode-window-state-"))
    const file = path.join(dir, "window-state-a.json")
    writeFileSync(
      file,
      '{"width":1280,"height":800,"x":0,"y":0,"displayBounds":{"x":0,"y":0,"width":3440,"height":1440},"isMaximized":false,"isFullScreen":false}',
    )
    expect(resolveWindowState(readWindowState(file), defaults, displays)).toEqual({
      width: 1280,
      height: 800,
      x: 0,
      y: 0,
      displayBounds: { x: 0, y: 0, width: 3440, height: 1440 },
      isMaximized: false,
      isFullScreen: false,
    })
    writeFileSync(file, "{oops")
    expect(readWindowState(file)).toBeUndefined()
    expect(readWindowState(path.join(dir, "missing.json"))).toBeUndefined()
  })
})
