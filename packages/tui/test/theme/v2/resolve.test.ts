import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { DEFAULT_THEME } from "../../../src/theme/v2/defaults"
import type { ThemeDefinition } from "../../../src/theme/v2"
import { resolveTheme, resolveThemeFile } from "../../../src/theme/v2/resolve"
import { selectTheme } from "../../../src/theme/v2/select"

const light = selectTheme(DEFAULT_THEME, "light")
const dark = selectTheme(DEFAULT_THEME, "dark")

test("resolves one-mode files with defaults for the available mode", () => {
  const resolvedLight = resolveThemeFile({ version: 2, light: {} }, "dark")
  const resolvedDark = resolveThemeFile({ version: 2, dark: {} }, "light")

  expect(resolvedLight.background.default.equals(resolveTheme(light).background.default)).toBeTrue()
  expect(resolvedDark.background.default.equals(resolveTheme(dark).background.default)).toBeTrue()
})

test("rejects theme files without a mode", () => {
  // @ts-expect-error Runtime decoding also enforces the at-least-one-mode invariant.
  expect(() => resolveThemeFile({ version: 2 })).toThrow("Invalid theme")
})

test("resolves independent definitions and hue aliases", () => {
  const lightTheme = resolveTheme(light)
  const darkTheme = resolveTheme(dark)

  expect(lightTheme.hue.accent).not.toBe(lightTheme.hue.blue)
  expect(lightTheme.hue.accent[500].equals(lightTheme.hue.blue[500])).toBeTrue()
  expect(lightTheme.hue.interactive).not.toBe(lightTheme.hue.blue)
  expect(lightTheme.hue.interactive[500].equals(lightTheme.hue.blue[500])).toBeTrue()
  expect(lightTheme.hue.neutral).not.toBe(lightTheme.hue.gray)
  expect(lightTheme.hue.neutral[500].equals(lightTheme.hue.gray[500])).toBeTrue()
  expect(lightTheme.source(lightTheme.hue.blue[500])).toEqual({ hue: "blue", step: 500 })
  expect(lightTheme.source(lightTheme.hue.neutral[200])).toEqual({ hue: "neutral", step: 200 })
  expect(lightTheme.source(lightTheme.background.surface.offset)).toEqual({ hue: "neutral", step: 300 })
  expect(lightTheme.increase(lightTheme.hue.red[100])).toBe(lightTheme.hue.red[200])
  expect(lightTheme.decrease(lightTheme.hue.red[200])).toBe(lightTheme.hue.red[100])
  expect(lightTheme.contexts["@context:elevated"]?.increase(lightTheme.hue.red[100])).toBe(lightTheme.hue.red[200])
  expect(lightTheme.text.default).toBeInstanceOf(RGBA)
  expect(darkTheme.background.default).toBeInstanceOf(RGBA)
  expect(lightTheme.background.surface.offset).toBe(lightTheme.hue.neutral[300])
  expect(lightTheme.background.surface.overlay).toBe(lightTheme.hue.neutral[400])
  expect(lightTheme.syntax.keyword).toBeInstanceOf(RGBA)
  expect(lightTheme.text.action.primary.default).toBe(lightTheme.hue.neutral[200])
  expect(lightTheme.contexts["@context:elevated"]?.background.action.primary.default).toBe(
    lightTheme.hue.interactive[500],
  )
  expect(lightTheme.contexts["@context:elevated"]?.background.default).toBe(lightTheme.background.surface.offset)
  expect(lightTheme.contexts["@context:elevated"]?.text.action.primary.default).toBe(lightTheme.hue.neutral[100])
  expect(lightTheme.contexts["@context:overlay"]?.background.action.primary.default).toBe(
    lightTheme.hue.interactive[500],
  )
  expect(lightTheme.contexts["@context:overlay"]?.background.default).toBe(lightTheme.background.surface.overlay)
  expect(lightTheme.contexts["@context:overlay"]?.text.action.primary.default).toBe(lightTheme.hue.neutral[100])
  expect(darkTheme.contexts["@context:elevated"]?.background.action.primary.default).toBe(
    darkTheme.hue.interactive[400],
  )
  expect(darkTheme.contexts["@context:elevated"]?.text.action.primary.default).toBe(darkTheme.hue.neutral[200])
  expect(darkTheme.contexts["@context:overlay"]?.background.action.primary.default).toBe(darkTheme.hue.interactive[400])
  expect(darkTheme.contexts["@context:overlay"]?.text.action.primary.default).toBe(darkTheme.hue.neutral[200])
})

test("resolves base hue aliases and rejects circular hue aliases", () => {
  const aliased = resolveTheme({
    ...light,
    hue: { ...light.hue, blue: "$hue.red", purple: "$hue.blue" },
  })
  const overridden = resolveThemeFile({ version: 2, light: { hue: { blue: "$hue.red" } }, dark: {} }, "light")

  expect(aliased.hue.blue).not.toBe(aliased.hue.red)
  expect(aliased.hue.blue[500].equals(aliased.hue.red[500])).toBeTrue()
  expect(aliased.hue.purple).not.toBe(aliased.hue.blue)
  expect(aliased.hue.purple[500].equals(aliased.hue.red[500])).toBeTrue()
  expect(overridden.hue.blue).not.toBe(overridden.hue.red)
  expect(overridden.hue.blue[500].equals(overridden.hue.red[500])).toBeTrue()
  expect(aliased.source(aliased.hue.red[500])).toEqual({ hue: "red", step: 500 })
  expect(aliased.source(aliased.hue.blue[500])).toEqual({ hue: "blue", step: 500 })
  expect(aliased.source(aliased.hue.purple[500])).toEqual({ hue: "purple", step: 500 })
  expect(() =>
    resolveTheme({
      ...light,
      hue: { ...light.hue, red: "$hue.blue", blue: "$hue.red" },
    }),
  ).toThrow("Circular hue reference: red -> blue -> red")
})

test("steps by hue source when adjacent colors have equal values", () => {
  if (typeof light.hue.gray !== "object") throw new Error("Expected a concrete gray scale")
  const theme = resolveTheme({
    ...light,
    hue: {
      ...light.hue,
      gray: { ...light.hue.gray, 200: "#eee8d5", 300: "#eee8d5", 400: "#d3d7c6" },
      neutral: "$hue.gray",
    },
  })

  expect(theme.hue.neutral[200]).not.toBe(theme.hue.neutral[300])
  expect(theme.hue.neutral[200].equals(theme.hue.neutral[300])).toBeTrue()
  expect(theme.source(theme.hue.neutral[200])).toEqual({ hue: "neutral", step: 200 })
  expect(theme.source(theme.hue.neutral[300])).toEqual({ hue: "neutral", step: 300 })
  expect(theme.increase(theme.hue.neutral[200])).toBe(theme.hue.neutral[300])
  expect(theme.increase(theme.hue.neutral[300])).toBe(theme.hue.neutral[400])
})

test("merges partial files with the selected OpenCode defaults", () => {
  const theme = resolveThemeFile(
    {
      version: 2,
      light: {
        hue: light.hue,
        text: { default: "#123456" },
      },
      dark: { hue: dark.hue },
    },
    "light",
  )

  expect(theme.text.default.toInts()).toEqual([18, 52, 86, 255])
  expect(theme.text.subdued.toInts()).toEqual([18, 52, 86, 255])
  expect(theme.background.action.destructive.pressed).toBeInstanceOf(RGBA)
})

test("expands user structural fallbacks before merging defaults", () => {
  const expanded = resolveThemeFile(
    {
      version: 2,
      light: {
        hue: light.hue,
        background: { action: { primary: { default: "#123456" } } },
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
        background: { action: { primary: { $pressed: "#654321" } } },
      },
      dark: { hue: dark.hue },
    },
    "light",
  )

  expect(expanded.background.action.primary.pressed.toInts()).toEqual([18, 52, 86, 255])
  expect(isolatedState.background.action.primary.pressed.toInts()).toEqual([101, 67, 33, 255])
  expect(isolatedState.background.action.primary.focused.toInts()).toEqual(
    resolveTheme(light).background.action.primary.focused.toInts(),
  )
})

test("standalone themes skip OpenCode defaults and use the red core fallback", () => {
  const file = { version: 2, standalone: true, light: { hue: light.hue }, dark: { hue: dark.hue } } as const
  const lightTheme = resolveThemeFile(file, "light")
  const darkTheme = resolveThemeFile(file, "dark")

  expect(lightTheme.text.default.toInts()).toEqual([255, 0, 0, 255])
  expect(lightTheme.background.default.toInts()).toEqual([255, 0, 0, 255])
  expect(darkTheme.text.default.toInts()).toEqual([255, 0, 0, 255])
  expect(darkTheme.background.default.toInts()).toEqual([255, 0, 0, 255])
})

test("uses defaults for the selected mode when it merges the other mode", () => {
  const theme = resolveThemeFile({ version: 2, light: { hue: light.hue }, dark: { mergeMode: true } }, "dark")
  expect(theme.background.default.toInts()).toEqual(resolveTheme(dark).background.default.toInts())
})

test("resolves matched action variants and states", () => {
  const theme = resolveTheme(light)

  expect(theme.text.action.primary.pressed).toBeInstanceOf(RGBA)
  expect(theme.text.action.primary.hovered).toBeInstanceOf(RGBA)
  expect(theme.text.action.primary.selected).toBeInstanceOf(RGBA)
  expect(theme.background.action.primary.pressed).toBeInstanceOf(RGBA)
  expect(theme.background.action.primary.hovered).toBeInstanceOf(RGBA)
  expect(theme.background.action.primary.selected).toBeInstanceOf(RGBA)
  expect(theme.background.action.destructive.disabled).toBeInstanceOf(RGBA)
  expect(theme.background.formfield.hovered).toBeInstanceOf(RGBA)
})

test("resolves elevated hover surfaces from direct colors", () => {
  const theme = resolveThemeFile(
    {
      version: 2,
      light: { background: { surface: { offset: "#123456", overlay: "#234567" } } },
      dark: {},
    },
    "light",
  )

  expect(theme.contexts["@context:elevated"]?.background.default.toInts()).toEqual([18, 52, 86, 255])
  expect(theme.contexts["@context:elevated"]?.background.action.primary.hovered.toInts()).toEqual([35, 69, 103, 255])
})

test("resolves transparent colors", () => {
  const theme = resolveThemeFile({
    version: 2,
    light: { background: { formfield: { default: "transparent" } } },
    dark: { background: { formfield: { default: "transparent" } } },
  })
  expect(theme.background.formfield.default.toInts()).toEqual([0, 0, 0, 0])
})

test("reports theme decoding failures as native errors", () => {
  expect(() =>
    resolveThemeFile(
      {
        version: 2,
        light: { text: { default: "opaque" } },
        dark: {},
      } as never,
      "light",
      "custom",
    ),
  ).toThrow('Invalid theme: custom "opaque" is an invalid value')
})

test("context overrides rewire semantic references and apply state precedence", () => {
  const definition = override(light, {
    text: {
      default: "#111111",
      action: {
        primary: { default: "$text.default", $pressed: "#222222" },
      },
    },
    "@context:elevated": {
      text: {
        default: "#333333",
        action: { primary: { default: "#444444", $focused: "#555555" } },
      },
    },
  })
  const theme = resolveTheme(definition)
  const overlay = theme.contexts["@context:elevated"]!

  expect(overlay.text.default.toInts()).toEqual([51, 51, 51, 255])
  expect(overlay.text.action.primary.pressed.toInts()).toEqual([68, 68, 68, 255])
  expect(overlay.text.action.primary.focused.toInts()).toEqual([85, 85, 85, 255])
})

test("rejects missing, base, and contextual reference cycles", () => {
  expect(() => resolveTheme(override(light, { text: { default: "$missing" } }))).toThrow(
    'Theme reference "$missing" was not found',
  )
  expect(() =>
    resolveTheme(
      override(light, {
        text: { default: "$text.subdued", subdued: "$text.default" },
      }),
    ),
  ).toThrow("Circular theme reference")
  expect(() =>
    resolveTheme(
      override(light, {
        "@context:elevated": { text: { default: "$text.default" } },
      }),
    ),
  ).toThrow("Circular theme reference")
})

test("validates complete hues, resolved groups, and hue-only syntax", () => {
  expect(() =>
    resolveTheme({
      ...light,
      hue: { ...light.hue, accent: "$hue.missing" },
    } as unknown as ThemeDefinition),
  ).toThrow("$hue.missing")
  expect(() =>
    resolveTheme({
      ...light,
      syntax: { ...light.syntax, keyword: "$text.default" },
    } as unknown as ThemeDefinition),
  ).toThrow("$text.default")
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
