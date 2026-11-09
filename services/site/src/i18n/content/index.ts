import { createMemo, createSignal } from "solid-js"
import { useLanguage } from "~/context/language"
import type { Locale } from "~/lib/language"
import { loadLocale } from "~/i18n"
import { itemIds, keyedList, source, structuralPaths, type Content, type ContentOverlay, type Overlay } from "./source"

export type { Content, ContentOverlay } from "./source"

// As with the UI dictionaries (i18n/index.ts): the server registers every language's copy at startup
// (i18n/server.ts), the browser fetches only the page's language (entry-client.tsx) and one it
// switches to (loadContent).
const files: Record<Exclude<Locale, "en">, () => Promise<{ content: ContentOverlay }>> = {
  zh: () => import("./zh"),
  zht: () => import("./zht"),
  ko: () => import("./ko"),
  de: () => import("./de"),
  es: () => import("./es"),
  fr: () => import("./fr"),
  it: () => import("./it"),
  da: () => import("./da"),
  ja: () => import("./ja"),
  pl: () => import("./pl"),
  ru: () => import("./ru"),
  uk: () => import("./uk"),
  ar: () => import("./ar"),
  no: () => import("./no"),
  br: () => import("./br"),
  th: () => import("./th"),
  tr: () => import("./tr"),
}
const [loaded, setLoaded] = createSignal<Partial<Record<Locale, ContentOverlay>>>({})
const overlay = (locale: Exclude<Locale, "en">) => loaded()[locale]

/** Fetches a language's page copy once, so siteContent(locale) and localize() use it from then on. */
export async function loadContent(locale: Locale) {
  if (locale === "en" || loaded()[locale]) return
  const file = await files[locale]()
  setLoaded((all) => ({ ...all, [locale]: file.content }))
}

/** Every language's copy at once: the server's (i18n/server.ts). */
export function registerContent(all: Partial<Record<Locale, ContentOverlay>>) {
  setLoaded(all)
}

/** A language's dictionary and page copy, before the page renders in it. */
export function loadLanguage(locale: Locale) {
  return Promise.all([loadLocale(locale), loadContent(locale)])
}

const cache = new Map<Locale, Content>()

/** The structured page copy in `locale`, with English wherever the locale's file has no translation. */
export function siteContent(locale: Locale): Content {
  if (locale === "en") return source
  const cached = cache.get(locale)
  if (cached) return cached
  const translation = overlay(locale)
  // Not fetched yet (only between a language switch and its file arriving): English meanwhile.
  if (!translation) return source
  const merged = merge(source, translation)
  cache.set(locale, merged)
  return merged
}

/** One area's copy built with the page's own localized links, with the locale's translations over it. */
export function localize<K extends keyof Content>(locale: Locale, key: K, base: Content[K]): Content[K] {
  if (locale === "en") return base
  return merge(base, (overlay(locale) as Partial<Record<keyof Content, Overlay<Content[K]>>> | undefined)?.[key], key)
}

/**
 * Each translated string of `localized` mapped to the English at the same place in `english`, so a
 * page can keep English heading ids (and the links to them) in every locale.
 */
export function englishText(localized: unknown, english: unknown, out = new Map<string, string>()) {
  if (typeof localized === "string" && typeof english === "string") return out.set(localized, english)
  if (typeof localized !== "object" || localized === null || typeof english !== "object" || english === null) return out
  Object.entries(localized).forEach(([key, value]) =>
    englishText(value, (english as Record<string, unknown>)[key], out),
  )
  return out
}

/** `siteContent` for the current locale, inside a component. */
export function useContent() {
  const language = useLanguage()
  return createMemo(() => siteContent(language.locale()))
}

function merge<T>(base: T, overlay: Overlay<T> | undefined, path = ""): T {
  if (overlay === undefined) return base
  if (typeof base === "string") {
    if (structuralPaths.some((pattern) => matches(pattern, path))) return base
    return (typeof overlay === "string" && overlay ? overlay : base) as T
  }
  if (Array.isArray(base)) {
    const list: readonly unknown[] = base
    if (keyedList(list)) {
      const byId = typeof overlay === "object" && overlay !== null && !Array.isArray(overlay) ? overlay : {}
      const ids = itemIds(list)
      return list.map((item, index) =>
        merge(item, (byId as Record<string, never>)[ids[index]], `${path}.${ids[index]}`),
      ) as T
    }
    const items: readonly unknown[] = Array.isArray(overlay) ? overlay : []
    return list.map((item, index) => merge(item, items[index] as Overlay<typeof item>, `${path}.${index}`)) as T
  }
  if (typeof base !== "object" || base === null || typeof overlay !== "object") return base
  return Object.fromEntries(
    Object.entries(base).map(([key, value]) => [
      key,
      merge(value, (overlay as Record<string, never>)[key], path ? `${path}.${key}` : key),
    ]),
  ) as T
}

function matches(pattern: string, path: string) {
  const want = pattern.split(".")
  const have = path.split(".")
  return want.length === have.length && want.every((part, index) => part === "*" || part === have[index])
}
