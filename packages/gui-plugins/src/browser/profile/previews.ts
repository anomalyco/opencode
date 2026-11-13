import { net, type Session } from "electron"
import { previewScheme } from "@opencode/gui-plugins/schemes"
import { previewResource } from "../preview"
import { workspaceFile } from "../workspace-file"

export function createPreviews(session: Session) {
  const grants = new Map<string, () => readonly string[]>()

  const serve = async (request: Request) => {
    const host = new URL(request.url).host
    const grant = grants.get(host)
    // Electron adds the Chromium initiator (not a renderer-supplied HTTP header) to protocol Requests.
    // SAFETY: Electron's Protocol.handle assigns ProtocolRequest.initiatorOrigin (string or undefined).
    const initiator = (request as Request & { initiatorOrigin?: string }).initiatorOrigin

    if (!grant) return Response.error()

    if (request.method !== "GET" && request.method !== "HEAD") return Response.error()
    const file = previewResource(request.url, host, initiator, grant())

    if (!file) return Response.error()
    const target = await workspaceFile(file, grant())

    if (!target || !grants.has(host)) return Response.error()
    const range = request.headers.get("range")
    const response = await net.fetch(target.href, { method: request.method, headers: range ? { range } : undefined })
    const headers = new Headers(response.headers)
    headers.set("Cross-Origin-Resource-Policy", "same-origin")
    headers.set("Content-Security-Policy", "frame-ancestors 'self'")
    headers.set("Referrer-Policy", "no-referrer")
    headers.set("Cache-Control", "no-store")

    return new Response(response.body, { status: response.status, headers })
  }

  // File loaders reject for disappearing or unreadable files. Refuse the request without throwing into Electron.
  session.protocol.handle(previewScheme, (request) => serve(request).catch(() => Response.error()))

  return {
    grant(roots: () => readonly string[]) {
      const host = crypto.randomUUID()
      grants.set(host, roots)

      return { host, release: () => grants.delete(host) }
    },
    dispose() {
      grants.clear()
      session.protocol.unhandle(previewScheme)
    },
  }
}
