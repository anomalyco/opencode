import { expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { TerminalColors } from "@opentui/core"
import {
  DEFAULT_THEMES,
  addTheme,
  allThemes,
  hasTheme,
  parseTheme,
  resolveTheme,
  setCustomThemes,
  upsertTheme,
} from "../src/theme"
import { discoverThemes } from "../src/theme/discovery"
import { configDirectories } from "../src/util/config-directories"
import { terminalMode } from "../src/theme/system"
import { tmpdir } from "./fixture/fixture"

test("addTheme writes into module theme store", () => {
  const name = `plugin-theme-${Date.now()}`
  expect(addTheme(name, DEFAULT_THEMES.opencode)).toBe(true)
  expect(allThemes()[name]).toBe(DEFAULT_THEMES.opencode)
})

test("addTheme keeps first theme for duplicate names", () => {
  const name = `plugin-theme-keep-${Date.now()}`
  const one = structuredClone(DEFAULT_THEMES.opencode)
  const two = structuredClone(DEFAULT_THEMES.opencode)
  one.theme.primary = "#101010"
  two.theme.primary = "#fefefe"

  expect(addTheme(name, one)).toBe(true)
  expect(addTheme(name, two)).toBe(false)
  expect(allThemes()[name]).toBe(one)
})

test("addTheme ignores values without a V1 theme or version", () => {
  const name = `plugin-theme-invalid-${Date.now()}`
  expect(addTheme(name, { defs: { a: "#ffffff" } })).toBe(false)
  expect(addTheme(name, { light: {} })).toBe(false)
  expect(allThemes()[name]).toBeUndefined()
})

test("addTheme defers validation of versioned sources", () => {
  const name = `plugin-theme-versioned-${Date.now()}`
  expect(addTheme(name, { version: 2 })).toBe(true)
  expect(() => parseTheme(allThemes()[name]!, name)).toThrow(`Invalid theme: ${name}`)
})

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
  const name = `plugin-theme-v2-${Date.now()}`
  const source = { version: 2, light: { categorical: ["red"] } } as const

  expect(addTheme(name, source)).toBe(true)
  expect(allThemes()[name]).toBe(source)
  const document = parseTheme(allThemes()[name]!, name)
  expect(document.light?.categorical).toEqual(["red"])
  expect(parseTheme(allThemes()[name]!, name)).toBe(document)
})

test("defers invalid V2 errors until parsing", () => {
  const name = `plugin-theme-invalid-v2-${Date.now()}`
  expect(addTheme(name, { version: 2, light: { categorical: [] } })).toBe(true)
  expect(() => parseTheme(allThemes()[name]!, name)).toThrow(`Invalid theme: ${name}`)
})

test("defers invalid V1 errors until parsing", () => {
  const name = `plugin-theme-invalid-v1-${Date.now()}`
  const source = structuredClone(DEFAULT_THEMES.opencode)
  source.defs = { ...source.defs, one: "two", two: "one" }
  source.theme.primary = "one"

  expect(addTheme(name, source)).toBe(true)
  expect(() => parseTheme(allThemes()[name]!, name)).toThrow("Circular color reference")
})

test("replacement sources receive independent parse caches", () => {
  const name = `plugin-theme-replace-${Date.now()}`
  const first = structuredClone(DEFAULT_THEMES.opencode)
  const second = structuredClone(DEFAULT_THEMES.opencode)
  second.theme.primary = "#123456"

  expect(addTheme(name, first)).toBe(true)
  const previous = parseTheme(allThemes()[name]!, name)
  expect(upsertTheme(name, second)).toBe(true)
  const next = parseTheme(allThemes()[name]!, name)
  expect(next).not.toBe(previous)
  expect(parseTheme(allThemes()[name]!, name)).toBe(next)
})

test("custom themes retain precedence over plugin themes", () => {
  const name = `plugin-theme-precedence-${Date.now()}`
  const plugin = structuredClone(DEFAULT_THEMES.opencode)
  const custom = structuredClone(DEFAULT_THEMES.opencode)

  expect(addTheme(name, plugin)).toBe(true)
  setCustomThemes({ [name]: custom })
  expect(allThemes()[name]).toBe(custom)
  setCustomThemes({})
  expect(allThemes()[name]).toBe(plugin)
})

test("hasTheme checks theme presence", () => {
  const name = `plugin-theme-has-${Date.now()}`
  expect(hasTheme(name)).toBe(false)
  expect(addTheme(name, DEFAULT_THEMES.opencode)).toBe(true)
  expect(hasTheme(name)).toBe(true)
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
