import { defineMiddleware } from "astro:middleware"

const MAP = {
  en: "root",
  root: "root",
  zh: "zh-cn",
  "zh-cn": "zh-cn",
  zht: "zh-tw",
  "zh-tw": "zh-tw",
  ko: "ko",
  bs: "bs",
  de: "de",
  es: "es",
  fr: "fr",
  it: "it",
  da: "da",
  ja: "ja",
  pl: "pl",
  ru: "ru",
  ar: "ar",
  no: "nb",
  nb: "nb",
  nn: "nb",
  br: "pt-br",
  "pt-br": "pt-br",
  pt: "pt-br",
  th: "th",
  tr: "tr",
} as const

function match(input: string) {
  const value = decodeURIComponent(input).trim().toLowerCase()
  if (!value) return null

  if (value.startsWith("zh")) {
    if (value.includes("hant") || value.includes("-tw") || value.includes("-hk") || value.includes("-mo"))
      return "zh-tw"
    return "zh-cn"
  }

  if (value in MAP) return MAP[value as keyof typeof MAP]
  if (value.startsWith("pt")) return "pt-br"
  if (value.startsWith("no") || value.startsWith("nb") || value.startsWith("nn")) return "nb"
  if (value.startsWith("ko")) return "ko"
  if (value.startsWith("bs")) return "bs"
  if (value.startsWith("de")) return "de"
  if (value.startsWith("es")) return "es"
  if (value.startsWith("fr")) return "fr"
  if (value.startsWith("it")) return "it"
  if (value.startsWith("da")) return "da"
  if (value.startsWith("ja")) return "ja"
  if (value.startsWith("pl")) return "pl"
  if (value.startsWith("ru")) return "ru"
  if (value.startsWith("ar")) return "ar"
  if (value.startsWith("th")) return "th"
  if (value.startsWith("tr")) return "tr"
  if (value.startsWith("en")) return "root"
  return null
}

function localeFromCookie(header: string | null) {
  if (!header) return null
  const raw = header
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("oc_locale="))
    ?.slice("oc_locale=".length)
  if (!raw) return null
  return match(raw)
}

function localeFromAcceptLanguage(header: string | null) {
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
    .map((lang) => match(lang))
    .find((lang) => lang)

  return locale ?? "root"
}

export const onRequest = defineMiddleware((ctx, next) => {
  if (ctx.url.pathname !== "/docs" && ctx.url.pathname !== "/docs/") return next()

  const locale =
    localeFromCookie(ctx.request.headers.get("cookie")) ??
    localeFromAcceptLanguage(ctx.request.headers.get("accept-language"))
  if (!locale || locale === "root") return next()

  const url = new URL(ctx.request.url)
  url.pathname = `/docs/${locale}/`
  return ctx.redirect(url.toString(), 302)
})
