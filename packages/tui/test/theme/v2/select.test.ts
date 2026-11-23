import { expect, test } from "bun:test"
import { selectTheme, selectThemeMode, supportsThemeMode, themeModes } from "@opencode/theme/tui"
import { getOpenCodeClassicTheme } from "../../../src/theme"

test("selects complete light and dark themes independently", () => {
  const light = selectTheme(getOpenCodeClassicTheme(), "light")
  const dark = selectTheme(getOpenCodeClassicTheme(), "dark")
  expect(selectTheme(getOpenCodeClassicTheme())).toEqual(light)
  expect(light.hue).toEqual(getOpenCodeClassicTheme().light.hue)
  expect(dark.text).toEqual(getOpenCodeClassicTheme().base.text)
  expect(dark.hue).toEqual(getOpenCodeClassicTheme().dark.hue)
  expect(selectThemeMode(getOpenCodeClassicTheme(), "dark")).toEqual({ theme: dark, mode: "dark" })
})

test("selects the available mode when the requested mode is missing", () => {
  const lightOnly = { base: getOpenCodeClassicTheme().base, light: getOpenCodeClassicTheme().light } as const
  const darkOnly = { base: getOpenCodeClassicTheme().base, dark: getOpenCodeClassicTheme().dark } as const

  expect(themeModes(lightOnly)).toEqual(["light"])
  expect(themeModes(darkOnly)).toEqual(["dark"])
  expect(supportsThemeMode(lightOnly, "light")).toBeTrue()
  expect(supportsThemeMode(lightOnly, "dark")).toBeFalse()
  expect(selectThemeMode(lightOnly, "dark")).toEqual({ theme: selectTheme(getOpenCodeClassicTheme(), "light"), mode: "light" })
  expect(selectThemeMode(darkOnly, "light")).toEqual({ theme: selectTheme(getOpenCodeClassicTheme(), "dark"), mode: "dark" })
})
