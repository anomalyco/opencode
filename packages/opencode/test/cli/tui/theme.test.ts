import { RGBA } from "@opentui/core"
import { describe, expect, test } from "bun:test"

const { DEFAULT_THEMES, resolveTheme, selectedForeground } = await import("../../../src/cli/cmd/tui/context/theme")

describe("selectedForeground", () => {
  test("contrasts against the selected background when theme background is transparent", () => {
    const transparentTheme = structuredClone(DEFAULT_THEMES.opencode)
    transparentTheme.theme.background = "transparent"
    const theme = resolveTheme(transparentTheme, "dark")

    expect(selectedForeground(theme, RGBA.fromInts(245, 158, 11))).toEqual(RGBA.fromInts(0, 0, 0))
  })
})
