import { expect, test } from "bun:test"
import { resolveThemeDocument, type HueScale, type ResolvedTheme } from "@opencode/theme/tui"
import { terminalPalette } from "../../src/component/terminal-pane"
import { getOpenCodeTheme } from "../../src/theme"

test.each(["light", "dark"] as const)("builds the %s ANSI palette from semantic colors", (mode) => {
  const theme = resolveThemeDocument(getOpenCodeTheme(), mode)
  const hues = allHues(theme)
  const black = theme.hue.neutral[mode === "dark" ? 800 : 200]
  const white = theme.hue.neutral[mode === "dark" ? 200 : 800]
  const brightWhite = theme.hue.neutral[mode === "dark" ? 100 : 900]
  const normal = [
    theme.text.feedback.error.base,
    theme.text.feedback.success.base,
    theme.text.feedback.warning.base,
    hues.blue[200],
    mode === "dark" ? hues.purple[200] : theme.hue.accent[200],
    theme.text.feedback.info.base,
    white,
  ]
  const expected = [
    black,
    ...normal,
    theme.text.muted,
    ...normal.slice(0, -1).map((color) => theme.decrease(color)),
    brightWhite,
  ]
  const output = terminalPalette(theme, mode, theme.background.raised.base).toString()
  const palette = [...output.matchAll(/\]4;(\d+);(#[0-9a-f]+)/g)]

  expect(palette).toHaveLength(16)
  expected.forEach((color, index) => {
    expect(palette[index]?.[1]).toBe(String(index))
    expect(palette[index]?.[2]).toBe(hex(color))
  })
  expect(output).toContain(`]10;${hex(theme.text.base)}`)
  expect(output).toContain(`]11;${hex(theme.background.raised.base)}`)
})

test("falls back to accent when no hue is confidently blue or magenta", () => {
  const resolved = resolveThemeDocument(getOpenCodeTheme(), "dark")
  const hues = allHues(resolved)
  const hue = {
    ...Object.fromEntries(Object.keys(hues).map((name) => [name, hues.red])),
    accent: hues.green,
  } as typeof resolved.hue
  const theme = { ...resolved, hue }
  const palette = [
    ...terminalPalette(theme, "dark", theme.background.raised.base)
      .toString()
      .matchAll(/\]4;(\d+);(#[0-9a-f]+)/g),
  ]

  expect(palette[4]?.[2]).toBe(hex(theme.hue.accent[200]))
  expect(palette[5]?.[2]).toBe(hex(theme.hue.accent[200]))
})

function byte(value: number) {
  return value.toString(16).padStart(2, "0")
}

function hex(color: { toInts(): [number, number, number, number] }) {
  return `#${color.toInts().slice(0, 3).map(byte).join("")}`
}

function allHues(theme: ResolvedTheme) {
  return theme.hue as typeof theme.hue & Readonly<Record<string, HueScale>>
}
