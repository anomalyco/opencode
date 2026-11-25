import { Duplex } from "node:stream"
import { WebSocket as NodeWebSocket } from "@effect/platform-node/NodeWS"
import { net, session, type WebContents } from "electron"
import type { RpcClient } from "@opencode/client/effect/api"
import type { ServerEndpoint } from "@opencode/plugin/gui/main"
import type { Session } from "@opencode/schema/session"
import { Browser } from "@opencode/plugin-browser/rpc"
import { BrowserProxy } from "@opencode/plugin-browser/proxy"
import { BrowserTunnelHost, StreamMux, StreamWire } from "@opencode/plugin-browser/stream"
import { Effect, Predicate } from "effect"
import { Base64 } from "effect/encoding"

const TUNNEL_TICKET_HEADER = "x-opencode-browser-ticket"

const TUNNEL_SESSION_HEADER = "x-opencode-browser-session"

const TUNNEL_CONNECTION_HEADER = "x-opencode-browser-connection"

const TUNNEL_PROTOCOL_HEADER = "x-opencode-browser-protocol"

const TUNNEL_PROTOCOL_VERSION = 1 as const

const PREWARM_WAIT_TIMEOUT_MS = 15_000

export type TunnelUpgradeFailureKind = "auth" | "tls" | "blocked" | "protocol" | "ticket" | "transport"

/**
 * Explicit non-downgrading failure raised when a server advertises binary stream tunneling
 * (`tunnel.ws.v1`) and the WebSocket upgrade is rejected, blocked, or fails TLS/auth checks.
 */
export class TunnelUpgradeError extends Error {
  constructor(
    readonly kind: TunnelUpgradeFailureKind,
    message: string,
    readonly statusCode?: number,
  ) {
    super(message)
    this.name = "TunnelUpgradeError"
  }
}

export type BrowserNetwork = {
  attach(contents: WebContents): () => void
  icon(url: string): Promise<{ mime: string; data: Buffer } | undefined>
  /** Activates negotiated tunnel mode once the server emits `attached`. */
  activate?(capabilities: readonly string[]): void
  /** Explicitly grants a private preview target for this attachment via trusted desktop RPC. */
  grantPrivateTarget?(url: string, extraPorts?: readonly number[]): Promise<void>
  /** Whether a prewarmed binary WebSocket stream currently owns this attachment's liveness. */
  streamActive?(): boolean
  /** Resolves once the liveness-owning binary WebSocket stream ends. */
  readonly streamEnded?: Promise<"closed" | "replaced">
}

export const createBrowserNetwork = Effect.fn("BrowserNetwork.create")(function* (input: {
  server: ServerEndpoint
  rpc: RpcClient<typeof Browser.Definition, unknown>
  attachment: { sessionID: Session.ID; connectionID: string }
  location: { directory: string; workspace?: string }
  partition: string
}) {
  const options = { location: input.location }
  const resetListeners = new Set<() => void>()
  const streamEnded = Promise.withResolvers<"closed" | "replaced">()
  let disposed = false
  const initialReady = Promise.withResolvers<void>()
  // Prewarm can settle before any page opens a stream; consume the rejection here while `openStream` throws `mode.error`.
  void initialReady.promise.catch(() => undefined)

  let mode:
    | { readonly kind: "pending"; readonly ready: ReturnType<typeof Promise.withResolvers<void>> }
    | { readonly kind: "stream"; readonly mux: StreamMux.ClientMux }
    | { readonly kind: "failed"; readonly error: TunnelUpgradeError }
    | { readonly kind: "legacy" } = { kind: "pending", ready: initialReady }

  const notifyReset = () => {
    resetListeners.forEach((listener) => listener())
  }

  const legacyTransport: BrowserProxy.Transport = {
    open: (target, signal) =>
      Effect.runPromise(input.rpc["tunnel.open"]({ ...input.attachment, target }, options), { signal }),
    read: (tunnelID, signal) =>
      Effect.runPromise(input.rpc["tunnel.read"]({ ...input.attachment, tunnelID }, options), { signal }),
    write: (tunnelID, data, end, signal) => {
      const payload = { ...input.attachment, tunnelID, data: Base64.encode(data), end }

      return Effect.runPromise(input.rpc["tunnel.write"](payload, options), { signal })
    },
    close: (tunnelID) =>
      Effect.runPromise(
        input.rpc["tunnel.close"]({ ...input.attachment, tunnelID }, options).pipe(Effect.timeout("5 seconds")),
      ),
  }

  const streamTransport: BrowserProxy.StreamTransport = {
    async openStream(target, signal) {
      if (disposed) throw new Error("Browser attachment is closed.")

      if (mode.kind === "pending") await waitWithAbort(mode.ready.promise, signal, PREWARM_WAIT_TIMEOUT_MS)

      if (disposed) throw new Error("Browser attachment is closed.")

      if (mode.kind === "stream") return mode.mux.openStream(target, signal)

      if (mode.kind === "failed") throw mode.error

      if (mode.kind === "legacy") return openLegacyDuplex(legacyTransport, target, signal)

      throw new Error("Browser tunnel did not become ready.")
    },
    onReset(listener) {
      resetListeners.add(listener)

      return () => {
        resetListeners.delete(listener)
      }
    },
  }

  const proxy = yield* Effect.acquireRelease(
    Effect.tryPromise(() => BrowserProxy.make(streamTransport)),
    (value) =>
      Effect.sync(() => {
        disposed = true

        if (mode.kind === "stream") mode.mux.close(1000, "desktop detached")

        if (mode.kind === "pending") mode.ready.reject(new Error("Browser attachment closed."))
        streamEnded.resolve("closed")
      }).pipe(Effect.andThen(Effect.promise(() => value.close()))),
  )

  const partition = session.fromPartition(input.partition)
  yield* Effect.addFinalizer(() => Effect.promise(() => partition.closeAllConnections()))
  // This is the browser's private partition, not the app/API connection. Never
  // bypass localhost: it must resolve on the machine running the OC2 server.
  yield* Effect.tryPromise(() =>
    partition.setProxy({ mode: "fixed_servers", proxyRules: proxy.url, proxyBypassRules: "<-loopback>" }),
  )
  yield* Effect.tryPromise(() => partition.closeAllConnections())

  const prewarmStream = async () => {
    const pending = mode.kind === "pending" ? mode.ready : undefined

    try {
      const issued = await Effect.runPromise(
        input.rpc["tunnel.ticket"]({ ...input.attachment, protocol: TUNNEL_PROTOCOL_VERSION }, options),
      ).catch((cause: Error) => {
        throw classifyTicketError(cause)
      })

      if (disposed) return

      const socket = await openAuthenticatedWebSocket({
        server: input.server,
        location: input.location,
        attachment: input.attachment,
        ticket: issued.ticket,
        path: issued.path,
        protocol: issued.protocol,
      })

      if (disposed) {
        socket.close(1000, "desktop detached")

        return
      }

      const mux = StreamMux.createClientMux(socket)
      mode = { kind: "stream", mux }
      pending?.resolve()
      void mux.closed.then((info) => {
        notifyReset()

        if (disposed) return

        mode = {
          kind: "failed",
          error: new TunnelUpgradeError(
            "transport",
            info.replaced ? "Browser attachment was replaced." : info.reason || "Browser stream tunnel disconnected.",
          ),
        }
        streamEnded.resolve(info.replaced ? "replaced" : "closed")
      })
    } catch (cause) {
      const error =
        cause instanceof TunnelUpgradeError
          ? cause
          : new TunnelUpgradeError("transport", cause instanceof Error ? cause.message : String(cause))

      // Never silently downgrade to legacy RPC or desktop direct network on auth, TLS, policy, or blocked upgrade errors.
      mode = { kind: "failed", error }
      pending?.reject(error)
    }
  }

  const network: BrowserNetwork = {
    activate(capabilities) {
      if (disposed || mode.kind !== "pending") return

      const forcedLegacy = process.env.OPENCODE_BROWSER_TUNNEL_TRANSPORT?.trim().toLowerCase() === "legacy"

      if (!forcedLegacy && capabilities.includes(BrowserTunnelHost.STREAM_CAPABILITY)) {
        void prewarmStream()

        return
      }

      const ready = mode.ready
      mode = { kind: "legacy" }
      ready.resolve()
    },
    async grantPrivateTarget(url, extraPorts) {
      if (disposed) return

      const parsed = URL.parse(url)

      if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) return

      const host = parsed.hostname.replace(/^\[|\]$/g, "")

      if (!host) return

      const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80

      if (!Number.isInteger(port) || port < 1 || port > 65_535) return

      const requestInput =
        extraPorts && extraPorts.length > 0
          ? { ...input.attachment, target: { host, port }, ports: [...extraPorts] }
          : { ...input.attachment, target: { host, port } }

      await Effect.runPromise(input.rpc["tunnel.grant"](requestInput, options).pipe(Effect.ignore))
    },
    streamActive: () => !disposed && mode.kind === "stream" && !mode.mux.isClosed(),
    streamEnded: streamEnded.promise,
    attach(contents: WebContents) {
      const login = (
        event: Electron.Event,
        _details: Electron.AuthenticationResponseDetails,
        auth: Electron.AuthInfo,
        callback: (username?: string, password?: string) => void,
      ) => {
        if (
          !auth.isProxy ||
          auth.scheme !== "basic" ||
          auth.host !== proxy.host ||
          auth.port !== proxy.port ||
          auth.realm !== "OpenCode Browser Proxy"
        )
          return
        event.preventDefault()
        callback(proxy.credentials.username, proxy.credentials.password)
      }

      contents.on("login", login)
      contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp")

      return () => void contents.off("login", login)
    },
    /** Fetches a page icon through the server's network, as the page loaded it. */
    icon: (url: string) =>
      fetchIcon(url, partition, (auth, callback) => {
        if (auth.isProxy && auth.host === proxy.host && auth.port === proxy.port)
          return callback(proxy.credentials.username, proxy.credentials.password)
        callback()
      }),
  }

  return network
})

/**
 * Opens one authenticated binary WebSocket in Electron main using a short-lived single-use ticket
 * in the `x-opencode-browser-ticket` header. Verified TLS is strictly enforced and redirects are rejected.
 */
async function openAuthenticatedWebSocket(input: {
  readonly server: ServerEndpoint
  readonly location: { readonly directory: string; readonly workspace?: string }
  readonly attachment: { readonly sessionID: Session.ID; readonly connectionID: string }
  readonly ticket: string
  readonly path: string
  readonly protocol: number
}): Promise<BrowserTunnelHost.BinarySocket> {
  const base = new URL(input.server.url)

  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new TunnelUpgradeError("protocol", `Unsupported server URL protocol for browser tunnel: ${base.protocol}`)
  }

  const wsUrl = new URL(input.path, base)
  wsUrl.protocol = base.protocol === "https:" ? "wss:" : "ws:"
  wsUrl.searchParams.set("location[directory]", input.location.directory)

  if (input.location.workspace) wsUrl.searchParams.set("location[workspace]", input.location.workspace)

  // Forward only non-cookie configured endpoint headers (for authenticating reverse proxies if present);
  // never put the ticket in URLs, and never send browser cookies.
  const headers: Record<string, string> = {}

  for (const [key, value] of Object.entries(input.server.headers)) {
    if (key.toLowerCase() === "cookie") continue
    headers[key] = value
  }

  headers[TUNNEL_TICKET_HEADER] = input.ticket
  headers[TUNNEL_SESSION_HEADER] = input.attachment.sessionID
  headers[TUNNEL_CONNECTION_HEADER] = input.attachment.connectionID
  headers[TUNNEL_PROTOCOL_HEADER] = String(input.protocol)

  return await new Promise<BrowserTunnelHost.BinarySocket>((resolve, reject) => {
    const ws = new NodeWebSocket(wsUrl.toString(), {
      headers,
      perMessageDeflate: false,
      followRedirects: false,
      maxPayload: StreamWire.MAX_WS_FRAME_BYTES,
      handshakeTimeout: PREWARM_WAIT_TIMEOUT_MS,
    })

    let settled = false

    const finish = (fn: () => void) => {
      if (settled) return

      settled = true
      ws.off("open", onOpen)
      ws.off("unexpected-response", onUnexpectedResponse)
      ws.off("error", onError)
      ws.off("close", onClose)
      fn()
    }

    const onOpen = () => {
      finish(() => resolve(adaptNodeWebSocket(ws)))
    }

    const onUnexpectedResponse = (_request: { readonly path?: string }, response: { readonly statusCode?: number }) => {
      const status = response.statusCode ?? 0
      finish(() => {
        // Keep a silent error sink because `ws.terminate()` during CONNECTING emits an asynchronous error event.
        ws.on("error", () => undefined)
        ws.terminate()

        if (status === 401 || status === 403) {
          reject(
            new TunnelUpgradeError(
              "auth",
              `Browser stream tunnel upgrade was rejected (HTTP ${status}). Check server credentials and attachment state.`,
              status,
            ),
          )

          return
        }

        reject(
          new TunnelUpgradeError(
            "blocked",
            `Browser stream tunnel WebSocket upgrade was blocked (HTTP ${status}). Ensure the server or reverse proxy permits WebSocket upgrades.`,
            status,
          ),
        )
      })
    }

    const onError = (error: Error) => {
      finish(() => {
        ws.on("error", () => undefined)
        ws.terminate()
        reject(classifySocketError(error))
      })
    }

    const onClose = (code: number, reason: Buffer) => {
      finish(() =>
        reject(
          new TunnelUpgradeError(
            code === 1002 || code === 1008 || code === 1009 ? "protocol" : "transport",
            reason.toString("utf8") || `Browser stream tunnel closed during handshake (code ${code}).`,
          ),
        ),
      )
    }

    ws.once("open", onOpen)
    ws.once("unexpected-response", onUnexpectedResponse)
    ws.once("error", onError)
    ws.once("close", onClose)
  })
}

function adaptNodeWebSocket(ws: NodeWebSocket): BrowserTunnelHost.BinarySocket {
  return {
    get readyState() {
      return ws.readyState
    },
    get bufferedAmount() {
      return ws.bufferedAmount
    },
    send(data, onWritten) {
      ws.send(data, { binary: true, compress: false }, (error) => onWritten?.(error ?? undefined))
    },
    ping() {
      if (ws.readyState === ws.OPEN) ws.ping()
    },
    close(code, reason) {
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close(code, reason)
    },
    terminate() {
      ws.terminate()
    },
    onMessage(listener) {
      const handler = (raw: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
        if (!isBinary) {
          listener(String(raw))

          return
        }

        if (raw instanceof Uint8Array) {
          listener(raw)

          return
        }

        if (raw instanceof ArrayBuffer) {
          listener(new Uint8Array(raw))

          return
        }

        listener(Buffer.concat(raw))
      }

      ws.on("message", handler)

      return () => {
        ws.off("message", handler)
      }
    },
    onClose(listener) {
      const handler = (code: number, reason: Buffer) => listener(code, reason.toString("utf8"))
      ws.on("close", handler)

      return () => {
        ws.off("close", handler)
      }
    },
    onError(listener) {
      ws.on("error", listener)

      return () => {
        ws.off("error", listener)
      }
    },
    onPong(listener) {
      ws.on("pong", listener)

      return () => {
        ws.off("pong", listener)
      }
    },
  }
}

function classifyTicketError(cause: Error): TunnelUpgradeError {
  const message = cause.message

  if (/401|403|unauthor|forbid/i.test(message)) {
    return new TunnelUpgradeError("auth", `Browser stream ticket request failed authentication: ${message}`)
  }

  if (/cert|ssl|tls|self.signed|unable to verify/i.test(message)) {
    return new TunnelUpgradeError("tls", `Browser stream ticket request failed TLS verification: ${message}`)
  }

  return new TunnelUpgradeError("ticket", `Could not obtain browser stream upgrade ticket: ${message}`)
}

function classifySocketError(error: Error): TunnelUpgradeError {
  const code = Predicate.hasProperty(error, "code") && Predicate.isString(error.code) ? error.code : ""

  if (/CERT|TLS|SSL|HOSTNAME_MISMATCH|UNABLE_TO_VERIFY|SELF_SIGNED/i.test(`${code} ${error.message}`)) {
    return new TunnelUpgradeError(
      "tls",
      `Browser stream tunnel TLS verification failed (${code || error.message}). Check the server certificate.`,
    )
  }

  return new TunnelUpgradeError("transport", `Browser stream tunnel connection failed: ${error.message}`)
}

async function waitWithAbort(promise: Promise<void>, signal: AbortSignal, timeoutMs: number) {
  if (signal.aborted) throw new Error("Browser tunnel open was cancelled.")

  let timer: ReturnType<typeof setTimeout> | undefined

  const gate = new Promise<never>((_resolve, reject) => {
    const onAbort = () => reject(new Error("Browser tunnel open was cancelled."))
    signal.addEventListener("abort", onAbort, { once: true })
    timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      reject(new Error("Browser stream tunnel timed out while connecting."))
    }, timeoutMs)
  })

  try {
    await Promise.race([promise, gate])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function openLegacyDuplex(
  transport: BrowserProxy.Transport,
  target: Browser.TunnelTarget,
  signal: AbortSignal,
): Promise<Duplex> {
  const id = await transport.open(target, signal)

  return new LegacyRpcDuplex(transport, id)
}

class LegacyRpcDuplex extends Duplex {
  readonly connecting = false
  private readonly abort = new AbortController()
  private reading = false
  private ended = false
  private idleTimer?: ReturnType<typeof setTimeout>

  constructor(
    private readonly transport: BrowserProxy.Transport,
    private readonly id: string,
  ) {
    super({ highWaterMark: Browser.TUNNEL_CHUNK_BYTES, allowHalfOpen: true })
    this.on("error", () => this.destroy())
  }

  override _read() {
    if (this.reading || this.ended || this.destroyed) return

    this.reading = true
    void this.transport.read(this.id, this.abort.signal).then(
      (result) => {
        this.reading = false

        if (this.destroyed) return

        if (result.eof) {
          this.ended = true
          this.push(null)

          return
        }

        if (this.push(result.data)) this._read()
      },
      (error: Error) => {
        this.reading = false
        this.destroy(error)
      },
    )
  }

  override _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    const data = Predicate.isString(chunk) ? Buffer.from(chunk, encoding) : chunk
    void (async () => {
      for (let offset = 0; offset < data.byteLength; offset += Browser.TUNNEL_CHUNK_BYTES) {
        await this.transport.write(
          this.id,
          data.subarray(offset, offset + Browser.TUNNEL_CHUNK_BYTES),
          false,
          this.abort.signal,
        )
      }
    })().then(
      () => callback(),
      (error: Error) => callback(error),
    )
  }

  override _final(callback: (error?: Error | null) => void) {
    void this.transport.write(this.id, new Uint8Array(), true, this.abort.signal).then(
      () => callback(),
      (error: Error) => callback(error),
    )
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = undefined
    }

    this.ended = true
    this.abort.abort()
    void this.transport
      .close(this.id)
      .catch(() => undefined)
      .then(() => callback(error))
  }

  setKeepAlive() {
    return this
  }

  setNoDelay() {
    return this
  }

  setTimeout(timeout: number, callback?: () => void) {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = undefined
    }

    if (timeout === 0) {
      if (callback) this.off("timeout", callback)

      return this
    }

    if (callback) this.once("timeout", callback)

    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined
      this.emit("timeout")
    }, timeout)
    this.idleTimer.unref?.()

    return this
  }

  ref() {
    return this
  }

  unref() {
    return this
  }
}

/**
 * The network of a server on this machine: the same one this desktop has, so pages load directly in the partition,
 * with the system's proxy settings, rather than through the server's tunnel.
 */
export function createDirectNetwork(partition: Electron.Session): BrowserNetwork {
  return {
    attach: () => () => undefined,
    icon: (url) => fetchIcon(url, partition, (_auth, callback) => callback()),
  }
}

/**
 * Resolves undefined for anything but a small image: a failure, a timeout, another content type, or more than
 * `MAX_ICON_BYTES`.
 */
function fetchIcon(
  url: string,
  partition: Electron.Session,
  login: (auth: Electron.AuthInfo, callback: (username?: string, password?: string) => void) => void,
) {
  return new Promise<{ mime: string; data: Buffer } | undefined>((resolve) => {
    // The page supplies this URL. The browser chrome must not turn an icon into a credentialed navigation.
    const request = net.request({
      url,
      session: partition,
      useSessionCookies: false,
      credentials: "omit",
      redirect: "follow",
    })

    const chunks: Buffer[] = []

    const finish = (value?: { mime: string; data: Buffer }) => {
      clearTimeout(timeout)
      resolve(value)
    }

    const fail = () => {
      request.abort()
      finish()
    }

    const timeout = setTimeout(fail, 5_000)

    request.on("login", login)
    request.on("response", (response) => {
      const header = response.headers["content-type"]
      const mime = (Array.isArray(header) ? header[0] : header)?.split(";")[0]?.trim().toLowerCase() ?? ""

      if (response.statusCode !== 200 || !mime.startsWith("image/")) return fail()

      response.on("data", (chunk) => {
        chunks.push(chunk)

        if (chunks.reduce((size, item) => size + item.length, 0) > MAX_ICON_BYTES) fail()
      })
      response.on("end", () => finish({ mime, data: Buffer.concat(chunks) }))
      response.on("error", fail)
    })
    request.on("error", fail)
    request.end()
  })
}

/** Icons larger than this are not worth reducing; sites list a favicon of a few kilobytes. */
const MAX_ICON_BYTES = 256 * 1024
