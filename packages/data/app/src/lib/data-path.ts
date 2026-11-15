import { basePath } from "./language"

// How src/middleware.ts reads a /data path: which page it names and whether it asks for an alternate format
// (Markdown, JSON, llms.txt) or the page's Open Graph image.

export type TextFormat = "markdown" | "json" | "text"
export type Target =
  | { kind: "home" }
  | { kind: "llms" }
  | { kind: "lab"; lab: string }
  | { kind: "model"; lab: string; model: string }
  | { kind: "compare"; params: string[] }

const reservedSegments = new Set(["api", "_server", "_build", "stats", "sitemap.xml", "banner.jpg", "banner.png"])
const extensionFormats = { ".md": "markdown", ".json": "json" } as const satisfies Record<string, TextFormat>
const ogSegment = "og.png"

export function parsePath(path: string) {
  const segments = path.split("/").filter(Boolean).slice(1)
  if (segments.some((segment) => !/^[\w.-]+$/.test(segment))) return undefined
  const last = segments.at(-1) ?? ""
  if (last === ogSegment) {
    const target = parseTarget(segments.slice(0, -1), false)
    if (target?.kind !== "lab" && target?.kind !== "model") return undefined
    return { target, extension: `/${ogSegment}`, format: "og" as const }
  }
  const extension = (Object.keys(extensionFormats) as (keyof typeof extensionFormats)[]).find(
    (value) => last.endsWith(value) && last.length > value.length,
  )
  const parts = extension ? [...segments.slice(0, -1), last.slice(0, -extension.length)] : segments
  const target = parseTarget(parts, extension !== undefined)
  if (!target) return undefined
  if (target.kind === "llms") return { target, extension: "", format: "text" as const }
  return { target, extension: extension ?? "", format: extension && extensionFormats[extension] }
}

// Machine and asset paths that never redirect to the visitor's language.
export function isDataBypassPath(pathname: string) {
  return (
    pathname.startsWith(`${basePath}/_build/`) ||
    pathname.startsWith(`${basePath}/api/`) ||
    pathname.startsWith(`${basePath}/stats/`) ||
    pathname.startsWith(`${basePath}/_server`) ||
    pathname === `${basePath}/banner.jpg` ||
    pathname === `${basePath}/banner.png` ||
    pathname === `${basePath}/sitemap.xml` ||
    pathname.endsWith("/llms.txt") ||
    pathname.endsWith(`/${ogSegment}`) ||
    pathname.endsWith(".md") ||
    pathname.endsWith(".json")
  )
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
