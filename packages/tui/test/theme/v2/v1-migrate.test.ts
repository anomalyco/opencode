import { expect, test } from "bun:test"
import { DEFAULT_THEMES, resolveTheme as resolveV1, selectedForeground } from "../../../src/theme"
import { resolveThemeFile } from "../../../src/theme/v2/resolve"
import { migrateV1 } from "../../../src/theme/v2/v1-migrate"

test("migrates resolved V1 modes into literal V2 tokens", () => {
  const migrated = migrateV1(DEFAULT_THEMES.opencode)
  const legacy = resolveV1(DEFAULT_THEMES.opencode, "light")
  const resolved = resolveThemeFile(migrated, "light")

  expect(migrated.standalone).toBeTrue()
  expect(migrated.light.hue?.accent).toBeObject()
  if (typeof migrated.light.hue?.accent !== "object") throw new Error("Expected a concrete accent scale")
  expect(migrated.light.hue.accent[500]).toBe(hex(legacy.secondary))
  expect(migrated.light.background?.default).toBe(hex(legacy.background))
  expect(migrated.light.background?.action?.primary?.default).toBe(hex(legacy.primary))
  expect(migrated.light.text?.action?.primary?.default).toBe(hex(selectedForeground(legacy, legacy.primary)))
  expect(migrated.light.scrollbar?.default).toBe(hex(legacy.borderActive))
  expect(migrated.light.diff?.lineNumber?.background?.removed).toBe(hex(legacy.diffRemovedLineNumberBg))
  expect(migrated.light.markdown?.emphasis).toBe(hex(legacy.markdownEmph))
  expect(resolved.background.action.secondary.focused.toInts()).toEqual(legacy.backgroundElement.toInts())
  expect(resolved.background.surface.offset.toInts()).toEqual(legacy.backgroundPanel.toInts())
  expect(resolved.background.surface.overlay.toInts()).toEqual(legacy.backgroundMenu.toInts())
  expect(resolved.background.formfield.selected.toInts()).toEqual(legacy.background.toInts())
  expect(resolved.background.formfield.focused.toInts()).toEqual(legacy.background.toInts())
  expect(resolved.text.formfield.default.toInts()).toEqual(legacy.text.toInts())
  expect(resolved.text.formfield.selected.toInts()).toEqual(legacy.primary.toInts())
  expect(resolved.text.formfield.focused.toInts()).toEqual(legacy.primary.toInts())
  expect(resolved.hue.accent[500].toInts()).toEqual(legacy.secondary.toInts())
  expect(resolved.hue.accent[300].r + resolved.hue.accent[300].g + resolved.hue.accent[300].b).toBeGreaterThan(
    resolved.hue.accent[500].r + resolved.hue.accent[500].g + resolved.hue.accent[500].b,
  )
  expect(resolved.background.feedback.error.default.toInts()).toEqual(legacy.background.toInts())
  expect(resolved.contexts["@context:elevated"]?.background.default.toInts()).toEqual(
    legacy.backgroundPanel.toInts(),
  )
  expect(resolved.contexts["@context:elevated"]?.background.action.secondary.default.toInts()).toEqual(
    legacy.backgroundPanel.toInts(),
  )
  expect(resolved.contexts["@context:elevated"]?.background.action.primary.default.toInts()).toEqual(
    legacy.primary.toInts(),
  )
  expect(resolved.contexts["@context:elevated"]?.text.action.primary.default.toInts()).toEqual(
    selectedForeground(legacy, legacy.primary).toInts(),
  )
  expect(resolved.contexts["@context:overlay"]?.background.default.toInts()).toEqual(
    legacy.backgroundMenu.toInts(),
  )
  expect(resolved.contexts["@context:overlay"]?.background.action.primary.default.toInts()).toEqual(
    legacy.primary.toInts(),
  )
})

test("preserves V1 selected foreground behavior on transparent backgrounds", () => {
  const source = structuredClone(DEFAULT_THEMES.opencode)
  source.theme.background = "transparent"
  source.theme.primary = { light: "#ffffff", dark: "#000000" }
  delete source.theme.selectedListItemText
  const migrated = migrateV1(source)

  expect(migrated.light.text?.action?.primary?.default).toBe("#000000")
  expect(migrated.dark.text?.action?.primary?.default).toBe("#ffffff")
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
