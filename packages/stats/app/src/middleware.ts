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
import { fromPathname, LOCALE_HEADER, pageUrl, parseLocale, prefersMarkdown, route, strip } from "./lib/language"
import { loadComparePage, loadHomePage, loadLabPage, loadModelPage } from "./lib/page-data"
import { canonicalModelEntry, catalogModelPath, findModelCatalogLab, loadModelCatalog } from "./routes/model-catalog"

type Format = "markdown" | "json" | "text"
type Target =
  | { kind: "home" }
  | { kind: "llms" }
  | { kind: "lab"; lab: string }
  | { kind: "model"; lab: string; model: string }
  | { kind: "compare"; params: string[] }
type Rendered = {
  body: string | object | undefined
  path?: string
  updatedAt?: string | null
  unavailable?: boolean
}

const reservedSegments = new Set(["api", "_server", "_build", "stats", "sitemap.xml", "banner.jpg", "banner.png"])
const pageCacheControl = "public, max-age=60, s-maxage=300, stale-while-revalidate=86400"
const extensionFormats = { ".md": "markdown", ".json": "json" } as const satisfies Record<string, Format>
const contentTypes = {
  markdown: "text/markdown",
  json: "application/json",
  text: "text/plain",
} as const satisfies Record<Format, string>

export default createMiddleware({
  onRequest: async (event) => {
    const request = event.request
    if (request.method !== "GET" && request.method !== "HEAD") return
    const url = new URL(request.url)
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
    return formatResponse(await render(parsed.target, format), format, { negotiated, head: request.method === "HEAD" })
  },
})

function parsePath(path: string) {
  const segments = path.split("/").filter(Boolean).slice(1)
  if (segments.some((segment) => !/^[\w.-]+$/.test(segment))) return undefined
  const last = segments.at(-1) ?? ""
  const extension = (Object.keys(extensionFormats) as (keyof typeof extensionFormats)[]).find(
    (value) => last.endsWith(value) && last.length > value.length,
  )
  const parts = extension ? [...segments.slice(0, -1), last.slice(0, -extension.length)] : segments
  const target = parseTarget(parts, extension !== undefined)
  if (!target) return undefined
  if (target.kind === "llms") return { target, extension: "", format: "text" as const }
  return { target, extension: extension ?? "", format: extension && extensionFormats[extension] }
}

function parseTarget(parts: string[], formatted: boolean): Target | undefined {
  if (parts.length === 0) return { kind: "home" }
  if (parts.length === 1 && parts[0] === "index" && formatted) return { kind: "home" }
  if (parts.length === 1 && parts[0] === "llms.txt" && !formatted) return { kind: "llms" }
  if (parts[0] === "compare") {
    if (parts.length !== 3 && parts.length !== 5) return undefined
    return { kind: "compare", params: parts.slice(1) }
  }
  if (reservedSegments.has(parts[0])) return undefined
  if (parts.length === 1) return { kind: "lab", lab: parts[0] }
  if (parts.length === 2) return { kind: "model", lab: parts[0], model: parts[1] }
  return undefined
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

async function render(target: Target, format: Format): Promise<Rendered> {
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

function formatResponse(rendered: Rendered, format: Format, options: { negotiated: boolean; head: boolean }) {
  const headers = new Headers({
    "Content-Type": `${contentTypes[format]}; charset=utf-8`,
    "Cache-Control": pageCacheControl,
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
