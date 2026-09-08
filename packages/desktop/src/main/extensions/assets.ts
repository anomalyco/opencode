import { and, eq, sql } from "drizzle-orm"
import type { Database } from "../storage/database"
import { extensions, extensionFiles } from "../storage/schema"

const types: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  woff2: "font/woff2",
  woff: "font/woff",
  json: "application/json",
  css: "text/css",
  txt: "text/plain",
  pdf: "application/pdf",
  wasm: "application/wasm",
}

export function extensionAssetResponse(
  db: Database,
  input: { id: string; revision: string; path: string; range?: string | null; head?: boolean },
) {
  const where = and(
    eq(extensionFiles.extension_id, input.id),
    eq(extensionFiles.path, input.path),
    eq(extensions.revision, input.revision),
    eq(extensions.enabled, true),
  )
  const metadata = db
    .select({ size: sql<number>`length(${extensionFiles.data})` })
    .from(extensionFiles)
    .innerJoin(extensions, eq(extensionFiles.extension_id, extensions.id))
    .where(where)
    .get()
  if (!metadata) return new Response(null, { status: 404 })
  const headers = new Headers({
    "Content-Type": types[input.path.split(".").at(-1)?.toLowerCase() ?? ""] ?? "application/octet-stream",
    "Cache-Control": "no-store",
    "Accept-Ranges": "bytes",
  })
  const match = input.range?.match(/^bytes=(\d*)-(\d*)$/)
  const start = match?.[1] ? Number(match[1]) : match?.[2] ? Math.max(0, metadata.size - Number(match[2])) : 0
  const end = match?.[1] && match[2] ? Math.min(Number(match[2]), metadata.size - 1) : metadata.size - 1
  if (
    input.range &&
    (!match ||
      (!match[1] && !match[2]) ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= metadata.size)
  ) {
    headers.set("Content-Range", `bytes */${metadata.size}`)
    return new Response(null, { status: 416, headers })
  }
  headers.set("Content-Length", String(Math.max(0, end - start + 1)))
  if (input.range) headers.set("Content-Range", `bytes ${start}-${end}/${metadata.size}`)
  const data = input.head
    ? undefined
    : db
        .select({
          data: sql<Uint8Array>`substr(${extensionFiles.data}, ${start + 1}, ${Math.max(0, end - start + 1)})`,
        })
        .from(extensionFiles)
        .innerJoin(extensions, eq(extensionFiles.extension_id, extensions.id))
        .where(where)
        .get()?.data
  return new Response(data ? new Uint8Array(data) : null, { status: input.range ? 206 : 200, headers })
}
