import { expect, test } from "bun:test"
import { win32SystemTheme } from "../src/terminal-win32"

test("win32SystemTheme returns a valid dark/light value on Windows, undefined elsewhere", () => {
  const result = win32SystemTheme()
  if (process.platform === "win32") {
    // On Windows the registry may or may not be readable; both outcomes are valid.
    // If readable, it must be "dark" or "light".
    expect(["dark", "light", undefined]).toContain(result)
  } else {
    expect(result).toBeUndefined()
  }
})

test("win32SystemTheme is idempotent - second call returns same value as first", () => {
  const a = win32SystemTheme()
  const b = win32SystemTheme()
  expect(a).toBe(b)
})
