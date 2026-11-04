import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { readWindowState, resolveWindowState } from "./window-state"

const defaults = { width: 1280, height: 800 }

const primary = { x: 0, y: 0, width: 1920, height: 1080 }

const upper = { x: -102, y: -1152, width: 2752, height: 1152 }

const displays = {
  all: () => [primary, { x: 1920, y: 0, width: 2560, height: 1440 }, upper],
  primary: () => primary,
  matching: () => primary,
}

describe("window state", () => {
  test("keeps bounds that still fit on a display, including negative-coordinate monitors", () => {
    const saved = {
      x: 2000,
      y: 100,
      width: 1000,
      height: 700,
      displayBounds: { x: 1920, y: 0, width: 2560, height: 1440 },
    }

    expect(resolveWindowState(saved, defaults, displays)).toEqual(saved)

    const negative = { x: -50, y: -1000, width: 1280, height: 800, displayBounds: upper }
    expect(resolveWindowState(negative, defaults, displays)).toEqual(negative)
  })

  test.each([
    {
      name: "it is above the primary and the normal bounds stayed on the primary",
      all: displays.all(),
      displayBounds: upper,
      expected: { x: 634, y: -976, width: 1280, height: 800 },
    },
    {
      // #58247: Electron reports a 1366x768 panel as 1388x781 DIP, shorter than the 800px default.
      name: "it is shorter than the normal bounds",
      all: [{ x: 0, y: 0, width: 1388, height: 781 }],
      displayBounds: { x: 0, y: 0, width: 1388, height: 781 },
      expected: { x: 54, y: 0, width: 1280, height: 781 },
    },
  ])("maximizes on the saved display when $name", (input) => {
    const saved = { x: 0, y: 0, width: 1280, height: 800, displayBounds: input.displayBounds, isMaximized: true }

    expect(resolveWindowState(saved, defaults, { ...displays, all: () => [...input.all] })).toEqual({
      ...input.expected,
      displayBounds: input.displayBounds,
      isMaximized: true,
    })
  })

  test("falls back to the default size on the primary display when the saved display is gone", () => {
    const saved = {
      x: 5000,
      y: 100,
      width: 1000,
      height: 700,
      displayBounds: { x: 4480, y: 0, width: 1920, height: 1080 },
    }

    expect(resolveWindowState(saved, defaults, displays)).toEqual({ ...defaults, x: 0, y: 0, displayBounds: primary })

    expect(resolveWindowState({ ...saved, isMaximized: true }, defaults, displays)).toEqual({
      ...defaults,
      x: 0,
      y: 0,
      displayBounds: primary,
      isMaximized: true,
    })
  })

  test("uses defaults without a position when nothing usable was saved", () => {
    expect(resolveWindowState(undefined, defaults, displays)).toEqual(defaults)
    expect(resolveWindowState({ width: 0, height: -1 }, defaults, displays)).toEqual(defaults)
    expect(resolveWindowState({}, defaults, displays)).toEqual(defaults)
  })

  test("keeps a maximized flag even without bounds", () => {
    expect(resolveWindowState({ isMaximized: true }, defaults, displays)).toEqual({ ...defaults, isMaximized: true })
  })

  test("reads the file electron-window-state wrote and ignores an unreadable or non-object one", () => {
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
    writeFileSync(file, '"junk"')
    expect(readWindowState(file)).toBeUndefined()
    writeFileSync(file, "{oops")
    expect(readWindowState(file)).toBeUndefined()
    expect(readWindowState(path.join(dir, "missing.json"))).toBeUndefined()
  })
})
