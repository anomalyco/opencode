import { expect, test } from "bun:test"
import { DEFAULT_THEME, selectTheme, selectThemeMode, supportsThemeMode, themeModes } from "@opencode/theme/tui"

test("selects complete light and dark themes independently", () => {
  expect(selectTheme(DEFAULT_THEME)).toEqual({ ...DEFAULT_THEME.base, ...DEFAULT_THEME.light })
  expect(selectTheme(DEFAULT_THEME, "light")).toEqual({ ...DEFAULT_THEME.base, ...DEFAULT_THEME.light })
  expect(selectTheme(DEFAULT_THEME, "dark")).toEqual({ ...DEFAULT_THEME.base, ...DEFAULT_THEME.dark })
  expect(selectThemeMode(DEFAULT_THEME, "dark")).toEqual({
    theme: { ...DEFAULT_THEME.base, ...DEFAULT_THEME.dark },
    mode: "dark",
  })
})

test("selects the available mode when the requested mode is missing", () => {
  const lightOnly = { version: 2, base: DEFAULT_THEME.base, light: DEFAULT_THEME.light } as const
  const darkOnly = { version: 2, base: DEFAULT_THEME.base, dark: DEFAULT_THEME.dark } as const

  expect(themeModes(lightOnly)).toEqual(["light"])
  expect(themeModes(darkOnly)).toEqual(["dark"])
  expect(supportsThemeMode(lightOnly, "light")).toBeTrue()
  expect(supportsThemeMode(lightOnly, "dark")).toBeFalse()
  expect(selectThemeMode(lightOnly, "dark")).toEqual({
    theme: { ...DEFAULT_THEME.base, ...DEFAULT_THEME.light },
    mode: "light",
  })
  expect(selectThemeMode(darkOnly, "light")).toEqual({
    theme: { ...DEFAULT_THEME.base, ...DEFAULT_THEME.dark },
    mode: "dark",
  })
})
