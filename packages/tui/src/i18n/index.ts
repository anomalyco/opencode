// TUI string translation. English is the source locale; other locales override
// subsets of the keys and fall back to English for the rest.
//
// The active locale is resolved once from the environment and can be replaced
// at boot through `setLocale`, driven by the `language` TUI config. Lookups are
// synchronous so non-component modules can translate too.
import { dict as en, type Key } from "./en"

export type Locale = "en"

export type Params = Record<string, string | number>

const dictionaries: Record<Locale, Partial<Record<Key, string>>> = { en }

// Maps a POSIX or BCP 47 tag ("en_US.UTF-8", "en-GB") onto a supported locale.
// Only English ships today, so every tag resolves to it; the parser exists so
// added locales do not change how a tag is read.
export function parseLocale(value: string | undefined): Locale | undefined {
  if (!value?.trim()) return undefined
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
