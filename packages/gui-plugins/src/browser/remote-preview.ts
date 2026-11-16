import type { ServerEndpoint } from "@opencode/plugin/gui/main"
import type { WorkspaceSource } from "./workspace-file"
import { workspacePrefix } from "./remote-address"
import { FileVerificationError } from "@opencode/util/file-verification"

/** The endpoint's marker distinguishes a missing file on a capable server from an older server's router 404. */
export function remotePreview(
  server: ServerEndpoint,
  session: string,
  location: { directory: string; workspace?: string },
  lifetime: AbortSignal,
  policy?: { agent?: string },
): Extract<WorkspaceSource, { type: "remote" }> {
  let outdated = false

  const request = async (path: string, method: "HEAD" | "GET", range: string | undefined, signal: AbortSignal, document: string, entry: boolean, identity: string) => {
    const url = new URL("api/experimental/preview/read", `${server.url.replace(/\/+$/, "")}/`)
    url.searchParams.set("sessionID", session)
    url.searchParams.set("path", path)
    url.searchParams.set("document", document)
    url.searchParams.set("root", identity)

    if (entry) url.searchParams.set("entry", "1")
    url.searchParams.set("location[directory]", location.directory)

    if (location.workspace) url.searchParams.set("location[workspace]", location.workspace)
    const headers = new Headers(server.headers)

    if (policy) {
      headers.set("x-opencode-preview-policy", "agent")

      if (policy.agent) headers.set("x-opencode-preview-agent", encodeURIComponent(policy.agent))
    }

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

      if (response.headers.get("x-opencode-preview") === "3" && (!policy || response.headers.get("x-opencode-preview-policy") === "agent")) {
        outdated = false

        return FileVerificationError.check(response)
      }

      outdated = [200, 404, 405, 501].includes(response.status)
      await response.body?.cancel()

      return Response.error()
    } finally {
      clearTimeout(timer)
    }
  }

  const pin = async (document:string, signal:AbortSignal) => {
    const response = await request(document, "HEAD", undefined, signal, document, true, "bind").catch(() => undefined)
    const id = response?.headers.get("x-opencode-preview-root")

    return response?.ok && id && /^[a-f0-9]{64}$/.test(id) ? id : undefined
  }

  return {
    type: "remote",
    root: location.directory,
    prefix: workspacePrefix(session),
    needsUpdate: () => outdated,
    pin,
    stat: async (path, signal, document=path, entry=false, identity) => {
      const id = identity ?? await pin(document,signal)

      if (!id) return null
      const response = await request(path, "HEAD", undefined, signal, document, entry, id).catch(FileVerificationError.orMissing)

      if (response?.headers.get("x-opencode-preview-denied") === "1") return "denied"
      const length = response?.headers.get("content-length")

      return response?.ok && length && /^\d+$/.test(length) && Number.isSafeInteger(Number(length))
        ? Number(length)
        : null
    },
    read: (path, range, signal, document, entry, identity) => request(path, "GET", range, signal, document, entry, identity),
  }
}
