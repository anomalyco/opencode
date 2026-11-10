import type { createMiddleware } from "@solidjs/start/middleware"
import { getRequestEvent } from "solid-js/web"

// A page's head links, in production. Its stylesheets (the shell's and its group's,
// script/stylesheet-groups.ts) are also named in a Link header, so the browser, and Cloudflare's Early
// Hints before the page is ready, can start them sooner. Its module preloads get fetchpriority="low":
// they still start with the page, but the stylesheets, the fonts and the largest image go first on a
// slow connection, and the page's script (the same files, the same order) hydrates once they have
// arrived. Inside the HTML cache (middleware.ts), so cached pages carry both.

type Middleware = ReturnType<typeof createMiddleware>[number]

export const headLinks: Middleware = async (_event, next) => {
  const value = await next()
  if (import.meta.env.DEV || typeof value !== "string") return value
  const page = pageHead(value)
  // On the request's response headers, which the HTML cache keeps with the page (lib/html-cache.ts).
  if (page.link) getRequestEvent()?.response.headers.set("Link", page.link)
  return page.html
}

/** The page with its module preloads at low priority, and the Link header for its stylesheets. */
export function pageHead(html: string) {
  const end = html.indexOf("</head>")
  if (end < 0) return { html }
  const head = html.slice(0, end)
  const stylesheets = [...head.matchAll(/<link href="(\/_build\/assets\/[\w-]+\.css)" rel="stylesheet" ?\/?>/g)]
  return {
    html:
      head.replace(
        /(<link href="\/_build\/assets\/[\w-]+\.js" rel="modulepreload")( ?\/?>)/g,
        '$1 fetchpriority="low"$2',
      ) + html.slice(end),
    link: stylesheets.map((match) => `<${match[1]}>; rel=preload; as=style`).join(", ") || undefined,
  }
}
