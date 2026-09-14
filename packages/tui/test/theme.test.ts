import { expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { TerminalColors } from "@opentui/core"
import { DEFAULT_THEMES, hasTheme, parseTheme, resolveTheme } from "../src/theme"
import { discoverThemes } from "../src/theme/discovery"
import { configDirectories } from "../src/util/config-directories"
import { terminalMode } from "../src/theme/system"
import { tmpdir } from "./fixture/fixture"

test("parseTheme delegates malformed V1 sources and rejects unknown versions", () => {
  expect(() => parseTheme({})).toThrow()
  expect(() => parseTheme({ version: 3 })).toThrow("Unsupported theme version: 3")
})

test("parses unversioned and explicit V1 themes lazily once", () => {
  const unversioned = structuredClone(DEFAULT_THEMES.opencode)
  const explicit = { ...structuredClone(DEFAULT_THEMES.opencode), version: 1 }
  const first = parseTheme(unversioned, "unversioned")
  const second = parseTheme(explicit, "explicit")

  expect(first.version).toBe(2)
  expect(second.version).toBe(2)
  expect(parseTheme(unversioned, "unversioned")).toBe(first)
  expect(parseTheme(explicit, "explicit")).toBe(second)
})

test("decodes native V2 themes lazily once", () => {
  const source = { version: 2, light: { categorical: ["red"] } } as const

  const document = parseTheme(source)
  expect(document.light?.categorical).toEqual(["red"])
  expect(parseTheme(source)).toBe(document)
})

test("rejects invalid V2 themes when parsing", () => {
  expect(() => parseTheme({ version: 2, light: { categorical: [] } }, "invalid-v2")).toThrow(
    "Invalid theme: invalid-v2",
  )
})

test("rejects invalid V1 themes when parsing", () => {
  const source = structuredClone(DEFAULT_THEMES.opencode)
  source.defs = { ...source.defs, one: "two", two: "one" }
  source.theme.primary = "one"

  expect(() => parseTheme(source)).toThrow("Circular color reference")
})

test("replacement sources receive independent parse caches", () => {
  const first = structuredClone(DEFAULT_THEMES.opencode)
  const second = structuredClone(DEFAULT_THEMES.opencode)
  second.theme.primary = "#123456"

  const previous = parseTheme(first)
  const next = parseTheme(second)
  expect(next).not.toBe(previous)
  expect(parseTheme(second)).toBe(next)
})

test("hasTheme checks theme presence", () => {
  expect(hasTheme("missing-theme")).toBe(false)
  expect(hasTheme("opencode")).toBe(true)
})

test("resolveTheme rejects circular color refs", () => {
  const item = structuredClone(DEFAULT_THEMES.opencode)
  item.defs = { ...item.defs, one: "two", two: "one" }
  item.theme.primary = "one"
  expect(() => resolveTheme(item, "dark")).toThrow("Circular color reference")
})

test("resolveTheme preserves full theme numeric color and marker semantics", () => {
  const item = structuredClone(DEFAULT_THEMES.opencode)
  item.theme.primary = 6
  delete item.theme.selectedListItemText

  const theme = resolveTheme(item, "dark")
  expect(theme.primary.intent).toBe("rgb")
  expect(theme.selectedListItemText).toBe(theme.background)
  expect(theme._hasSelectedListItemText).toBe(false)
})

function terminalColors(defaultBackground: string | null, palette: Array<string | null> = []): TerminalColors {
  return {
    palette,
    defaultForeground: null,
    defaultBackground,
    cursorColor: null,
    mouseForeground: null,
    mouseBackground: null,
    tekForeground: null,
    tekBackground: null,
    highlightBackground: null,
    highlightForeground: null,
  }
}

test("terminalMode derives mode from refreshed background", () => {
  expect(terminalMode(terminalColors("#fbf1c7"))).toBe("light")
  expect(terminalMode(terminalColors("#1a1b26"))).toBe("dark")
})

test("terminalMode does not derive mode from ANSI slot zero", () => {
  expect(terminalMode(terminalColors(null, ["#000000"]))).toBeUndefined()
})

test("custom theme precedence follows directory order", async () => {
  await using tmp = await tmpdir()
  const global = path.join(tmp.path, "global")
  const project = path.join(tmp.path, "project")
  await mkdir(path.join(global, "themes"), { recursive: true })
  await mkdir(path.join(project, "themes"), { recursive: true })
  await writeFile(path.join(global, "themes", "custom.json"), JSON.stringify({ source: "global" }))
  await writeFile(path.join(project, "themes", "custom.json"), JSON.stringify({ source: "project" }))

  await expect(discoverThemes([global, project])).resolves.toEqual({ custom: { source: "project" } })
})

test("theme directories include global config before project directories", async () => {
  await using tmp = await tmpdir()
  const global = path.join(tmp.path, "global")
  const project = path.join(tmp.path, "repo", "package")
  await mkdir(path.join(global, "themes"), { recursive: true })
  await mkdir(path.join(project, ".opencode", "themes"), { recursive: true })
  await writeFile(path.join(global, "themes", "global.json"), JSON.stringify({ source: "global" }))
  await writeFile(path.join(project, ".opencode", "themes", "project.json"), JSON.stringify({ source: "project" }))

  await expect(discoverThemes(configDirectories(global, project))).resolves.toEqual({
    global: { source: "global" },
    project: { source: "project" },
  })
})
