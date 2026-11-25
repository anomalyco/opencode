import { NodeHttpServerRequest } from "@effect/platform-node"
import { type WebSocket, WebSocketServer } from "@effect/platform-node-shared/NodeWS"
import { BrowserTunnelGateway } from "@opencode/core/experimental/browser-tunnel"
import { LocationLifecycle } from "@opencode/core/location-lifecycle"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import {
  BROWSER_TUNNEL_CONNECTION_HEADER,
  BROWSER_TUNNEL_PROTOCOL_HEADER,
  BROWSER_TUNNEL_PROTOCOL_VERSION,
  BROWSER_TUNNEL_SESSION_HEADER,
  BROWSER_TUNNEL_TICKET_HEADER,
} from "@opencode/protocol/groups/experimental/browser-tunnel"
import { isWebSocketUpgrade } from "@opencode/protocol/groups/machine"
import { Session } from "@opencode/schema/session"
import { Effect, Option, Schema, Scope } from "effect"
import { HttpMiddleware, type HttpServerRequest, HttpServerResponse } from "effect/http"
import { IncomingMessage } from "node:http"
import { CorsConfig, isAllowedRequestOrigin } from "../../cors"
import { locationErrors, requestRef } from "../../location"

const STOPPING = "1 second"
const CLOSING = "5 seconds"

function toUint8Array(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (Array.isArray(data)) {
    const buffers = data.map((part) => (part instanceof Uint8Array ? part : new Uint8Array(part)))
    return Buffer.concat(buffers)
  }
  return new Uint8Array()
}

function adaptWebSocket(ws: WebSocket): BrowserTunnelGateway.BinarySocket {
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
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
        ws.close(code, reason)
      }
    },
    terminate() {
      ws.terminate()
    },
    onMessage(listener) {
      const handler = (raw: unknown, isBinary: boolean) => {
        if (!isBinary) {
          listener(String(raw))
          return
        }
        listener(toUint8Array(raw))
      }
      ws.on("message", handler)
      // Resume after the mux listener is attached so frames sent immediately after 101 are never lost.
      ws.resume()
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

const upgradeSocket = (sockets: WebSocketServer, incoming: IncomingMessage) =>
  Effect.acquireRelease(
    Effect.callback<WebSocket, Error>((resume) => {
      const refused = () => resume(Effect.fail(new Error("WebSocket upgrade closed before completion.")))
      if (incoming.socket.destroyed) return refused()
      incoming.socket.once("close", refused)
      sockets.handleUpgrade(incoming, incoming.socket, Buffer.alloc(0), (ws) => {
        incoming.socket.off("close", refused)
        incoming.socket.setNoDelay(true)
        // Pause until the attachment's mux installs its message listener.
        ws.pause()
        resume(Effect.succeed(ws))
      })
    }),
    (ws) =>
      Effect.gen(function* () {
        if (ws.readyState === ws.CLOSED) return
        const gone = Effect.callback<void>((resume) => {
          if (ws.readyState === ws.CLOSED) return resume(Effect.void)
          ws.once("close", () => resume(Effect.void))
        })
        ws.close(1001, "server closing")
        if (Option.isNone(yield* Effect.timeoutOption(gone, CLOSING))) ws.terminate()
      }),
  )

/**
 * Narrow experimental upgrade route for remote desktop browser streaming.
 * Authenticates a single-use, attachment-bound ticket from `x-opencode-browser-ticket`,
 * checks origin, upgrades to a raw binary WebSocket, and hands ownership directly to the
 * live browser attachment. Never exposes a general TCP proxy API.
 */
export const makeBrowserTunnel = Effect.gen(function* () {
  const gateway = yield* BrowserTunnelGateway.Service
  const locations = yield* LocationServiceMap.Service
  const cors = yield* CorsConfig
  const scope = yield* Effect.scope

  const server = yield* Effect.cached(
    Effect.acquireRelease(
      Effect.sync(
        () =>
          new WebSocketServer({
            noServer: true,
            perMessageDeflate: false,
            maxPayload: BrowserTunnelGateway.MAX_WS_FRAME_BYTES,
          }),
      ),
      (sockets) =>
        Effect.gen(function* () {
          sockets.clients.forEach((ws) => ws.close(1012, "server stopping"))
          const empty = Effect.callback<void>((resume) => sockets.close(() => resume(Effect.void)))
          if (Option.isNone(yield* Effect.timeoutOption(empty, STOPPING))) {
            sockets.clients.forEach((ws) => ws.terminate())
          }
        }),
    ).pipe(Scope.provide(scope)),
  )

  return Effect.fn("BrowserTunnelHandler.connect")(function* (request: HttpServerRequest.HttpServerRequest) {
    if (!isAllowedRequestOrigin(request.headers.origin, request.headers.host, cors)) {
      return HttpServerResponse.empty({ status: 403 })
    }
    const incoming = NodeHttpServerRequest.toIncomingMessage(request)
    if (!(incoming instanceof IncomingMessage) || !isWebSocketUpgrade(request)) {
      return HttpServerResponse.empty({ status: 400 })
    }

    const url = new URL(request.url, "http://localhost")
    // Ticket must travel exclusively in the upgrade header, never in URLs or query strings.
    if (url.searchParams.has("ticket")) {
      return HttpServerResponse.empty({ status: 403 })
    }
    const ticket = request.headers[BROWSER_TUNNEL_TICKET_HEADER]?.trim()
    if (!ticket) {
      return HttpServerResponse.empty({ status: 403 })
    }

    const rawSession = request.headers[BROWSER_TUNNEL_SESSION_HEADER]?.trim() ?? url.searchParams.get("sessionID")?.trim()
    const connectionID =
      request.headers[BROWSER_TUNNEL_CONNECTION_HEADER]?.trim() ?? url.searchParams.get("connectionID")?.trim()
    const rawProtocol =
      request.headers[BROWSER_TUNNEL_PROTOCOL_HEADER]?.trim() ?? url.searchParams.get("protocol")?.trim()
    const protocol = rawProtocol ? Number(rawProtocol) : NaN
    const sessionID = rawSession ? Option.getOrUndefined(Schema.decodeUnknownOption(Session.ID)(rawSession)) : undefined

    if (!sessionID || !connectionID || protocol !== BROWSER_TUNNEL_PROTOCOL_VERSION) {
      return HttpServerResponse.empty({ status: 403 })
    }

    const ref = LocationServiceMap.canonical(requestRef(request))
    const binding = yield* gateway.consumeTicket({
      ticket,
      location: ref,
      sessionID,
      connectionID,
      protocol,
    })
    if (!binding) {
      return HttpServerResponse.empty({ status: 403 })
    }

    if (Option.isNone(yield* Effect.option(request.upgrade))) {
      return HttpServerResponse.empty({ status: 400 })
    }

    return yield* Effect.gen(function* () {
      const sockets = yield* server
      const ws = yield* upgradeSocket(sockets, incoming)
      yield* HttpMiddleware.withLoggerDisabled(Effect.void)
      const lifecycle = yield* LocationLifecycle.Service
      yield* lifecycle.retain
      yield* lifecycle.awaitShutdown.pipe(
        Effect.andThen(Effect.sync(() => ws.close(1012, "location shut down"))),
        Effect.forkChild,
      )
      yield* binding.onUpgrade(adaptWebSocket(ws))
      return HttpServerResponse.empty()
    }).pipe(
      Effect.scoped,
      Effect.provide(locations.get(ref)),
      locationErrors,
      Effect.orElseSucceed(() => HttpServerResponse.empty()),
    )
  })
})
