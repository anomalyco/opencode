import { createMiddleware } from "@solidjs/start/middleware"
import {
  compareMarkdown,
  homeJson,
  homeMarkdown,
  labJson,
  labMarkdown,
  llmsTxt,
  modelJson,
  modelMarkdown,
} from "./lib/agent-formats"
import {
  basePath,
  cookie,
  fromPathname,
  LOCALE_HEADER,
  localeFromRequest,
  pageUrl,
  parseLocale,
  prefersMarkdown,
  route,
  strip,
} from "./lib/language"
import { isDataBypassPath, parsePath, type Target, type TextFormat } from "./lib/data-path"
import { noindexOutsideProduction } from "./lib/noindex"
import { loadComparePage, loadHomePage, loadLabPage, loadModelPage } from "./lib/page-data"
import { labOgCard, modelOgCard } from "./og/card-data"
import { ogResponse } from "./og/response"
import { canonicalModelEntry, catalogModelPath, findModelCatalogLab, loadModelCatalog } from "./routes/model-catalog"
import { statsPageCacheControl } from "./routes/stats-cache"

type Rendered = {
  body: string | object | undefined
  path?: string
  updatedAt?: string | null
  unavailable?: boolean
}

const contentTypes = {
  markdown: "text/markdown",
  json: "application/json",
  text: "text/plain",
} as const satisfies Record<TextFormat, string>

const pageMiddleware = createMiddleware({
  onRequest: async (event) => {
    const request = event.request
    if (request.method !== "GET" && request.method !== "HEAD") return
    const url = new URL(request.url)
    const localized = localizedRedirect(request, url)
    if (localized) return localized
    const path = strip(url.pathname)
    const parsed = parsePath(path)
    if (!parsed) return
    const negotiated = !parsed.format && prefersMarkdown(request.headers.get("accept"))
    const format = parsed.format ?? (negotiated ? "markdown" : undefined)

    const canonical = await canonicalPath(parsed.target)
    if (canonical && `${canonical}${parsed.extension}` !== path) {
      // The console proxy strips the locale prefix and sends it as a header. Agent formats are English only.
      const locale = format
        ? "en"
        : (parseLocale(request.headers.get(LOCALE_HEADER)) ?? fromPathname(url.pathname) ?? "en")
      return new Response(null, {
        status: 301,
        headers: {
          Location: `${route(locale, canonical)}${parsed.extension}${url.search}`,
          // The target depends on request headers, so shared caches must not reuse it across clients.
          "Cache-Control": "private, max-age=300",
          Vary: `Accept, ${LOCALE_HEADER}`,
        },
      })
    }

    if (!format) return
    if (format === "og")
      return ogResponse({
        origin: url.origin,
        path,
        version: url.searchParams.get("v"),
        head: request.method === "HEAD",
        card: () => loadOgCard(parsed.target),
      })
    return formatResponse(await render(parsed.target, format), format, { negotiated, head: request.method === "HEAD" })
  },
})

// The noindex header outside production first (lib/noindex.ts), so every response carries it.
export default [noindexOutsideProduction, ...pageMiddleware]

// Unprefixed pages redirect to the visitor's language from their cookie or Accept-Language. /en/data stays put so
// English remains reachable for visitors whose browser prefers another language.
function localizedRedirect(request: Request, url: URL) {
  if (fromPathname(url.pathname)) return undefined
  if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) return undefined
  if (isDataBypassPath(url.pathname)) return undefined
  const accept = request.headers.get("accept")
  // Agents asking for Markdown get the English page in place.
  if (prefersMarkdown(accept)) return undefined
  if (accept && !accept.includes("text/html") && !accept.includes("*/*")) return undefined
  const locale = localeFromRequest(request)
  if (locale === "en") return undefined
  const headers = new Headers({
    // route() normalizes /data to /data/, so keep the visitor's own trailing slash.
    Location: `${url.pathname === basePath ? `/${locale}${basePath}` : route(locale, url.pathname)}${url.search}`,
    "Cache-Control": "private, no-store",
    Vary: "Accept, Accept-Language, Cookie",
  })
  headers.append("Set-Cookie", cookie(locale))
  return new Response(null, { status: 308, headers })
}

async function canonicalPath(target: Target) {
  if (target.kind !== "lab" && target.kind !== "model") return undefined
  const catalog = await loadModelCatalog()
  if (target.kind === "lab") {
    const lab = findModelCatalogLab(catalog, target.lab)
    return lab && `/data/${lab.id}`
  }
  const entry = canonicalModelEntry(catalog, target.model, target.lab)
  return entry && catalogModelPath(entry)
}

async function loadOgCard(target: Target) {
  if (target.kind === "lab") return labOgCard(await loadLabPage(target.lab))
  if (target.kind === "model") return modelOgCard(await loadModelPage(target.lab, target.model))
  return undefined
}

async function render(target: Target, format: TextFormat): Promise<Rendered> {
  if (target.kind === "llms") {
    const [home, catalog] = await Promise.all([loadHomePage(), loadModelCatalog()])
    return { body: llmsTxt(home, catalog), updatedAt: home.updatedAt }
  }
  if (target.kind === "home") {
    const data = await loadHomePage()
    return { body: format === "json" ? homeJson(data) : homeMarkdown(data), path: "/data/", updatedAt: data.updatedAt }
  }
  if (target.kind === "lab") {
    const data = await loadLabPage(target.lab)
    return {
      body: format === "json" ? labJson(data) : labMarkdown(data),
      path: data.lab ? `/data/${data.lab.id}` : undefined,
      updatedAt: data.stats?.updatedAt,
      unavailable: data.labs.length === 0,
    }
  }
  if (target.kind === "model") {
    const data = await loadModelPage(target.lab, target.model)
    const name = data.catalog.entry?.name ?? data.stats?.model ?? target.model
    return {
      body: format === "json" ? modelJson(data, name) : modelMarkdown(data, name),
      path: data.path,
      updatedAt: data.stats?.updatedAt,
      unavailable: data.catalog.labs.length === 0,
    }
  }
  if (format === "json") return { body: undefined }
  const data = await loadComparePage(target.params)
  return { body: compareMarkdown(data, target.params), unavailable: data.catalog.models.length === 0 }
}

function formatResponse(rendered: Rendered, format: TextFormat, options: { negotiated: boolean; head: boolean }) {
  const headers = new Headers({
    "Content-Type": `${contentTypes[format]}; charset=utf-8`,
    "Cache-Control": statsPageCacheControl,
  })
  if (options.negotiated) headers.set("Vary", "Accept")
  if (rendered.path) headers.set("Link", `<${pageUrl(rendered.path)}>; rel="canonical"`)
  if (rendered.updatedAt) headers.set("Last-Modified", new Date(rendered.updatedAt).toUTCString())
  if (rendered.body !== undefined)
    return new Response(options.head ? null : serialize(rendered.body), { status: 200, headers })
  const status = rendered.unavailable ? 503 : 404
  const message = status === 503 ? "Data is temporarily unavailable." : "Page not found."
  const body = format === "json" ? { error: message } : `# ${message}\n`
  return new Response(options.head ? null : serialize(body), { status, headers })
}

function serialize(body: string | object) {
  return typeof body === "string" ? body : `${JSON.stringify(body, null, 2)}\n`
}
