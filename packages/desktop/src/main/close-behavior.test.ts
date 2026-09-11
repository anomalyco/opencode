import { describe, expect, test } from "bun:test"
import { resolveCloseAction } from "./close-behavior"

const win = { isQuitting: false, otherWindows: 0, platform: "win32" as NodeJS.Platform }

describe("resolveCloseAction", () => {
  test("hides the last window while the app is running (windows)", () => {
    expect(resolveCloseAction(win)).toBe("hide")
  })

  test("hides the last window while the app is running (linux)", () => {
    expect(resolveCloseAction({ ...win, platform: "linux" })).toBe("hide")
  })

  test("closes a window when others remain open", () => {
    expect(resolveCloseAction({ ...win, otherWindows: 1 })).toBe("close")
    expect(resolveCloseAction({ ...win, otherWindows: 3 })).toBe("close")
  })

  test("closes every window during a real quit", () => {
    expect(resolveCloseAction({ ...win, isQuitting: true })).toBe("close")
    expect(resolveCloseAction({ ...win, isQuitting: true, otherWindows: 2 })).toBe("close")
  })

  test("keeps native close behavior on macOS (no interception)", () => {
    expect(resolveCloseAction({ ...win, platform: "darwin" })).toBe("close")
    expect(resolveCloseAction({ ...win, platform: "darwin", isQuitting: true })).toBe("close")
    expect(resolveCloseAction({ ...win, platform: "darwin", otherWindows: 0 })).toBe("close")
  })
})
