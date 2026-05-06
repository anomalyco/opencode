import { Pty } from "@/pty"
import { PtyID } from "@/pty/schema"
import { PtyTicket } from "@/pty/ticket"
import { handlePtyInput } from "@/pty/input"
import { Shell } from "@/shell/shell"
import { EffectBridge } from "@/effect/bridge"
import { CorsConfig, isAllowedRequestOrigin, type CorsOptions } from "@/server/cors"
import {
  PTY_CONNECT_TICKET_QUERY,
  PTY_CONNECT_TOKEN_HEADER,
  PTY_CONNECT_TOKEN_HEADER_VALUE,
} from "@/server/shared/pty-ticket"
import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import * as Socket from "effect/unstable/socket/Socket"
import { InstanceHttpApi } from "../api"
import * as ApiError from "../errors"
import { CursorQuery, Params, PtyPaths } from "../groups/pty"
import { WebSocketTracker } from "../websocket-tracker"

function validOrigin(request: HttpServerRequest.HttpServerRequest, opts: CorsOptions | undefined) {
  return isAllowedRequestOrigin(request.headers.origin, request.headers.host, opts)
}

export const ptyHandlers = HttpApiBuilder.group(InstanceHttpApi, "pty", (handlers) =>
  Effect.gen(function* () {
    const pty = yield* Pty.Service
    const tickets = yield* PtyTicket.Service
    const cors = yield* CorsConfig

    const shells = Effect.fn("PtyHttpApi.shells")(function* () {
      return yield* Effect.promise(() => Shell.list())
    })

    const list = Effect.fn("PtyHttpApi.list")(function* () {
      return yield* pty.list()
    })

    const create = Effect.fn("PtyHttpApi.create")(function* (ctx: { payload: typeof Pty.CreateInput.Type }) {
      return yield* pty.create({
        ...ctx.payload,
        args: ctx.payload.args ? [...ctx.payload.args] : undefined,
        env: ctx.payload.env ? { ...ctx.payload.env } : undefined,
      })
    })

    const get = Effect.fn("PtyHttpApi.get")(function* (ctx: { params: { ptyID: PtyID } }) {
      const info = yield* pty.get(ctx.params.ptyID)
      if (!info) return yield* ApiError.notFound("Session not found")
      return info
    })

    const update = Effect.fn("PtyHttpApi.update")(function* (ctx: {
      params: { ptyID: PtyID }
      payload: typeof Pty.UpdateInput.Type
    }) {
      const info = yield* pty.update(ctx.params.ptyID, {
        ...ctx.payload,
        size: ctx.payload.size ? { ...ctx.payload.size } : undefined,
      })
      if (!info) return yield* ApiError.notFound("Session not found")
      return info
    })

    const remove = Effect.fn("PtyHttpApi.remove")(function* (ctx: { params: { ptyID: PtyID } }) {
      yield* pty.remove(ctx.params.ptyID)
      return true
    })

    const connectToken = Effect.fn("PtyHttpApi.connectToken")(function* (ctx: { params: { ptyID: PtyID } }) {
      const request = yield* HttpServerRequest.HttpServerRequest
      if (request.headers[PTY_CONNECT_TOKEN_HEADER] !== PTY_CONNECT_TOKEN_HEADER_VALUE || !validOrigin(request, cors))
        return yield* new HttpApiError.Forbidden({})
      if (!(yield* pty.get(ctx.params.ptyID))) return yield* ApiError.notFound("Session not found")
      return yield* tickets.issue({ ptyID: ctx.params.ptyID, ...(yield* PtyTicket.scope) })
    })

    return handlers
      .handle("shells", shells)
      .handle("list", list)
      .handle("create", create)
      .handle("get", get)
      .handle("update", update)
      .handle("remove", remove)
      .handle("connectToken", connectToken)
  }),
)

export const ptyConnectRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const pty = yield* Pty.Service
    const tickets = yield* PtyTicket.Service
    const cors = yield* CorsConfig
    yield* router.add(
      "GET",
      PtyPaths.connect,
      Effect.gen(function* () {
        const params = yield* HttpRouter.schemaPathParams(Params)
        if (!(yield* pty.get(params.ptyID))) return HttpServerResponse.empty({ status: 404 })

        const query = yield* HttpServerRequest.schemaSearchParams(CursorQuery)
        const request = yield* HttpServerRequest.HttpServerRequest
        const ticket = new URL(request.url, "http://localhost").searchParams.get(PTY_CONNECT_TICKET_QUERY)
        if (ticket) {
          const valid = validOrigin(request, cors)
            ? yield* tickets.consume({ ticket, ptyID: params.ptyID, ...(yield* PtyTicket.scope) })
            : false
          if (!valid) return HttpServerResponse.empty({ status: 403 })
        }
        const parsedCursor = query.cursor === undefined ? undefined : Number(query.cursor)
        const cursor =
          parsedCursor !== undefined && Number.isSafeInteger(parsedCursor) && parsedCursor >= -1
            ? parsedCursor
            : undefined
        const socket = yield* Effect.orDie(request.upgrade)
        const write = yield* socket.writer
        const closeAccepted = (event: Socket.CloseEvent) =>
          socket
            .runRaw(() => Effect.void, { onOpen: write(event).pipe(Effect.catch(() => Effect.void)) })
            .pipe(
              Effect.timeout("1 second"),
              Effect.catchReason("SocketError", "SocketCloseError", () => Effect.void),
              Effect.catch(() => Effect.void),
            )
        const registered = yield* WebSocketTracker.register(write(WebSocketTracker.SERVER_CLOSING_EVENT()))
        if (!registered) {
          yield* closeAccepted(WebSocketTracker.SERVER_CLOSING_EVENT())
          return HttpServerResponse.empty()
        }
        const bridge = yield* EffectBridge.make()
        const writeScoped = (effect: Effect.Effect<void, unknown>) => {
          bridge.fork(effect.pipe(Effect.catch(() => Effect.void)))
        }
        let closed = false
        const adapter = {
          get readyState() {
            return closed ? 3 : 1
          },
          send: (data: string | Uint8Array | ArrayBuffer) => {
            if (closed) return
            writeScoped(write(data instanceof ArrayBuffer ? new Uint8Array(data) : data))
          },
          close: (code?: number, reason?: string) => {
            if (closed) return
            closed = true
            writeScoped(write(new Socket.CloseEvent(code, reason)))
          },
        }
        const handler = yield* pty.connect(params.ptyID, adapter, cursor)
        if (!handler) {
          yield* closeAccepted(new Socket.CloseEvent(4404, "session not found"))
          return HttpServerResponse.empty()
        }

        yield* socket
          .runRaw((message) => handlePtyInput(handler, message))
          .pipe(
            Effect.catchReason("SocketError", "SocketCloseError", () => Effect.void),
            Effect.ensuring(
              Effect.sync(() => {
                closed = true
                handler.onClose()
              }),
            ),
            Effect.orDie,
          )
        return HttpServerResponse.empty()
      }),
    )
  }),
)
