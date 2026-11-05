import type { APIEvent } from "@solidjs/start/server"
import { localeFromRequest } from "~/lib/language"
import { llmsText } from "~/lib/llms"
import { markdownHeaders } from "~/lib/markdown"

export async function GET(event: APIEvent) {
  return new Response(await llmsText(localeFromRequest(event.request)), {
    headers: { ...markdownHeaders, "Content-Type": "text/plain; charset=utf-8" },
  })
}
