import { describe, expect, test } from "bun:test"
import { LINUX_OPEN_APPS, WINDOWS_OPEN_APPS } from "./open-in-app"

describe("open in app", () => {
  test("uses the Sublime Text CLI command outside macOS", () => {
    expect(WINDOWS_OPEN_APPS.find((app) => app.id === "sublime-text")?.openWith).toBe("subl")
    expect(LINUX_OPEN_APPS.find((app) => app.id === "sublime-text")?.openWith).toBe("subl")
  })
})
