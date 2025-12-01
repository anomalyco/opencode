import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { tmpdir } from "os"
import { join } from "path"
import { Config } from "../../src/config/config"
import { writeFileSync, mkdirSync, rmSync } from "fs"

describe("Theme Loading", () => {
  let tempDir: string

  beforeAll(() => {
    tempDir = join(tmpdir(), "opencode-theme-test")
    mkdirSync(tempDir, { recursive: true })
  })

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test("should load JSONC theme file with comments", async () => {
    const themeContent = `{
  // This is a comment
  "$schema": "https://opencode.ai/theme.json",
  "theme": {
    "primary": "#ff0000",
    "secondary": "#00ff00"
  }
}`

    const themeFile = join(tempDir, "test-theme.jsonc")
    writeFileSync(themeFile, themeContent)

    const theme = await Config.loadThemeFile(themeFile)

    expect(theme.theme.primary).toBe("#ff0000")
    expect(theme.theme.secondary).toBe("#00ff00")
  })

  test("should NOT process environment variables in themes", async () => {
    process.env.TEST_COLOR = "#00ff00"
    const themeContent = `{
  "theme": {
    "primary": "{env:TEST_COLOR}",
    "secondary": "#ff0000"
  }
}`

    const themeFile = join(tempDir, "test-theme.jsonc")
    writeFileSync(themeFile, themeContent)

    const theme = await Config.loadThemeFile(themeFile)

    // Environment variable should NOT be processed in themes
    expect(theme.theme.primary).toBe("{env:TEST_COLOR}")
    expect(theme.theme.secondary).toBe("#ff0000")
  })

  test("should NOT process file inclusion in themes", async () => {
    const colorFile = join(tempDir, "color.txt")
    writeFileSync(colorFile, "#00ff00")

    const themeContent = `{
  "theme": {
    "primary": "{file:color.txt}",
    "secondary": "#ff0000"
  }
}`

    const themeFile = join(tempDir, "test-theme.jsonc")
    writeFileSync(themeFile, themeContent)

    const theme = await Config.loadThemeFile(themeFile)

    // File inclusion should NOT be processed in themes
    expect(theme.theme.primary).toBe("{file:color.txt}")
    expect(theme.theme.secondary).toBe("#ff0000")
  })

  test("should handle trailing commas in JSONC themes", async () => {
    const themeContent = `{
  "theme": {
    "primary": "#ff0000",
    "secondary": "#00ff00", // Trailing comma
  }
}`

    const themeFile = join(tempDir, "test-theme.jsonc")
    writeFileSync(themeFile, themeContent)

    const theme = await Config.loadThemeFile(themeFile)

    expect(theme.theme.primary).toBe("#ff0000")
    expect(theme.theme.secondary).toBe("#00ff00")
  })

  test("should throw error for invalid JSONC theme", async () => {
    const themeContent = `{
  "theme": {
    "primary": "#ff0000",
    // Missing closing brace
    "secondary": "#00ff00",
  }`

    const themeFile = join(tempDir, "test-theme.jsonc")
    writeFileSync(themeFile, themeContent)

    expect(Config.loadThemeFile(themeFile)).rejects.toThrow()
  })

  test("should throw error for empty theme file", async () => {
    const themeFile = join(tempDir, "empty-theme.jsonc")
    writeFileSync(themeFile, "")

    expect(Config.loadThemeFile(themeFile)).rejects.toThrow("Empty theme file")
  })
})
