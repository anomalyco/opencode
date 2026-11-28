import { expect, test } from "bun:test"
import { t } from "../src/i18n/index"

test("interpolates the params a template names", () => {
  expect(t("permission.field.path", { path: "/tmp/x" })).toBe("Path: /tmp/x")
  expect(t("permission.always.wildcard", { action: "bash" })).toBe("This will always allow bash for this project.")
  expect(t("permission.field.path", { path: "/tmp/张" })).toBe("Path: /tmp/张")
})

test("returns the source copy when the template has no placeholders", () => {
  expect(t("dialog.alert.confirm")).toBe("Confirm alert")
  expect(t("permission.option.once")).toBe("Allow once")
})
