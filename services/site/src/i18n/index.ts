import { createSignal } from "solid-js"
import { isServer } from "solid-js/web"
import { parseLocale, type Locale } from "~/lib/language"
import type { dict as en } from "~/i18n/en"
import { tables } from "~/i18n/tables"

export type Key = keyof typeof en
export type Dict = Record<Key, string>

/** Some of a language's strings: dictionary keys, areas of page copy, and the keys still in English. */
export type Payload = { dict: Partial<Dict>; content: Record<string, unknown>; same: string[] }
type Load = () => Promise<{ default: Payload }>
/**
 * Where a language's strings load from: `all` of them, and, when the build split them, each slice by
 * id (where it loads from, or the slice itself for the shell's). A split table has no entry for an
 * empty slice.
 */
export type Table = { all: Load; slices?: Record<string, Load | Payload> }

// The server registers every language at startup (i18n/server.ts). The browser loads only what the
// page can show, in the page's language: the shell's strings before it hydrates (entry-client.tsx),
// and each lazy boundary's (a page route, a module loaded with import()) before that module runs. A
// production build splits the strings that way (script/i18n-slices.ts); the development server
// loads whole languages (i18n/tables.ts). Switching to a language in place loads all of it first.
const stores: Partial<Record<Locale, { dict: Partial<Dict>; content: Record<string, unknown>; same: Set<string> }>> = {}
const complete = new Set<Locale>()
const pending = new Map<string, Promise<void>>()
// Bumped when a whole language arrives after a string was missing, so the text that missed it updates.
const [version, setVersion] = createSignal(0)
const reported = new Set<string>()

/** Adds a payload's strings to a language, keeping any already there. */
export function register(locale: Locale, payload: Payload, whole = false) {
  const store = (stores[locale] ??= { dict: {}, content: {}, same: new Set() })
  store.dict = { ...payload.dict, ...store.dict }
  for (const [area, value] of Object.entries(payload.content)) store.content[area] ??= value
  payload.same.forEach((key) => store.same.add(key))
  if (whole) complete.add(locale)
}

/** Loads one slice of the current page language (or of `locale`): "shell", a boundary's id, or "*" for all. */
export function loadSlice(id: string, locale = currentLocale()): Promise<void> {
  if (complete.has(locale)) return Promise.resolve()
  const key = `${locale} ${id}`
  const known = pending.get(key)
  if (known) return known
  const promise = tables[locale]()
    .then((table) => {
      const whole = id === "*" || !table.slices
      const entry = whole ? table.all : table.slices?.[id]
      if (typeof entry === "function") return entry().then((module) => register(locale, module.default, whole))
      if (entry) register(locale, entry, whole)
    })
    .catch((error) => {
      pending.delete(key)
      throw error
    })
  pending.set(key, promise)
  return promise
}

/** A language's every string, before the page switches to it. */
export function loadLanguage(locale: Locale) {
  return loadSlice("*", locale)
}

/** A string in `locale`. A key the page didn't load (which the build should rule out) loads the whole language. */
export function lookup(locale: Locale, key: Key): string {
  const value = stores[locale]?.dict[key]
  if (value !== undefined) return value
  missing(locale, `"${key}"`)
  return ""
}

/** An area of page copy in `locale` (undefined when the language has no translation of it). */
export function contentArea(locale: Exclude<Locale, "en">, area: string): unknown {
  const store = stores[locale]
  if (store && area in store.content) return store.content[area]
  missing(locale, `the ${area} copy`)
}

/** False while the language still shows the English for `key`. */
export function translated(locale: Locale, key: Key) {
  return locale === "en" || !stores[locale]?.same.has(key)
}

/** A whole language at once: the server's copy (i18n/server.ts). */
export function i18n(locale: Locale): Dict {
  return stores[locale]?.dict as Dict
}

export type Translate = (key: Key, params?: Record<string, string | number>) => string

/** Translation outside the I18n context, for server routes that render page copy. */
export function translator(locale: Locale): Translate {
  return (key, params) => interpolate(lookup(locale, key), params)
}

export function interpolate(text: string, params?: Record<string, string | number>) {
  if (!params) return text
  return text.replace(/\{\{(\w+)\}\}/g, (raw, key) => {
    const value = params[key]
    if (value === undefined || value === null) return raw
    return String(value)
  })
}

function currentLocale() {
  return parseLocale(document.documentElement.dataset.locale) ?? "en"
}

function missing(locale: Locale, what: string) {
  version()
  if (isServer || complete.has(locale)) return
  if (!reported.has(`${locale} ${what}`)) console.error(`i18n: ${what} wasn't loaded for ${locale}; loading all of it`)
  reported.add(`${locale} ${what}`)
  void loadLanguage(locale)
    .then(() => setVersion((value) => value + 1))
    .catch(() => {})
}
