import type { APIEvent } from "@solidjs/start/server"
import { Resource } from "@opencode-ai/console-resource"

const dataPath = "/data"

export async function statsProxy(evt: APIEvent) {
  const req = evt.request.clone()
  const targetUrl = new URL(req.url)
  targetUrl.protocol = "https:"
  targetUrl.hostname = Resource.App.stage === "production" ? "stats.opencode.ai" : "stats.dev.opencode.ai"
  targetUrl.port = ""

  if (
    targetUrl.pathname.startsWith(`${dataPath}/_build/`) ||
    targetUrl.pathname === `${dataPath}/banner.jpg` ||
    targetUrl.pathname === `${dataPath}/banner.png`
  ) {
    targetUrl.pathname = targetUrl.pathname.slice(dataPath.length)
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

export function statsRedirect(evt: APIEvent) {
  const url = new URL(evt.request.url)
  url.pathname = `${dataPath}${url.pathname.slice("/stats".length)}`
  return new Response(null, {
    status: 308,
    headers: {
      Location: url.toString(),
    },
  })
}

function rewriteStatsHtml(html: string) {
  return html.replaceAll('"/_build/', `"${dataPath}/_build/`).replaceAll("'/_build/", `'${dataPath}/_build/`)
}
