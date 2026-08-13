interface Env {
  readonly ASSETS: { fetch(request: Request): Promise<Response> }
}

interface CatalogIndex {
  readonly variants: ReadonlyArray<{ readonly id: string; readonly label: string }>
  readonly screens: ReadonlyArray<{
    readonly id: string
    readonly title: string
    readonly summary: string
    readonly frames: ReadonlyArray<{ readonly variantId: string }>
  }>
}

let catalogCache: Promise<CatalogIndex> | undefined

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = assetPath(url.pathname)
    const assetUrl = new URL(url)
    assetUrl.pathname = path
    const response = await env.ASSETS.fetch(new Request(assetUrl, request))
    if (path !== "/index.html" || !response.ok) return response

    catalogCache ??= env.ASSETS.fetch(new Request(new URL("/catalog.json", url.origin)))
      .then((asset) => asset.json() as Promise<CatalogIndex>)
      .catch((cause) => {
        catalogCache = undefined
        throw cause
      })
    const catalog = await catalogCache.catch(() => undefined)
    if (!catalog) return response

    const html = await response.text()
    const headers = new Headers(response.headers)
    headers.delete("content-length")
    return new Response(html.replace("</head>", `${metaTags(url, catalog)}</head>`), {
      status: response.status,
      headers,
    })
  },
}

export function assetPath(pathname: string) {
  const path = pathname.slice("/lab/catalog".length)
  return path === "" || path === "/" || !path.includes(".") ? "/index.html" : path
}

export function metaTags(url: URL, catalog: CatalogIndex) {
  const screen = catalog.screens.find((candidate) => candidate.id === url.searchParams.get("screen"))
  const variantId = url.searchParams.get("set") ?? catalog.variants[0]?.id
  const variant = catalog.variants.find((candidate) => candidate.id === variantId)
  const captured = screen && variant && screen.frames.some((frame) => frame.variantId === variant.id)

  const title = captured ? `${screen.title} — OpenCode Terminal Catalog` : "OpenCode Terminal Catalog"
  const description = captured
    ? screen.summary || `The ${screen.title} state of the OpenCode TUI, captured live in the ${variant.label} theme.`
    : "A visual catalog of OpenCode TUI states, captured from the live terminal."
  const image = `${url.origin}/lab/catalog/og/${captured ? `${screen.id}--${variant.id}` : "default"}.png`

  const tags: ReadonlyArray<readonly [string, string]> = [
    ["og:title", title],
    ["og:description", description],
    ["og:type", "website"],
    ["og:url", url.href],
    ["og:image", image],
    ["og:image:width", "1200"],
    ["og:image:height", "630"],
  ]
  return [
    ...tags.map(([property, content]) => `<meta property="${property}" content="${escapeAttribute(content)}" />`),
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttribute(title)}" />`,
    `<meta name="twitter:image" content="${escapeAttribute(image)}" />`,
    `<meta name="description" content="${escapeAttribute(description)}" />`,
  ].join("\n    ")
}

function escapeAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;")
}
