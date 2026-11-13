import { realpath, stat } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { net, type Session } from "electron"
import { previewScheme } from "@opencode/gui-plugins/schemes"
import { previewResource } from "../preview"

export function createPreviews(session: Session) {
  const grants = new Map<string, () => readonly string[]>()

  session.protocol.handle(previewScheme, async (request) => {
    const host = new URL(request.url).host
    const grant = grants.get(host)
    // Electron adds the Chromium initiator (not a renderer-supplied HTTP header) to protocol Requests.
    // SAFETY: Electron's Protocol.handle assigns ProtocolRequest.initiatorOrigin (string or undefined).
    const initiator = (request as Request & { initiatorOrigin?: string }).initiatorOrigin

    if (!grant) return Response.error()

    if (request.method !== "GET" && request.method !== "HEAD") return Response.error()
    const file = previewResource(request.url, host, initiator, grant())

    if (!file) return Response.error()
    // Check the resolved target too: a symlink or junction under the workspace is not a grant for its destination.
    const target = await realpath(fileURLToPath(file)).catch(() => undefined)

    if (!target || !(await stat(target)).isFile()) return Response.error()
    const href = pathToFileURL(target).href
    const roots = await Promise.all(grant().map((root) => realpath(root)))

    if (!roots.some((root) => href.startsWith(`${pathToFileURL(root).href.replace(/\/$/, "")}/`)) || !grants.has(host))
      return Response.error()
    const range = request.headers.get("range")
    const response = await net.fetch(href, { method: request.method, headers: range ? { range } : undefined })
    const headers = new Headers(response.headers)
    headers.set("Cross-Origin-Resource-Policy", "same-origin")
    headers.set("Content-Security-Policy", "frame-ancestors 'self'")
    headers.set("Referrer-Policy", "no-referrer")
    headers.set("Cache-Control", "no-store")

    return new Response(response.body, { status: response.status, headers })
  })

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
