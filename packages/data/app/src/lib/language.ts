import { route as localeRoute, strip as localeStrip } from "./locale"
import type { Locale } from "./locale"

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
} from "./locale"

export type { Locale } from "./locale"

export function prefersMarkdown(accept: string | null | undefined) {
  if (!accept) return false
  const weights = new Map(
    accept.split(",").map((part) => {
      const fields = part.split(";").map((value) => value.trim().toLowerCase())
      const quality = fields.slice(1).find((field) => field.startsWith("q="))
      return [fields[0] ?? "", quality ? Number(quality.slice(2)) : 1] as const
    }),
  )
  const markdown = Math.max(weights.get("text/markdown") ?? 0, weights.get("text/x-markdown") ?? 0)
  return markdown > 0 && markdown >= (weights.get("text/html") ?? 0)
}

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

export function pageUrl(pathname: string) {
  return `${baseUrl}${pathname}`
}

export function markdownUrl(pathname: string) {
  return `${baseUrl}${formatPathname(pathname, "md")}`
}

export function jsonUrl(pathname: string) {
  return `${baseUrl}${formatPathname(pathname, "json")}`
}

function formatPathname(pathname: string, extension: "md" | "json") {
  const trimmed = pathname.replace(/\/+$/, "")
  if (trimmed === basePath) return `${basePath}/index.${extension}`
  return `${trimmed}.${extension}`
}
