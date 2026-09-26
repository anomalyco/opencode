import { expect, test } from "bun:test"
import { selectTheme, selectThemeMode, supportsThemeMode, themeModes } from "@opencode/theme/tui"
import { getOpenCodeTheme } from "../../../src/theme"

test("selects complete light and dark themes independently", () => {
  const light = selectTheme(getOpenCodeTheme(), "light")
  const dark = selectTheme(getOpenCodeTheme(), "dark")
  expect(selectTheme(getOpenCodeTheme())).toEqual(light)
  expect(light.hue).toEqual(getOpenCodeTheme().light.hue)
  expect(dark.text).toEqual(getOpenCodeTheme().base.text)
  expect(dark.hue).toEqual(getOpenCodeTheme().dark.hue)
  expect(selectThemeMode(getOpenCodeTheme(), "dark")).toEqual({ theme: dark, mode: "dark" })
})

test("selects the available mode when the requested mode is missing", () => {
  const lightOnly = { base: getOpenCodeTheme().base, light: getOpenCodeTheme().light } as const
  const darkOnly = { base: getOpenCodeTheme().base, dark: getOpenCodeTheme().dark } as const

  expect(themeModes(lightOnly)).toEqual(["light"])
  expect(themeModes(darkOnly)).toEqual(["dark"])
  expect(supportsThemeMode(lightOnly, "light")).toBeTrue()
  expect(supportsThemeMode(lightOnly, "dark")).toBeFalse()
  expect(selectThemeMode(lightOnly, "dark")).toEqual({ theme: selectTheme(getOpenCodeTheme(), "light"), mode: "light" })
  expect(selectThemeMode(darkOnly, "light")).toEqual({ theme: selectTheme(getOpenCodeTheme(), "dark"), mode: "dark" })
})
