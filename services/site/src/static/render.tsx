import type { createMiddleware } from "@solidjs/start/middleware"
import { Route, Router } from "@solidjs/router"
import type { Component } from "solid-js"
import { getRequestEvent, NoHydration, renderToString, ssr } from "solid-js/web"
import fileRoutes from "solid-start:routes"
import { clientViteManifest } from "solid-start:client-vite-manifest"
import script from "virtual:static-client"
import { AppRoot } from "~/app"
import { dir, pageLocale, strip, tag } from "~/lib/language"
import type { StaticPass } from "~/lib/page-data"
import { sourceLogo } from "~/lib/source-logo"
import { matches, staticPath } from "./routes"
import {
  cardMorphKey,
  clearCardMorph,
  markCard,
  onScreen,
  revealCard,
  showHeroPoster,
  travel,
} from "~/component/site/card-morph"
import { cardTiming } from "~/component/site/products"

type Middleware = ReturnType<typeof createMiddleware>[number]
type PageModule = { default: Component; id$$?: string }

// The file routes, by path (`/changelog/:tag`; an index route's ends in a slash, `/brand/`), as
// SolidStart's router loads them: the pages' modules, and the API routes' handlers by method (`$GET`).
const pages = fileRoutes as {
  path: string
  page?: boolean
  $component?: { import: () => Promise<PageModule> }
  [handler: string]: unknown
}[]

/** Whether an API route or a server function (SolidStart's /_server) answers a request, not a page. A HEAD
 * request is answered by the route's GET handler. */
const answered = (path: string, method: string) =>
  path.startsWith("/_server") ||
  pages.some(
    (route) =>
      !route.page && (route[`$${method}`] || (method === "HEAD" && route.$GET)) && matches(route.path, path),
  )

/** The methods an address takes: an API route's handlers (HEAD with GET), else a page's GET and HEAD. */
const allowed = (path: string) => {
  const methods = pages
    .filter((route) => !route.page && matches(route.path, path))
    .flatMap((route) => Object.keys(route).flatMap((key) => (/^\$[A-Z]+$/.test(key) ? [key.slice(1)] : [])))
  return [...new Set(methods.includes("GET") || !methods.length ? [...methods, "GET", "HEAD"] : methods)].join(", ")
}

/**
 * Production only: the static routes (routes.ts) as plain HTML with no hydration, and the not-found
 * page (`[...404].tsx`, with its 404 status) for every address no route answers. The page renders
 * with the same components, providers and head tags as the hydrated app, inside NoHydration and
 * synchronously (renderToString), so the HTML has no hydration keys and no serialized data, and the
 * page loads one script of its own (src/client/entry.ts) instead of the app. Its data (the status
 * bars, the releases) is awaited first (lib/page-data.ts). After the HTML cache (lib/html-cache.ts)
 * and the head links (lib/head-links.ts), so both treat it as any other page.
 */
export const staticPages: Middleware = async (_event, next) => {
  const event = getRequestEvent()
  if (import.meta.env.DEV || !event) return next()
  const url = new URL(event.request.url)
  const path = strip(url.pathname)
  // Pages only answer GET and HEAD. A method nothing handles gets a 405 listing the methods the address takes,
  // not the app's document, whose scripts production no longer ships.
  if (event.request.method !== "GET" && event.request.method !== "HEAD")
    return answered(path, event.request.method)
      ? next()
      : new Response(null, { status: 405, headers: { Allow: allowed(path) } })
  const pattern = staticPath(path) ?? (answered(path, event.request.method) ? undefined : "/*404")
  const load =
    pattern && pages.find((route) => route.page && route.path.replace(/(.)\/$/, "$1") === pattern)?.$component?.import
  if (!load) return next()
  const page = await load()
  const shell = stylesheets(["src/entry-client.tsx"])
  const own = stylesheets([page.id$$ ?? ""]).filter((file) => !shell.includes(file))
  // The not-found page has no frame: its own stylesheet copies what it needs of the shell's
  // (arcade3d/not-found-page.css).
  const styles = pattern === "/*404" ? own : [...shell, ...own]
  const pass: StaticPass = { collect: true, pending: [], values: [], next: 0 }
  event.locals.staticPass = pass
  // HttpStatusCode (the changelog's missing releases) keeps its status only on a completed render.
  Object.assign(event, { complete: true })
  const render = () =>
    renderToString(() => (
      <StaticDocument locale={pageLocale(event.request)} styles={styles}>
        <Router url={url.pathname + url.search} explicitLinks={true} transformUrl={strip} root={AppRoot}>
          <Route path={pattern} component={page.default} />
        </Router>
      </StaticDocument>
    ))
  const first = render()
  event.response.headers.set("Content-Type", "text/html")
  if (!pass.pending.length) return finish(first)
  // The loaders answer their own expected failures (lib/edge-cache.ts); anything else fails the page
  // (a 500, which htmlCache never stores) rather than rendering it without its data.
  pass.values = await Promise.all(pass.pending)
  pass.collect = false
  pass.next = 0
  return finish(render())
}

/**
 * Without Solid's markers around dynamic text, which only hydration reads. A page with a product
 * card, or a product page's hero, opts into cross-document view transitions for the card ↔ hero
 * morph (card-morph.ts): the rule and the arriving half go first in its head, ahead of the
 * stylesheets, so they run before the page's first frame.
 */
function finish(html: string) {
  const page = html.replace(/<!--!?\$?\/?-->/g, "")
  if (!/data-component="product-card"|data-component="product-hero"[^>]*data-product=/.test(page)) return page
  return page.replace("<link ", `${cardReveal}<link `)
}

// The functions' own source, each statement on its own line, so a comment the bundle keeps stays
// one.
const cardReveal =
  `<style>@view-transition{navigation:auto}</style><script>(${revealCard})(${JSON.stringify(cardTiming())},"${cardMorphKey}",{markCard:${markCard},travel:${travel},onScreen:${onScreen},clearCardMorph:${clearCardMorph},showHeroPoster:${showHeroPoster}})</script>`.replace(
    /\n\s*/g,
    "\n",
  )

function StaticDocument(props: { locale: Parameters<typeof tag>[0]; styles: string[]; children: unknown }) {
  return (
    <NoHydration>
      {ssr("<!DOCTYPE html>") as unknown as Element}
      <html lang={tag(props.locale)} dir={dir(props.locale)} data-locale={props.locale}>
        <head>
          <meta charset="utf-8" />
          {/* After the charset meta: the art is over 1 KB, and the meta must come in the first 1024 bytes. */}
          {ssr([`\n${sourceLogo}\n`]) as unknown as Element}
          {
            ssr(
              props.styles.map((href) => `<link href="${href}" rel="stylesheet" />`).join("") +
                // Its own build's one file (script/static-client.ts).
                (script ? `<script type="module" src="${script}"></script>` : ""),
            ) as unknown as Element
          }
        </head>
        <body>
          <div id="app">{props.children as Element}</div>
        </body>
      </html>
    </NoHydration>
  )
}

/** The stylesheets the client build gives these modules and what they import, shell first. */
function stylesheets(entries: string[]) {
  const found = new Set<string>()
  const seen = new Set<string>()
  const visit = (key: string) => {
    const chunk = clientViteManifest[key] as { css?: string[]; imports?: string[] } | undefined
    if (!chunk || seen.has(key)) return
    seen.add(key)
    chunk.imports?.forEach(visit)
    chunk.css?.forEach((file) => found.add(`/${file}`))
  }
  entries.forEach(visit)
  return [...found]
}
