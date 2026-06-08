import * as InstanceState from "@/effect/instance-state"
import { registerDisposer } from "@/effect/instance-registry"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { PtyPreparation } from "@/pty-preparation"
import { Pty } from "@opencode-ai/core/pty"
import { handlePtyInput } from "@opencode-ai/core/pty/input"
import { PtyID } from "@opencode-ai/core/pty/schema"
import { PtyTicket } from "@opencode-ai/core/pty/ticket"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Shell } from "@/shell/shell"
import { EffectBridge } from "@/effect/bridge"
import { CorsConfig, isAllowedRequestOrigin, type CorsOptions } from "@/server/cors"
import {
  PTY_CONNECT_TICKET_QUERY,
  PTY_CONNECT_TOKEN_HEADER,
  PTY_CONNECT_TOKEN_HEADER_VALUE,
} from "@/server/shared/pty-ticket"
import { Effect, Layer, Option, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Socket from "effect/unstable/socket/Socket"
import { InstanceHttpApi } from "../api"
import * as ApiError from "../errors"
import { CursorQuery, PtyConnectApi } from "../groups/pty"
import { WebSocketTracker } from "../websocket-tracker"

function validOrigin(request: HttpServerRequest.HttpServerRequest, opts: CorsOptions | undefined) {
  return isAllowedRequestOrigin(request.headers.origin, request.headers.host, opts)
}

const ticketScope = Effect.gen(function* () {
  const instance = yield* InstanceRef
  const workspaceID = yield* WorkspaceRef
  return { directory: instance?.directory, workspaceID }
})

export const ptyHandlers = HttpApiBuilder.group(InstanceHttpApi, "pty", (handlers) =>
  Effect.gen(function* () {
    const tickets = yield* PtyTicket.Service
    const cors = yield* CorsConfig
    const locations = yield* LocationServiceMap
    const unregister = registerDisposer((directory) =>
      Effect.runPromise(locations.invalidate({ directory: AbsolutePath.make(directory) })),
    )
    yield* Effect.addFinalizer(() => Effect.sync(unregister))

    const pty = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
      return yield* effect.pipe(
        Effect.provide(locations.get({ directory: AbsolutePath.make((yield* InstanceState.context).directory) })),
      )
    })

    const shells = Effect.fn("PtyHttpApi.shells")(function* () {
      return yield* Effect.promise(() => Shell.list())
    })

    const list = Effect.fn("PtyHttpApi.list")(function* () {
      return yield* pty(Pty.Service.use((service) => service.list()))
    })

    const create = Effect.fn("PtyHttpApi.create")(function* (ctx: { payload: typeof Pty.CreateInput.Type }) {
      return yield* pty(
        Pty.Service.use((service) =>
          Effect.flatMap(
            PtyPreparation.prepareCreate({
              ...ctx.payload,
              args: ctx.payload.args ? [...ctx.payload.args] : undefined,
              env: ctx.payload.env ? { ...ctx.payload.env } : undefined,
            }),
            service.create,
          ),
        ),
      )
    })

    const get = Effect.fn("PtyHttpApi.get")(function* (ctx: { params: { ptyID: PtyID } }) {
      return yield* pty(Pty.Service.use((service) => service.get(ctx.params.ptyID))).pipe(
        Effect.catchTag("Pty.NotFoundError", (error) =>
          Effect.fail(
            new ApiError.PtyNotFoundError({
              ptyID: error.ptyID,
              message: `PTY session not found: ${error.ptyID}`,
            }),
          ),
        ),
      )
    })

    const update = Effect.fn("PtyHttpApi.update")(function* (ctx: {
      params: { ptyID: PtyID }
      payload: typeof Pty.UpdateInput.Type
    }) {
      return yield* pty(
        Pty.Service.use((service) =>
          service.update(ctx.params.ptyID, {
            ...ctx.payload,
            size: ctx.payload.size ? { ...ctx.payload.size } : undefined,
          }),
        ),
      ).pipe(
        Effect.catchTag("Pty.NotFoundError", (error) =>
          Effect.fail(
            new ApiError.PtyNotFoundError({
              ptyID: error.ptyID,
              message: `PTY session not found: ${error.ptyID}`,
            }),
          ),
        ),
      )
    })

    const remove = Effect.fn("PtyHttpApi.remove")(function* (ctx: { params: { ptyID: PtyID } }) {
      yield* pty(Pty.Service.use((service) => service.remove(ctx.params.ptyID))).pipe(
        Effect.catchTag("Pty.NotFoundError", (error) =>
          Effect.fail(
            new ApiError.PtyNotFoundError({
              ptyID: error.ptyID,
              message: `PTY session not found: ${error.ptyID}`,
            }),
          ),
        ),
      )
      return true
    })

    const connectToken = Effect.fn("PtyHttpApi.connectToken")(function* (ctx: { params: { ptyID: PtyID } }) {
      const request = yield* HttpServerRequest.HttpServerRequest
      if (request.headers[PTY_CONNECT_TOKEN_HEADER] !== PTY_CONNECT_TOKEN_HEADER_VALUE || !validOrigin(request, cors))
        return yield* new ApiError.PtyForbiddenError({ message: "Invalid PTY connect token request" })
      yield* pty(Pty.Service.use((service) => service.get(ctx.params.ptyID))).pipe(
        Effect.catchTag("Pty.NotFoundError", (error) =>
          Effect.fail(
            new ApiError.PtyNotFoundError({
              ptyID: error.ptyID,
              message: `PTY session not found: ${error.ptyID}`,
            }),
          ),
        ),
      )
      return yield* tickets.issue({ ptyID: ctx.params.ptyID, ...(yield* ticketScope) })
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
).pipe(Layer.provide(LocationServiceMap.layer))

export const ptyConnectHandlers = HttpApiBuilder.group(PtyConnectApi, "pty-connect", (handlers) =>
  Effect.gen(function* () {
    const tickets = yield* PtyTicket.Service
    const cors = yield* CorsConfig
    const locations = yield* LocationServiceMap
    const unregister = registerDisposer((directory) =>
      Effect.runPromise(locations.invalidate({ directory: AbsolutePath.make(directory) })),
    )
    yield* Effect.addFinalizer(() => Effect.sync(unregister))

    const pty = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
      return yield* effect.pipe(
        Effect.provide(locations.get({ directory: AbsolutePath.make((yield* InstanceState.context).directory) })),
      )
    })

    return handlers.handleRaw(
      "connect",
      Effect.fn("PtyHttpApi.connect")(function* (ctx: {
        params: { ptyID: PtyID }
        request: HttpServerRequest.HttpServerRequest
      }) {
        const exists = yield* pty(Pty.Service.use((service) => service.get(ctx.params.ptyID))).pipe(
          Effect.as(true),
          Effect.catchTag("Pty.NotFoundError", () => Effect.succeed(false)),
        )
        if (!exists) return HttpServerResponse.empty({ status: 404 })

        const query = Schema.decodeUnknownOption(CursorQuery)(yield* HttpServerRequest.ParsedSearchParams)
        if (Option.isNone(query)) return HttpServerResponse.empty({ status: 400 })
        const ticket = new URL(ctx.request.url, "http://localhost").searchParams.get(PTY_CONNECT_TICKET_QUERY)
        if (ticket) {
          const valid = validOrigin(ctx.request, cors)
            ? yield* tickets.consume({ ticket, ptyID: ctx.params.ptyID, ...(yield* ticketScope) })
            : false
          if (!valid) return HttpServerResponse.empty({ status: 403 })
        }
        const parsedCursor = query.value.cursor === undefined ? undefined : Number(query.value.cursor)
        const cursor =
          parsedCursor !== undefined && Number.isSafeInteger(parsedCursor) && parsedCursor >= -1
            ? parsedCursor
            : undefined
        const socket = yield* Effect.orDie(ctx.request.upgrade)
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
        const handler = yield* pty(
          Pty.Service.use((service) => service.connect(ctx.params.ptyID, adapter, cursor)),
        ).pipe(
          Effect.catchTag("Pty.NotFoundError", () =>
            closeAccepted(new Socket.CloseEvent(4404, "session not found")).pipe(Effect.as(undefined)),
          ),
        )
        if (!handler) return HttpServerResponse.empty()

        // The handshake runs inside `socket.runRaw`, after the input callback is
        // registered, so the client cannot send frames before PTY input is wired.
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
).pipe(Layer.provide(LocationServiceMap.layer))
