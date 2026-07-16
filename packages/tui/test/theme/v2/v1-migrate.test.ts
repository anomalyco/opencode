import { expect, test } from "bun:test"
import { DEFAULT_THEMES, resolveTheme as resolveV1 } from "../../../src/theme"
import { resolveThemeFile } from "../../../src/theme/v2/resolve"
import { migrateV1 } from "../../../src/theme/v2/v1-migrate"

test("migrates resolved V1 modes into literal V2 tokens", () => {
  const migrated = migrateV1(DEFAULT_THEMES.opencode)
  const legacy = resolveV1(DEFAULT_THEMES.opencode, "light")
  const resolved = resolveThemeFile(migrated, "light")

  expect(migrated.standalone).toBeTrue()
  expect(migrated.light.hue?.accent).toBeObject()
  expect(migrated.light.hue?.interactive).toBeObject()
  if (typeof migrated.light.hue?.accent !== "object" || typeof migrated.light.hue.interactive !== "object") {
    throw new Error("Expected concrete accent and interactive scales")
  }
  expect(migrated.light.hue.accent[900]).toBe(hex(legacy.accent))
  expect(migrated.light.hue.interactive[900]).toBe(hex(legacy.primary))
  expect(migrated.light.text?.default).toBe("$hue.neutral.900")
  expect(migrated.light.text?.subdued).toBe("$hue.neutral.700")
  expect(migrated.light.background?.action?.primary?.default).toBe("transparent")
  expect(migrated.light.background?.default).toBe("$hue.neutral.100")
  expect(migrated.light.background?.surface?.offset).toBe("$hue.neutral.200")
  expect(migrated.light.background?.surface?.overlay).toBe("$hue.neutral.300")
  expect(migrated.dark.background?.default).toBe("$hue.neutral.900")
  expect(migrated.dark.background?.surface?.offset).toBe("$hue.neutral.800")
  expect(migrated.dark.background?.surface?.overlay).toBe("$hue.neutral.700")
  expect(migrated.light.text?.action?.primary?.default).toBe("$text.default")
  expect(migrated.light.background?.action?.primary?.$selected).toBe("$hue.interactive.900")
  expect(migrated.light.scrollbar?.default).toBe(hex(legacy.borderActive))
  expect(migrated.light.diff?.lineNumber?.background?.removed).toBe(hex(legacy.diffRemovedLineNumberBg))
  expect(migrated.light.markdown?.emphasis).toBe(hex(legacy.markdownEmph))
  expect(resolved.background.surface.offset.toInts()).toEqual(legacy.backgroundPanel.toInts())
  expect(resolved.background.surface.overlay.toInts()).toEqual(legacy.backgroundMenu.toInts())
  expect(resolved.background.formfield.selected.toInts()).toEqual(legacy.background.toInts())
  expect(resolved.background.formfield.focused.toInts()).toEqual(legacy.background.toInts())
  expect(resolved.text.formfield.default.toInts()).toEqual(legacy.text.toInts())
  expect(resolved.text.formfield.selected.toInts()).toEqual(legacy.primary.toInts())
  expect(resolved.text.formfield.focused.toInts()).toEqual(legacy.primary.toInts())
  expect(resolved.hue.accent[900].toInts()).toEqual(legacy.accent.toInts())
  expect(resolved.hue.interactive[900].toInts()).toEqual(legacy.primary.toInts())
  expect(resolved.background.action.primary.selected.toInts()).toEqual(legacy.primary.toInts())
  expect(resolved.text.action.primary.selected.toInts()).toEqual(legacy.primary.toInts())
  expect(resolved.background.feedback.error.default.toInts()).toEqual(legacy.background.toInts())
  expect(resolved.contexts["@context:elevated"]?.background.default.toInts()).toEqual(
    legacy.backgroundPanel.toInts(),
  )
  expect(resolved.contexts["@context:elevated"]?.background.action.primary.default.toInts()).toEqual([0, 0, 0, 0])
  expect(resolved.contexts["@context:elevated"]?.text.action.primary.default.toInts()).toEqual(
    legacy.text.toInts(),
  )
  expect(resolved.contexts["@context:overlay"]?.background.default.toInts()).toEqual(
    legacy.backgroundMenu.toInts(),
  )
  expect(resolved.contexts["@context:overlay"]?.background.action.primary.default.toInts()).toEqual([0, 0, 0, 0])
})

test("infers chromatic hues, anchors light and dark colors, and aliases ambiguous hues to gray", () => {
  const source = structuredClone(DEFAULT_THEMES.opencode)
  const ambiguous = { light: "#808080", dark: "#808080" }
  source.theme.accent = ambiguous
  source.theme.warning = ambiguous
  source.theme.primary = ambiguous
  source.theme.error = ambiguous
  source.theme.info = ambiguous
  source.theme.secondary = "transparent"
  source.theme.success = { light: "#ff6666", dark: "#450000" }

  const migrated = migrateV1(source)
  const lightRed = migrated.light.hue?.red
  const darkRed = migrated.dark.hue?.red
  if (typeof lightRed !== "object" || typeof darkRed !== "object") throw new Error("Expected generated red scales")

  expect(lightRed[900]).toBe("#ff6666")
  expect(darkRed[100]).toBe("#450000")
  expect(migrated.light.hue?.orange).toBe("$hue.gray")
  expect(migrated.light.hue?.yellow).toBe("$hue.gray")
  expect(migrated.light.hue?.green).toBe("$hue.gray")
  expect(migrated.light.hue?.cyan).toBe("$hue.gray")
  expect(migrated.light.hue?.blue).toBe("$hue.gray")
  expect(migrated.light.hue?.purple).toBe("$hue.gray")
  expect(migrated.light.hue?.accent).toBe("$hue.gray")
  expect(migrated.light.hue?.interactive).toBe("$hue.gray")
  expect(() => resolveThemeFile(migrated, "light")).not.toThrow()
  expect(() => resolveThemeFile(migrated, "dark")).not.toThrow()
})

test("builds gray from V1 surfaces and text without using borders", () => {
  const source = structuredClone(DEFAULT_THEMES.opencode)
  source.theme.backgroundMenu = { light: "#ededed", dark: "#252525" }
  const light = resolveV1(source, "light")
  const dark = resolveV1(source, "dark")
  const migrated = migrateV1(source)
  const lightGray = migrated.light.hue?.gray
  const darkGray = migrated.dark.hue?.gray
  if (typeof lightGray !== "object" || typeof darkGray !== "object") throw new Error("Expected concrete gray scales")

  expect(lightGray[100]).toBe(hex(light.background))
  expect(lightGray[200]).toBe(hex(light.backgroundPanel))
  expect(lightGray[300]).toBe(hex(light.backgroundMenu))
  expect(lightGray[700]).toBe(hex(light.textMuted))
  expect(lightGray[900]).toBe(hex(light.text))
  expect(darkGray[100]).toBe(hex(dark.text))
  expect(darkGray[300]).toBe(hex(dark.textMuted))
  expect(darkGray[700]).toBe(hex(dark.backgroundMenu))
  expect(darkGray[800]).toBe(hex(dark.backgroundPanel))
  expect(darkGray[900]).toBe(hex(dark.background))

  source.theme.borderSubtle = "#ff00ff"
  source.theme.border = "#00ff00"
  source.theme.borderActive = "#00ffff"
  expect(migrateV1(source).light.hue?.gray).toEqual(lightGray)
  expect(migrateV1(source).dark.hue?.gray).toEqual(darkGray)
})

test("uses the default text reference for primary actions on transparent backgrounds", () => {
  const source = structuredClone(DEFAULT_THEMES.opencode)
  source.theme.background = "transparent"
  source.theme.primary = { light: "#ffffff", dark: "#000000" }
  delete source.theme.selectedListItemText
  const migrated = migrateV1(source)

  expect(migrated.light.text?.action?.primary?.default).toBe("$text.default")
  expect(migrated.dark.text?.action?.primary?.default).toBe("$text.default")
})

test("retains V1 circular reference errors", () => {
  const source = structuredClone(DEFAULT_THEMES.opencode)
  source.defs = { ...source.defs, one: "two", two: "one" }
  source.theme.primary = "one"

  expect(() => migrateV1(source)).toThrow("Circular color reference: one -> two -> one")
})

test("migrates every built-in V1 theme in both modes", () => {
  for (const source of Object.values(DEFAULT_THEMES)) {
    const migrated = migrateV1(source)
    expect(resolveThemeFile(migrated, "light").text.default).toBeDefined()
    expect(resolveThemeFile(migrated, "dark").text.default).toBeDefined()
  }
})

function hex(color: { toInts(): [number, number, number, number] }) {
  const [r, g, b, a] = color.toInts()
  const byte = (value: number) => value.toString(16).padStart(2, "0")
  return `#${byte(r)}${byte(g)}${byte(b)}${a === 255 ? "" : byte(a)}`
}
