import { fix, fromPathname, LOCALE_HEADER, parseLocale, strip, type Locale } from "@opencode/locale"

export {
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_HEADER,
  clearCookie,
  cookie,
  dir,
  fromPathname,
  label,
  parseLocale,
  strip,
  tag,
} from "@opencode/locale"

export type { Locale } from "@opencode/locale"

const DOCS = {
  en: "root",
  zh: "zh-cn",
  zht: "zh-tw",
  ko: "ko",
  de: "de",
  es: "es",
  fr: "fr",
  it: "it",
  da: "da",
  ja: "ja",
  pl: "pl",
  ru: "ru",
  // There are no Ukrainian docs, so Ukrainian visitors read the English docs.
  uk: "root",
  ar: "ar",
  no: "nb",
  br: "pt-br",
  th: "th",
  tr: "tr",
} satisfies Record<Locale, string>

const DOCS_SEGMENT = new Set([
  "ar",
  "bs",
  "da",
  "de",
  "es",
  "fr",
  "it",
  "ja",
  "ko",
  "nb",
  "pl",
  "pt-br",
  "ru",
  "th",
  "tr",
  "uk",
  "zh-cn",
  "zh-tw",
])

const DOCS_LOCALE = {
  ar: "ar",
  da: "da",
  de: "de",
  en: "en",
  es: "es",
  fr: "fr",
  it: "it",
  ja: "ja",
  ko: "ko",
  nb: "no",
  "pt-br": "br",
  root: "en",
  ru: "ru",
  th: "th",
  tr: "tr",
  uk: "uk",
  "zh-cn": "zh",
  "zh-tw": "zht",
} as const satisfies Record<string, Locale>

function suffix(pathname: string) {
  const index = pathname.search(/[?#]/)
  if (index === -1) {
    return {
      path: fix(pathname),
      suffix: "",
    }
  }

  return {
    path: fix(pathname.slice(0, index)),
    suffix: pathname.slice(index),
  }
}

function docs(locale: Locale, pathname: string) {
  const value = DOCS[locale]
  const next = suffix(pathname)
  if (next.path !== "/docs" && next.path !== "/docs/" && !next.path.startsWith("/docs/")) {
    return `${next.path}${next.suffix}`
  }

  if (value === "root") {
    if (next.path === "/docs/en") return `/docs${next.suffix}`
    if (next.path === "/docs/en/") return `/docs/${next.suffix}`
    if (next.path.startsWith("/docs/en/")) return `/docs/${next.path.slice("/docs/en/".length)}${next.suffix}`
    return `${next.path}${next.suffix}`
  }

  if (next.path === "/docs") return `/docs/${value}${next.suffix}`
  if (next.path === "/docs/") return `/docs/${value}/${next.suffix}`

  const head = next.path.slice("/docs/".length).split("/")[0] ?? ""
  if (!head) return `/docs/${value}/${next.suffix}`
  if (DOCS_SEGMENT.has(head)) return `${next.path}${next.suffix}`
  if (head.startsWith("_")) return `${next.path}${next.suffix}`
  if (head.includes(".")) return `${next.path}${next.suffix}`

  return `/docs/${value}${next.path.slice("/docs".length)}${next.suffix}`
}

function fromDocsPathname(pathname: string) {
  const next = fix(pathname)
  const value = next.split("/")[2]?.toLowerCase()
  if (!value) return null
  if (!next.startsWith("/docs/")) return null
  if (!(value in DOCS_LOCALE)) return null
  return DOCS_LOCALE[value as keyof typeof DOCS_LOCALE]
}

export function route(locale: Locale, pathname: string) {
  const next = strip(pathname)
  if (next.startsWith("/docs")) return docs(locale, next)
  if (next.startsWith("/auth")) return next
  if (next.startsWith("/workspace")) return next
  // The changelog worker owns /changelog and only publishes English release notes.
  if (next === "/changelog" || next.startsWith("/changelog/")) return next
  if (locale === "en") return next
  if (next === "/") return `/${locale}`
  return `/${locale}${next}`
}

export function localeFromRequest(request: Request) {
  const fromHeader = parseLocale(request.headers.get(LOCALE_HEADER))
  if (fromHeader) return fromHeader

  const fromPath = fromPathname(new URL(request.url).pathname)
  if (fromPath) return fromPath

  const fromDocsPath = fromDocsPathname(new URL(request.url).pathname)
  if (fromDocsPath) return fromDocsPath

  // Unprefixed pages are English, like the rest of the site.
  return "en" satisfies Locale
}
