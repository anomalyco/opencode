import { route as localeRoute, strip as localeStrip } from "../../../../console/app/src/lib/language"
import type { Locale } from "../../../../console/app/src/lib/language"

export {
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_HEADER,
  clearCookie,
  cookie,
  detectFromAcceptLanguage,
  detectFromLanguages,
  dir,
  fromPathname,
  label,
  localeFromCookieHeader,
  localeFromRequest,
  parseLocale,
  tag,
} from "../../../../console/app/src/lib/language"

export type { Locale } from "../../../../console/app/src/lib/language"

export const basePath = "/data"
export const baseUrl = "https://opencode.ai"

function normalizeDataPathname(pathname: string) {
  const next = localeStrip(pathname)
  const path = next.startsWith("/") ? next : `/${next}`
  const trailing = path.endsWith("/")
  const segments = path.split("/").filter(Boolean)
  const dataIndex = segments.lastIndexOf(basePath.slice(1))
  const rest = dataIndex === -1 ? segments : segments.slice(dataIndex + 1)
  const normalized = `${basePath}${rest.length ? `/${rest.join("/")}` : "/"}`
  if (trailing && !normalized.endsWith("/")) return `${normalized}/`
  return normalized
}

export function strip(pathname: string) {
  return normalizeDataPathname(pathname)
}

export function route(locale: Locale, pathname: string) {
  return localeRoute(locale, normalizeDataPathname(pathname))
}

export function localizedUrl(locale: Locale, pathname: string) {
  return `${baseUrl}${route(locale, pathname)}`
}
