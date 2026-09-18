import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { Schema } from "effect"
import { DEFAULT_THEME, ThemeDocument, migrateV1, resolveThemeDocument, selectTheme } from "../src/tui/index.js"
import type { ThemeV1Json } from "../src/tui/v1.js"

test.each(["light", "dark"] as const)("built-in %s themes resolve status colors", async (mode) => {
  const source: ThemeV1Json = await Bun.file(
    new URL("../../tui/src/theme/assets/opencode.json", import.meta.url),
  ).json()
  for (const document of [DEFAULT_THEME, migrateV1(source)]) {
    const theme = resolveThemeDocument(document, mode)
    expect(theme.text.status.running.equals(theme.hue.interactive[200])).toBeTrue()
    expect(theme.text.status.question.equals(theme.text.status.unread)).toBeTrue()
    expect(theme.text.status.permission.equals(theme.text.status.unread)).toBeTrue()
    expect(theme.text.status.unread.equals(theme.hue.accent[200])).toBeTrue()
    expect(theme.surface("dialog").text.status).toEqual(theme.text.status)
  }
})

test.each(["light", "dark"] as const)("custom %s themes inherit the unread attention color", (mode) => {
  const base = selectTheme(DEFAULT_THEME, mode)
  const definition = {
    ...base,
    hue: { ...base.hue, accent: "$hue.purple" },
    text: {
      ...base.text,
      status: { ...base.text.status, unread: "#abcdef" },
    },
  }
  const { hue, ...tokens } = definition
  const theme = resolveThemeDocument(
    Schema.decodeUnknownSync(ThemeDocument)({
      version: 2,
      base: tokens,
      [mode]: { hue },
    }),
    mode,
  )
  expect(theme.text.status.unread.equals(RGBA.fromHex("#abcdef"))).toBeTrue()
  expect(theme.text.status.question.equals(theme.text.status.unread)).toBeTrue()
  expect(theme.text.status.permission.equals(theme.text.status.unread)).toBeTrue()
  expect(theme.surface("dialog").text.status).toEqual(theme.text.status)
})

test.each(["light", "dark"] as const)("custom %s themes inherit and override status colors", (mode) => {
  const base = selectTheme(DEFAULT_THEME, mode)
  const definition = {
    ...base,
    hue: { ...base.hue, interactive: "$hue.purple", accent: "$hue.orange" },
    text: {
      ...base.text,
      status: {
        ...base.text.status,
        question: "#123456",
        permission: "#654321",
      },
    },
  }
  const { hue, ...tokens } = definition
  const theme = resolveThemeDocument(
    Schema.decodeUnknownSync(ThemeDocument)({
      version: 2,
      base: tokens,
      [mode]: { hue },
    }),
    mode,
  )
  expect(theme.text.status.running.equals(theme.hue.purple[200])).toBeTrue()
  expect(theme.text.status.unread.equals(theme.hue.orange[200])).toBeTrue()
  expect(theme.text.status.question.equals(RGBA.fromHex("#123456"))).toBeTrue()
  expect(theme.text.status.permission.equals(RGBA.fromHex("#654321"))).toBeTrue()
})
