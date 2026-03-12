import { defineMiddleware } from "astro:middleware"
import { docsAlias, docsRedirect, localeFromAcceptLanguage, localeFromCookie, redirect } from "./lib/docs-locale"

export const onRequest = defineMiddleware(async (ctx, next) => {
  const alias = docsAlias(ctx.url.pathname)
  if (alias) {
    return redirect(ctx.url, alias.path, alias.locale)
  }

  const locale =
    localeFromCookie(ctx.request.headers.get("cookie")) ??
    localeFromAcceptLanguage(ctx.request.headers.get("accept-language"))

  const path = docsRedirect(ctx.url.pathname, locale)
  if (path) return redirect(ctx.url, path, locale)

  return next()
})
