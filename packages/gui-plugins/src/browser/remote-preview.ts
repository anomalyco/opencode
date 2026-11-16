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
    read(path, range, signal) {
      const encoded = path.split("/").map(encodeURIComponent).join("/")
      const url = new URL(`api/fs/read/${encoded}`, `${server.url.replace(/\/+$/, "")}/`)
      url.searchParams.set("location[directory]", location.directory)

      if (location.workspace) url.searchParams.set("location[workspace]", location.workspace)
      const headers = new Headers(server.headers)
      headers.set("accept-encoding", "identity")

      if (range) headers.set("range", range)

      // Never send the page's headers or follow a redirect supplied by the server. Node streams the response with
      // backpressure and a body inactivity timeout; revoking the attachment also interrupts active readers.
      return fetch(url, { headers, redirect: "error", signal: AbortSignal.any([signal, lifetime]) })
    },
  }
}
