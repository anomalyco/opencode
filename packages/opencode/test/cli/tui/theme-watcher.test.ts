import { expect, test, afterAll, beforeAll } from "bun:test"
import { mkdir, writeFile, rm } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { Global } from "../../../src/global"

const { getCustomThemes } = await import("../../../src/cli/cmd/tui/context/theme")

const testThemeName = `test-watcher-${Date.now()}`
const testThemePath = path.join(Global.Path.config, "themes", `${testThemeName}.json`)

const minimalTheme = {
  theme: {
    primary: "#00ff00",
    secondary: "#ff00ff",
    accent: "#00ffff",
    error: "#ff0000",
    warning: "#ffff00",
    success: "#00ff00",
    info: "#00ffff",
    text: "#ffffff",
    textMuted: "#888888",
    background: "#000000",
    backgroundPanel: "#111111",
    backgroundElement: "#222222",
    borderSubtle: "#333333",
    border: "#444444",
    borderActive: "#555555",
    diffAdded: "#00ff00",
    diffRemoved: "#ff0000",
    diffContext: "#888888",
    diffHunkHeader: "#666666",
    diffHighlightAdded: "#00ff00",
    diffHighlightRemoved: "#ff0000",
    diffContextBg: "#333333",
    diffLineNumber: "#555555",
    diffAddedLineNumberBg: "#003300",
    diffRemovedLineNumberBg: "#330000",
    markdownText: "#ffffff",
    markdownHeading: "#ffffff",
    markdownLink: "#0000ff",
    markdownLinkText: "#00ffff",
    markdownCode: "#00ff00",
    markdownBlockQuote: "#ffff00",
    markdownEmph: "#ffff00",
    markdownStrong: "#ffffff",
    markdownHorizontalRule: "#888888",
    markdownListItem: "#0000ff",
    markdownListEnumeration: "#00ffff",
    markdownImage: "#0000ff",
    markdownImageText: "#00ffff",
    markdownCodeBlock: "#ffffff",
    syntaxComment: "#888888",
    syntaxKeyword: "#ff00ff",
    syntaxFunction: "#0000ff",
    syntaxVariable: "#ffffff",
    syntaxString: "#00ff00",
    syntaxNumber: "#ffff00",
    syntaxType: "#00ffff",
    syntaxOperator: "#00ffff",
    syntaxPunctuation: "#ffffff",
  },
}

async function ensureThemesDir() {
  const dir = path.dirname(testThemePath)
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
}

beforeAll(async () => {
  await ensureThemesDir()
})

afterAll(async () => {
  if (existsSync(testThemePath)) {
    await rm(testThemePath).catch(() => {})
  }
})

test("getCustomThemes picks up new theme file", async () => {
  const themes = await getCustomThemes()
  const initialCount = Object.keys(themes).length

  await writeFile(testThemePath, JSON.stringify(minimalTheme))

  const themesAfter = await getCustomThemes()
  expect(Object.keys(themesAfter).length).toBe(initialCount + 1)
  expect(themesAfter[testThemeName]).toBeDefined()
  expect(themesAfter[testThemeName]!.theme.primary).toBe("#00ff00")
})

test("getCustomThemes reflects modified theme file", async () => {
  const updatedTheme = {
    ...minimalTheme,
    theme: { ...minimalTheme.theme, primary: "#ff0000" },
  }
  await writeFile(testThemePath, JSON.stringify(updatedTheme))

  const themes = await getCustomThemes()
  expect(themes[testThemeName]).toBeDefined()
  expect(themes[testThemeName]!.theme.primary).toBe("#ff0000")
})

test("getCustomThemes removes deleted theme file", async () => {
  const themesBefore = await getCustomThemes()
  expect(themesBefore[testThemeName]).toBeDefined()

  await rm(testThemePath)

  const themesAfter = await getCustomThemes()
  expect(themesAfter[testThemeName]).toBeUndefined()
})

test("getCustomThemes handles missing themes directory gracefully", async () => {
  const themes = await getCustomThemes()
  expect(themes).toBeDefined()
  expect(typeof themes).toBe("object")
})

test("getCustomThemes ignores non-JSON files", async () => {
  const nonJsonPath = path.join(path.dirname(testThemePath), "not-a-theme.txt")
  await writeFile(nonJsonPath, "not json")

  const themes = await getCustomThemes()
  expect(themes["not-a-theme"]).toBeUndefined()

  await rm(nonJsonPath).catch(() => {})
})
