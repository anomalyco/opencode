import { resolvePreviewRequest, type PreviewSource } from "../workspace-file"
import { FSUtil } from "@opencode/util/fs-util"
import type { FileHandle } from "node:fs/promises"
import type { HandlePath } from "../disk"
import { Readable } from "node:stream"
import { previewRange } from "./range"

export async function servePreview(
  request: Request,
  grants: ReadonlyMap<string, PreviewSource>,
  verifier: HandlePath,
) {
  const host = new URL(request.url).host
  // Electron adds the Chromium initiator (not a renderer-supplied HTTP header) to protocol Requests.
  // SAFETY: Electron's Protocol.handle assigns ProtocolRequest.initiatorOrigin (string or undefined).
  const initiator = (request as Request & { initiatorOrigin?: string }).initiatorOrigin

  const target = await resolvePreviewRequest(request.url, request.method, initiator, grants, request.signal, verifier)

  if (!target) return Response.error()

  if (target.type === "artifact") {
    const response = await target.read(target.route, request.method, request.signal)

    if (!grants.has(host) || response.status !== 200) {
      await response.body?.cancel()

      return Response.error()
    }

    // The server's opaque-origin sandbox cannot load a bundle. Keep its sandbox, allowing same-origin only
    // inside this random grant; deny external resources, forms, popups and top-level navigation privileges.
    const mime = response.headers.get("content-type") ?? ""

    return new Response(response.body, {
      headers: {
        "Content-Type": /^[\w.+-]+\/[\w.+-]+(?:; charset=utf-8)?$/i.test(mime) ? mime : "application/octet-stream",
        "Content-Security-Policy":
          "sandbox allow-scripts allow-same-origin; default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
        "Cross-Origin-Resource-Policy": "same-origin",
        // Chromium's network policy includes speculative connections and ICE, unlike CSP fetch directives.
        "Connection-Allowlist": "(response-origin);webrtc=block",
        "X-DNS-Prefetch-Control": "off",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  }

  const slice = previewRange(request.headers.get("range"), target.size)

  if (target.type === "local" && (slice.status === 416 || request.method === "HEAD")) await target.file.close()

  const response =
    slice.status === 416 || request.method === "HEAD"
      ? undefined
      : target.type === "remote"
        ? await target.read(target.path, slice.range, request.signal)
        : await readLocal(target, slice, request.signal)

  if (response?.type === "error") return response

  // Trust no upstream headers. A changed size, ignored range, auth challenge or redirect is not this file.
  if (
    target.type === "remote" &&
    response &&
    (response.status !== slice.status ||
      response.headers.get("content-length") !== String(slice.length) ||
      response.headers.get("content-range") !== (slice.content ?? null))
  ) {
    await response.body?.cancel()

    return Response.error()
  }

  const headers = new Headers({
    "Content-Type": (target.type === "local" && response?.headers.get("Content-Type")) || FSUtil.mimeType(target.path),
  })

  headers.set("Accept-Ranges", "bytes")
  headers.set("Content-Length", String(slice.length))

  if (slice.content) headers.set("Content-Range", slice.content)
  headers.set("Cross-Origin-Resource-Policy", "same-origin")
  headers.set("Content-Security-Policy", "frame-ancestors 'self'")
  headers.set("Referrer-Policy", "no-referrer")
  headers.set("X-Content-Type-Options", "nosniff")
  headers.set("Cache-Control", "no-store")

  if (!grants.has(host)) {
    await response?.body?.cancel()

    return Response.error()
  }

  return new Response(request.method === "HEAD" ? null : response?.body, { status: slice.status, headers })
}

async function readLocal(target: { file: FileHandle }, slice: ReturnType<typeof previewRange>, signal: AbortSignal) {
  if (signal.aborted || !slice.length) {
    await target.file.close()

    return signal.aborted ? Response.error() : new Response(null)
  }

  const start = slice.range ? Number(slice.range.slice(6).split("-")[0]) : 0
  const stream = target.file.createReadStream({ start, end: start + slice.length - 1, signal })

  // SAFETY: toWeb adapts this byte-only file stream to a WHATWG stream. Node and DOM disagree on the BYOB overload.
  const body = Readable.toWeb(stream, { strategy: { highWaterMark: 64 * 1024, size: (chunk: Uint8Array) => chunk.byteLength } })

  if (body instanceof ReadableStream) return new Response(body)
  await body.cancel()

  return Response.error()
}
