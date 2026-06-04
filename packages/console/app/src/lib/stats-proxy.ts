import type { APIEvent } from "@solidjs/start/server"
import { Resource } from "@opencode-ai/console-resource"

export async function statsProxy(evt: APIEvent) {
  const req = evt.request.clone()
  const targetUrl = new URL(req.url)
  targetUrl.protocol = "https:"
  targetUrl.hostname = Resource.App.stage === "production" ? "stats.opencode.ai" : "stats.dev.opencode.ai"
  targetUrl.port = ""

  if (targetUrl.pathname.startsWith("/stats/_build/")) {
    targetUrl.pathname = targetUrl.pathname.slice("/stats".length)
  }

  const response = await fetch(targetUrl, {
    method: req.method,
    headers: req.headers,
    body: req.body,
  })

  if (!response.headers.get("content-type")?.includes("text/html")) return response

  const headers = new Headers(response.headers)
  headers.delete("content-encoding")
  headers.delete("content-length")
  headers.delete("etag")

  return new Response(rewriteStatsHtml(await response.text()), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function rewriteStatsHtml(html: string) {
  return html.replaceAll('"/_build/', '"/stats/_build/').replaceAll("'/_build/", "'/stats/_build/")
}
