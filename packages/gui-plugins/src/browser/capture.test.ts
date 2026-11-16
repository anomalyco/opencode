import { expect, test } from "bun:test"
import { cropPixels, pngFits, undrawable, undrawableMessage } from "./capture"

const shown = { minimized: false, visible: true, appHidden: false }

test("crop uses the returned pixels, including fractional edge overlaps at non-default zoom", () => {
  // A 200 DIP view rendered at 150% DPI, at page zoom 2: one CSS pixel covers three bitmap pixels.
  const crop = (x: number, y: number, width: number, height: number) => cropPixels({ x, y, width, height }, { width: 300, height: 240 }, 200, 2)
  expect(crop(10, 20, 4, 5)).toEqual({ x: 30, y: 60, width: 12, height: 15 })
  expect(crop(99.95, 79.95, 2, 2)).toEqual({ x: 299, y: 239, width: 1, height: 1 })
  expect(crop(-2, -2, 2.05, 2.05)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  expect(crop(100, 0, 1, 1)).toBeUndefined()
  expect(crop(0, 80, 1, 1)).toBeUndefined()
})

test("reuse the redraw's PNG only when its actual dimensions and transfer size fit", () => {
  const png = Buffer.alloc(32)
  png.writeUInt32BE(800, 16)
  png.writeUInt32BE(600, 20)
  expect(pngFits(png, 800, 32)).toBe(true)
  expect(pngFits(png, 799, 32)).toBe(false)
  expect(pngFits(png, 800, 31)).toBe(false)
  expect(pngFits(png.subarray(0, 23), 800, 32)).toBe(false)
  png.writeUInt32BE(0, 20)
  expect(pngFits(png, 800, 32)).toBe(false)
})

test.each([
  { platform: "darwin", window: shown, expected: undefined },
  { platform: "darwin", window: { ...shown, minimized: true, visible: false }, expected: "minimized" },
  { platform: "darwin", window: { ...shown, appHidden: true }, expected: "hidden" },
  { platform: "darwin", window: { ...shown, visible: false }, expected: "hidden" },
  // Windows keeps drawing a minimized window, so its screenshot still works.
  { platform: "win32", window: { ...shown, minimized: true, visible: false }, expected: undefined },
  { platform: "linux", window: { ...shown, minimized: true }, expected: undefined },
] as const)("a $platform window $window cannot draw: $expected", ({ platform, window, expected }) => {
  expect(undrawable({ platform, ...window })).toBe(expected)
})

test.each(["minimized", "hidden"] as const)("the %s message asks for the window, not the connection", (reason) => {
  const message = undrawableMessage(reason)

  expect(message).toContain("restore the OpenCode window")
  expect(message).not.toMatch(/connection|reload|crash/i)
})

test("a redraw timeout never presents a cached image as a successful capture", () => {
  expect(undrawableMessage("stalled")).toContain("No cached screenshot was returned")
})
