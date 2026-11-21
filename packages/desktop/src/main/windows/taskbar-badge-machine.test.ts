import { afterEach, describe, expect, test } from "bun:test"
import type { NativeImage } from "electron"
import { createTaskbarBadgeController } from "./taskbar-badge"
import { renderTaskbarBadgeBitmap } from "./taskbar-badge-icon"
import {
  INITIAL_TASKBAR_BADGE_STATE,
  selectTaskbarBadgeGlyph,
  transitionTaskbarBadge,
  type TaskbarBadgeEvent,
  type TaskbarBadgeState,
  type TaskbarBadgeTransition,
} from "./taskbar-badge-machine"

const originalPlatform = process.platform

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform })
})

function replay(events: readonly TaskbarBadgeEvent[], start: TaskbarBadgeState = INITIAL_TASKBAR_BADGE_STATE) {
  return events.reduce<TaskbarBadgeTransition>(
    (acc, event) => {
      const next = transitionTaskbarBadge(acc.state, event)

      return { state: next.state, commands: [...acc.commands, ...next.commands] }
    },
    { state: start, commands: [] },
  )
}

function fakeWindow(destroyed = false) {
  const calls: Array<{ overlay: NativeImage | null; description: string }> = []

  return {
    calls,
    win: {
      isDestroyed: () => destroyed,
      getBounds: () => ({ x: 0, y: 0, width: 1280, height: 800 }),
      setOverlayIcon: (overlay: NativeImage | null, description: string) => {
        calls.push({ overlay, description })
      },
    },
  }
}

describe("transitionTaskbarBadge", () => {
  test("stays blank when idle window reports zero", () => {
    const next = transitionTaskbarBadge(INITIAL_TASKBAR_BADGE_STATE, {
      type: "badge.reported",
      count: 0,
      description: "",
    })

    expect(next.state).toBe(INITIAL_TASKBAR_BADGE_STATE)
    expect(next.commands).toEqual([])
  })

  test("sets, updates, deduplicates, and clears badge cleanly", () => {
    const result = replay([
      { type: "badge.reported", count: 1, description: "1 session needs you" },
      { type: "badge.reported", count: 1, description: "1 session needs you" },
      { type: "badge.reported", count: 12, description: "12 sessions need you" },
      { type: "badge.reported", count: 0, description: "" },
      { type: "badge.reported", count: 0, description: "" },
    ])

    expect(result.state).toBe(INITIAL_TASKBAR_BADGE_STATE)
    expect(result.commands).toEqual([
      { type: "set", count: 1, description: "1 session needs you" },
      { type: "set", count: 12, description: "12 sessions need you" },
      { type: "clear" },
    ])
  })

  test("caps displayed glyph at 10 (9+)", () => {
    expect(selectTaskbarBadgeGlyph(0)).toBe(0)
    expect(selectTaskbarBadgeGlyph(9)).toBe(9)
    expect(selectTaskbarBadgeGlyph(10)).toBe(10)
    expect(selectTaskbarBadgeGlyph(42)).toBe(10)
  })
})

describe("renderTaskbarBadgeBitmap", () => {
  test("renders transparent corners, critical red disc, and distinct white glyphs for 1..9 and 9+", () => {
    const bitmaps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((count) => renderTaskbarBadgeBitmap(count, 24))

    bitmaps.forEach((bitmap) => {
      expect(bitmap.width).toBe(24)
      expect(bitmap.height).toBe(24)
      expect(bitmap.buffer.length).toBe(24 * 24 * 4)
      // Corner pixel (0, 0) lies outside the circle and stays transparent.
      expect(bitmap.buffer[3]).toBe(0)
      // Red disc pixels exist (B < G < R with full alpha).
      let redPixels = 0
      let whitePixels = 0

      for (let i = 0; i < bitmap.buffer.length; i += 4) {
        const b = bitmap.buffer[i]
        const g = bitmap.buffer[i + 1]
        const r = bitmap.buffer[i + 2]
        const a = bitmap.buffer[i + 3]

        if (a === 255 && r === 0xc4 && g === 0x2b && b === 0x1c) redPixels += 1

        if (a === 255 && r > 220 && g > 220 && b > 220) whitePixels += 1
      }

      expect(redPixels).toBeGreaterThan(100)
      expect(whitePixels).toBeGreaterThan(10)
    })

    const unique = new Set(bitmaps.map((bitmap) => bitmap.buffer.toString("base64")))
    expect(unique.size).toBe(10)
  })
})

describe("createTaskbarBadgeController", () => {
  test.each<{ platform: NodeJS.Platform; calls: number }>([
    { platform: "darwin", calls: 0 },
    { platform: "linux", calls: 0 },
    { platform: "win32", calls: 1 },
  ])("on $platform calls setOverlayIcon $calls time(s)", ({ platform, calls }) => {
    Object.defineProperty(process, "platform", { value: platform })
    let created = 0

    const controller = createTaskbarBadgeController({
      scaleFactor: () => 1.5,
      createImage: () => {
        created += 1

        return null
      },
    })

    const target = fakeWindow()
    controller.set(target.win, 3, "3 sessions need you")
    expect(target.calls.length).toBe(calls)
    expect(created).toBe(calls)
  })

  test("caches icons by glyph+size and clears on zero count", () => {
    Object.defineProperty(process, "platform", { value: "win32" })
    const createdSizes: number[] = []

    const controller = createTaskbarBadgeController({
      scaleFactor: () => 1.5,
      createImage: (_buffer, options) => {
        createdSizes.push(options.width)

        return null
      },
    })

    const target = fakeWindow()
    controller.set(target.win, 10, "10 sessions need you")
    controller.set(target.win, 11, "11 sessions need you")
    controller.set(target.win, 0, "")
    controller.clear(target.win)

    // Both 10 and 11 map to glyph "9+" at 24px (16 * 1.5), so only one image is rasterized.
    expect(createdSizes).toEqual([24])
    expect(target.calls.map((call) => call.description)).toEqual([
      "10 sessions need you",
      "11 sessions need you",
      "",
    ])
  })
})
