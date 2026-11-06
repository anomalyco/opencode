// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server"
import { getRequestEvent, ssr } from "solid-js/web"
import { dir, pageLocale, tag, type Locale } from "~/lib/language"
import { sourceLogo } from "~/lib/source-logo"
import { freezeScript } from "~/lib/freeze"
import { clientViteManifest } from "solid-start:client-vite-manifest"
import { markdownKey } from "~/component/site/use-markdown"
import preloads from "virtual:i18n-preload"
// Every language, before any page renders.
import "~/i18n/server"

const criticalCSS = `[data-component="top"]{min-height:80px;display:flex;align-items:center}html[data-scroll-restore] #app{opacity:0}`

// A reload, or a return from another site, lands on a history entry the router left a scroll position
// for (createScrollRestoration in @solidjs/router keeps them in sessionStorage by the entry's depth).
// WebKit paints the top of the page while it's still parsing and restores only once the page has
// loaded, so the reader saw the top and then a jump. When there's a position to go back to, the page
// stays hidden (its background still paints) until the document has been parsed, and the script after
// #app scrolls there before anything paints; the timer shows it anyway if that never runs.
const scrollHoldScript = `try{const n=performance.getEntriesByType("navigation")[0],d=history.state&&history.state._depth,y=n&&n.type!=="navigate"&&d!=null&&JSON.parse(sessionStorage.getItem("solid-router:scroll")||"{}")[d];if(y>0){const r=document.documentElement;r.dataset.scrollRestore=y;setTimeout(()=>delete r.dataset.scrollRestore,2000)}}catch{}`
const scrollRestoreScript = `{const r=document.documentElement,y=+r.dataset.scrollRestore;if(y){scrollTo(0,y);delete r.dataset.scrollRestore}}`

// A reload in the Markdown view keeps the page hidden until the view shows (site.tsx), so the view's
// code (markdown-pages.ts, loaded on first use) and its strings in the page's language are fetched
// alongside the page's own code. The development server has no manifest, so it fetches them once
// the page runs.
const markdownChunks = (() => {
  const closure = (key: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(key) || !clientViteManifest[key]) return seen
    seen.add(key)
    clientViteManifest[key].imports?.forEach((next) => closure(next, seen))
    return seen
  }
  const entry = closure("src/entry-client.tsx")
  return [...closure("src/component/site/markdown-pages.ts")]
    .filter((key) => !entry.has(key))
    .map((key) => `${import.meta.env.BASE_URL.replace(/\/+$/, "")}/${clientViteManifest[key].file}`)
})()
const markdownPreload = (locale: Locale) => {
  const strings = preloads?.[locale].boundaries["component/site/markdown-pages.ts"]
  const files = strings ? [...markdownChunks, strings] : markdownChunks
  if (!files.length) return undefined
  return `try{if(sessionStorage.getItem(${JSON.stringify(markdownKey)})==="1")for(const href of ${JSON.stringify(files)}){const link=document.createElement("link");link.rel="modulepreload";link.href=href;document.head.append(link)}}catch{}`
}

export default createHandler(
  () => (
    <StartServer
      document={({ assets, children, scripts }) => {
        const evt = getRequestEvent()
        // The language comes from the URL only (dev #56564), never the cookie, so / is always English.
        const locale = evt ? pageLocale(evt.request) : "en"
        const restoreMarkdown = markdownPreload(locale)

        return (
          <html lang={tag(locale)} dir={dir(locale)} data-locale={locale}>
            <head>
              <meta charset="utf-8" />
              {/* After the charset meta: the art is over 1 KB, and the meta must come in the first 1024 bytes. */}
              {ssr([`\n${sourceLogo}\n`]) as unknown as Element}
              <style>{criticalCSS}</style>
              <script innerHTML={scrollHoldScript} />
              {/* Development only, before Vite's client loads: the device preview's Freeze (lib/freeze.ts). */}
              {import.meta.env.DEV && <script innerHTML={freezeScript} />}
              {assets}
              {restoreMarkdown && <script innerHTML={restoreMarkdown} />}
            </head>
            <body>
              <div id="app">{children}</div>
              <script innerHTML={scrollRestoreScript} />
              {scripts}
            </body>
          </html>
        )
      }}
    />
  ),
  {
    mode: "async",
  },
)
