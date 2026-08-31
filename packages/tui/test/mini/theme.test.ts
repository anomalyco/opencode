import { expect, test } from "bun:test"
import { CliRenderEvents, RGBA, type CapturedLine, type CliRenderer, type TerminalColors } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { entrySplash, exitSplash } from "../../src/mini/splash"
import { RUN_THEME_MONO, RUN_THEME_FALLBACK, generateSystem, resolveRunTheme, resolveTheme } from "../../src/mini/theme"
import { DEFAULT_THEMES } from "../../src/theme"

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
    resolvedThemeMode?: "dark" | "light"
    colors?: TerminalColors
    fail?: boolean
  } = {},
) {
  return {
    themeMode: input.themeMode,
    waitForThemeMode: async () => input.resolvedThemeMode ?? input.themeMode ?? null,
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
  expect(await resolveRunTheme(renderer({ fail: true }), undefined, true)).toBe(RUN_THEME_MONO)
  const light = await resolveRunTheme(renderer({ resolvedThemeMode: "light" }), undefined, true)
  expect(expectRgba(light.footer.text).toInts().slice(0, 3)).toEqual([0, 0, 0])
  expect(RUN_THEME_MONO.block.syntax).toBeUndefined()
  for (const color of [
    RUN_THEME_MONO.background,
    ...Object.values(RUN_THEME_MONO.footer),
    ...Object.values(RUN_THEME_MONO.splash),
    ...Object.values(RUN_THEME_MONO.entry).flatMap((tone) => [tone.body, tone.start].filter(Boolean)),
    ...Object.entries(RUN_THEME_MONO.block)
      .filter(([key]) => key !== "syntax")
      .map(([, value]) => value),
  ]) {
    expect(expectRgba(color).intent).toBe("default")
  }
})

test("resolveTheme preserves Mini indexed color and result shape semantics", () => {
  const item = structuredClone(DEFAULT_THEMES.opencode)
  item.theme.primary = 6
  delete item.theme.selectedListItemText

  const theme = resolveTheme(item, "dark")
  expect(theme.primary.intent).toBe("indexed")
  expect(theme.primary.slot).toBe(6)
  expect(theme.selectedListItemText).toBe(theme.background)
  expect("_hasSelectedListItemText" in theme).toBe(false)
})

test("returns syntax styles and native alpha splash shadows", async () => {
  const theme = await resolveRunTheme(renderer({ themeMode: "dark" }))

  try {
    expect(theme.block.syntax).toBeDefined()
    expect([...theme.block.syntax!.getAllStyles()].length).toBeGreaterThan(0)
    expectIndexed(theme.splash.left)
    expectIndexed(theme.splash.right)
    const shadow = expectRgba(theme.splash.leftShadow)
    expect(shadow.intent).toBe("rgb")
    expect(shadow.a).toBeCloseTo(0.25, 2)
    expect(shadow.toInts().slice(0, 3)).toEqual(expectRgba(theme.splash.left).toInts().slice(0, 3))
    expectRgba(theme.footer.highlight)
    expectRgba(theme.footer.statusAccent)
    expectRgba(theme.footer.surface)
    expect(expectRgba(theme.footer.statusAccent).toInts()).not.toEqual(expectRgba(theme.footer.status).toInts())
  } finally {
    theme.block.syntax?.destroy()
  }
})

test("omits splash shadows without an actual terminal background", async () => {
  const theme = await resolveRunTheme(renderer({ colors: { ...terminalColors(), defaultBackground: null } }))

  try {
    expect(expectRgba(theme.splash.leftShadow).a).toBe(0)
    expect(expectRgba(theme.splash.left).intent).toBe("default")
    expect(expectRgba(theme.splash.right).intent).toBe("default")
    expect(expectRgba(theme.splash.left).toInts()).toEqual(expectRgba(theme.footer.text).toInts())
  } finally {
    theme.block.syntax?.destroy()
  }
})

test("fallback splash uses default foreground without shadows", () => {
  expect(expectRgba(RUN_THEME_FALLBACK.splash.leftShadow).a).toBe(0)
  expect(expectRgba(RUN_THEME_FALLBACK.splash.left).intent).toBe("default")
  expect(expectRgba(RUN_THEME_FALLBACK.splash.right).intent).toBe("default")
})

test("native scrollback composes splash shadows against the reported background", async () => {
  for (const background of ["#101820", "#faf0dc", "#0000ff", null]) {
    const theme = await resolveRunTheme(renderer({ colors: { ...terminalColors(), defaultBackground: background } }))
    const out = await createTestRenderer({
      width: 80,
      screenMode: "split-footer",
      footerHeight: 6,
      externalOutputMode: "capture-stdout",
      consoleMode: "disabled",
    })
    out.renderer.setBackgroundColor(theme.background)
    let lines: CapturedLine[] = []
    let text = ""
    out.renderer.on(CliRenderEvents.EXTERNAL_OUTPUT, (event) => {
      lines = event.snapshot.getSpanLines()
      text = new TextDecoder().decode(event.snapshot.getRealCharBytes(false))
    })

    try {
      for (const splash of [entrySplash, exitSplash]) {
        out.renderer.writeToScrollback(splash({ theme: theme.splash, title: "Test", session_id: "ses-test" }))
        expect([1, 2, 3].map((row) => text.slice(row * 80, row * 80 + 4))).toEqual(["█▀▀█", "█  █", "▀▀▀▀"])
        const interior = lines[2]!.spans[lines[2]!.spans[0]!.width > 1 ? 0 : 1]!
        expect(interior).toBeDefined()
        if (!background) {
          expect(interior.bg.a).toBe(0)
          continue
        }
        const foreground = expectRgba(theme.splash.left)
        const base = RGBA.fromHex(background)
        expect(interior.bg.a).toBe(1)
        expect(interior.bg.r).toBeCloseTo(base.r * 0.75 + foreground.r * 0.25, 2)
        expect(interior.bg.g).toBeCloseTo(base.g * 0.75 + foreground.g * 0.25, 2)
        expect(interior.bg.b).toBeCloseTo(base.b * 0.75 + foreground.b * 0.25, 2)
      }
    } finally {
      out.renderer.destroy()
      theme.block.syntax?.destroy()
    }
  }
})

test("keeps footer surfaces exact while scrollback stays palette matched", async () => {
  const colors = terminalColors({
    defaultBackground: "#0f172a",
    defaultForeground: "#e2e8f0",
  })
  const theme = await resolveRunTheme(renderer({ themeMode: "dark", colors }))
  const exact = resolveTheme(generateSystem(colors, "dark"), "dark")

  try {
    expect(expectRgba(theme.footer.selected).toInts()).toEqual(expectRgba(exact.backgroundElement).toInts())
    expect(expectRgba(theme.footer.border).toInts()).toEqual(expectRgba(exact.border).toInts())
    expect(expectRgba(theme.footer.pane).toInts()).toEqual(expectRgba(exact.backgroundMenu).toInts())
    expect(expectRgba(theme.footer.selected).intent).toBe("rgb")
  } finally {
    theme.block.syntax?.destroy()
  }
})

test("uses refreshed background brightness when cached renderer mode is stale", async () => {
  const colors = terminalColors({
    defaultBackground: "#fbf1c7",
    defaultForeground: "#3c3836",
  })
  const stale = await resolveRunTheme(renderer({ themeMode: "dark", colors }))
  const light = await resolveRunTheme(renderer({ themeMode: "light", colors }))

  try {
    expect(expectRgba(stale.footer.surface).toInts()).toEqual(expectRgba(light.footer.surface).toInts())
  } finally {
    stale.block.syntax?.destroy()
    light.block.syntax?.destroy()
  }
})

test("keeps renderer mode when refreshed default background is unavailable", async () => {
  const colors = {
    ...terminalColors(),
    defaultBackground: null,
    palette: ["#000000", ...terminalColors().palette.slice(1)],
  }
  const light = await resolveRunTheme(renderer({ themeMode: "light", colors }))
  const dark = await resolveRunTheme(renderer({ themeMode: "dark", colors }))

  try {
    expect(expectRgba(light.footer.surface).toInts()).not.toEqual(expectRgba(dark.footer.surface).toInts())
  } finally {
    light.block.syntax?.destroy()
    dark.block.syntax?.destroy()
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
