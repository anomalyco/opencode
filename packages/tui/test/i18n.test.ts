import { expect, test } from "bun:test"
import { detectLocale, parseLocale, setLocale, t } from "../src/i18n/index"
import { dict as en } from "../src/i18n/en"
import { dict as zh } from "../src/i18n/zh"
import { dict as zht } from "../src/i18n/zht"

test("maps POSIX and BCP 47 tags onto a supported locale", () => {
  expect(parseLocale("zh_CN.UTF-8")).toBe("zh")
  expect(parseLocale("zh-Hans-CN")).toBe("zh")
  expect(parseLocale("zh")).toBe("zh")
  expect(parseLocale("zh_TW.UTF-8")).toBe("zht")
  expect(parseLocale("zh-HK")).toBe("zht")
  expect(parseLocale("zh-Hant")).toBe("zht")
  expect(parseLocale("zht")).toBe("zht")
  expect(parseLocale("en_US.UTF-8")).toBe("en")
  expect(parseLocale("de_DE.UTF-8")).toBe("en")
  expect(parseLocale("")).toBeUndefined()
  expect(parseLocale(undefined)).toBeUndefined()
})

test("detects the locale from the environment in priority order", () => {
  expect(detectLocale({ OPENCODE_LANGUAGE: "zht", LANG: "zh_CN.UTF-8" })).toBe("zht")
  expect(detectLocale({ LANG: "zh_CN.UTF-8" })).toBe("zh")
  expect(detectLocale({ LC_ALL: "zh_TW.UTF-8", LANG: "en_US.UTF-8" })).toBe("zht")
  expect(detectLocale({ LANGUAGE: "zh_CN:fr" })).toBe("zh")
  expect(detectLocale({})).toBe("en")
})

test("falls back to English for keys a locale does not override", () => {
  setLocale("zh")
  expect(t("permission.required")).toBe(zh["permission.required"])
  setLocale("en")
  expect(t("permission.required")).toBe(en["permission.required"])
})

test("accepts auto and an empty setting as environment detection", () => {
  setLocale(undefined)
  expect(t("permission.required")).toBe(en["permission.required"])
  setLocale("auto")
  expect(t("permission.required")).toBe(en["permission.required"])
})

test("resolves params and drops unknown ones", () => {
  setLocale("zh")
  expect(t("cli.chdirFailed", { path: "/tmp/x" })).toBe("无法切换到目录 /tmp/x")
  expect(t("cli.fileNotFound", { file: "a.txt", unused: "ignored" })).toBe("文件不存在：a.txt")
  setLocale("en")
})

test("ships a Chinese translation for every English key", () => {
  const keys = Object.keys(en) as (keyof typeof en)[]
  const missingZh = keys.filter((key) => !(key in zh))
  const missingZht = keys.filter((key) => !(key in zht))
  expect(missingZh).toEqual([])
  expect(missingZht).toEqual([])
})
