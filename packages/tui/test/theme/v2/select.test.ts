import { expect, test } from "bun:test"
import type { HueDefinition, ThemeDefinition, ThemeFile } from "../../../src/theme/v2"
import { selectTheme, selectThemeMode } from "../../../src/theme/v2/select"

const hue = {} as HueDefinition
const light = { hue, color: { text: { default: "#111111", subdued: "#222222" } } } satisfies ThemeDefinition
const dark = { hue, color: { text: { default: "#eeeeee", subdued: "#dddddd" } } } satisfies ThemeDefinition

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
    dark: { mergeMode: true, color: { text: { default: "#ffffff" } } },
  } satisfies ThemeFile
  const selected = selectTheme(file, "dark")

  expect(selected.hue).toBeDefined()
  expect(selected.color?.text?.default).toBe("#ffffff")
  expect(selected.color?.text?.subdued).toBe("$color.text.default")
})

test("rejects mutual mode merging", () => {
  const file = {
    version: 2,
    light: { mergeMode: true },
    dark: { mergeMode: true },
  } satisfies ThemeFile
  expect(() => selectTheme(file)).toThrow("cannot both merge")
})
