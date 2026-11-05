import { createMemo } from "solid-js"
import { useLanguage } from "~/context/language"
import type { Locale } from "~/lib/language"
import { contentArea } from "~/i18n"
import { itemIds, keyedList, source, structuralPaths, type Content, type Overlay } from "./source"

export type { Content, ContentOverlay } from "./source"
export { loadLanguage, loadSlice } from "~/i18n"

// Each language's page copy loads with its dictionary (i18n/index.ts), by area (products, brand, …),
// and is merged over the English source here, one area at a time as the page reads it.
const pages = new Map<Locale, Content>()
const areas = new Map<string, { overlay: unknown; merged: unknown }>()

/** The structured page copy in `locale`, with English wherever the locale's file has no translation. */
export function siteContent(locale: Locale): Content {
  if (locale === "en") return source
  const known = pages.get(locale)
  if (known) return known
  const page = Object.defineProperties(
    {},
    Object.fromEntries(
      Object.keys(source).map((area) => [area, { enumerable: true, get: () => mergedArea(locale, area as keyof Content) }]),
    ),
  ) as Content
  pages.set(locale, page)
  return page
}

function mergedArea<K extends keyof Content>(locale: Exclude<Locale, "en">, area: K): Content[K] {
  const overlay = contentArea(locale, area)
  const key = `${locale} ${area}`
  const known = areas.get(key)
  if (known && known.overlay === overlay) return known.merged as Content[K]
  const merged = merge(source[area], overlay as Overlay<Content[K]> | undefined, area)
  areas.set(key, { overlay, merged })
  return merged
}

/** One area's copy built with the page's own localized links, with the locale's translations over it. */
export function localize<K extends keyof Content>(locale: Locale, key: K, base: Content[K]): Content[K] {
  if (locale === "en") return base
  return merge(base, contentArea(locale, key) as Overlay<Content[K]> | undefined, key)
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
