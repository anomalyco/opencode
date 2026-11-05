import type { createMiddleware } from "@solidjs/start/middleware"

// One stylesheet per page, in production. Vite splits the CSS by JavaScript chunk, so a page links
// 11–16 render-blocking stylesheets. This middleware replaces them with one: /stylesheet/<names>.css
// (routes/stylesheet/[file].ts) is their contents joined in the same order, so the cascade is
// unchanged. The names are content hashes, so the combined file is immutable too.
//
// Each original link stays in the head with `disabled` (not fetched, not applied): the client's
// chunk loader (Vite's preload helper) looks for `link[href="…"][rel="stylesheet"]` before adding a
// chunk's CSS on a client-side navigation, so it doesn't add a second copy later in the cascade.
//
// Only the head's stylesheets are combined, and only when nothing but links sits between them (no
// inline <style>), so the order against inline styles is the same as before.
//
// The same pass gives the page's module preloads `fetchpriority="low"`: they still start with the
// page, but the stylesheet, the fonts and the largest image go first on a slow connection, and the
// page's script (the same files, the same order) hydrates once they have arrived.

type Middleware = ReturnType<typeof createMiddleware>[number]

const link = /<link href="\/_build\/assets\/([\w-]+)\.css" rel="stylesheet" ?\/?>/g

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
  const names = matches.map((match) => match[1])
  const combined = `<link rel="stylesheet" href="/stylesheet/${names.join("~")}.css" />`
  let index = 0
  const rewritten = head.replace(link, (tag, name: string) => {
    const disabled = `<link href="/_build/assets/${name}.css" rel="stylesheet" disabled />`
    return index++ === 0 ? combined + disabled : disabled
  })
  return rewritten + html.slice(end)
}
