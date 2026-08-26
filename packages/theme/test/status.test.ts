import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { Schema } from "effect"
import {
  DEFAULT_THEME,
  ThemeDocument,
  migrateV1,
  resolveTheme,
  resolveThemeDocument,
  selectTheme,
} from "../src/tui/index.js"
import type { ThemeV1Json } from "../src/tui/v1.js"

test.each(["light", "dark"] as const)("resolves built-in %s status colors", (mode) => {
  const theme = resolveTheme(selectTheme(DEFAULT_THEME, mode))

  expect(theme.text.status.running).toBe(theme.hue.interactive[mode === "light" ? 800 : 200])
  expect(theme.text.status.question).toBe(theme.text.feedback.info.default)
  expect(theme.text.status.question).toBe(theme.hue.cyan[mode === "light" ? 700 : 300])
  expect(theme.text.status.permission).toBe(theme.text.feedback.warning.default)
  expect(theme.text.status.permission).toBe(theme.hue.yellow[mode === "light" ? 800 : 200])
  expect(theme.contextual.elevated.text.status).toEqual(theme.text.status)
  expect(theme.contextual.overlay.text.status).toEqual(theme.text.status)
})

test.each(["light", "dark"] as const)("custom %s themes inherit status colors from their hues and feedback", (mode) => {
  const definition = {
    hue: { interactive: "$hue.purple" },
    text: {
      feedback: { info: { default: "#123456" }, warning: { default: "#654321" } },
    },
  } as const
  const theme = resolveThemeDocument({ version: 2, light: definition, dark: definition }, mode)

  expect(theme.text.status.running).toBe(theme.hue.interactive[mode === "light" ? 800 : 200])
  expect(theme.text.status.running.equals(theme.hue.purple[mode === "light" ? 800 : 200])).toBeTrue()
  expect(theme.text.status.question.equals(RGBA.fromHex("#123456"))).toBeTrue()
  expect(theme.text.status.permission.equals(RGBA.fromHex("#654321"))).toBeTrue()
})

test("decodes partial status overrides and resolves colors and references", () => {
  const document = Schema.decodeUnknownSync(ThemeDocument)({
    version: 2,
    light: { text: { status: { question: "#123456" } } },
    dark: { text: { status: { running: "$hue.purple.300", permission: "transparent" } } },
  })
  const light = resolveThemeDocument(document, "light")
  const dark = resolveThemeDocument(document, "dark")

  expect(light.text.status.question.equals(RGBA.fromHex("#123456"))).toBeTrue()
  expect(light.text.status.running).toBe(light.hue.interactive[800])
  expect(light.text.status.permission).toBe(light.text.feedback.warning.default)
  expect(dark.text.status.running).toBe(dark.hue.purple[300])
  expect(dark.text.status.question).toBe(dark.text.feedback.info.default)
  expect(dark.text.status.permission.toInts()).toEqual([0, 0, 0, 0])
  expect(() =>
    Schema.decodeUnknownSync(ThemeDocument)({ version: 2, light: { text: { status: { running: "opaque" } } } }),
  ).toThrow()
})

test("contextual status overrides inherit remaining tokens and rewire feedback references", () => {
  const theme = resolveThemeDocument({
    version: 2,
    dark: {
      "@context:elevated": {
        text: {
          status: { running: "$hue.purple.300" },
          feedback: { info: { default: "#123456" } },
        },
      },
    },
  })

  expect(theme.contextual.elevated.text.status.running).toBe(theme.hue.purple[300])
  expect(theme.contextual.elevated.text.status.question.equals(RGBA.fromHex("#123456"))).toBeTrue()
  expect(theme.contextual.elevated.text.status.permission).toBe(theme.text.status.permission)
  expect(theme.contextual.overlay.text.status).toEqual(theme.text.status)
})

test.each(["light", "dark"] as const)(
  "standalone %s themes inherit existing semantic colors when status tokens are omitted",
  (mode) => {
    const definition = {
      hue: { ...DEFAULT_THEME[mode].hue, interactive: "$hue.purple" },
      text: {
        feedback: { info: { default: "#22d3ee" }, warning: { default: "#eab308" } },
      },
    } as const
    const document = { version: 2, standalone: true, light: definition, dark: definition } as const
    const theme = resolveThemeDocument(document, mode)
    const override = { ...definition, text: { ...definition.text, status: { question: "#123456" } } } as const
    const overridden = resolveThemeDocument({
      version: 2,
      standalone: true,
      ...(mode === "light" ? { light: override } : { dark: override }),
    })

    expect(theme.text.status.running).toBe(theme.hue.interactive[mode === "light" ? 800 : 200])
    expect(theme.text.status.running.equals(theme.hue.purple[mode === "light" ? 800 : 200])).toBeTrue()
    expect(theme.text.status.question.equals(RGBA.fromHex("#22d3ee"))).toBeTrue()
    expect(theme.text.status.permission.equals(RGBA.fromHex("#eab308"))).toBeTrue()
    expect(theme.text.default.toInts()).toEqual([255, 0, 0, 255])
    expect(theme.contextual.elevated.text.status).toEqual(theme.text.status)
    expect(overridden.text.status.question.equals(RGBA.fromHex("#123456"))).toBeTrue()
    expect(overridden.text.status.running.equals(theme.text.status.running)).toBeTrue()
    expect(overridden.text.status.permission.equals(theme.text.status.permission)).toBeTrue()
  },
)

test.each(["light", "dark"] as const)(
  "built-in opencode JSON inherits %s status colors without new tokens",
  async (mode) => {
    const source: ThemeV1Json = await Bun.file(
      new URL("../../tui/src/theme/assets/opencode.json", import.meta.url),
    ).json()
    const document = migrateV1(source)
    const theme = resolveThemeDocument(document, mode)

    expect(document.standalone).toBeTrue()
    expect(document[mode]?.text?.status).toBeUndefined()
    expect(theme.text.status.running).toBe(theme.hue.interactive[mode === "light" ? 800 : 200])
    expect(theme.text.status.question.equals(theme.text.feedback.info.default)).toBeTrue()
    expect(theme.text.status.permission.equals(theme.text.feedback.warning.default)).toBeTrue()
    expect(Object.values(theme.text.status).every((color) => !color.equals(RGBA.fromHex("#ff0000")))).toBeTrue()
  },
)
