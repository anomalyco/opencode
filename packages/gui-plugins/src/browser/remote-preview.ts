import type { ServerEndpoint } from "@opencode/plugin/gui/main"
import type { PreviewSource } from "./workspace-file"
import { workspacePrefix } from "./remote-address"

/** The endpoint's marker distinguishes a missing file on a capable server from an older server's router 404. */
export function remotePreview(
  server: ServerEndpoint,
  session: string,
  location: { directory: string; workspace?: string },
  lifetime: AbortSignal,
): Extract<PreviewSource, { type: "remote" }> {
  let outdated = false

  const request = async (path: string, method: "HEAD" | "GET", range: string | undefined, signal: AbortSignal) => {
    const url = new URL("api/experimental/preview/read", `${server.url.replace(/\/+$/, "")}/`)
    url.searchParams.set("sessionID", session)
    url.searchParams.set("path", path)
    url.searchParams.set("location[directory]", location.directory)

    if (location.workspace) url.searchParams.set("location[workspace]", location.workspace)
    const headers = new Headers(server.headers)
    headers.set("accept-encoding", "identity")

    if (range) headers.set("range", range)
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), 15_000)

    try {
      const response = await fetch(url, {
        method,
        headers,
        redirect: "error",
        signal: AbortSignal.any([signal, lifetime, timeout.signal]),
      })

      if (response.headers.get("x-opencode-preview") === "1") {
        outdated = false

        return response
      }

      outdated = [200, 404, 405, 501].includes(response.status)
      await response.body?.cancel()

      return Response.error()
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    type: "remote",
    prefix: workspacePrefix(session),
    needsUpdate: () => outdated,
    stat: async (path, signal) => {
      const response = await request(path, "HEAD", undefined, signal).catch(() => undefined)
      const length = response?.headers.get("content-length")

      return response?.ok && length && /^\d+$/.test(length) && Number.isSafeInteger(Number(length))
        ? Number(length)
        : null
    },
    read: (path, range, signal) => request(path, "GET", range, signal),
  }
}
