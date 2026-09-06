import { expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { RGBA, type TerminalColors } from "@opentui/core"
import { DEFAULT_THEMES, addTheme, allThemes, generateSystem, hasTheme, resolveTheme, terminalMode } from "../src/theme"
import { discoverThemes } from "../src/context/theme"
import { tmpdir } from "./fixture/fixture"

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
  item.defs = { ...item.defs, one: "two", two: "one" }
  item.theme.primary = "one"
  expect(() => resolveTheme(item, "dark")).toThrow("Circular color reference")
})

test("resolveTheme transparency policy respects auto, on, and off", () => {
  const base = resolveTheme(DEFAULT_THEMES.opencode, "dark", "auto")
  const forced = resolveTheme(DEFAULT_THEMES.opencode, "dark", "on")

  expect(base.background.a).toBe(1)
  expect(forced.background.a).toBe(0)
  expect(forced.background.r).toBe(base.background.r)
  expect(forced.background.g).toBe(base.background.g)
  expect(forced.background.b).toBe(base.background.b)
  expect(forced.transparent).toBe(true)

  const palette = Array.from({ length: 16 }, () => "#1a1b26")
  palette[7] = "#c0caf5"

  const system = generateSystem(terminalColors("#1a1b26", palette), "dark")
  const automatic = resolveTheme(system, "dark", "auto")
  const disabled = resolveTheme(system, "dark", "off")

  expect(automatic.background.a).toBe(0)
  expect(automatic.transparent).toBe(true)
  expect(disabled.background.a).toBe(1)
  expect(disabled.background.r).toBe(automatic.background.r)
  expect(disabled.background.g).toBe(automatic.background.g)
  expect(disabled.background.b).toBe(automatic.background.b)
  expect(disabled.transparent).toBe(false)

  const partial = structuredClone(DEFAULT_THEMES.opencode)
  partial.theme.background = RGBA.fromValues(base.background.r, base.background.g, base.background.b, 0.5)
  const automaticPartial = resolveTheme(partial, "dark", "auto")
  const disabledPartial = resolveTheme(partial, "dark", "off")

  expect(automaticPartial.background.a).toBeCloseTo(0.5)
  expect(automaticPartial.transparent).toBe(true)
  expect(disabledPartial.background.a).toBe(1)
  expect(disabledPartial.transparent).toBe(false)
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
