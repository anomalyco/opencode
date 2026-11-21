import { remotePath } from "./remote-address"

const route = "/api/experimental/artifacts/"

export function artifactViewPath(item: { id: string; path: string }) {
  return `${route}${item.id}/view/${item.path}`
}

/** Parse the path as written, before URL normalization could erase a traversal or repair an authority. */
function parts(value: string) {
  const match = /^(art_[a-zA-Z0-9]+)\/(.*)$/u.exec(value)

  if (!match || /[?#\s\x00-\x1f]/u.test(value)) return
  const path = match[2] ? remotePath(match[2], "", true) : ""

  if (path === undefined) return

  return { id: match[1], path: path.split("/").map(encodeURIComponent).join("/") }
}

/** Only the view route on this exact server (never its metadata, or a look-alike origin). */
export function artifactLink(href: string, server: string) {
  const authority = /^(https?:\/\/[^/?#\\\s@]+)(\/.*)$/iu.exec(href)
  // Compare origins as URLs, but compare paths as written: a URL parser would erase dot segments.
  const base = authority && URL.canParse(server) && URL.canParse(authority[1]) ? new URL(server) : undefined
  const prefix = `${base?.pathname.replace(/\/+$/, "") ?? ""}${route}`

  const rest = href.startsWith(route)
    ? href.slice(route.length)
    : base &&
        authority &&
        !base.username &&
        !base.password &&
        new URL(authority[1]).origin === base.origin &&
        authority[2].startsWith(prefix)
      ? authority[2].slice(prefix.length)
      : undefined

  const match = rest && /^(art_[a-zA-Z0-9]+)\/view(?:\/(.*))?$/u.exec(rest)
  const item = match && parts(`${match[1]}/${match[2] ?? ""}`)

  return item ? `artifact://${item.id}/${item.path}` : undefined
}

export function artifactAddress(address: string) {
  return address.startsWith("artifact://") ? parts(address.slice(11)) : undefined
}

/** A grant translates only its own origin. No page-supplied query, fragment or path becomes an API selector. */
export function artifactResource(url: string, host: string, id: string) {
  const prefix = `oc-preview://${host}/`

  if (!url.startsWith(prefix)) return
  const item = parts(`${id}/${url.slice(prefix.length).split(/[?#]/, 1)[0]}`)

  return item && { display: `artifact://${id}/${item.path}`, route: artifactViewPath(item) }
}

/** The public link the web app opens in a separate browser tab, without supplying server credentials. */
export function artifactWebURL(address: string, server: string) {
  const item = artifactAddress(address)

  if (!item || !URL.canParse(server)) return
  const base = new URL(server)

  if (!/^https?:$/.test(base.protocol) || base.username || base.password || base.search || base.hash) return

  return `${base.href.replace(/\/+$/, "")}${artifactViewPath(item)}`
}
