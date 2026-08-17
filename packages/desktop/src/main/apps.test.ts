import { describe, expect, test } from "bun:test"
import { isAllowedOpenApp } from "./apps"

describe("open application policy", () => {
  test.each([
    ["darwin", "Visual Studio Code"],
    ["darwin", "Cursor"],
    ["darwin", "Zed"],
    ["darwin", "TextMate"],
    ["darwin", "Antigravity"],
    ["darwin", "Terminal"],
    ["darwin", "iTerm"],
    ["darwin", "Ghostty"],
    ["darwin", "Warp"],
    ["darwin", "Xcode"],
    ["darwin", "Android Studio"],
    ["darwin", "Sublime Text"],
    ["win32", "code"],
    ["win32", "cursor"],
    ["win32", "zed"],
    ["win32", "powershell"],
    ["win32", "Sublime Text"],
    ["linux", "code"],
    ["linux", "cursor"],
    ["linux", "zed"],
    ["linux", "Sublime Text"],
  ] as const)("allows %s application %s", (platform, app) => {
    expect(isAllowedOpenApp(platform, app)).toBe(true)
  })

  test("rejects applications outside the configured list", () => {
    expect(isAllowedOpenApp("darwin", "Calculator")).toBe(false)
    expect(isAllowedOpenApp("win32", "cmd.exe")).toBe(false)
    expect(isAllowedOpenApp("linux", "sh")).toBe(false)
  })
})
