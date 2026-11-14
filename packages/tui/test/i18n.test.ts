import { expect, test } from "bun:test"
import { createI18n, i18n } from "../src/i18n"
import type { Dictionary } from "../src/i18n"

test("the alert catalog preserves the existing English display text", () => {
  expect(i18n.t("dialog.group")).toBe("Dialog")
  expect(i18n.t("dialog.alert.confirm")).toBe("Confirm alert")
  expect(i18n.t("dialog.alert.ok")).toBe("ok")
})

test("an incomplete catalog falls back to English per key", () => {
  const language = createI18n(() => ({ "dialog.alert.ok": "OK" }))
  expect(language.t("dialog.alert.ok")).toBe("OK")
  expect(language.t("dialog.alert.confirm")).toBe("Confirm alert")
})

test("translation reads the current source instead of retaining the initial catalog", () => {
  const source: { dict: Partial<Dictionary> } = { dict: {} }
  const language = createI18n(() => source.dict)
  expect(language.t("dialog.alert.ok")).toBe("ok")
  source.dict = { "dialog.alert.ok": "OK" }
  expect(language.t("dialog.alert.ok")).toBe("OK")
  source.dict = {}
  expect(language.t("dialog.alert.ok")).toBe("ok")
})

test("independent catalogs do not change the default English source", () => {
  const language = createI18n(() => ({ "dialog.alert.ok": "OK" }))
  expect(language.t("dialog.alert.ok")).toBe("OK")
  expect(i18n.t("dialog.alert.ok")).toBe("ok")
})

test("an explicitly empty translation is preserved", () => {
  expect(createI18n(() => ({ "dialog.alert.ok": "" })).t("dialog.alert.ok")).toBe("")
})
