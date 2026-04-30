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

test("resolveTheme keeps markdown prose on base text color", () => {
  const resolved = resolveTheme(DEFAULT_THEMES.matrix, "dark")

  expect(resolved.markdownText).toBe(resolved.text)
  expect(resolved.markdownHeading).toBe(resolved.text)
  expect(resolved.markdownBlockQuote).toBe(resolved.text)
  expect(resolved.markdownEmph).toBe(resolved.text)
  expect(resolved.markdownStrong).toBe(resolved.text)
  expect(resolved.markdownListItem).toBe(resolved.text)
  expect(resolved.markdownListEnumeration).toBe(resolved.text)
  expect(resolved.markdownImageText).toBe(resolved.text)
  expect(resolved.markdownCode).not.toBe(resolved.text)
  expect(resolved.markdownLink).not.toBe(resolved.text)
})

test("graphite registers a balanced neutral palette", () => {
  const resolved = resolveTheme(DEFAULT_THEMES.graphite, "dark")

  expect(DEFAULT_THEMES.graphite).toBeDefined()
  expect(resolved.background).toBeDefined()
  expect(resolved.text).toBeDefined()
  expect(resolved.border).toBeDefined()
  expect(resolved.background).not.toBe(resolved.text)
})
