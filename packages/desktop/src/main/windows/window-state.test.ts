import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Rectangle } from "electron"
import { readWindowState, resolveWindowState, type Displays } from "./window-state"

const defaults = { width: 1280, height: 800 }

const primary = { x: 0, y: 0, width: 1920, height: 1080 }

const displays = createDisplays([primary, { x: 1920, y: 0, width: 2560, height: 1440 }], primary)

describe("window state", () => {
  test("keeps bounds that still fit on a display", () => {
    const saved = { x: 2000, y: 100, width: 1000, height: 700, displayBounds: { x: 1920, y: 0, width: 2560, height: 1440 } }
    expect(resolveWindowState(saved, defaults, displays)).toEqual(saved)
  })

  test("falls back to the default size on the primary display when the saved display is gone", () => {
    const saved = { x: 5000, y: 100, width: 1000, height: 700, displayBounds: { x: 4480, y: 0, width: 1920, height: 1080 } }
    expect(resolveWindowState(saved, defaults, displays)).toEqual({ ...defaults, x: 0, y: 0, displayBounds: primary })
  })

  test.each([
    { isMaximized: true, isFullScreen: false },
    { isMaximized: false, isFullScreen: true },
  ])("keeps saved window mode when bounds exceed the display (%j)", (flags) => {
    const display = { x: 0, y: 0, width: 1388, height: 781 }
    const saved = { width: 1284, height: 783, x: 2, y: 34, displayBounds: display, ...flags }

    const resolved = resolveWindowState(saved, defaults, createDisplays([display], display))

    expect(resolved).toMatchObject(flags)
    expect(resolved).toEqual({ width: 1280, height: 781, x: 0, y: 0, displayBounds: display, ...flags })
  })

  test("clamps the fallback size to a primary display smaller than the defaults", () => {
    const display = { x: 0, y: 0, width: 1024, height: 768 }
    const saved = { x: 5000, y: 100, width: 1000, height: 700, displayBounds: primary }

    expect(resolveWindowState(saved, defaults, createDisplays([display], display))).toEqual({
      width: 1024,
      height: 768,
      x: 0,
      y: 0,
      displayBounds: display,
    })
  })

  test.each([
    { display: { x: 1920, y: 0, width: 1366, height: 768 }, height: 768 },
    { display: { x: -1440, y: 0, width: 1440, height: 900 }, height: 800 },
  ])("keeps overflowing bounds on their matched display (%j)", (fixture) => {
    const display = fixture.display

    const saved = {
      x: display.x + 2,
      y: 34,
      width: display.width - 4,
      height: display.height + 2,
      displayBounds: display,
      isMaximized: true,
      isFullScreen: false,
    }

    expect(resolveWindowState(saved, defaults, createDisplays([primary, display], primary))).toEqual({
      x: display.x,
      y: display.y,
      width: 1280,
      height: fixture.height,
      displayBounds: display,
      isMaximized: true,
      isFullScreen: false,
    })
  })

  test("uses the primary display's origin when the matched display is no longer current", () => {
    const display = { x: 3200, y: 200, width: 1024, height: 768 }
    const saved = { x: 2, y: 34, width: 1284, height: 783, displayBounds: primary, isMaximized: true }

    expect(
      resolveWindowState(saved, defaults, {
        ...createDisplays([display], display),
        matching: () => primary,
      }),
    ).toEqual({ width: 1024, height: 768, x: 3200, y: 200, displayBounds: display, isMaximized: true })
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

function createDisplays(all: Rectangle[], primary: Rectangle): Displays {
  return {
    all: () => all,
    primary: () => primary,
    matching: (bounds) => ({
      ...all
        .map((display) => ({
          display,
          overlap:
            Math.max(0, Math.min(bounds.x + bounds.width, display.x + display.width) - Math.max(bounds.x, display.x)) *
            Math.max(0, Math.min(bounds.y + bounds.height, display.y + display.height) - Math.max(bounds.y, display.y)),
        }))
        .reduce((best, current) => (current.overlap > best.overlap ? current : best), { display: primary, overlap: 0 })
        .display,
    }),
  }
}
