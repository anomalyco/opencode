import { resolvePreviewRequest, type PreviewSource } from "../workspace-file"
import { FSUtil } from "@opencode/util/fs-util"
import { previewRange } from "./range"

export async function servePreview(
  request: Request,
  grants: ReadonlyMap<string, PreviewSource>,
  readLocal: (href: string, options: RequestInit) => Promise<Response>,
) {
  const host = new URL(request.url).host
  // Electron adds the Chromium initiator (not a renderer-supplied HTTP header) to protocol Requests.
  // SAFETY: Electron's Protocol.handle assigns ProtocolRequest.initiatorOrigin (string or undefined).
  const initiator = (request as Request & { initiatorOrigin?: string }).initiatorOrigin

  const target = await resolvePreviewRequest(request.url, request.method, initiator, grants, request.signal)

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
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  }

  const slice = previewRange(request.headers.get("range"), target.size)

  const response =
    slice.status === 416 || request.method === "HEAD"
      ? undefined
      : target.type === "remote"
        ? await target.read(target.path, slice.range, request.signal)
        : await readLocal(target.href, {
            headers: slice.range ? { range: slice.range } : undefined,
            signal: request.signal,
          })

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
