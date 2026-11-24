import { afterEach, describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Rectangle } from "electron"
import { manageWindowState, readWindowState, resolveWindowState, type ManagedWindow } from "./window-state"

const originalPlatform = process.platform

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform })
})

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

  test.each([
    { platform: "win32" as const, expected: "kept" },
    { platform: "linux" as const, expected: "reset" },
  ])("on $platform a window snapped to the primary display's left edge is $expected", ({ platform, expected }) => {
    Object.defineProperty(process, "platform", { value: platform })
    // A left-half snap at 100% scale: the invisible resize borders put the frame 7px past the left and bottom edges.
    const snapped = { x: -7, y: 0, width: 974, height: 1047, displayBounds: primary }
    const resolved = resolveWindowState(snapped, defaults, displays)

    expect(resolved).toEqual(expected === "kept" ? snapped : { ...defaults, x: 0, y: 0, displayBounds: primary })
  })

  test.each([
    {
      name: "a maximized window keeps the frame Windows restores it to",
      reading: { maximized: true, minimized: false, bounds: { x: 1912, y: -8, width: 2576, height: 1456 } },
      expected: { x: 2100, y: 200, width: 1100, height: 700, isMaximized: true, isFullScreen: false },
    },
    {
      name: "a minimized window keeps how it was shown",
      reading: { maximized: false, minimized: true, bounds: { x: -32000, y: -32000, width: 160, height: 28 } },
      expected: { x: 100, y: 100, width: 1000, height: 600, isMaximized: true, displayBounds: primary },
    },
  ])("on win32 $name", ({ reading, expected }) => {
    Object.defineProperty(process, "platform", { value: "win32" })
    const dir = mkdtempSync(path.join(tmpdir(), "opencode-window-state-"))
    const file = path.join(dir, "window-state-a.json")
    const second = { x: 1920, y: 0, width: 2560, height: 1440 }
    const events = new EventEmitter()

    const fake: ManagedWindow = {
      maximize: () => {},
      setFullScreen: () => {},
      isDestroyed: () => false,
      isMaximized: () => reading.maximized,
      isMinimized: () => reading.minimized,
      isFullScreen: () => false,
      getBounds: () => reading.bounds,
      getNormalBounds: () => ({ x: 2100, y: 200, width: 1100, height: 700 }),
      on: (event, listener) => events.on(event, listener),
      off: (event, listener) => events.off(event, listener),
    }

    const initial = { x: 100, y: 100, width: 1000, height: 600, isMaximized: true, displayBounds: primary }

    const matching = (bounds: Rectangle) => (bounds.x >= second.x - 16 ? second : primary)

    manageWindowState(fake, file, initial, { ...displays, matching })
    events.emit("close")
    events.emit("closed")

    const written: unknown = JSON.parse(readFileSync(file, "utf8"))
    expect(written).toEqual(expected.displayBounds ? expected : { ...expected, displayBounds: second })
  })
})
