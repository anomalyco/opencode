import type { createMiddleware } from "@solidjs/start/middleware"
import { getRequestEvent } from "solid-js/web"

// In production, a page's stylesheets (the shell's and its group's, script/stylesheet-groups.ts) are
// also named in a Link header, so the browser, and Cloudflare's Early Hints before the page is ready,
// can start them sooner. Inside the HTML cache (middleware.ts), so cached pages carry it.

type Middleware = ReturnType<typeof createMiddleware>[number]

export const headLinks: Middleware = async (_event, next) => {
  const value = await next()
  if (import.meta.env.DEV || typeof value !== "string") return value
  const link = stylesheetLinks(value)
  // On the request's response headers, which the HTML cache keeps with the page (lib/html-cache.ts).
  if (link) getRequestEvent()?.response.headers.set("Link", link)
  return value
}

/** The Link header for the stylesheets in a page's head, if it has any. */
export function stylesheetLinks(html: string) {
  const end = html.indexOf("</head>")
  if (end < 0) return
  const stylesheets = [
    ...html.slice(0, end).matchAll(/<link href="(\/_build\/assets\/[\w-]+\.css)" rel="stylesheet" ?\/?>/g),
  ]
  return stylesheets.map((match) => `<${match[1]}>; rel=preload; as=style`).join(", ") || undefined
}
