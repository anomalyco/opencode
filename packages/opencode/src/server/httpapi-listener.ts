// TODO: Node adapter forthcoming — same pattern but using `node:http` + `ws` library,
// and `node:http`'s `upgrade` event.
//
// This module is a Bun-only proof-of-concept for a native `Bun.serve` listener that
// drives the experimental HttpApi handler directly (no Hono in the middle) and handles
// WebSocket upgrades inline based on path-matching. It exists to validate the pattern
// before deleting the Hono backend; `Server.listen()` is intentionally NOT wired to it.

import type { ServerWebSocket } from "bun"
import { Effect, Schema } from "effect"
import { AppRuntime } from "@/effect/app-runtime"
import { WithInstance } from "@/project/with-instance"
import { Pty } from "@/pty"
import { handlePtyInput } from "@/pty/input"
import { PtyID } from "@/pty/schema"
import { PtyPaths } from "@/server/routes/instance/httpapi/groups/pty"
import { ExperimentalHttpApiServer } from "@/server/routes/instance/httpapi/server"
import * as Log from "@opencode-ai/core/util/log"
import type { CorsOptions } from "./cors"

const log = Log.create({ service: "httpapi-listener" })
const decodePtyID = Schema.decodeUnknownSync(PtyID)

export type Listener = {
  hostname: string
  port: number
  url: URL
  stop: (close?: boolean) => Promise<void>
}

export type ListenOptions = CorsOptions & {
  port: number
  hostname: string
}

type WsKind = { kind: "pty"; ptyID: string; cursor: number | undefined; directory: string }

type PtyHandler = {
  onMessage: (message: string | ArrayBuffer) => void
  onClose: () => void
}

type WsState = WsKind & {
  handler?: PtyHandler
  pending: Array<string | Uint8Array>
  ready: boolean
  closed: boolean
}

// Derive from the OpenAPI path so this stays in sync if the route literal moves.
const ptyConnectPattern = new RegExp(`^${PtyPaths.connect.replace(/:[^/]+/g, "([^/]+)")}$`)

function parseCursor(value: string | null): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < -1) return undefined
  return parsed
}

function asAdapter(ws: ServerWebSocket<WsState>) {
  return {
    get readyState() {
      return ws.readyState
    },
    send: (data: string | Uint8Array | ArrayBuffer) => {
      try {
        if (data instanceof ArrayBuffer) ws.send(new Uint8Array(data))
        else ws.send(data)
      } catch {
        // socket likely already closed; ignore
      }
    },
    close: (code?: number, reason?: string) => {
      try {
        ws.close(code, reason)
      } catch {
        // ignore
      }
    },
  }
}

/**
 * Spin up a native Bun.serve that:
 *   1. Routes all HTTP traffic through the HttpApi web handler.
 *   2. Intercepts known WebSocket upgrade paths and handles them inline.
 *
 * This bypasses Hono entirely. The Hono code path remains untouched.
 */
export async function listen(opts: ListenOptions): Promise<Listener> {
  const built = ExperimentalHttpApiServer.webHandler(opts)
  const handler = built.handler
  const context = ExperimentalHttpApiServer.context

  const start = (port: number) => {
    try {
      return Bun.serve<WsState>({
        hostname: opts.hostname,
        port,
        idleTimeout: 0,
        fetch(request, server) {
          const url = new URL(request.url)
          const ptyMatch = url.pathname.match(ptyConnectPattern)
          if (ptyMatch && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
            const ptyID = ptyMatch[1]!
            const cursor = parseCursor(url.searchParams.get("cursor"))
            // Resolve the instance directory the same way the HttpApi
            // `instance-context` middleware does (search params, then header,
            // then process.cwd()).
            const directory =
              url.searchParams.get("directory") ?? request.headers.get("x-opencode-directory") ?? process.cwd()
            const upgraded = server.upgrade(request, {
              data: {
                kind: "pty",
                ptyID,
                cursor,
                directory,
                pending: [],
                ready: false,
                closed: false,
              } satisfies WsState,
            })
            if (upgraded) return undefined
            return new Response("upgrade failed", { status: 400 })
          }

          // TODO: workspace-proxy WS upgrade detection. The Hono path forwards via a
          // remote `new WebSocket(url, ...)` (see ServerProxy.websocket). To support
          // that here we'd need to (a) resolve the workspace target the same way
          // `WorkspaceRouterMiddleware` does today, then (b) `server.upgrade(request,
          // { data: { kind: "proxy", target, headers, protocols } })` and bridge the
          // ServerWebSocket to a remote WebSocket inside the `websocket` handlers.
          // Deferred to a follow-up — the proxy story needs more design (auth header
          // forwarding, fence sync, reconnection semantics) than fits this PR.

          return handler(request as Request, context as never)
        },
        websocket: {
          open(ws) {
            const data = ws.data
            if (data.kind !== "pty") {
              ws.close(1011, "unknown ws kind")
              return
            }
            const id = (() => {
              try {
                return decodePtyID(data.ptyID)
              } catch {
                ws.close(1008, "invalid pty id")
                return undefined
              }
            })()
            if (!id) return
            ;(async () => {
              const result = await WithInstance.provide({
                directory: data.directory,
                fn: () =>
                  AppRuntime.runPromise(
                    Effect.gen(function* () {
                      const pty = yield* Pty.Service
                      return yield* pty.connect(id, asAdapter(ws), data.cursor)
                    }).pipe(Effect.withSpan("HttpApiListener.pty.connect.open")),
                  ),
              })
              return await result
            })()
              .then((handler) => {
                if (data.closed) {
                  handler?.onClose()
                  return
                }
                if (!handler) {
                  ws.close(4404, "session not found")
                  return
                }
                data.handler = handler
                data.ready = true
                for (const msg of data.pending) {
                  AppRuntime.runPromise(handlePtyInput(handler, msg)).catch(() => undefined)
                }
                data.pending.length = 0
              })
              .catch((err) => {
                log.error("pty connect failed", { error: err })
                ws.close(1011, "pty connect failed")
              })
          },
          message(ws, message) {
            const data = ws.data
            if (data.kind !== "pty") return
            const payload =
              typeof message === "string"
                ? message
                : message instanceof Buffer
                  ? new Uint8Array(message.buffer, message.byteOffset, message.byteLength)
                  : (message as Uint8Array)
            if (!data.ready || !data.handler) {
              data.pending.push(payload)
              return
            }
            AppRuntime.runPromise(handlePtyInput(data.handler, payload)).catch(() => undefined)
          },
          close(ws) {
            const data = ws.data
            data.closed = true
            data.handler?.onClose()
          },
        },
      })
    } catch (err) {
      log.error("Bun.serve failed", { error: err })
      return undefined
    }
  }

  const server = opts.port === 0 ? (start(4096) ?? start(0)) : start(opts.port)
  if (!server) throw new Error(`Failed to start server on port ${opts.port}`)
  const port = server.port
  if (port === undefined) throw new Error("Bun.serve started without a numeric port")

  const url = new URL("http://localhost")
  url.hostname = opts.hostname
  url.port = String(port)

  let closing: Promise<void> | undefined
  return {
    hostname: opts.hostname,
    port,
    url,
    stop(close?: boolean) {
      closing ??= (async () => {
        await server.stop(close)
        // NOTE: we deliberately do NOT call `built.dispose()` here. The
        // underlying `webHandler` is memoized at module level (same as the
        // Hono path), so disposing it would tear down shared services for
        // every other consumer in the process. Lifecycle teardown is owned
        // by the AppRuntime itself.
      })()
      return closing
    },
  }
}

export * as HttpApiListener from "./httpapi-listener"
