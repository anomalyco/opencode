import { dict as en } from "./en"
import { dict as zh } from "./zh"

export const LOCALES = ["en", "zh"] as const

export type Locale = (typeof LOCALES)[number]
export type Key = keyof typeof en
export type Params = Record<string, string | number | boolean>

const INTL = {
  en: "en",
  zh: "zh-Hans",
} as const satisfies Record<Locale, string>

const dicts = {
  en,
  zh,
} as const satisfies Record<Locale, Record<Key, string>>

function from(input: string) {
  const value = input.trim().toLowerCase().replaceAll("_", "-")
  if (!value) return null
  if (value.startsWith("zh")) return "zh" satisfies Locale
  if (value.startsWith("en")) return "en" satisfies Locale
  return null
}

export function parseLocale(value: unknown): Locale | null {
  if (typeof value !== "string") return null
  if ((LOCALES as readonly string[]).includes(value)) return value as Locale
  return from(value)
}

export function normalizeLocale(value: unknown): Locale {
  return parseLocale(value) ?? "en"
}

export function resolveLocale(value?: unknown, env: NodeJS.ProcessEnv = process.env): Locale {
  const direct = parseLocale(value)
  if (direct) return direct

  for (const key of ["OPENCODE_LOCALE", "LC_ALL", "LC_MESSAGES", "LANGUAGE", "LANG"]) {
    const hit = parseLocale(env[key])
    if (hit) return hit
  }

  return "en"
}

export function intl(locale: Locale) {
  return INTL[locale]
}

export function plural(locale: Locale, count: number, forms: { one: Key; other: Key }) {
  const rule = new Intl.PluralRules(intl(locale)).select(count)
  if (rule === "one") return forms.one
  return forms.other
}

function resolve(text: string, params?: Params) {
  if (!params) return text
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, raw) => {
    const key = String(raw)
    const value = params[key]
    return value === undefined ? "" : String(value)
  })
}

export function t(locale: Locale, key: Key, params?: Params) {
  const value = dicts[locale][key] ?? dicts.en[key] ?? String(key)
  return resolve(value, params)
}

export function datetime(locale: Locale, input: number) {
  return new Date(input).toLocaleString(intl(locale))
}
