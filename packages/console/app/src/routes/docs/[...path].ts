import type { APIEvent } from "@solidjs/start/server"
import { Resource } from "@opencode-ai/console-resource"
import { docs, localeFromRequest, tag } from "~/lib/language"

async function handler(evt: APIEvent) {
  const req = evt.request.clone()
  const url = new URL(req.url)
  const locale = localeFromRequest(req)
  const host = Resource.App.stage === "production" ? "docs.opencode.ai" : "docs.dev.opencode.ai"
  const targetUrl = `https://${host}${docs(locale, url.pathname)}${url.search}`

  const headers = new Headers(req.headers)
  headers.set("accept-language", tag(locale))

  const response = await fetch(targetUrl, {
    method: req.method,
    headers,
    body: req.body,
  })
  return response
}

export const GET = handler
export const POST = handler
export const PUT = handler
export const DELETE = handler
export const OPTIONS = handler
export const PATCH = handler
