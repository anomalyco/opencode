import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import {
  BaseHue,
  DEFAULT_THEME,
  generateSyntax,
  resolveTheme,
  resolveThemeDocument,
  selectTheme,
  type Mode,
  type ThemeDefinition,
} from "@opencode/theme/tui"
import { parseTheme, type ThemeDocumentSource } from "../../../src/theme"

const light = selectTheme(DEFAULT_THEME, "light")
const dark = selectTheme(DEFAULT_THEME, "dark")

test("orders light hues dark-to-light and dark hues light-to-dark", () => {
  const lightTheme = resolveTheme(light)
  const darkTheme = resolveTheme(dark)
  const luminance = (color: RGBA) => 0.299 * color.r + 0.587 * color.g + 0.114 * color.b

  BaseHue.literals.forEach((name) => {
    expect(luminance(lightTheme.hue[name][100])).toBeLessThan(luminance(lightTheme.hue[name][900]))
    expect(luminance(darkTheme.hue[name][100])).toBeGreaterThan(luminance(darkTheme.hue[name][900]))
  })
})

function resolveSource(source: ThemeDocumentSource, mode?: Mode, name?: string) {
  return resolveThemeDocument(parseTheme(source, name), mode)
}

function complete(mode: Mode, value: unknown = {}): ThemeDocumentSource {
  const definition = override(mode === "light" ? light : dark, value)
  const { hue, ...base } = definition
  return { version: 2, base, [mode]: { hue } }
}

test("resolves complete one-mode documents in the available mode", () => {
  const resolvedLight = resolveSource(complete("light"), "dark")
  const resolvedDark = resolveSource(complete("dark"), "light")

  expect(resolvedLight.background.base.equals(resolveTheme(light).background.base)).toBeTrue()
  expect(resolvedDark.background.base.equals(resolveTheme(dark).background.base)).toBeTrue()
  expect(resolvedLight.categorical.length).toBeGreaterThan(0)
  expect(resolvedDark.categorical.length).toBeGreaterThan(0)
})

test("rejects theme documents without a mode", () => {
  expect(() => resolveSource({ version: 2 })).toThrow("Invalid theme")
})

test("validates and resolves categorical hues in configured order", () => {
  const theme = resolveSource(complete("light", { categorical: ["accent", "red", "interactive"] }), "light")

  expect(theme.categorical[0]).toBe(theme.hue.accent)
  expect(theme.categorical[1]).toBe(theme.hue.red)
  expect(theme.categorical[2]).toBe(theme.hue.interactive)
  expect(theme.surface("dialog").categorical).toBe(theme.categorical)
  expect(() => resolveSource(complete("light", { categorical: [] }), "light")).toThrow("Invalid theme")
  expect(() =>
    resolveSource(complete("light", { categorical: ["magenta"] as never }), "light"),
  ).toThrow("Invalid theme")
})

test("generates syntax with one categorical hue", () => {
  const theme = resolveSource(complete("light", { categorical: ["red"] }), "light")
  const syntax = generateSyntax(theme)

  expect(syntax.getStyleId("extmark.skill")).not.toBeNull()
  syntax.destroy()
})

test("rejects incomplete themes instead of merging defaults", () => {
  expect(() => resolveSource({ version: 2, light: { hue: light.hue } }, "light")).toThrow("Invalid theme")
  expect(() => resolveSource({ version: 2, light: { ...light, categorical: undefined } }, "light")).toThrow(
    "Invalid theme",
  )
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
  expect(lightTheme.categorical[0]).toBe(lightTheme.hue.blue)
  expect(lightTheme.source(lightTheme.hue.blue[500])).toEqual({ hue: "blue", step: 500 })
  expect(lightTheme.source(lightTheme.hue.neutral[200])).toEqual({ hue: "neutral", step: 200 })
  expect(lightTheme.source(lightTheme.background.raised.base)).toEqual({ hue: "neutral", step: 700 })
  expect(lightTheme.increase(lightTheme.hue.red[100])).toBe(lightTheme.hue.red[200])
  expect(lightTheme.decrease(lightTheme.hue.red[200])).toBe(lightTheme.hue.red[100])
  expect(lightTheme.surface("dialog").increase(lightTheme.hue.red[100])).toBe(lightTheme.hue.red[200])
  expect(lightTheme.decrease(lightTheme.hue.red[200])).toBe(lightTheme.hue.red[100])
  expect(darkTheme.decrease(darkTheme.hue.red[200])).toBe(darkTheme.hue.red[100])
  expect(lightTheme.text.base).toBeInstanceOf(RGBA)
  expect(darkTheme.background.base).toBeInstanceOf(RGBA)
  expect(lightTheme.background.raised.base).toBe(lightTheme.hue.neutral[700])
  expect(lightTheme.background.raised.high).toBe(lightTheme.hue.neutral[600])
  expect(lightTheme.syntax.keyword).toBeInstanceOf(RGBA)
  expect(lightTheme.text.action.primary.base).toBe(lightTheme.hue.neutral[800])
  // Surfaces re-resolve the palette after applying their theme-provided overrides.
  const dialog = lightTheme.surface("dialog")
  expect(dialog.background.base).toBe(lightTheme.background.raised.base)
  expect(dialog.background.formfield.base).toBe(lightTheme.background.raised.base)
  expect(dialog.background.feedback.error.base).toBe(lightTheme.background.raised.base)
  expect(dialog.background.action.primary.hovered).toBe(lightTheme.background.raised.high)
  expect(dialog.background.action.primary.base).toBe(lightTheme.hue.interactive[500])
  expect(dialog.background.action.primary.focused).toBe(lightTheme.hue.interactive[500])
  expect(dialog.text.action.primary.base).toBe(lightTheme.hue.neutral[900])
  expect(dialog.surface("dialog")).toBe(dialog)
  expect(darkTheme.surface("dialog").background.base).toBe(darkTheme.background.raised.base)
})

test("resolves base hue aliases and rejects circular hue aliases", () => {
  const aliased = resolveTheme(
    {
      ...light,
      hue: { ...light.hue, blue: "$hue.red", purple: "$hue.blue" },
    },
  )
  const overridden = resolveSource(
    complete("light", { hue: { ...light.hue, blue: "$hue.red" } }),
    "light",
  )

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
    resolveTheme(
      {
        ...light,
        hue: { ...light.hue, red: "$hue.blue", blue: "$hue.red" },
      },
    ),
  ).toThrow("Circular hue reference: red -> blue -> red")
})

test("steps by hue source when adjacent colors have equal values", () => {
  if (typeof light.hue.gray !== "object") throw new Error("Expected a concrete gray scale")
  const theme = resolveTheme(
    {
      ...light,
      hue: {
        ...light.hue,
        gray: { ...light.hue.gray, 200: "#eee8d5", 300: "#eee8d5", 400: "#d3d7c6" },
        neutral: "$hue.gray",
      },
    },
  )

  expect(theme.hue.neutral[200]).not.toBe(theme.hue.neutral[300])
  expect(theme.hue.neutral[200].equals(theme.hue.neutral[300])).toBeTrue()
  expect(theme.source(theme.hue.neutral[200])).toEqual({ hue: "neutral", step: 200 })
  expect(theme.source(theme.hue.neutral[300])).toEqual({ hue: "neutral", step: 300 })
  expect(theme.increase(theme.hue.neutral[200])).toBe(theme.hue.neutral[300])
  expect(theme.increase(theme.hue.neutral[300])).toBe(theme.hue.neutral[400])
})

test("resolves complete light and dark definitions independently", () => {
  const lightDefinition = override(light, {
    text: {
      ...light.text,
      action: { ...light.text.action, secondary: { base: "#123456", $hovered: "#234567" } },
    },
  })
  const { hue, ...base } = lightDefinition
  const document = {
    version: 2,
    base,
    light: { hue },
    dark,
  } as const
  const lightTheme = resolveSource(document, "light")
  const darkTheme = resolveSource(document, "dark")

  expect(lightTheme.text.action.secondary.base.toInts()).toEqual([18, 52, 86, 255])
  expect(lightTheme.text.action.secondary.hovered.toInts()).toEqual([35, 69, 103, 255])
  expect(darkTheme.text.action.secondary.base).toBe(darkTheme.text.muted)
  expect(darkTheme.text.action.secondary.hovered).toBe(darkTheme.text.base)
})

test("expands structural state fallbacks within a complete theme", () => {
  const expanded = resolveTheme({
    ...light,
    background: {
      ...light.background,
      action: {
        ...light.background.action,
        primary: { base: "#123456" },
      },
    },
  })

  expect(expanded.background.action.primary.pressed.toInts()).toEqual([18, 52, 86, 255])
})

test("resolves matched action variants and states", () => {
  const theme = resolveTheme(light)

  expect(theme.text.action.primary.pressed).toBeInstanceOf(RGBA)
  expect(theme.text.action.primary.hovered).toBeInstanceOf(RGBA)
  expect(theme.text.action.primary.selected).toBeInstanceOf(RGBA)
  expect(theme.text.action.secondary.base).toBe(theme.text.muted)
  expect(theme.text.action.secondary.hovered).toBe(theme.text.base)
  expect(theme.background.action.primary.pressed).toBeInstanceOf(RGBA)
  expect(theme.background.action.primary.hovered).toBeInstanceOf(RGBA)
  expect(theme.background.action.primary.selected).toBeInstanceOf(RGBA)
  expect(theme.background.action.destructive.disabled).toBeInstanceOf(RGBA)
  expect(theme.background.formfield.hovered).toBeInstanceOf(RGBA)
})

test("resolves dialog surfaces from direct colors", () => {
  const theme = resolveSource(
    {
      ...complete("light", {
        background: {
          ...light.background,
          raised: { ...light.background.raised, base: "#123456", high: "#234567" },
        },
      }),
    },
    "light",
  )

  expect(theme.surface("dialog").background.base.toInts()).toEqual([18, 52, 86, 255])
  expect(theme.surface("dialog").background.action.primary.hovered.toInts()).toEqual([35, 69, 103, 255])
})

test("resolves transparent colors", () => {
  const theme = resolveSource(complete("light", {
    background: { ...light.background, formfield: { base: "transparent" } },
  }))
  expect(theme.background.formfield.base.toInts()).toEqual([0, 0, 0, 0])
})

test("reports theme decoding failures as native errors", () => {
  expect(() =>
    resolveSource(
      complete("light", { text: { ...light.text, base: "opaque" } }) as never,
      "light",
      "custom",
    ),
  ).toThrow('Invalid theme: custom "opaque" is an invalid value')
})

test("surface overrides rewire references and reset action states from their base", () => {
  const theme = resolveTheme(
    override(light, {
      text: {
        base: "#111111",
        action: { primary: { base: "$text.base", $pressed: "#222222" } },
      },
      "@dialog": {
        text: {
          base: "#333333",
          action: { primary: { base: "#444444", $focused: "#555555" } },
        },
      },
    }),
  )
  const raised = theme.surface("dialog")
  expect(raised.text.base.toInts()).toEqual([51, 51, 51, 255])
  expect(raised.text.action.primary.pressed.toInts()).toEqual([68, 68, 68, 255])
  expect(raised.text.action.primary.focused.toInts()).toEqual([85, 85, 85, 255])
})

test("rejects missing and circular references", () => {
  expect(() => resolveTheme(override(light, { text: { base: "$missing" } }))).toThrow(
    'Theme reference "$missing" was not found',
  )
  expect(() =>
    resolveTheme(
      override(light, {
        text: { base: "$text.muted", muted: "$text.base" },
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
    resolveTheme(
      {
        ...light,
        syntax: { ...light.syntax, keyword: "$text.base" },
      } as unknown as ThemeDefinition,
    ),
  ).toThrow("$text.base")
})

function override(base: ThemeDefinition, value: unknown) {
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
