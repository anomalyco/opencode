export * as ProxyDispatcher from "./dispatcher"

import http from "node:http"
import https from "node:https"
import net from "node:net"
import tls from "node:tls"
import { once } from "node:events"
import { Readable } from "node:stream"
import type { ProxySettings } from "./resolve"
import { selectProviders, type ProxyAuthContext, type ProxyAuthProvider } from "./auth/provider"
import { ProxyAuthError } from "./error"

export const MAX_AUTH_ROUNDS = 3

export interface ProxyDispatcher {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
  close(): Promise<void>
}

export interface ProxyDispatcherDeps {
  providers?: readonly ProxyAuthProvider[]
}

interface Tunnel {
  socket: net.Socket
}

interface Head {
  status: number
  headers: Record<string, string>
  rest: Buffer
}

/**
 * A fetch-compatible transport that authenticates to an HTTP proxy.
 *
 * This is the seam Effect's `FetchHttpClient` consumes: it is installed as the
 * `FetchHttpClient.Fetch` reference so every outbound request inherits proxy
 * authentication. HTTPS uses a `CONNECT` tunnel; HTTP uses absolute-form
 * requests. Both answer a `407` by walking the advertised schemes
 * (Negotiate → NTLM → Basic) and retrying, bounded by `MAX_AUTH_ROUNDS`.
 *
 * The CONNECT handshake uses a raw socket because Bun's `http.request` cannot
 * emit a valid CONNECT target. `makeDispatcher` returns a `{ fetch, close }`
 * object rather than an undici `Dispatcher`, because the chosen seam is a fetch
 * function.
 */
export function makeDispatcher(settings: ProxySettings, deps: ProxyDispatcherDeps = {}): ProxyDispatcher {
  const proxy = settings.url
  const withLock = makeAsyncKeyedLock()

  if (!proxy) {
    return { fetch: (input, init) => globalThis.fetch(input, init), close: async () => {} }
  }

  const authHeader = makeAuthHeader(settings, deps)

  return {
    async fetch(input, init) {
      const request = input instanceof Request ? input : new Request(input, init)
      const target = new URL(request.url)
      if (target.protocol === "https:") {
        const tunnel = await withLock(proxy.origin, () => openTunnel(proxy, target, authHeader))
        return requestThroughTunnel(tunnel, request)
      }
      return withLock(proxy.origin, () => requestAbsoluteForm(proxy, target, request, authHeader))
    },
    async close() {},
  }
}

/** Build the challenge→`Proxy-Authorization` resolver for a proxy. */
export function makeAuthHeader(
  settings: ProxySettings,
  deps: ProxyDispatcherDeps = {},
): (challenges: string[], target: string) => Promise<string | undefined> {
  const proxy = settings.url
  return async (challenges, target) => {
    if (!proxy) return undefined
    const ctx: ProxyAuthContext = { proxy, target, username: settings.username, password: settings.password }
    const selected = deps.providers ?? selectProviders(settings.auth, challenges)
    for (const provider of selected) {
      const value = await provider.step(ctx, challenges.join(", "))
      if (value) return value
    }
    return undefined
  }
}

/** Open an authenticated CONNECT tunnel, or throw with an actionable error. */
export async function openTunnel(
  proxy: URL,
  target: URL,
  authHeader: (challenges: string[], target: string) => Promise<string | undefined>,
): Promise<Tunnel> {
  const challenges = new Set<string>()
  for (let round = 0; round < MAX_AUTH_ROUNDS; round++) {
    const header = challenges.size ? await authHeader([...challenges], target.origin) : undefined
    const result = await connectOnce(proxy, target, header)
    if ("socket" in result) return result
    for (const scheme of result.challenges) challenges.add(scheme)
    if (header) throw new ProxyAuthError("rejected", { proxy: proxy.origin })
    if (challenges.size === 0) throw new ProxyAuthError("no-credentials", { proxy: proxy.origin })
  }
  throw new ProxyAuthError("rounds-exceeded", { proxy: proxy.origin })
}

function connectOnce(
  proxy: URL,
  target: URL,
  authorization: string | undefined,
): Promise<{ socket: net.Socket } | { challenges: string[] }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.hostname, port: Number(proxy.port) || 80 })
    socket.on("connect", () => {
      const lines = [
        `CONNECT ${target.hostname}:${target.port} HTTP/1.1`,
        `Host: ${target.hostname}:${target.port}`,
        "Proxy-Connection: Keep-Alive",
      ]
      if (authorization) lines.push(`Proxy-Authorization: ${authorization}`)
      socket.write(lines.join("\r\n") + "\r\n\r\n")
      readHead(socket).then((head) => {
        if (head.status === 200) {
          if (head.rest.length) socket.unshift(head.rest)
          resolve({ socket })
          return
        }
        socket.destroy()
        resolve({ challenges: challengesOf(head.headers["proxy-authenticate"]) })
      }, reject)
    })
    socket.on("error", reject)
  })
}

async function requestThroughTunnel(tunnel: Tunnel, request: Request): Promise<Response> {
  const target = new URL(request.url)
  const tlsSocket = tls.connect({ socket: tunnel.socket, servername: target.hostname })
  await once(tlsSocket, "secureConnect")
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: target.hostname,
        port: Number(target.port) || 443,
        method: request.method,
        path: target.pathname + target.search,
        headers: Object.fromEntries(request.headers),
        createConnection: () => tlsSocket,
      },
      (res) => resolve(nodeResponse(res)),
    )
    req.on("error", reject)
    pipeBody(request, req)
  })
}

async function requestAbsoluteForm(
  proxy: URL,
  target: URL,
  request: Request,
  authHeader: (challenges: string[], target: string) => Promise<string | undefined>,
): Promise<Response> {
  const challenges = new Set<string>()
  for (let round = 0; round < MAX_AUTH_ROUNDS; round++) {
    const header = challenges.size ? await authHeader([...challenges], target.origin) : undefined
    const response = await sendAbsolute(proxy, target, request, header)
    if (response.status !== 407) return response
    for (const scheme of challengesOf(response.headers.get("proxy-authenticate") ?? undefined)) challenges.add(scheme)
    response.body?.cancel()
    if (header) throw new ProxyAuthError("rejected", { proxy: proxy.origin })
    if (challenges.size === 0) throw new ProxyAuthError("no-credentials", { proxy: proxy.origin })
  }
  throw new ProxyAuthError("rounds-exceeded", { proxy: proxy.origin })
}

/**
 * Send an absolute-form request over a raw socket connected to the proxy.
 * `node:http` is not used here because it resolves an absolute-form path to the
 * target host when that host resolves locally, silently bypassing the proxy.
 * `Connection: close` makes the response end when the proxy closes the socket.
 */
function sendAbsolute(
  proxy: URL,
  target: URL,
  request: Request,
  authorization: string | undefined,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.hostname, port: Number(proxy.port) || 80 })
    socket.on("connect", async () => {
      const headers: Record<string, string> = { host: target.host, connection: "close", ...Object.fromEntries(request.headers) }
      if (authorization) headers["proxy-authorization"] = authorization
      const body = request.body ? Buffer.from(await new Response(request.body).arrayBuffer()) : undefined
      if (body) headers["content-length"] = String(body.length)
      const lines = [`${request.method} ${target.toString()} HTTP/1.1`]
      for (const [key, value] of Object.entries(headers)) lines.push(`${key}: ${value}`)
      socket.write(lines.join("\r\n") + "\r\n\r\n")
      if (body) socket.write(body)
      readHead(socket).then((head) => {
        resolve(new Response(bodyStream(socket, head.rest), { status: head.status, headers: head.headers }))
      }, reject)
    })
    socket.on("error", reject)
  })
}

function nodeResponse(res: http.IncomingMessage): Response {
  const headers = new Headers()
  for (const [key, value] of Object.entries(res.headers)) {
    if (value === undefined) continue
    for (const entry of Array.isArray(value) ? value : [value]) headers.append(key, entry)
  }
  if (res.statusCode === 204 || res.statusCode === 304) return new Response(null, { status: res.statusCode, headers })
  return new Response(Readable.toWeb(res) as ReadableStream, { status: res.statusCode ?? 500, headers })
}

/**
 * Adapt the remaining socket bytes to a web stream without the double-close
 * ("Controller is already closed") that `Readable.toWeb` produces when the
 * consumer closes before the socket ends.
 */
function bodyStream(socket: net.Socket, rest: Buffer): ReadableStream<Uint8Array> {
  let closed = false
  const close = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (closed) return
    closed = true
    try {
      controller.close()
    } catch {}
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (rest.length) controller.enqueue(new Uint8Array(rest))
      if (socket.readableEnded) {
        close(controller)
        return
      }
      socket.on("data", (chunk) => {
        if (closed) return
        try {
          controller.enqueue(new Uint8Array(chunk))
        } catch {
          closed = true
        }
      })
      socket.on("end", () => close(controller))
      socket.on("error", (error) => {
        if (closed) return
        closed = true
        try {
          controller.error(error)
        } catch {}
      })
    },
    cancel() {
      closed = true
      socket.destroy()
    },
  })
}

/** Read one HTTP response head, returning any body bytes that followed it. */
function readHead(socket: net.Socket): Promise<Head> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      const end = buffer.indexOf("\r\n\r\n")
      if (end === -1) return
      socket.off("data", onData)
      socket.off("error", onError)
      const head = buffer.subarray(0, end).toString("latin1")
      const rest = Buffer.from(buffer.subarray(end + 4))
      const [statusLine, ...headerLines] = head.split("\r\n")
      const headers: Record<string, string> = {}
      for (const line of headerLines) {
        const colon = line.indexOf(":")
        if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim()
      }
      resolve({ status: Number(statusLine.split(" ")[1]), headers, rest })
    }
    const onError = (error: Error) => reject(error)
    socket.on("data", onData)
    socket.on("error", onError)
  })
}

const challengesOf = (value: string | string[] | undefined): string[] => {
  if (!value) return []
  const values = Array.isArray(value) ? value : [value]
  return values
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim().split(/\s/, 1)[0])
    .filter((entry): entry is string => Boolean(entry))
}

/**
 * Serializes async work per key so concurrent cold-start requests through one
 * proxy share a single authentication handshake instead of racing.
 */
function makeAsyncKeyedLock() {
  const chains = new Map<string, Promise<unknown>>()
  return <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const previous = chains.get(key) ?? Promise.resolve()
    const run = previous.then(task, task)
    chains.set(
      key,
      run.catch(() => {}),
    )
    return run
  }
}

export type { Tunnel as ProxyTunnel }
