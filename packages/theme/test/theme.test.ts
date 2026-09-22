import { expect, test } from "bun:test"
import { migrateV1, resolveThemeDocument } from "../src/tui/index.js"
import type { ThemeV1Json } from "../src/tui/v1.js"

const source: ThemeV1Json = await Bun.file(
  new URL("../../tui/src/theme/assets/opencode.json", import.meta.url),
).json()
const document = migrateV1(source)

test.each(["light", "dark"] as const)("resolves %s themes without status tokens", (mode) => {
  const theme = resolveThemeDocument(document, mode)
  expect("status" in theme.text).toBeFalse()
  expect(theme.hue.accent[800]).toBeDefined()
  expect(theme.hue.interactive[800]).toBeDefined()
})

test.each(["light", "dark"] as const)("aliases pre-2.0.9 text token names in %s", (mode) => {
  const theme = resolveThemeDocument(document, mode)
  expect(theme.text.subdued).toBe(theme.text.muted)
  expect(theme.text.subdued).toBeDefined()
  for (const kind of ["error", "warning", "success", "info"] as const) {
    expect(theme.text.feedback[kind].default).toBe(theme.text.feedback[kind].base)
    expect(theme.text.feedback[kind].default).toBeDefined()
  }
  expect(theme.surface("dialog").text.subdued).toBe(theme.surface("dialog").text.muted)
  expect(theme.surface("dialog").text.feedback.error.default).toBe(theme.surface("dialog").text.feedback.error.base)
})
