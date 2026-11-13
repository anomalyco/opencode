import { expect, test } from "bun:test"
import { undrawable, undrawableMessage } from "./capture"

const shown = { minimized: false, visible: true, appHidden: false }

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

test.each(["minimized", "hidden", "stalled"] as const)("the %s message asks for the window, not the connection", (reason) => {
  const message = undrawableMessage(reason)

  expect(message).toContain("restore the OpenCode window")
  expect(message).not.toMatch(/connection|reload|crash/i)
})
