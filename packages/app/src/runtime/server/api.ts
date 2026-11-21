import { OpenCode, withMediaRefs, type MediaRequestOptions } from "@opencode/client/promise"
import type { ServerConnection } from "@/runtime/server/registry"
import { decode64 } from "@/runtime/persistence/base64"

export function authTokenFromCredentials(input: { password: string }) {
  return btoa(`opencode:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)

  if (!decoded) return
  const separator = decoded.indexOf(":")

  if (separator === -1) return

  return {
    password: decoded.slice(separator + 1),
  }
}

/** `mediaRefs: false` reads stored media as inline bytes, for callers such as export that need self-contained messages. */
export type ServerRequestOptions = MediaRequestOptions

export function createApiForServer(input: { server: ServerConnection.HttpBase; fetch?: typeof globalThis.fetch }) {
  return withMediaRefs(
    OpenCode.make({
      baseUrl: input.server.url,
      fetch: input.fetch,
      headers: input.server.password
        ? {
            Authorization: `Basic ${authTokenFromCredentials({
              password: input.server.password,
            })}`,
          }
        : undefined,
    }),
  )
}

/**
 * The server's ranged read of one file, for media elements. They cannot send the Authorization header, and a credential
 * never goes in a DOM URL, so a server that needs a password has none: its media downloads through the API instead.
 */
export function fileStreamUrl(server: ServerConnection.HttpBase, input: { path: string; directory: string }) {
  if (server.password) return

  return fileUrl(server, "api/fs/read/", input)
}

/**
 * The server's sandboxed page for one HTML file, for the preview frame. A blob: frame inherits the app's CSP, and the
 * web UI the server serves blocks inline scripts. Only on that same origin does the frame's request carry the session
 * cookie; elsewhere (desktop, a remote server) the preview keeps its blob: frame.
 */
export function filePreviewUrl(server: ServerConnection.HttpBase, input: { path: string; directory: string }) {
  if (server.password || new URL(server.url).origin !== location.origin) return

  return fileUrl(server, "api/experimental/fs/preview/", input)
}

function fileUrl(server: ServerConnection.HttpBase, route: string, input: { path: string; directory: string }) {
  const url = new URL(
    `${route}${input.path.split("/").map(encodeURIComponent).join("/")}`,
    server.url.endsWith("/") ? server.url : `${server.url}/`,
  )

  url.searchParams.set("location[directory]", input.directory)

  return url.href
}

export type ServerApi = ReturnType<typeof createApiForServer>
