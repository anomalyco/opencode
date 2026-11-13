import { net, type Session } from "electron"
import { previewScheme } from "../scheme"
import { resolvePreviewRequest } from "../workspace-file"
import { previewRange } from "./range"

export function createPreviews(session: Session, signal: AbortSignal) {
  signal.throwIfAborted()
  const grants = new Map<string, () => readonly string[]>()

  const release = (host: string) => {
    if (!grants.delete(host)) return
    void session.clearStorageData({ origin: `${previewScheme}://${host}`, storages: ["localstorage", "indexdb", "cachestorage", "filesystem"] }).catch(() => undefined)
  }

  const serve = async (request: Request) => {
    const host = new URL(request.url).host
    // Electron adds the Chromium initiator (not a renderer-supplied HTTP header) to protocol Requests.
    // SAFETY: Electron's Protocol.handle assigns ProtocolRequest.initiatorOrigin (string or undefined).
    const initiator = (request as Request & { initiatorOrigin?: string }).initiatorOrigin

    const target = await resolvePreviewRequest(request.url, request.method, initiator, grants)

    if (!target) return Response.error()
    const slice = previewRange(request.headers.get("range"), target.size)
    const response = slice.status === 416 ? undefined : await net.fetch(target.href, { method: request.method, headers: slice.range ? { range: slice.range } : undefined })
    const headers = new Headers(response?.headers)
    headers.set("Accept-Ranges", "bytes")
    headers.set("Content-Length", String(slice.length))

    if (slice.content) headers.set("Content-Range", slice.content)
    headers.set("Cross-Origin-Resource-Policy", "same-origin")
    headers.set("Content-Security-Policy", "frame-ancestors 'self'")
    headers.set("Referrer-Policy", "no-referrer")
    headers.set("Cache-Control", "no-store")

    if (request.method === "HEAD") await response?.body?.cancel()

    if (!grants.has(host)) {
      await response?.body?.cancel()

      return Response.error()
    }

    return new Response(request.method === "HEAD" ? null : response?.body, { status: slice.status, headers })
  }

  // File loaders reject for disappearing or unreadable files. Refuse the request without throwing into Electron.
  session.protocol.handle(previewScheme, (request) => serve(request).catch(() => Response.error()))
  let active = true

  const dispose = () => {
    if (!active) return
    active = false
    signal.removeEventListener("abort", dispose)
    grants.forEach((_roots, host) => release(host))
    session.protocol.unhandle(previewScheme)
  }

  // Revoke synchronously, before async pane teardown can exceed the plugin host's reload deadline.
  signal.addEventListener("abort", dispose, { once: true })

  return {
    grant(roots: () => readonly string[]) {
      signal.throwIfAborted()
      const host = crypto.randomUUID()
      grants.set(host, roots)

      return { host, release: () => release(host) }
    },
    dispose,
  }
}
