import { defineMiddleware } from "astro:middleware"
import {
  cookie,
  docsAlias,
  docsRedirect,
  docsRouteLocale,
  localeFromAcceptLanguage,
  localeFromCookie,
  redirect,
} from "./lib/docs-locale"

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

  const route = docsRouteLocale(ctx.url.pathname)
  const response = await next()
  if (!route) return response

  response.headers.append("Set-Cookie", cookie(route))
  return response
})
