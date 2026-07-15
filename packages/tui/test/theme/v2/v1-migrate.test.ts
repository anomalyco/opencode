import { expect, test } from "bun:test"
import { DEFAULT_THEMES, resolveTheme as resolveV1, selectedForeground } from "../../../src/theme"
import { resolveThemeFile } from "../../../src/theme/v2/resolve"
import { migrateV1 } from "../../../src/theme/v2/v1-migrate"

test("migrates resolved V1 modes into literal V2 tokens", () => {
  const migrated = migrateV1(DEFAULT_THEMES.opencode)
  const legacy = resolveV1(DEFAULT_THEMES.opencode, "light")
  const resolved = resolveThemeFile(migrated, "light")

  expect(migrated.standalone).toBeUndefined()
  expect(migrated.light.hue?.accent).toBeObject()
  if (typeof migrated.light.hue?.accent !== "object") throw new Error("Expected a concrete accent scale")
  expect(migrated.light.hue.accent[300]).toBe(hex(legacy.accent))
  expect(migrated.light.color?.background?.default).toBe(hex(legacy.background))
  expect(migrated.light.color?.background?.action?.primary?.default).toBe(hex(legacy.primary))
  expect(migrated.light.color?.text?.action?.primary?.default).toBe(hex(selectedForeground(legacy, legacy.primary)))
  expect(migrated.light.color?.scrollbar?.default).toBe(hex(legacy.borderActive))
  expect(migrated.light.color?.diff?.lineNumber?.background?.removed).toBe(hex(legacy.diffRemovedLineNumberBg))
  expect(migrated.light.color?.markdown?.emphasis).toBe(hex(legacy.markdownEmph))
  expect(resolved.color.background.action.secondary.hovered.toInts()).toEqual(legacy.backgroundElement.toInts())
  expect(resolved.color.background.feedback.error.default.toInts()).toEqual(legacy.background.toInts())
  expect(resolved.contexts["@context:elevated"]?.color.background.default.toInts()).toEqual(
    legacy.backgroundPanel.toInts(),
  )
  expect(resolved.contexts["@context:overlay"]?.color.background.default.toInts()).toEqual(
    legacy.backgroundMenu.toInts(),
  )
})

test("preserves V1 selected foreground behavior on transparent backgrounds", () => {
  const source = structuredClone(DEFAULT_THEMES.opencode)
  source.theme.background = "transparent"
  source.theme.primary = { light: "#ffffff", dark: "#000000" }
  delete source.theme.selectedListItemText
  const migrated = migrateV1(source)

  expect(migrated.light.color?.text?.action?.primary?.default).toBe("#000000")
  expect(migrated.dark.color?.text?.action?.primary?.default).toBe("#ffffff")
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
    expect(resolveThemeFile(migrated, "light").color.text.default).toBeDefined()
    expect(resolveThemeFile(migrated, "dark").color.text.default).toBeDefined()
  }
})

function hex(color: { toInts(): [number, number, number, number] }) {
  const [r, g, b, a] = color.toInts()
  const byte = (value: number) => value.toString(16).padStart(2, "0")
  return `#${byte(r)}${byte(g)}${byte(b)}${a === 255 ? "" : byte(a)}`
}
