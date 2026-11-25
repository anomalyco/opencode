import { WebSocket as NodeWebSocket } from "@effect/platform-node/NodeWS"
import type { ServerEndpoint } from "@opencode/plugin/gui/main"
import type { Session } from "@opencode/schema/session"
import { BrowserTunnelHost, StreamWire } from "@opencode/plugin-browser/experimental/stream"
import { Predicate } from "effect"

export const TUNNEL_TICKET_HEADER = "x-opencode-browser-ticket"

export const TUNNEL_SESSION_HEADER = "x-opencode-browser-session"

export const TUNNEL_CONNECTION_HEADER = "x-opencode-browser-connection"

export const TUNNEL_PROTOCOL_HEADER = "x-opencode-browser-protocol"

export const TUNNEL_PROTOCOL_VERSION = 1 as const

export const PREWARM_WAIT_TIMEOUT_MS = 15_000

export type TunnelUpgradeFailureKind = "auth" | "tls" | "blocked" | "protocol" | "ticket" | "transport"

/**
 * Explicit non-downgrading failure raised when a server advertises binary stream tunneling
 * (`tunnel.ws.v1`) and the WebSocket upgrade is rejected, blocked, or fails TLS/auth/route checks.
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

/**
 * Derives the binary WebSocket upgrade URL solely from the configured server endpoint using the
 * same base-path prefix joining rules as the authenticated HTTP SDK (`HttpClientRequest.prependUrl`).
 * Validates any reply `path` strictly against the fixed experimental route so a malformed or
 * mismatched plugin reply can never steer endpoint credentials to another authority or path.
 */
export function resolveBrowserTunnelUrl(input: {
  readonly serverUrl: string
  readonly location: { readonly directory: string; readonly workspace?: string }
  readonly replyPath?: string
}): URL {
  if (input.replyPath !== undefined && input.replyPath !== BrowserTunnelHost.BROWSER_TUNNEL_PATH) {
    throw new TunnelUpgradeError(
      "protocol",
      `Refused unexpected browser tunnel upgrade path: ${input.replyPath.slice(0, 128)}`,
    )
  }

  const base = URL.parse(input.serverUrl)

  if (!base || (base.protocol !== "http:" && base.protocol !== "https:")) {
    throw new TunnelUpgradeError(
      "protocol",
      `Unsupported server URL protocol for browser tunnel: ${base?.protocol ?? "invalid"}`,
    )
  }

  if (base.username || base.password) {
    throw new TunnelUpgradeError("protocol", "Configured browser tunnel server URL must not contain credentials.")
  }

  const prefix = base.pathname.replace(/\/+$/, "")
  const expectedPathname = `${prefix}${BrowserTunnelHost.BROWSER_TUNNEL_PATH}`
  const wsUrl = new URL(expectedPathname, base.origin)
  const expectedProtocol = base.protocol === "https:" ? "wss:" : "ws:"
  wsUrl.protocol = expectedProtocol

  if (
    wsUrl.protocol !== expectedProtocol ||
    wsUrl.host !== base.host ||
    wsUrl.pathname !== expectedPathname ||
    wsUrl.username !== "" ||
    wsUrl.password !== ""
  ) {
    throw new TunnelUpgradeError("protocol", "Derived browser tunnel upgrade URL did not match configured server authority.")
  }

  wsUrl.searchParams.set("location[directory]", input.location.directory)

  if (input.location.workspace) wsUrl.searchParams.set("location[workspace]", input.location.workspace)

  return wsUrl
}

/**
 * Opens one authenticated binary WebSocket in Electron main using a short-lived single-use ticket
 * in the `x-opencode-browser-ticket` header. Verified TLS is strictly enforced and redirects are rejected.
 */
export async function openAuthenticatedWebSocket(input: {
  readonly server: ServerEndpoint
  readonly location: { readonly directory: string; readonly workspace?: string }
  readonly attachment: { readonly sessionID: Session.ID; readonly connectionID: string }
  readonly ticket: string
  readonly path?: string
  readonly protocol: number
}): Promise<BrowserTunnelHost.BinarySocket> {
  // Validate reply path and derive URL strictly from the configured endpoint BEFORE touching credentials or sockets.
  const wsUrl = resolveBrowserTunnelUrl({
    serverUrl: input.server.url,
    location: input.location,
    replyPath: input.path,
  })

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
