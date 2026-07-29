import { expect, test } from "bun:test"
import {
  selectTheme,
  selectThemeMode,
  supportsThemeMode,
  themeModes,
  type HueDefinition,
  type ThemeDefinition,
  type ThemeDocument,
} from "@opencode-ai/theme/tui"

const hue = {} as HueDefinition
const light = { hue, categorical: ["blue"], text: { default: "#111111", subdued: "#222222" } } satisfies ThemeDefinition
const dark = {
  hue,
  categorical: ["purple"],
  text: { default: "#eeeeee", subdued: "#dddddd" },
} satisfies ThemeDefinition

test("requires and selects independent light and dark themes", () => {
  const document = { version: 2, light, dark } satisfies ThemeDocument
  expect(selectTheme(document)).toBe(light)
  expect(selectTheme(document, "light")).toBe(light)
  expect(selectTheme(document, "dark")).toBe(dark)
  expect(selectThemeMode(document, "dark").mode).toBe("dark")
})

test("merges an expanded mode override over the other mode", () => {
  const document = {
    version: 2,
    light,
    dark: { mergeMode: true, text: { default: "#ffffff" } },
  } satisfies ThemeDocument
  const selected = selectTheme(document, "dark")

  expect(selected.hue).toBeDefined()
  expect(selected.text?.default).toBe("#ffffff")
  expect(selected.text?.subdued).toBe("$text.default")
})

test("replaces categorical order in a merge mode", () => {
  const selected = selectTheme(
    { version: 2, light, dark: { mergeMode: true, categorical: ["accent", "cyan"] } },
    "dark",
  )

  expect(selected.categorical).toEqual(["accent", "cyan"])
})

test("selects the available mode when the requested mode is missing", () => {
  const lightOnly = { version: 2, light } satisfies ThemeDocument
  const darkOnly = { version: 2, dark } satisfies ThemeDocument

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
  const document = {
    version: 2,
    light: { mergeMode: true },
    dark: { mergeMode: true },
  } satisfies ThemeDocument
  expect(() => selectTheme(document)).toThrow("cannot both merge")
})
