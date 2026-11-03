import { describe, expect, spyOn, test } from "bun:test"
import { EventEmitter } from "node:events"
import type { BrowserWindow } from "electron"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { manageWindowState, readWindowState, resolveWindowState } from "./window-state"

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

describe("saving window state on close", () => {
  test.each(["success", "mkdir", "write", "rename", ...(process.platform === "linux" ? ["full"] : [])])(
    "continues closing after %s",
    (stage) => {
      const dir = mkdtempSync(path.join(tmpdir(), "opencode-window-close-"))
      const file = path.join(dir, "state", "window.json")
      const warn = spyOn(console, "warn").mockImplementation(() => {})
      const bounds = { x: 10, y: 20, width: 800, height: 600 }

      const win = Object.assign(new EventEmitter(), {
        isDestroyed: () => false,
        getBounds: () => bounds,
        isMaximized: () => false,
        isMinimized: () => false,
        isFullScreen: () => false,
      })

      try {
        if (stage === "mkdir") writeFileSync(path.dirname(file), "blocked")

        if (stage === "write") {
          mkdirSync(path.dirname(file))
          writeFileSync(file, "previous state")
          mkdirSync(`${file}.tmp`)
        }

        if (stage === "rename") mkdirSync(file, { recursive: true })

        // /dev/full provides a real ENOSPC without filling the machine's disk.
        if (stage === "full") {
          mkdirSync(path.dirname(file))
          symlinkSync("/dev/full", `${file}.tmp`)
        }

        // SAFETY: this fixture implements the window events and methods used for this non-maximized state.
        manageWindowState(win as BrowserWindow, file, defaults, displays)
        const closed = { called: false }
        win.on("closed", () => {
          closed.called = true
        })
        win.emit("close")
        expect(() => win.emit("closed")).not.toThrow()
        expect(closed.called).toBe(true)
        expect(win.listenerCount("resize")).toBe(0)
        expect(win.listenerCount("move")).toBe(0)
        expect(win.listenerCount("close")).toBe(0)

        if (stage === "success") {
          expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
            ...bounds,
            isMaximized: false,
            isFullScreen: false,
            displayBounds: primary,
          })
          expect(existsSync(`${file}.tmp`)).toBe(false)
          expect(warn).not.toHaveBeenCalled()

          return
        }

        expect(warn).toHaveBeenCalledWith("Failed to save window state", { file, error: expect.any(Error) })

        if (stage === "write") expect(readFileSync(file, "utf8")).toBe("previous state")

        if (stage === "full")
          expect(warn).toHaveBeenCalledWith("Failed to save window state", {
            file,
            error: expect.objectContaining({ code: "ENOSPC" }),
          })
      } finally {
        warn.mockRestore()
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
})
