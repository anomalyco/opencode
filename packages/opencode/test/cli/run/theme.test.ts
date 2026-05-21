import { expect, test } from "bun:test"
import { RGBA, type CliRenderer, type TerminalColors } from "@opentui/core"
import { RUN_THEME_FALLBACK, generateSystem, resolveRunTheme, resolveTheme } from "@/cli/cmd/run/theme"

const palette = ["#15161e", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#c0caf5"] as const

function terminalColors(input: Partial<TerminalColors> = {}): TerminalColors {
  return {
    palette: Array.from({ length: 256 }, (_, index) => input.palette?.[index] ?? palette[index % palette.length]!),
    defaultBackground: input.defaultBackground ?? "#1a1b26",
    defaultForeground: input.defaultForeground ?? "#c0caf5",
    cursorColor: input.cursorColor ?? "#ff9e64",
    mouseForeground: input.mouseForeground ?? null,
    mouseBackground: input.mouseBackground ?? null,
    tekForeground: input.tekForeground ?? null,
    tekBackground: input.tekBackground ?? null,
    highlightBackground: input.highlightBackground ?? "#33467c",
    highlightForeground: input.highlightForeground ?? "#c0caf5",
  }
}

function renderer(
  input: {
    themeMode?: "dark" | "light"
    colors?: TerminalColors
    fail?: boolean
  } = {},
) {
  return {
    themeMode: input.themeMode,
    getPalette: async () => {
      if (input.fail) {
        throw new Error("boom")
      }

      return input.colors ?? terminalColors()
    },
  } as CliRenderer
}

function expectRgba(color: unknown) {
  expect(color).toBeInstanceOf(RGBA)
  if (!(color instanceof RGBA)) {
    throw new Error("expected RGBA")
  }

  return color
}

function expectIndexed(color: unknown) {
  const rgba = expectRgba(color)
  expect(rgba.intent).toBe("indexed")
  expect(rgba.slot).toBeLessThan(256)
}

function spread(color: RGBA) {
  const [r, g, b] = color.toInts()
  return Math.max(r, g, b) - Math.min(r, g, b)
}

test("falls back when palette lookup fails", async () => {
  expect(await resolveRunTheme(renderer({ fail: true }))).toBe(RUN_THEME_FALLBACK)
})

test("returns syntax styles and indexed splash colors", async () => {
  const theme = await resolveRunTheme(renderer({ themeMode: "dark" }))

  try {
    expect(theme.block.syntax).toBeDefined()
    expect(theme.block.subtleSyntax).toBeDefined()
    expect([...theme.block.syntax!.getAllStyles()].length).toBeGreaterThan(0)
    expect([...theme.block.subtleSyntax!.getAllStyles()].length).toBeGreaterThan(0)
    expectIndexed(theme.splash.left)
    expectIndexed(theme.splash.right)
    expectIndexed(theme.splash.leftShadow)
    expectIndexed(theme.splash.rightShadow)
    expectRgba(theme.footer.highlight)
    expectRgba(theme.footer.surface)
  } finally {
    theme.block.syntax?.destroy()
    theme.block.subtleSyntax?.destroy()
  }
})

test("keeps dark surfaces neutral on saturated backgrounds", () => {
  const theme = resolveTheme(
    generateSystem(
      terminalColors({
        defaultBackground: "#0000ff",
        defaultForeground: "#ffffff",
      }),
      "dark",
    ),
    "dark",
  )

  expect(spread(theme.backgroundPanel)).toBeLessThan(10)
  expect(spread(theme.backgroundElement)).toBeLessThan(10)
})

test("keeps light surfaces close to neutral on warm backgrounds", () => {
  const theme = resolveTheme(
    generateSystem(
      terminalColors({
        defaultBackground: "#fbf1c7",
        defaultForeground: "#3c3836",
      }),
      "light",
    ),
    "light",
  )

  expect(spread(theme.backgroundPanel)).toBeLessThan(60)
  expect(spread(theme.backgroundElement)).toBeLessThan(60)
})
