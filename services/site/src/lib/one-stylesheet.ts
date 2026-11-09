import type { createMiddleware } from "@solidjs/start/middleware"

// One stylesheet per page, in production. Vite splits the CSS by JavaScript chunk, so a page links
// 11–16 render-blocking stylesheets. This middleware replaces them with one: /stylesheet/<names>.css
// (routes/stylesheet/[file].ts) is their contents joined in the same order, so the cascade is
// unchanged. The names are content hashes, so the combined file is immutable too.
//
// The client's chunk loader (Vite's preload helper) looks for a `link` with the file's href and
// rel="stylesheet" before adding a chunk's CSS on a client-side navigation, so each original link
// must stay in the document, disabled (not applied), or a second copy lands later in the cascade. A
// script in front of the combined link adds them: Chrome's preload scanner fetches a disabled link
// written in the HTML anyway, but not one a script adds. Its text is the same on every page (the
// names are in its data-css attribute).
//
// Only the head's stylesheets are combined, and only when nothing but links sits between them (no
// inline <style>), so the order against inline styles is the same as before.
//
// The same pass gives the page's module preloads `fetchpriority="low"`: they still start with the
// page, but the stylesheet, the fonts and the largest image go first on a slow connection, and the
// page's script (the same files, the same order) hydrates once they have arrived.

type Middleware = ReturnType<typeof createMiddleware>[number]

const link = /<link href="\/_build\/assets\/([\w-]+)\.css" rel="stylesheet" ?\/?>/g
const disabledLinks = `for(const n of document.currentScript.dataset.css.split("~")){const l=document.createElement("link");l.rel="stylesheet";l.disabled=true;l.href="/_build/assets/"+n+".css";document.head.appendChild(l)}`

export const oneStylesheet: Middleware = async (_event, next) => {
  const value = await next()
  if (import.meta.env.DEV || typeof value !== "string") return value
  return lowerPreloadPriority(combineStylesheets(value))
}

export function lowerPreloadPriority(html: string) {
  const end = html.indexOf("</head>")
  if (end < 0) return html
  return (
    html
      .slice(0, end)
      .replace(/(<link href="\/_build\/assets\/[\w-]+\.js" rel="modulepreload")( ?\/?>)/g, '$1 fetchpriority="low"$2') +
    html.slice(end)
  )
}

export function combineStylesheets(html: string) {
  const end = html.indexOf("</head>")
  if (end < 0) return html
  const head = html.slice(0, end)
  const matches = [...head.matchAll(link)]
  if (matches.length < 2) return html
  const first = matches[0].index!
  const last = matches.at(-1)!
  const between = head.slice(first, last.index! + last[0].length)
  if (/<style[\s>]/.test(between)) return html
  const names = matches.map((match) => match[1]).join("~")
  const combined = `<script data-css="${names}">${disabledLinks}</script><link rel="stylesheet" href="/stylesheet/${names}.css" />`
  let index = 0
  const rewritten = head.replace(link, () => (index++ === 0 ? combined : ""))
  return rewritten + html.slice(end)
}
