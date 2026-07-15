import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { DEFAULT_THEME } from "../../../src/theme/v2/defaults"
import type { ThemeDefinition } from "../../../src/theme/v2"
import { resolveTheme, resolveThemeFile } from "../../../src/theme/v2/resolve"
import { selectTheme } from "../../../src/theme/v2/select"

const light = selectTheme(DEFAULT_THEME, "light")
const dark = selectTheme(DEFAULT_THEME, "dark")

test("resolves independent definitions and hue aliases", () => {
  const lightTheme = resolveTheme(light)
  const darkTheme = resolveTheme(dark)

  expect(lightTheme.hue.accent).toBe(lightTheme.hue.blue)
  expect(lightTheme.hue.neutral).toBe(lightTheme.hue.gray)
  expect(lightTheme.color.text.default).toBeInstanceOf(RGBA)
  expect(darkTheme.color.background.default).toBeInstanceOf(RGBA)
  expect(lightTheme.color.syntax.keyword).toBeInstanceOf(RGBA)
  expect(lightTheme.color.text.action.primary.default).toBe(lightTheme.hue.neutral[100])
  expect(lightTheme.contexts["@context:elevated"]?.color.background.action.primary.default).toBe(
    lightTheme.hue.accent[500],
  )
  expect(lightTheme.contexts["@context:elevated"]?.color.text.action.primary.default).toBe(
    lightTheme.hue.neutral[100],
  )
  expect(lightTheme.contexts["@context:overlay"]?.color.background.action.primary.default).toBe(
    lightTheme.hue.accent[500],
  )
  expect(lightTheme.contexts["@context:overlay"]?.color.text.action.primary.default).toBe(
    lightTheme.hue.neutral[100],
  )
  expect(darkTheme.contexts["@context:elevated"]?.color.background.action.primary.default).toBe(
    darkTheme.hue.accent[400],
  )
  expect(darkTheme.contexts["@context:elevated"]?.color.text.action.primary.default).toBe(
    darkTheme.hue.neutral[100],
  )
  expect(darkTheme.contexts["@context:overlay"]?.color.background.action.primary.default).toBe(
    darkTheme.hue.accent[400],
  )
  expect(darkTheme.contexts["@context:overlay"]?.color.text.action.primary.default).toBe(
    darkTheme.hue.neutral[900],
  )
})

test("merges partial files with the selected OpenCode defaults", () => {
  const theme = resolveThemeFile(
    {
      version: 2,
      light: {
        hue: light.hue,
        color: { text: { default: "#123456" } },
      },
      dark: { hue: dark.hue },
    },
    "light",
  )

  expect(theme.color.text.default.toInts()).toEqual([18, 52, 86, 255])
  expect(theme.color.text.subdued.toInts()).toEqual([18, 52, 86, 255])
  expect(theme.color.background.action.destructive.pressed).toBeInstanceOf(RGBA)
})

test("expands user structural fallbacks before merging defaults", () => {
  const expanded = resolveThemeFile(
    {
      version: 2,
      light: {
        hue: light.hue,
        color: { background: { action: { primary: { default: "#123456" } } } },
      },
      dark: { hue: dark.hue },
    },
    "light",
  )
  const isolatedState = resolveThemeFile(
    {
      version: 2,
      light: {
        hue: light.hue,
        color: { background: { action: { primary: { $pressed: "#654321" } } } },
      },
      dark: { hue: dark.hue },
    },
    "light",
  )

  expect(expanded.color.background.action.primary.pressed.toInts()).toEqual([18, 52, 86, 255])
  expect(isolatedState.color.background.action.primary.pressed.toInts()).toEqual([101, 67, 33, 255])
  expect(isolatedState.color.background.action.primary.hovered.toInts()).toEqual(
    resolveTheme(light).color.background.action.primary.hovered.toInts(),
  )
})

test("standalone themes skip OpenCode defaults and use the red core fallback", () => {
  const file = { version: 2, standalone: true, light: { hue: light.hue }, dark: { hue: dark.hue } } as const
  const lightTheme = resolveThemeFile(file, "light")
  const darkTheme = resolveThemeFile(file, "dark")

  expect(lightTheme.color.text.default.toInts()).toEqual([255, 0, 0, 255])
  expect(lightTheme.color.background.default.toInts()).toEqual([255, 0, 0, 255])
  expect(darkTheme.color.text.default.toInts()).toEqual([255, 0, 0, 255])
  expect(darkTheme.color.background.default.toInts()).toEqual([255, 0, 0, 255])
})

test("uses defaults for the selected mode when it merges the other mode", () => {
  const theme = resolveThemeFile({ version: 2, light: { hue: light.hue }, dark: { mergeMode: true } }, "dark")
  expect(theme.color.background.default.toInts()).toEqual(resolveTheme(dark).color.background.default.toInts())
})

test("resolves matched action variants and states", () => {
  const theme = resolveTheme(light)

  expect(theme.color.text.action.primary.pressed).toBeInstanceOf(RGBA)
  expect(theme.color.background.action.primary.pressed).toBeInstanceOf(RGBA)
  expect(theme.color.text.action.secondary.default).toBeInstanceOf(RGBA)
  expect(theme.color.background.action.destructive.disabled).toBeInstanceOf(RGBA)
})

test("context overrides rewire semantic references and apply state precedence", () => {
  const definition = override(light, {
    color: {
      text: {
        default: "#111111",
        action: {
          primary: { default: "$color.text.default", $pressed: "#222222" },
          secondary: { default: "$color.text.default" },
        },
      },
    },
    "@context:elevated": {
      color: {
        text: {
          default: "#333333",
          action: { primary: { default: "#444444", $selected: "#555555" } },
        },
      },
    },
  })
  const theme = resolveTheme(definition)
  const overlay = theme.contexts["@context:elevated"]!

  expect(overlay.color.text.default.toInts()).toEqual([51, 51, 51, 255])
  expect(overlay.color.text.action.secondary.default.toInts()).toEqual([51, 51, 51, 255])
  expect(overlay.color.text.action.primary.pressed.toInts()).toEqual([68, 68, 68, 255])
  expect(overlay.color.text.action.primary.selected.toInts()).toEqual([85, 85, 85, 255])
})

test("rejects missing, base, and contextual reference cycles", () => {
  expect(() => resolveTheme(override(light, { color: { text: { default: "$missing.color" } } }))).toThrow(
    'Theme reference "$missing.color" was not found',
  )
  expect(() =>
    resolveTheme(
      override(light, {
        color: { text: { default: "$color.text.subdued", subdued: "$color.text.default" } },
      }),
    ),
  ).toThrow("Circular theme reference")
  expect(() =>
    resolveTheme(
      override(light, {
        "@context:elevated": { color: { text: { default: "$color.text.default" } } },
      }),
    ),
  ).toThrow("Circular theme reference")
})

test("validates complete hues, resolved groups, and hue-only syntax", () => {
  expect(() =>
    resolveTheme(
      {
        ...light,
        hue: { ...light.hue, accent: "$hue.missing" },
      } as unknown as ThemeDefinition,
    ),
  ).toThrow("$hue.missing")
  expect(() =>
    resolveTheme({
      ...light,
      color: { ...light.color, syntax: { ...light.color?.syntax, keyword: "$color.text.default" } },
    } as unknown as ThemeDefinition),
  ).toThrow("$color.text.default")
})

function override(base: ThemeDefinition, value: Partial<ThemeDefinition>) {
  return merge(base, value) as ThemeDefinition
}

function merge(...values: unknown[]): Record<string, unknown> {
  return values.reduce<Record<string, unknown>>((result, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return result
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue
      result[key] = item && typeof item === "object" && !Array.isArray(item) ? merge(result[key], item) : item
    }
    return result
  }, {})
}
