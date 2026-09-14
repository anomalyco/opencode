import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { Schema } from "effect"
import { DEFAULT_THEME, ThemeDocument, migrateV1, resolveThemeDocument } from "../src/tui/index.js"
import type { ThemeV1Json } from "../src/tui/v1.js"

test.each(["light", "dark"] as const)("built-in %s themes resolve status colors", async (mode) => {
  const source: ThemeV1Json = await Bun.file(
    new URL("../../tui/src/theme/assets/opencode.json", import.meta.url),
  ).json()
  for (const document of [DEFAULT_THEME, migrateV1(source)]) {
    const theme = resolveThemeDocument(document, mode)
    expect(theme.text.status.running.equals(theme.hue.interactive[mode === "light" ? 800 : 200])).toBeTrue()
    expect(theme.text.status.question.equals(theme.text.status.unread)).toBeTrue()
    expect(theme.text.status.permission.equals(theme.text.status.unread)).toBeTrue()
    expect(theme.text.status.unread.equals(theme.hue.accent[mode === "light" ? 800 : 200])).toBeTrue()
    expect(theme.contextual.elevated.text.status).toEqual(theme.text.status)
  }
})

test.each(["light", "dark"] as const)("custom %s themes inherit the unread attention color", (mode) => {
  for (const standalone of [false, true]) {
    const theme = resolveThemeDocument(
      Schema.decodeUnknownSync(ThemeDocument)({
        version: 2,
        standalone,
        [mode]: {
          hue: { ...DEFAULT_THEME[mode].hue, accent: "$hue.purple" },
          text: { status: { unread: "#abcdef" } },
        },
      }),
      mode,
    )
    expect(theme.text.status.unread.equals(RGBA.fromHex("#abcdef"))).toBeTrue()
    expect(theme.text.status.question.equals(theme.text.status.unread)).toBeTrue()
    expect(theme.text.status.permission.equals(theme.text.status.unread)).toBeTrue()
    expect(theme.contextual.elevated.text.status).toEqual(theme.text.status)
  }
})

test.each(["light", "dark"] as const)("custom %s themes inherit and override status colors", (mode) => {
  for (const standalone of [false, true]) {
    const theme = resolveThemeDocument(
      Schema.decodeUnknownSync(ThemeDocument)({
        version: 2,
        standalone,
        [mode]: {
          hue: { ...DEFAULT_THEME[mode].hue, interactive: "$hue.purple", accent: "$hue.orange" },
          text: {
            status: { question: "#123456", permission: "#654321" },
          },
        },
      }),
      mode,
    )
    expect(theme.text.status.running.equals(theme.hue.purple[mode === "light" ? 800 : 200])).toBeTrue()
    expect(theme.text.status.unread.equals(theme.hue.orange[mode === "light" ? 800 : 200])).toBeTrue()
    expect(theme.text.status.question.equals(RGBA.fromHex("#123456"))).toBeTrue()
    expect(theme.text.status.permission.equals(RGBA.fromHex("#654321"))).toBeTrue()
  }
})
