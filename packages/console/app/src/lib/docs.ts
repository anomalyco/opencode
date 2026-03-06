import type { APIEvent } from "@solidjs/start/server"
import { Resource } from "@opencode-ai/console-resource"
import { type Locale, cookie, docs, localeFromRequest, tag } from "~/lib/language"

function redirect(url: URL, path: string, locale: Locale) {
  const next = new URL(url)
  next.pathname = path
  return new Response(null, {
    status: 302,
    headers: {
      Location: next.toString(),
      "Set-Cookie": cookie(locale),
    },
  })
}

export async function docsHandler(evt: APIEvent) {
  const req = evt.request.clone()
  const url = new URL(req.url)
  const locale = localeFromRequest(req)
  const path = docs(locale, url.pathname)
  if (path !== url.pathname) return redirect(url, path, locale)

  const host = Resource.App.stage === "production" ? "docs.opencode.ai" : "docs.dev.opencode.ai"
  const target = `https://${host}${path}${url.search}`

  const headers = new Headers(req.headers)
  headers.set("accept-language", tag(locale))

  const response = await fetch(target, {
    method: req.method,
    headers,
    body: req.body,
  })
  const next = new Response(response.body, response)
  next.headers.append("set-cookie", cookie(locale))
  return next
}
