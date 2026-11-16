import { expect, test } from "bun:test"
import { detectLocale, getLocale, parseLocale, setLocale, t } from "../src/i18n/index"
import { dict as en } from "../src/i18n/en"

test("reads POSIX and BCP 47 tags without inventing an unsupported locale", () => {
  expect(parseLocale("en_US.UTF-8")).toBe("en")
  expect(parseLocale("en-GB")).toBe("en")
  expect(parseLocale("C")).toBe("en")
  expect(parseLocale("zh_CN.UTF-8")).toBe("en")
  expect(parseLocale("")).toBeUndefined()
  expect(parseLocale("   ")).toBeUndefined()
  expect(parseLocale(undefined)).toBeUndefined()
})

test("falls back to English when the environment names no supported locale", () => {
  expect(detectLocale({})).toBe("en")
  expect(detectLocale({ LANG: "de_DE.UTF-8" })).toBe("en")
})

test("resolves a configured language, treating auto and empty as detection", () => {
  setLocale("en")
  expect(getLocale()).toBe("en")
  setLocale("auto")
  expect(getLocale()).toBe("en")
  setLocale("")
  expect(getLocale()).toBe("en")
  setLocale(undefined)
  expect(getLocale()).toBe("en")
  setLocale("not-a-locale")
  expect(getLocale()).toBe("en")
  setLocale("en")
})

test("returns the English copy for every key", () => {
  setLocale("en")
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    expect(t(key)).toBe(en[key])
  }
})

test("substitutes params and drops unknown ones", () => {
  setLocale("en")
  expect(t("permission.field.path", { path: "/tmp/x" })).toBe("Path: /tmp/x")
  expect(t("permission.always.wildcard", { action: "bash" })).toBe("This will always allow bash for this project.")
  expect(t("permission.field.path", { path: "a", unused: "ignored" })).toBe("Path: a")
  expect(t("permission.field.path", {})).toBe("Path: ")
  expect(t("permission.field.path")).toBe("Path: {{path}}")
})

test("leaves key order and copy stable for the converted surfaces", () => {
  setLocale("en")
  expect(t("dialog.alert.confirm")).toBe("Confirm alert")
  expect(t("dialog.alert.ok")).toBe("ok")
  expect(t("permission.option.once")).toBe("Allow once")
  expect(t("permission.option.always")).toBe("Always allow")
  expect(t("permission.action.shell")).toBe("Shell command")
})
