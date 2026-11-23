import type { ServerEndpoint } from "@opencode/plugin/gui/main"
import type { WorkspaceSource } from "./workspace-file"
import { workspacePrefix } from "./remote-address"

/**
 * A remote server's workspace files, read through its file endpoint. Only main knows the server's address and
 * credentials: the preview grant gets sizes and bytes, never a URL to fetch.
 */
export function remotePreview(
  server: ServerEndpoint,
  session: string,
  location: { directory: string; workspace?: string },
  lifetime: AbortSignal,
): Extract<WorkspaceSource, { type: "remote" }> {
  const request = async (path: string, method: "HEAD" | "GET", range: string | undefined, signal: AbortSignal) => {
    const encoded = path.split("/").map(encodeURIComponent).join("/")
    const url = new URL(`api/fs/read/${encoded}`, `${server.url.replace(/\/+$/, "")}/`)
    url.searchParams.set("location[directory]", location.directory)

    if (location.workspace) url.searchParams.set("location[workspace]", location.workspace)
    const headers = new Headers(server.headers)
    headers.set("accept-encoding", "identity")

    if (range) headers.set("range", range)
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), 15_000)

    try {
      // Never send the page's headers or follow a redirect the server supplies. The timeout covers the answer's
      // headers; the body streams for as long as the page reads it, and revoking the attachment interrupts it.
      return await fetch(url, {
        method,
        headers,
        redirect: "error",
        signal: AbortSignal.any([signal, lifetime, timeout.signal]),
      })
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    type: "remote",
    root: location.directory,
    prefix: workspacePrefix(session),
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
