import { createSignal } from "solid-js"
import type { Locale } from "~/lib/language"
import { dict as en } from "~/i18n/en"

export type Key = keyof typeof en
export type Dict = Record<Key, string>

const base = en satisfies Dict

// Only English ships with every page. The server registers every language at startup (i18n/server.ts);
// the browser fetches the page's language before it hydrates (entry-client.tsx) and another one before
// switching to it (loadLocale), so the other 17 dictionaries never load for a visitor who doesn't use them.
const files: Record<Exclude<Locale, "en">, () => Promise<{ dict: Partial<Dict> }>> = {
  zh: () => import("~/i18n/zh"),
  zht: () => import("~/i18n/zht"),
  ko: () => import("~/i18n/ko"),
  de: () => import("~/i18n/de"),
  es: () => import("~/i18n/es"),
  fr: () => import("~/i18n/fr"),
  it: () => import("~/i18n/it"),
  da: () => import("~/i18n/da"),
  ja: () => import("~/i18n/ja"),
  pl: () => import("~/i18n/pl"),
  ru: () => import("~/i18n/ru"),
  uk: () => import("~/i18n/uk"),
  ar: () => import("~/i18n/ar"),
  no: () => import("~/i18n/no"),
  br: () => import("~/i18n/br"),
  th: () => import("~/i18n/th"),
  tr: () => import("~/i18n/tr"),
}
const [loaded, setLoaded] = createSignal<Partial<Record<Locale, Partial<Dict>>>>({})
const merged = new Map<Locale, Dict>()

export function i18n(locale: Locale): Dict {
  if (locale === "en") return base
  const cached = merged.get(locale)
  if (cached) return cached
  const overlay = loaded()[locale]
  // Not fetched yet (only between a language switch and its file arriving): English meanwhile.
  if (!overlay) return base
  const dict = { ...base, ...overlay } as Dict
  merged.set(locale, dict)
  return dict
}

/** Fetches a language's dictionary once, so i18n(locale) returns it from then on. */
export async function loadLocale(locale: Locale) {
  if (locale === "en" || loaded()[locale]) return
  const file = await files[locale]()
  setLoaded((all) => ({ ...all, [locale]: file.dict }))
}

/** Every language at once: the server's copy (i18n/server.ts). */
export function registerLocales(all: Partial<Record<Locale, Partial<Dict>>>) {
  setLoaded(all)
}

export type Translate = (key: Key, params?: Record<string, string | number>) => string

/** Translation outside the I18n context, for server routes that render page copy. */
export function translator(locale: Locale): Translate {
  const dict = i18n(locale)
  return (key, params) => interpolate(dict[key], params)
}

export function interpolate(text: string, params?: Record<string, string | number>) {
  if (!params) return text
  return text.replace(/\{\{(\w+)\}\}/g, (raw, key) => {
    const value = params[key]
    if (value === undefined || value === null) return raw
    return String(value)
  })
}
