import { describe, expect, test } from "bun:test"
import { shouldShowSessionHeaderFileTreeAction } from "./session-header-actions"

describe("shouldShowSessionHeaderFileTreeAction", () => {
  test("shows the header action when the desktop file tree feature is visible", () => {
    expect(shouldShowSessionHeaderFileTreeAction({ desktop: true, visible: true })).toBe(true)
  })

  test("hides the header action on mobile or when the feature is hidden", () => {
    expect(shouldShowSessionHeaderFileTreeAction({ desktop: false, visible: true })).toBe(false)
    expect(shouldShowSessionHeaderFileTreeAction({ desktop: true, visible: false })).toBe(false)
  })
})
