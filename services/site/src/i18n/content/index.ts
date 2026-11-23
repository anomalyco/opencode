import { createMemo } from "solid-js"
import { useLanguage } from "~/context/language"
import type { Locale } from "~/lib/language"
import { contentArea } from "~/i18n"
import type { Content } from "./source"
import { itemIds, keyedList, structuralPaths, type Overlay } from "./paths"

export type { Content, ContentOverlay } from "./source"
export { loadLanguage, loadSlice } from "~/i18n"

// Each language's page copy loads with its dictionary (i18n/index.ts), by area (products, brand, …),
// and is merged here over the English the page passes in: a page's own build of an area (with its
// localized links), or the English source of one (content/areas, through useArea).
const merged = new WeakMap<object, Map<Locale, { overlay: unknown; value: unknown }>>()

/** One area's copy built with the page's own localized links, with the locale's translations over it. */
export function localize<K extends keyof Content>(locale: Locale, key: K, base: Content[K]): Content[K] {
  if (locale === "en") return base
  const overlay = contentArea(locale, key)
  // The same English and translation give the same objects, so lists keyed by them stay put.
  const byLocale = merged.get(base) ?? new Map<Locale, { overlay: unknown; value: unknown }>()
  merged.set(base, byLocale)
  const known = byLocale.get(locale)
  if (known && known.overlay === overlay) return known.value as Content[K]
  const value = merge(base, overlay as Overlay<Content[K]> | undefined, key)
  byLocale.set(locale, { overlay, value })
  return value
}

/** An area of page copy in the current locale, inside a component: its English source with the locale's translations over it. */
export function useArea<K extends keyof Content>(key: K, english: Content[K]) {
  const language = useLanguage()
  return createMemo(() => localize(language.locale(), key, english))
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
