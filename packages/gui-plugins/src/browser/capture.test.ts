import { expect, test } from "bun:test"
import { pngFits, undrawable, undrawableMessage } from "./capture"

const shown = { minimized: false, visible: true, appHidden: false }

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
