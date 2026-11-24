import { expect, test } from "bun:test"
import { resolveThemeDocument } from "@opencode/theme/tui"
import { terminalPalette } from "../../src/component/terminal-pane"
import { getOpenCodeClassicTheme } from "../../src/theme"

test.each(["light", "dark"] as const)("builds the %s ANSI palette from semantic colors", (mode) => {
  const theme = resolveThemeDocument(getOpenCodeClassicTheme(), mode)
  const black = mode === "dark" ? theme.background.raised.high : theme.text.base
  const white = mode === "dark" ? theme.text.base : theme.background.raised.high
  const brightWhite = mode === "dark" ? theme.increase(theme.text.base) : theme.decrease(theme.text.base)
  const expected = new Map<number, { toInts(): [number, number, number, number] }>([
    [0, black],
    [1, theme.text.feedback.error.base],
    [2, theme.text.feedback.success.base],
    [3, theme.text.feedback.warning.base],
    [6, theme.text.feedback.info.base],
    [7, white],
    [8, theme.text.muted],
    [15, brightWhite],
  ])
  const output = terminalPalette(theme, mode, theme.background.raised.base).toString()
  const palette = [...output.matchAll(/\]4;(\d+);(#[0-9a-f]+)/g)]
  const categorical = theme.categorical.map((scale) => hex(scale[400]))

  expect(palette).toHaveLength(16)
  expected.forEach((color, index) => {
    expect(palette[index]?.[1]).toBe(String(index))
    expect(palette[index]?.[2]).toBe(hex(color))
  })
  expect(categorical).toContain(palette[4]?.[2])
  expect(categorical).toContain(palette[5]?.[2])
  expect(output).toContain(`]10;${hex(theme.text.base)}`)
  expect(output).toContain(`]11;${hex(theme.background.raised.base)}`)
})

test("falls back to the first categorical color when no hue is confidently blue or magenta", () => {
  const resolved = resolveThemeDocument(getOpenCodeClassicTheme(), "dark")
  const red = resolved.categorical[4]!
  const theme = { ...resolved, categorical: [resolved.categorical[0]!, red, red, red, red] }
  const palette = [
    ...terminalPalette(theme, "dark", theme.background.raised.base)
      .toString()
      .matchAll(/\]4;(\d+);(#[0-9a-f]+)/g),
  ]

  expect(palette[4]?.[2]).toBe(hex(theme.categorical[0]![400]))
  expect(palette[5]?.[2]).toBe(hex(theme.categorical[0]![400]))
})

function byte(value: number) {
  return value.toString(16).padStart(2, "0")
}

function hex(color: { toInts(): [number, number, number, number] }) {
  return `#${color.toInts().slice(0, 3).map(byte).join("")}`
}
