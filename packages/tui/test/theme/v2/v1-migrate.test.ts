import { expect, test } from "bun:test"
import {
  migrateV1,
  resolveThemeDocument,
  selectThemeMode,
  themeModes,
  type HueScale,
  type ResolvedTheme,
} from "@opencode/theme/tui"
import { DEFAULT_THEMES, getOpenCodeTheme, resolveTheme as resolveV1 } from "../../../src/theme"
import opencodeSource from "../../../src/theme/assets/opencode.json" with { type: "json" }
import type { ThemeV1Json } from "@opencode/theme/tui/v1"

const opencodeV1 = opencodeSource as ThemeV1Json
const opencodeLight = resolveThemeDocument(getOpenCodeTheme(), "light")
const opencodeDark = resolveThemeDocument(getOpenCodeTheme(), "dark")
const opencodeLightHues = allHues(opencodeLight)

test("migrates resolved V1 modes into V2 tokens", () => {
  const migrated = migrateV1(opencodeV1)
  if (!migrated.light || !migrated.dark) throw new Error("Expected both modes")
  const legacy = resolveV1(opencodeV1, "light")
  const resolved = resolveThemeDocument(migrated, "light")

  expect(migrated.base.categorical?.length).toBeGreaterThan(0)
  expect(migrated.dark.categorical?.length).toBeGreaterThan(0)
  expect(migrated.light.hue?.accent).toMatch(/^\$hue\.[^.]+$/)
  expect(migrated.light.hue?.interactive).toMatch(/^\$hue\.[^.]+$/)
  expect(migrated.base.text?.base).toBe("$hue.neutral.200")
  expect(migrated.base.text?.muted).toBe("$hue.neutral.400")
  expect(migrated.base.background?.action?.primary?.base).toBe("transparent")
  expect(migrated.base.background?.base).toBe("$hue.neutral.800")
  expect(migrated.base.background?.raised?.base).toBe("$hue.neutral.700")
  expect(migrated.base.background?.raised?.high).toBe("$hue.neutral.600")
  expect(migrated.dark.background?.base).toBe("$hue.neutral.800")
  expect(migrated.dark.background?.raised?.base).toBe("$hue.neutral.700")
  expect(migrated.dark.background?.raised?.high).toBe("$hue.neutral.600")
  expect(migrated.base.text?.action?.primary?.base).toBe("$text.base")
  expect(migrated.base.text?.action?.secondary?.base).toBe("$text.muted")
  expect(migrated.base.text?.action?.secondary?.$hovered).toBe("$text.base")
  expect(migrated.base.background?.action?.primary?.$selected).toBe("transparent")
  expect(resolved.background.raised.base.toInts()).toEqual(legacy.backgroundPanel.toInts())
  expect(resolved.background.raised.high.toInts()).toEqual(legacy.backgroundElement.toInts())
  expect(resolved.background.formfield.selected.toInts()).toEqual(legacy.background.toInts())
  expect(resolved.background.formfield.focused.toInts()).toEqual(legacy.background.toInts())
  expect(resolved.text.formfield.base.toInts()).toEqual(legacy.text.toInts())
  expect(resolved.text.formfield.selected.toInts()).toEqual(legacy.primary.toInts())
  expect(resolved.text.formfield.focused.toInts()).toEqual(legacy.primary.toInts())
  expect(resolved.hue.accent[200].toInts()).toEqual(legacy.accent.toInts())
  expect(resolved.hue.interactive[200].toInts()).toEqual(legacy.primary.toInts())
  expect(resolved.background.action.primary.selected.toInts()).toEqual([0, 0, 0, 0])
  expect(resolved.text.action.primary.selected.toInts()).toEqual(legacy.primary.toInts())
  expect(resolved.text.action.secondary.base.toInts()).toEqual(legacy.textMuted.toInts())
  expect(resolved.text.action.secondary.hovered.toInts()).toEqual(legacy.text.toInts())
  expect(resolved.background.feedback.error.base.toInts()).toEqual(legacy.background.toInts())
  expect(resolved.surface("dialog").background.base.toInts()).toEqual(legacy.backgroundPanel.toInts())
  expect(resolved.surface("dialog").background.action.primary.base.toInts()).toEqual([0, 0, 0, 0])
  expect(resolved.surface("dialog").text.action.primary.base.toInts()).toEqual(legacy.text.toInts())
})

test("references generated hues from matching token colors", () => {
  const source = structuredClone(opencodeV1)
  source.theme.border = source.theme.primary
  source.theme.borderActive = source.theme.accent
  source.theme.syntaxKeyword = source.theme.error
  source.theme.markdownEmph = "#123456"

  const migrated = migrateV1(source)
  if (!migrated.light) throw new Error("Expected light mode")

  expect(migrated.base.border?.base).toBe("$hue.interactive.200")
  expect(migrated.base.scrollbar?.base).toBe("$hue.accent.200")
  expect(migrated.base.syntax?.keyword).toMatch(/^\$hue\.[^.]+\.200$/)
  expect(migrated.base.markdown?.emphasis).toBe("#123456")
})

test("infers and emits only chromatic hues represented by V1 colors", () => {
  const source = structuredClone(opencodeV1)
  const ambiguous = { light: "#808080", dark: "#808080" }
  source.theme.accent = ambiguous
  source.theme.warning = ambiguous
  source.theme.primary = ambiguous
  source.theme.error = ambiguous
  source.theme.info = ambiguous
  source.theme.secondary = "transparent"
  source.theme.success = { light: "#ff6666", dark: "#450000" }

  const migrated = migrateV1(source)
  if (!migrated.light || !migrated.dark) throw new Error("Expected both modes")
  const lightRed = migrated.light.hue?.red
  const darkRed = migrated.dark.hue?.red
  if (typeof lightRed !== "object" || typeof darkRed !== "object") throw new Error("Expected generated red scales")

  expect(lightRed[200]).toBe("#ff6666")
  expect(darkRed[200]).toBe("#450000")
  expect(lightRed[100]).not.toBe(lightRed[200])
  expect(darkRed[100]).not.toBe(darkRed[200])
  expect(migrated.light.hue?.orange).toBeUndefined()
  expect(migrated.light.hue?.yellow).toBeUndefined()
  expect(migrated.light.hue?.green).toBeUndefined()
  expect(migrated.light.hue?.cyan).toBeUndefined()
  expect(migrated.light.hue?.blue).toBeUndefined()
  expect(migrated.light.hue?.purple).toBeUndefined()
  expect(migrated.light.hue?.accent).toBe("$hue.gray")
  expect(migrated.light.hue?.interactive).toBe("$hue.gray")
  expect(() => resolveThemeDocument(migrated, "light")).not.toThrow()
  expect(() => resolveThemeDocument(migrated, "dark")).not.toThrow()
})

test("orders categorical hues by V1 semantic color mapping", () => {
  const source = structuredClone(opencodeV1)
  const colors = {
    light: {
      red: "#fca5a5",
      orange: "#fdba74",
      yellow: "#fde047",
      green: "#86efac",
      blue: "#93c5fd",
      purple: "#d8b4fe",
    },
    dark: {
      red: "#b91c1c",
      orange: "#c2410c",
      yellow: "#a16207",
      green: "#15803d",
      blue: "#1d4ed8",
      purple: "#7e22ce",
    },
  } as const
  const mapped = (name: "red" | "orange" | "yellow" | "green" | "blue" | "purple") => ({
    light: colors.light[name],
    dark: colors.dark[name],
  })
  source.theme.secondary = mapped("purple")
  source.theme.accent = mapped("orange")
  source.theme.success = mapped("green")
  source.theme.warning = mapped("yellow")
  source.theme.primary = mapped("blue")
  source.theme.error = mapped("red")

  const migrated = migrateV1(source)
  expect(migrated.base.categorical).toEqual(["purple", "orange", "green", "yellow", "blue", "red"])
  expect(migrated.dark?.categorical).toEqual(["purple", "orange", "green", "yellow", "blue", "red"])

  source.theme.accent = source.theme.secondary
  expect(migrateV1(source).base.categorical).toEqual(["purple", "green", "yellow", "blue", "red"])
})

test("gives accent and primary ownership of their inferred hues", () => {
  const source = structuredClone(opencodeV1)
  source.theme.success = hex(opencodeLightHues.orange[700])
  source.theme.accent = hex(opencodeLightHues.orange[600])
  source.theme.info = hex(opencodeLightHues.blue[700])
  source.theme.primary = hex(opencodeLightHues.blue[600])

  const migrated = migrateV1(source)
  if (!migrated.light) throw new Error("Expected light mode")
  const orange = migrated.light.hue?.orange
  const blue = migrated.light.hue?.blue
  if (typeof orange !== "object" || typeof blue !== "object") throw new Error("Expected concrete hue scales")

  expect(orange[200]).toBe(source.theme.accent)
  expect(blue[200]).toBe(source.theme.primary)
  expect(migrated.light.hue?.accent).toBe("$hue.orange")
  expect(migrated.light.hue?.interactive).toBe("$hue.blue")

  source.theme.primary = hex(opencodeLightHues.orange[500])
  const collisionMode = migrateV1(source).light
  const collision = collisionMode?.hue?.orange
  if (typeof collision !== "object") throw new Error("Expected concrete orange scale")
  expect(collision[200]).toBe(source.theme.primary)
  expect(collisionMode?.hue?.accent).toBe("$hue.orange")
  expect(collisionMode?.hue?.interactive).toBe("$hue.orange")
})

test("uses the semantic neutral hue when V1 categorical colors are ambiguous", () => {
  const source = structuredClone(opencodeV1)
  source.theme.secondary = "transparent"
  source.theme.accent = "transparent"
  source.theme.success = "transparent"
  source.theme.warning = "transparent"
  source.theme.primary = "transparent"
  source.theme.error = "transparent"

  const migrated = migrateV1(source)
  expect(migrated.base.categorical).toEqual(["neutral"])
  expect(migrated.dark?.categorical).toEqual(["neutral"])
})

test("builds and extrapolates gray from V1 surfaces and text without using menus or borders", () => {
  const source = structuredClone(opencodeV1)
  source.theme.background = { light: "#eeeeee", dark: "#111111" }
  source.theme.backgroundPanel = { light: "#dddddd", dark: "#222222" }
  source.theme.backgroundElement = { light: "#cccccc", dark: "#333333" }
  source.theme.textMuted = { light: "#777777", dark: "#999999" }
  source.theme.text = { light: "#333333", dark: "#dddddd" }
  source.theme.backgroundMenu = { light: "#ededed", dark: "#252525" }
  const light = resolveV1(source, "light")
  const dark = resolveV1(source, "dark")
  const migrated = migrateV1(source)
  if (!migrated.light || !migrated.dark) throw new Error("Expected both modes")
  const lightGray = migrated.light.hue?.gray
  const darkGray = migrated.dark.hue?.gray
  if (typeof lightGray !== "object" || typeof darkGray !== "object") throw new Error("Expected concrete gray scales")

  expect(lightGray[100]).not.toBe(lightGray[200])
  expect(lightGray[200]).toBe(hex(light.text))
  expect(lightGray[400]).toBe(hex(light.textMuted))
  expect(lightGray[600]).toBe(hex(light.backgroundElement))
  expect(lightGray[700]).toBe(hex(light.backgroundPanel))
  expect(lightGray[800]).toBe(hex(light.background))
  expect(lightGray[900]).not.toBe(lightGray[800])
  expect(darkGray[100]).not.toBe(darkGray[200])
  expect(darkGray[200]).toBe(hex(dark.text))
  expect(darkGray[400]).toBe(hex(dark.textMuted))
  expect(darkGray[600]).toBe(hex(dark.backgroundElement))
  expect(darkGray[700]).toBe(hex(dark.backgroundPanel))
  expect(darkGray[800]).toBe(hex(dark.background))
  expect(darkGray[900]).not.toBe(darkGray[800])

  source.theme.borderSubtle = "#ff00ff"
  source.theme.border = "#00ff00"
  source.theme.borderActive = "#00ffff"
  const withBorders = migrateV1(source)
  expect(withBorders.light?.hue?.gray).toEqual(lightGray)
  expect(withBorders.dark?.hue?.gray).toEqual(darkGray)
})

test("uses the base text reference for primary actions on transparent backgrounds", () => {
  const source = structuredClone(opencodeV1)
  source.theme.background = "transparent"
  source.theme.primary = { light: "#ffffff", dark: "#000000" }
  delete source.theme.selectedListItemText
  const migrated = migrateV1(source)
  if (!migrated.light || !migrated.dark) throw new Error("Expected both modes")

  expect(migrated.base.text?.action?.primary?.base).toBe("$text.base")
  expect(migrated.dark.text?.action?.primary?.base).toBe("$text.base")
})

test("retains V1 circular reference errors", () => {
  const source = structuredClone(opencodeV1)
  source.defs = { ...source.defs, one: "two", two: "one" }
  source.theme.primary = "one"

  expect(() => migrateV1(source)).toThrow("Circular color reference: one -> two -> one")
})

test("migrates every built-in V1 theme in its supported modes", () => {
  for (const source of Object.values(DEFAULT_THEMES)) {
    const migrated = migrateV1(source)
    for (const mode of themeModes(migrated)) {
      expect(resolveThemeDocument(migrated, mode).text.base).toBeDefined()
    }
  }
})

test("collapses identical V1 backgrounds when both variants infer one mode", () => {
  const dark = structuredClone(opencodeV1)
  dark.theme.background = "#111111"
  dark.theme.text = "#eeeeee"
  const migratedDark = migrateV1(dark)
  expect(migratedDark.light).toBeUndefined()
  expect(migratedDark.dark).toBeDefined()
  expect(themeModes(migratedDark)).toEqual(["dark"])
  expect(selectThemeMode(migratedDark, "light").mode).toBe("dark")

  const light = structuredClone(opencodeV1)
  light.theme.background = "#eeeeee"
  light.theme.text = "#111111"
  const migratedLight = migrateV1(light)
  expect(migratedLight.light).toBeDefined()
  expect(migratedLight.dark).toBeUndefined()
  expect(themeModes(migratedLight)).toEqual(["light"])
  expect(selectThemeMode(migratedLight, "dark").mode).toBe("light")
})

test("keeps both modes when a shared background has different contrast", () => {
  const source = structuredClone(opencodeV1)
  source.theme.background = "#808080"
  source.theme.text = { light: "#111111", dark: "#eeeeee" }
  const migrated = migrateV1(source)

  expect(themeModes(migrated)).toEqual(["light", "dark"])
})

function allHues(theme: ResolvedTheme) {
  return theme.hue as typeof theme.hue & Readonly<Record<string, HueScale>>
}

function hex(color: { toInts(): [number, number, number, number] }) {
  const [r, g, b, a] = color.toInts()
  const byte = (value: number) => value.toString(16).padStart(2, "0")
  return `#${byte(r)}${byte(g)}${byte(b)}${a === 255 ? "" : byte(a)}`
}
