import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { Duplex } from "node:stream"

export function normalizeBasePath(input: string | undefined) {
  const value = input?.trim().replace(/\/+$/, "") ?? ""
  if (!value) return ""
  const path = value.startsWith("/") ? value : `/${value}`
  if (
    path.startsWith("//") ||
    /[?#\\\u0000-\u0020"'<>]/.test(path) ||
    new URL(path, "http://localhost").pathname !== path
  )
    throw new Error("base-path must be a URL-encoded path without a query, fragment, or dot segments")
  return path
}

export function basePathServer(options: { basePath?: string; basePathStripped?: boolean }) {
  const server = createServer()
  const base = normalizeBasePath(options.basePath)
  // The public prefix is still injected into HTML when a reverse proxy removes it on ingress.
  if (!base || options.basePathStripped) return server

  // EventEmitter overloads do not correlate the event name with the argument types.
  /* oxlint-disable typescript-eslint/no-unsafe-type-assertion */
  const emit = server.emit.bind(server)
  server.emit = ((event: string, ...args: unknown[]) => {
    if (event !== "request" && event !== "upgrade") return emit(event, ...args)
    const request = args[0] as IncomingMessage
    const url = request.url ?? "/"
    const index = url.indexOf("?")
    const pathname = index === -1 ? url : url.slice(0, index)
    if (pathname === base && event === "request") {
      const response = args[1] as ServerResponse
      response.writeHead(308, { Location: base + "/" + (index === -1 ? "" : url.slice(index)) })
      response.end()
      return true
    }
    if (pathname.startsWith(base + "/")) {
      request.url = url.slice(base.length)
      return emit(event, ...args)
    }
    if (event === "request") {
      const response = args[1] as ServerResponse
      response.writeHead(404, { "Content-Type": "text/plain" })
      response.end("Not Found")
      return true
    }
    const socket = args[1] as Duplex
    socket.destroy()
    return true
  }) as typeof server.emit
  /* oxlint-enable typescript-eslint/no-unsafe-type-assertion */
  return server
}
