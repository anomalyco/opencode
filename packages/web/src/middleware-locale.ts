import { exactLocale, matchLocale, type Locale } from "./i18n/locales"

export function docsAlias(pathname: string): { path: string; locale: Locale } | null {
  const hit = /^\/docs\/([^/]+)(\/.*)?$/.exec(pathname)
  if (!hit) return null

  const value = hit[1] ?? ""
  const tail = hit[2] ?? ""
  const locale = exactLocale(value)
  if (!locale) return null

  const next = locale === "root" ? `/docs${tail}` : `/docs/${locale}${tail}`
  if (next === pathname) return null
  return {
    path: next,
    locale,
  }
}

export function localeCookie(locale: Locale) {
  const value = locale === "root" ? "en" : locale
  return `oc_locale=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`
}

export function localeFromCookie(header: string | null): Locale | null {
  if (!header) return null
  const raw = header
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("oc_locale="))
    ?.slice("oc_locale=".length)
  if (!raw) return null
  return matchLocale(raw)
}

export function localeFromAcceptLanguage(header: string | null): Locale {
  if (!header) return "root"

  const items = header
    .split(",")
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const parts = raw.split(";").map((x) => x.trim())
      const lang = parts[0] ?? ""
      const q = parts
        .slice(1)
        .find((x) => x.startsWith("q="))
        ?.slice(2)
      return {
        lang,
        q: q ? Number.parseFloat(q) : 1,
      }
    })
    .sort((a, b) => b.q - a.q)

  const locale = items
    .map((item) => item.lang)
    .filter((lang) => lang && lang !== "*")
    .map((lang) => matchLocale(lang))
    .find((lang) => lang)

  return locale ?? "root"
}

export function defaultDocsLocale(pathname: string, referer?: string | null, accept?: string | null): Locale | null {
  if (!accept?.includes("text/html")) return null
  if (pathname !== "/docs" && pathname !== "/docs/" && !pathname.startsWith("/docs/")) return null
  const segment = pathname.split("/")[2] ?? ""
  if (segment && exactLocale(segment)) return null
  if (pathname !== "/docs" && pathname !== "/docs/") return "root"
  const ref = refererPathname(referer)
  if (!ref) return null
  const refLocale = exactLocale(ref.split("/")[2] ?? "")
  return refLocale && refLocale !== "root" ? "root" : null
}

function refererPathname(referer?: string | null) {
  if (!referer || !URL.canParse(referer)) return null
  return new URL(referer).pathname
}
