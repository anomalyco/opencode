import type { APIEvent } from "@solidjs/start/server"
import { Resource } from "@opencode/console-resource"
import { docs, pageLocale, tag } from "~/lib/language"

async function handler(evt: APIEvent) {
  const req = evt.request.clone()
  const url = new URL(req.url)
  const moved = /^\/docs\/(?:[^/]+\/)?(zen|go)\/?$/.exec(url.pathname)
  if (moved) {
    return Response.redirect(new URL(moved[1] === "go" ? "/v2/docs/console/go/" : "/v2/docs/console/models/", url), 302)
  }

  const locale = pageLocale(req)
  const host = Resource.App.stage === "production" ? "docs.opencode.ai" : "docs.dev.opencode.ai"
  const targetUrl = `https://${host}${docs(locale, url.pathname)}${url.search}`

  const headers = new Headers(req.headers)
  headers.set("accept-language", tag(locale))

  const response = await fetch(targetUrl, {
    method: req.method,
    headers,
    body: req.body,
  })
  return new Response(response.body, response)
}

export const GET = handler
export const POST = handler
export const PUT = handler
export const DELETE = handler
export const OPTIONS = handler
export const PATCH = handler
