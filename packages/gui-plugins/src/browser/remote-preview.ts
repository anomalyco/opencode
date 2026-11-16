import type { ServerEndpoint } from "@opencode/plugin/gui/main"
import type { PreviewSource } from "./workspace-file"
import { workspacePrefix } from "./remote-address"

/** Only main knows the API address and credentials. The preview grant exposes metadata and bytes, never a URL to fetch. */
export function remotePreview(
  server: ServerEndpoint,
  session: string,
  location: { directory: string; workspace?: string },
  lifetime: AbortSignal,
  stat: (path: string, signal: AbortSignal) => Promise<number | null>,
): Extract<PreviewSource, { type: "remote" }> {
  return {
    type: "remote",
    prefix: workspacePrefix(session),
    stat: (path, signal) => stat(path, AbortSignal.any([lifetime, signal, AbortSignal.timeout(15_000)])).catch(() => null),
    async read(path, range, signal) {
      const url = new URL("api/experimental/preview/read", `${server.url.replace(/\/+$/, "")}/`)
      url.searchParams.set("path", path)
      url.searchParams.set("sessionID", session)
      url.searchParams.set("location[directory]", location.directory)

      if (location.workspace) url.searchParams.set("location[workspace]", location.workspace)
      const headers = new Headers(server.headers)
      headers.set("accept-encoding", "identity")

      if (range) headers.set("range", range)

      // Bound the wait for headers, not the duration of a large response. Detach still aborts its body.
      const timeout = new AbortController()
      const timer = setTimeout(() => timeout.abort(), 15_000)

      try {
        const response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.any([signal, lifetime, timeout.signal]) })

        if (response.headers.get("x-opencode-preview") === "1") return response
        await response.body?.cancel()

        return Response.error()
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
