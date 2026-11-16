// TUI string translation. English is the source locale; `zh` (Simplified
// Chinese) and `zht` (Traditional Chinese) override subsets of the keys and
// fall back to English for the rest.
//
// The active locale is resolved once from the environment and can be replaced
// at boot through `setLocale`, driven by the `language` TUI config. Lookups are
// synchronous so non-component modules can translate too.
import { dict as en, type Key } from "./en"
import { dict as zh } from "./zh"
import { dict as zht } from "./zht"

export type Locale = "en" | "zh" | "zht"

export type Params = Record<string, string | number>

const dictionaries: Record<Locale, Partial<Record<Key, string>>> = { en, zh, zht }

// Maps a POSIX or BCP 47 tag ("zh_CN.UTF-8", "zh-TW", "zht") onto a supported
// locale. Chinese variants used in Taiwan, Hong Kong, and Macau, plus the Han
// script tag, resolve to Traditional Chinese.
export function parseLocale(value: string | undefined): Locale | undefined {
  if (!value?.trim()) return undefined
  const [language, region] = value
    .trim()
    .toLowerCase()
    .split(":")[0]!
    .split(".")[0]!
    .split("@")[0]!
    .replace("_", "-")
    .split("-")
  if (language === "zh") return ["tw", "hk", "mo", "hant"].includes(region ?? "") ? "zht" : "zh"
  if (language === "zht") return "zht"
  return "en"
}

export function detectLocale(environment: Readonly<Record<string, string | undefined>> = process.env): Locale {
  return (
    parseLocale(environment.OPENCODE_LANGUAGE) ??
    parseLocale(environment.LANGUAGE) ??
    parseLocale(environment.LC_ALL) ??
    parseLocale(environment.LC_MESSAGES) ??
    parseLocale(environment.LANG) ??
    "en"
  )
}

let locale = detectLocale()

// Applies a configured language. "auto" (and the empty default) defers to
// environment detection.
export function setLocale(next: string | undefined) {
  locale = next === undefined || next === "" || next === "auto" ? detectLocale() : (parseLocale(next) ?? "en")
}

export function getLocale(): Locale {
  return locale
}

export function t(key: Key, params?: Params): string {
  const template = dictionaries[locale][key] ?? en[key]
  if (!params) return template
  return template.replace(/{{\s*([^}]+?)\s*}}/g, (_, rawKey: string) => {
    const value = params[rawKey]
    return value === undefined ? "" : String(value)
  })
}

export * as I18n from "./index"
