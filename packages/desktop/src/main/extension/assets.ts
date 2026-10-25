import { and, eq, sql } from "drizzle-orm"
import type { Database } from "../storage/database"
import { extension, extensionFile } from "../storage/schema"

const types: Record<string, string> = {
  css: "text/css",
  js: "text/javascript",
  json: "application/json",
  txt: "text/plain",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
  pdf: "application/pdf",
  wasm: "application/wasm",
}

/** Serves `oc://extensions/<id>/<path>` from an enabled installed archive, with byte ranges for media. */
export function extensionAsset(db: Database, request: Request, url: URL) {
  const [id, ...rest] = url.pathname.slice(1).split("/").map(decodeURIComponent)
  const path = rest.join("/")

  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Accept-Ranges": "bytes",
    "Content-Type": types[path.split(".").at(-1)?.toLowerCase() ?? ""] ?? "application/octet-stream",
  })

  const where = and(eq(extensionFile.extension_id, id ?? ""), eq(extensionFile.path, path), eq(extension.enabled, true))

  const size = db
    .select({ size: sql<number>`length(${extensionFile.data})` })
    .from(extensionFile)
    .innerJoin(extension, eq(extensionFile.extension_id, extension.id))
    .where(where)
    .get()?.size

  if (size === undefined) return new Response(null, { status: 404, headers })
  const range = request.headers.get("range")
  const match = range?.match(/^bytes=(\d*)-(\d*)$/)
  const start = match?.[1] ? Number(match[1]) : match?.[2] ? Math.max(0, size - Number(match[2])) : 0
  const end = match?.[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1

  if (range && (!match || (!match[1] && !match[2]) || start > end || start >= size)) {
    headers.set("Content-Range", `bytes */${size}`)

    return new Response(null, { status: 416, headers })
  }

  headers.set("Content-Length", String(end - start + 1))

  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${size}`)
  const status = range ? 206 : 200

  if (request.method === "HEAD") return new Response(null, { status, headers })

  const data = db
    .select({ data: sql<Uint8Array>`substr(${extensionFile.data}, ${start + 1}, ${end - start + 1})` })
    .from(extensionFile)
    .innerJoin(extension, eq(extensionFile.extension_id, extension.id))
    .where(where)
    .get()?.data

  return new Response(data ? new Uint8Array(data) : null, { status, headers })
}
