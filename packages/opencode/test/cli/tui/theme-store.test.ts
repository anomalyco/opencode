import { expect, test } from "bun:test"

const { DEFAULT_THEMES, allThemes, addTheme, hasTheme, resolveTheme } = await import(
  "../../../src/cli/cmd/tui/context/theme"
)

test("addTheme writes into module theme store", () => {
  const name = `plugin-theme-${Date.now()}`
  expect(addTheme(name, DEFAULT_THEMES.opencode)).toBe(true)

  expect(allThemes()[name]).toBeDefined()
})

test("addTheme keeps first theme for duplicate names", () => {
  const name = `plugin-theme-keep-${Date.now()}`
  const one = structuredClone(DEFAULT_THEMES.opencode)
  const two = structuredClone(DEFAULT_THEMES.opencode)
  one.theme.primary = "#101010"
  two.theme.primary = "#fefefe"

  expect(addTheme(name, one)).toBe(true)
  expect(addTheme(name, two)).toBe(false)

  expect(allThemes()[name]).toBeDefined()
  expect(allThemes()[name]!.theme.primary).toBe("#101010")
})

test("addTheme ignores entries without a theme object", () => {
  const name = `plugin-theme-invalid-${Date.now()}`
  expect(addTheme(name, { defs: { a: "#ffffff" } })).toBe(false)
  expect(allThemes()[name]).toBeUndefined()
})

test("hasTheme checks theme presence", () => {
  const name = `plugin-theme-has-${Date.now()}`
  expect(hasTheme(name)).toBe(false)
  expect(addTheme(name, DEFAULT_THEMES.opencode)).toBe(true)
  expect(hasTheme(name)).toBe(true)
})

test("resolveTheme rejects circular color refs", () => {
  const item = structuredClone(DEFAULT_THEMES.opencode)
  item.defs = {
    ...item.defs,
    one: "two",
    two: "one",
  }
  item.theme.primary = "one"

  expect(() => resolveTheme(item, "dark")).toThrow("Circular color reference")
})

test("resolveTheme uses default for overlay backgrounds when not specified", () => {
  const item = structuredClone(DEFAULT_THEMES.opencode)
  const resolved = resolveTheme(item, "dark")
  expect(resolved.backgroundDialogOverlay.a).toBeCloseTo(150 / 255, 2)
  expect(resolved.backgroundSidebarOverlay.a).toBeCloseTo(70 / 255, 2)
})

test("resolveTheme uses custom overlay background values", () => {
  const item = structuredClone(DEFAULT_THEMES.opencode)
  item.theme.backgroundDialogOverlay = "#ff0000"
  item.theme.backgroundSidebarOverlay = "#0000ff"
  const resolved = resolveTheme(item, "dark")
  expect(resolved.backgroundDialogOverlay.r).toEqual(1)
  expect(resolved.backgroundSidebarOverlay.b).toEqual(1)
})
