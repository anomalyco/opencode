export * as ProxyDispatcher from "./dispatcher"

import net from "node:net"
import tls from "node:tls"
import { once } from "node:events"
import type { ProxySettings } from "./resolve"
import { selectProviders, type ProxyAuthContext, type ProxyAuthProvider } from "./auth/provider"
import { ProxyAuthError } from "./error"
import { load as loadNative } from "./native"

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
 * Raw sockets are used instead of `node:http`: Bun's `http.request` cannot emit
 * a valid `CONNECT` target, and it resolves an absolute-form `path` against the
 * target host when that host resolves locally, silently bypassing the proxy.
 * `makeDispatcher` returns a `{ fetch, close }` object rather than an undici
 * `Dispatcher`, because the chosen seam is a fetch function.
 */
export function makeDispatcher(settings: ProxySettings, deps: ProxyDispatcherDeps = {}): ProxyDispatcher {
  const proxy = settings.url
  const withLock = makeAsyncKeyedLock()
  const tunnels = new Map<string, Tunnel>()

  if (!proxy) {
    return { fetch: (input, init) => globalThis.fetch(input, init), close: async () => {} }
  }

  const authHeader = makeAuthHeader(settings, deps)

  return {
    async fetch(input, init) {
      const request = input instanceof Request ? input : new Request(String(input), init)
      const target = new URL(request.url)
      if (target.protocol === "https:") {
        const key = `${proxy.origin}->${target.origin}`
        const existing = tunnels.get(key)
        if (existing && !existing.socket.destroyed) return requestThroughTunnel(existing, request)
        const tunnel = await withLock(key, () => openTunnel(proxy, target, authHeader))
        tunnels.set(key, tunnel)
        return requestThroughTunnel(tunnel, request)
      }
      return withLock(proxy.origin, () => requestAbsoluteForm(proxy, target, request, authHeader))
    },
    async close() {
      for (const tunnel of tunnels.values()) tunnel.socket.destroy()
      tunnels.clear()
    },
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
    const native = await loadNative()
    if (!deps.providers && !native && (settings.auth === "negotiate" || settings.auth === "ntlm")) {
      throw new ProxyAuthError("missing-native", { proxy: proxy.origin })
    }
    const selected = deps.providers ?? selectProviders(settings.auth, challenges, native)
    for (const provider of selected) {
      const challenge = challenges.find((entry) => entry.split(/\s/, 1)[0].toLowerCase() === provider.scheme) ?? provider.scheme
      const value = await provider.step(ctx, challenge)
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
  let previous = ""
  for (let round = 0; round < MAX_AUTH_ROUNDS; round++) {
    const attempted = challenges.size > 0
    const header = attempted ? await authHeader([...challenges], target.origin) : undefined
    const result = await connectOnce(proxy, target, header)
    if ("socket" in result) return result
    for (const scheme of result.challenges) challenges.add(scheme)
    // A credentialed round that receives a *new* challenge (for example NTLM's
    // Type2 token) continues; the same challenge repeated means the credentials
    // were rejected.
    const signature = result.challenges.join("|")
    if (header && signature !== previous) {
      previous = signature
      continue
    }
    if (header) throw new ProxyAuthError("rejected", { proxy: proxy.origin })
    // A challenge arrived but no provider could produce credentials for it.
    if (attempted) throw new ProxyAuthError("no-credentials", { proxy: proxy.origin })
  }
  throw new ProxyAuthError("rounds-exceeded", { proxy: proxy.origin })
}

function connectOnce(
  proxy: URL,
  target: URL,
  authorization: string | undefined,
): Promise<{ socket: net.Socket } | { challenges: string[] }> {
  return new Promise((resolve, reject) => {
    // RFC 7231 requires `host:port`; default the scheme's port when the URL omits it.
    const authority = `${target.hostname}:${Number(target.port) || 443}`
    const socket = net.connect({ host: proxy.hostname, port: Number(proxy.port) || 80 })
    socket.on("connect", () => {
      const lines = [`CONNECT ${authority} HTTP/1.1`, `Host: ${authority}`, "Proxy-Connection: Keep-Alive"]
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
  // Write the request directly over the established TLS socket. `https.request`
  // cannot be used here: given an already-TLS socket it would attempt a second
  // handshake. `Connection: close` bounds the response to this socket's end.
  const headers: Record<string, string> = {
    host: target.host,
    connection: "close",
    ...Object.fromEntries(request.headers),
  }
  const body = request.body ? Buffer.from(await new Response(request.body).arrayBuffer()) : undefined
  if (body) headers["content-length"] = String(body.length)
  const lines = [`${request.method} ${target.pathname}${target.search} HTTP/1.1`]
  for (const [key, value] of Object.entries(headers)) lines.push(`${key}: ${value}`)
  tlsSocket.write(lines.join("\r\n") + "\r\n\r\n")
  if (body) tlsSocket.write(body)
  const head = await readHead(tlsSocket)
  return new Response(bodyStream(tlsSocket, head.rest), { status: head.status, headers: head.headers })
}

async function requestAbsoluteForm(
  proxy: URL,
  target: URL,
  request: Request,
  authHeader: (challenges: string[], target: string) => Promise<string | undefined>,
): Promise<Response> {
  const challenges = new Set<string>()
  let previous = ""
  for (let round = 0; round < MAX_AUTH_ROUNDS; round++) {
    const attempted = challenges.size > 0
    const header = attempted ? await authHeader([...challenges], target.origin) : undefined
    const response = await sendAbsolute(proxy, target, request, header)
    if (response.status !== 407) return response
    const advertised = challengesOf(response.headers.get("proxy-authenticate") ?? undefined)
    for (const scheme of advertised) challenges.add(scheme)
    response.body?.cancel()
    const signature = advertised.join("|")
    if (header && signature !== previous) {
      previous = signature
      continue
    }
    if (header) throw new ProxyAuthError("rejected", { proxy: proxy.origin })
    // A challenge arrived but no provider could produce credentials for it.
    if (attempted) throw new ProxyAuthError("no-credentials", { proxy: proxy.origin })
  }
  throw new ProxyAuthError("rounds-exceeded", { proxy: proxy.origin })
}

/**
 * Send an absolute-form request over a raw socket connected to the proxy.
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
      const headers: Record<string, string> = {
        host: target.host,
        connection: "close",
        ...Object.fromEntries(request.headers),
      }
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
        if (colon <= 0) continue
        const key = line.slice(0, colon).trim().toLowerCase()
        const value = line.slice(colon + 1).trim()
        // Some proxies emit one `Proxy-Authenticate` per scheme; join rather
        // than overwrite so auto-selection sees every advertised mechanism.
        headers[key] = headers[key] ? `${headers[key]}, ${value}` : value
      }
      resolve({ status: Number(statusLine.split(" ")[1]), headers, rest })
    }
    const onError = (error: Error) => reject(error)
    socket.on("data", onData)
    socket.on("error", onError)
  })
}

/**
 * Parse `Proxy-Authenticate` values, preserving each scheme's token so NTLM can
 * read the Type2 message. Comma splitting is safe here because the base64
 * tokens NTLM/Negotiate use never contain commas.
 */
const challengesOf = (value: string | string[] | undefined): string[] => {
  if (!value) return []
  const values = Array.isArray(value) ? value : [value]
  return values
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean)
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
