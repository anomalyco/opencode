import { exactLocale, matchLocale } from "../i18n/locales"

export function docsAlias(pathname: string) {
  const hit = /^\/docs\/([^/]+)(\/.*)?$/.exec(pathname)
  if (!hit) return null

  const value = hit[1] ?? ""
  const tail = hit[2] ?? ""
  const locale = exactLocale(value)
  if (!locale) return null

  const next = tail ? `/docs/${locale}${tail}` : `/docs/${locale}/`
  if (next === pathname) return null
  return {
    path: next,
    locale,
  }
}

export function docsRouteLocale(pathname: string) {
  if (pathname === "/docs" || pathname === "/docs/") return "en"

  const hit = /^\/docs\/([^/]+)(\/.*)?$/.exec(pathname)
  if (!hit) return null

  const value = hit[1] ?? ""
  if (!value || value.startsWith("_") || value.includes(".")) return null

  return exactLocale(value) ?? "en"
}

export function docsRedirect(pathname: string, locale: string) {
  if (pathname === "/docs" || pathname === "/docs/") return `/docs/${locale}/`

  const hit = /^\/docs\/([^/]+)(\/.*)?$/.exec(pathname)
  if (!hit) return null

  const value = hit[1] ?? ""
  const tail = hit[2] ?? ""
  if (!value || value.startsWith("_") || value.includes(".")) return null
  if (exactLocale(value)) return null
  return `/docs/${locale}/${value}${tail}`
}

export function cookie(locale: string) {
  return `oc_locale=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax`
}

export function redirect(url: URL, path: string, locale?: string) {
  const next = new URL(url.toString())
  next.pathname = path
  const headers = new Headers({
    Location: next.toString(),
  })
  if (locale) headers.set("Set-Cookie", cookie(locale))
  return new Response(null, {
    status: 302,
    headers,
  })
}

export function localeFromCookie(header: string | null) {
  if (!header) return null
  const raw = header
    .split(";")
    .map((x) => x.trim())
    .filter((x) => x.startsWith("oc_locale="))
    .at(-1)
    ?.slice("oc_locale=".length)
  if (!raw) return null
  if (raw.startsWith('"') && raw.endsWith('"')) return matchLocale(raw.slice(1, -1))
  return matchLocale(raw)
}

export function localeFromAcceptLanguage(header: string | null) {
  if (!header) return "en"

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

  return locale ?? "en"
}
