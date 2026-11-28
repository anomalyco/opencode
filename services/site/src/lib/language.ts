import {
  LOCALE_HEADER,
  detectFromAcceptLanguage,
  fromPathname,
  localeFromCookieHeader,
  parseLocale,
  strip,
  tag,
  type Locale,
} from "@opencode/locale"

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
  parseLocale,
  strip,
  tag,
} from "@opencode/locale"

export type { Locale } from "@opencode/locale"

// The language's name in English, shown beside its own name for readers who can't read the page.
const ENGLISH = {
  en: "English",
  zh: "Chinese, Simplified",
  zht: "Chinese, Traditional",
  ko: "Korean",
  de: "German",
  es: "Spanish",
  fr: "French",
  it: "Italian",
  da: "Danish",
  ja: "Japanese",
  pl: "Polish",
  ru: "Russian",
  uk: "Ukrainian",
  ar: "Arabic",
  no: "Norwegian",
  br: "Portuguese, Brazil",
  th: "Thai",
  tr: "Turkish",
} satisfies Record<Locale, string>

/**
 * True for an address that takes a locale prefix. The latest docs take one too (English at /docs,
 * every other language at /<locale>/docs). The other apps on the domain (the Console, the old
 * dashboard) and the English-only pages (the changelog and the font) have one address in every
 * language: route() leaves them unprefixed, and their prefixed addresses redirect there
 * (middleware.ts). The V1 docs (/v1/docs, and the V2 docs' old /v2) keep their own addresses and
 * languages.
 */
export function localized(pathname: string) {
  return !/^\/(v1|v2|console|auth|workspace|changelog|font)(?=$|[/.?#])/.test(strip(pathname))
}

export function route(locale: Locale, pathname: string) {
  const next = strip(pathname)
  if (locale === "en" || !localized(next)) return next
  if (next === "/") return `/${locale}`
  return `/${locale}${next}`
}

// The Console serves its marketing pages at /<locale>/console/... and keeps the guides and app
// pages (workspace, login, ...) at /console/...; consoleRoute leaves those alone too.
const consoleMarketing = [
  "/console",
  "/console/models",
  "/console/go",
  "/console/enterprise",
  "/console/teams",
  "/console/support",
  "/console/integrations",
]

/** True for one of the Console's marketing pages, and only that page: its guides stay English. */
function consoleMarketingPath(pathname: string) {
  const path = pathname.split(/[?#]/, 1)[0]?.replace(/\/$/, "") || "/"
  return consoleMarketing.includes(path)
}

/**
 * A link to a Console marketing page in the page's language. The Console serves its marketing pages
 * at /<locale>/console/... and keeps its guides and app pages (workspace, login, ...) at /console/...;
 * this app's own route() leaves /console unprefixed (localized() excludes it).
 */
export function consoleRoute(locale: Locale, pathname: string) {
  const next = strip(pathname)
  if (locale === "en" || !consoleMarketingPath(next)) return next
  return `/${locale}${next}`
}
export function english(locale: Locale) {
  return ENGLISH[locale]
}

/**
 * A language's name in the page's language, shown beside its own name ("ドイツ語" beside "Deutsch" on
 * /ja). English pages keep the names in ENGLISH, which match how the docs list them.
 */
export function displayName(locale: Locale, page: Locale) {
  if (page === "en") return ENGLISH[locale]
  return new Intl.DisplayNames([tag(page)], { type: "language" }).of(tag(locale)) ?? ENGLISH[locale]
}

export function localeFromRequest(request: Request) {
  const fromHeader = parseLocale(request.headers.get(LOCALE_HEADER))
  if (fromHeader) return fromHeader

  const fromPath = fromPathname(new URL(request.url).pathname)
  if (fromPath) return fromPath

  return (
    localeFromCookieHeader(request.headers.get("cookie")) ??
    detectFromAcceptLanguage(request.headers.get("accept-language"))
  )
}

export function pageLocale(request: Request) {
  const pathname = new URL(request.url).pathname
  return parseLocale(request.headers.get(LOCALE_HEADER)) ?? fromPathname(pathname) ?? ("en" satisfies Locale)
}
