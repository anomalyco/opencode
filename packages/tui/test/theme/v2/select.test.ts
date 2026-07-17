import { expect, test } from "bun:test"
import type { HueDefinition, ThemeDefinition, ThemeFile } from "../../../src/theme/v2"
import { selectTheme, selectThemeMode, supportsThemeMode, themeModes } from "../../../src/theme/v2/select"

const hue = {} as HueDefinition
const light = { hue, text: { default: "#111111", subdued: "#222222" } } satisfies ThemeDefinition
const dark = { hue, text: { default: "#eeeeee", subdued: "#dddddd" } } satisfies ThemeDefinition

test("requires and selects independent light and dark themes", () => {
  const file = { version: 2, light, dark } satisfies ThemeFile
  expect(selectTheme(file)).toBe(light)
  expect(selectTheme(file, "light")).toBe(light)
  expect(selectTheme(file, "dark")).toBe(dark)
  expect(selectThemeMode(file, "dark").mode).toBe("dark")
})

test("merges an expanded mode override over the other mode", () => {
  const file = {
    version: 2,
    light,
    dark: { mergeMode: true, text: { default: "#ffffff" } },
  } satisfies ThemeFile
  const selected = selectTheme(file, "dark")

  expect(selected.hue).toBeDefined()
  expect(selected.text?.default).toBe("#ffffff")
  expect(selected.text?.subdued).toBe("$text.default")
})

test("selects the available mode when the requested mode is missing", () => {
  const lightOnly = { version: 2, light } satisfies ThemeFile
  const darkOnly = { version: 2, dark } satisfies ThemeFile

  expect(themeModes(lightOnly)).toEqual(["light"])
  expect(themeModes(darkOnly)).toEqual(["dark"])
  expect(supportsThemeMode(lightOnly, "light")).toBeTrue()
  expect(supportsThemeMode(lightOnly, "dark")).toBeFalse()
  expect(selectThemeMode(lightOnly, "dark")).toEqual({ theme: light, mode: "light", expanded: false })
  expect(selectThemeMode(darkOnly, "light")).toEqual({ theme: dark, mode: "dark", expanded: false })
})

test("rejects a merge mode without its base mode", () => {
  expect(() => selectThemeMode({ version: 2, light: { mergeMode: true } })).toThrow(
    "light theme cannot merge without a dark theme",
  )
  expect(() => selectThemeMode({ version: 2, dark: { mergeMode: true } })).toThrow(
    "dark theme cannot merge without a light theme",
  )
})

test("rejects mutual mode merging", () => {
  const file = {
    version: 2,
    light: { mergeMode: true },
    dark: { mergeMode: true },
  } satisfies ThemeFile
  expect(() => selectTheme(file)).toThrow("cannot both merge")
})
