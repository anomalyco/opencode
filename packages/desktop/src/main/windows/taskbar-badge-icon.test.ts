import { describe, expect, test } from "bun:test"
import { renderTaskbarBadgeBitmap } from "./taskbar-badge-icon"

describe("taskbar badge", () => {
  test("draws a red disc with a distinct white glyph for 1 to 9 and 9+", () => {
    const bitmaps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((count) => renderTaskbarBadgeBitmap(count, 24))

    bitmaps.forEach((bitmap) => {
      const pixels = Array.from({ length: bitmap.buffer.length / 4 }, (_, i) =>
        bitmap.buffer.subarray(i * 4, i * 4 + 4),
      )

      expect(bitmap.buffer.length).toBe(24 * 24 * 4)
      // The corner lies outside the disc.
      expect(bitmap.buffer[3]).toBe(0)
      expect(
        pixels.filter(([b, g, r, a]) => a === 255 && r === 0xc4 && g === 0x2b && b === 0x1c).length,
      ).toBeGreaterThan(100)
      expect(pixels.filter(([b, g, r, a]) => a === 255 && r > 220 && g > 220 && b > 220).length).toBeGreaterThan(10)
    })

    expect(new Set(bitmaps.map((bitmap) => bitmap.buffer.toString("base64"))).size).toBe(10)
  })
})
