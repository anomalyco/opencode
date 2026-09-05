import { describe, expect, test } from "bun:test"
import { isValidDesktopTheme } from "./loader"

const validSeeds = {
  neutral: "#111111",
  primary: "#222222",
  success: "#333333",
  warning: "#444444",
  error: "#555555",
  info: "#666666",
  interactive: "#777777",
  diffAdd: "#888888",
  diffDelete: "#999999",
}

const validPalette = {
  neutral: "#111111",
  ink: "#222222",
  primary: "#333333",
  success: "#444444",
  warning: "#555555",
  error: "#666666",
  info: "#777777",
}

function seedsTheme() {
  return {
    name: "Test Theme",
    id: "test-theme",
    light: { seeds: validSeeds },
    dark: { seeds: validSeeds },
  }
}

function paletteTheme() {
  return {
    name: "Test Theme",
    id: "test-theme",
    light: { palette: validPalette },
    dark: { palette: validPalette },
  }
}

describe("isValidDesktopTheme", () => {
  test("accepts a valid seeds-based theme", () => {
    expect(isValidDesktopTheme(seedsTheme())).toBe(true)
  })

  test("accepts a valid palette-based theme", () => {
    expect(isValidDesktopTheme(paletteTheme())).toBe(true)
  })

  test("rejects null/undefined/non-objects", () => {
    expect(isValidDesktopTheme(null)).toBe(false)
    expect(isValidDesktopTheme(undefined)).toBe(false)
    expect(isValidDesktopTheme("theme")).toBe(false)
    expect(isValidDesktopTheme(42)).toBe(false)
  })

  test("rejects a theme missing required top-level fields", () => {
    const theme = seedsTheme() as Record<string, unknown>
    delete theme.name
    expect(isValidDesktopTheme(theme)).toBe(false)
  })

  test("rejects an id that doesn't match the slug pattern", () => {
    const theme = seedsTheme()
    theme.id = "Not A Slug!"
    expect(isValidDesktopTheme(theme)).toBe(false)
  })

  test("rejects a variant with an invalid hex color", () => {
    const theme = seedsTheme()
    theme.light.seeds.primary = "not-a-color"
    expect(isValidDesktopTheme(theme)).toBe(false)
  })

  test("rejects a variant missing a required seed key", () => {
    const theme = seedsTheme() as unknown as { light: { seeds: Record<string, unknown> } }
    delete theme.light.seeds.primary
    expect(isValidDesktopTheme(theme)).toBe(false)
  })

  test("rejects a variant with neither seeds nor palette", () => {
    const theme = seedsTheme() as unknown as { light: Record<string, unknown> }
    delete theme.light.seeds
    expect(isValidDesktopTheme(theme)).toBe(false)
  })

  test("rejects a variant with both seeds and palette", () => {
    const theme = seedsTheme() as unknown as { light: { seeds: unknown; palette?: unknown } }
    theme.light.palette = validPalette
    expect(isValidDesktopTheme(theme)).toBe(false)
  })
})
