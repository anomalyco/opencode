import { defineMiddleware } from "astro:middleware"
import type { Locale } from "./i18n/locales"
import {
  defaultDocsLocale,
  docsAlias,
  localeCookie,
  localeFromAcceptLanguage,
  localeFromCookie,
} from "./middleware-locale"

function redirect(url: URL, path: string, locale?: Locale) {
  const next = new URL(url.toString())
  next.pathname = path
  const headers = new Headers({
    Location: next.toString(),
  })
  if (locale) headers.set("Set-Cookie", localeCookie(locale))
  return new Response(null, {
    status: 302,
    headers,
  })
}

async function withCookie(next: () => Response | Promise<Response>, locale: Locale) {
  const response = await next()
  const headers = new Headers(response.headers)
  headers.append("Set-Cookie", localeCookie(locale))
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export const onRequest = defineMiddleware(async (ctx, next) => {
  const alias = docsAlias(ctx.url.pathname)
  if (alias) {
    return redirect(ctx.url, alias.path, alias.locale)
  }

  const selected = defaultDocsLocale(
    ctx.url.pathname,
    ctx.request.headers.get("referer"),
    ctx.request.headers.get("accept"),
  )
  if (selected) return withCookie(next, selected)

  if (ctx.url.pathname !== "/docs" && ctx.url.pathname !== "/docs/") return next()

  const locale =
    localeFromCookie(ctx.request.headers.get("cookie")) ??
    localeFromAcceptLanguage(ctx.request.headers.get("accept-language"))
  if (!locale || locale === "root") return next()

  return redirect(ctx.url, `/docs/${locale}/`)
})
