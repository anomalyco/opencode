import type { APIEvent } from "@solidjs/start/server"
import { localeFromRequest, tag } from "~/lib/language"

async function handler(evt: APIEvent) {
  const req = evt.request.clone()
  const url = new URL(req.url)
  const targetUrl = `https://docs.opencode.ai${url.pathname}${url.search}`

  const headers = new Headers(req.headers)
  headers.set("accept-language", tag(localeFromRequest(req)))

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
