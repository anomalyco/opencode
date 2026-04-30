import { Pty } from "@/pty"
import { PtyID } from "@/pty/schema"
import { handlePtyInput } from "@/pty/input"
import { Shell } from "@/shell/shell"
import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import * as Socket from "effect/unstable/socket/Socket"
import { InstanceHttpApi } from "../api"
import { CursorQuery, Params, PtyPaths } from "../groups/pty"

export const ptyHandlers = HttpApiBuilder.group(InstanceHttpApi, "pty", (handlers) =>
  Effect.gen(function* () {
    const pty = yield* Pty.Service

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
      if (!info) return yield* new HttpApiError.NotFound({})
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
      if (!info) return yield* new HttpApiError.NotFound({})
      return info
    })

    const remove = Effect.fn("PtyHttpApi.remove")(function* (ctx: { params: { ptyID: PtyID } }) {
      yield* pty.remove(ctx.params.ptyID)
      return true
    })

    return handlers
      .handle("shells", shells)
      .handle("list", list)
      .handle("create", create)
      .handle("get", get)
      .handle("update", update)
      .handle("remove", remove)
  }),
)

export const ptyConnectRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const pty = yield* Pty.Service
    yield* router.add(
      "GET",
      PtyPaths.connect,
      Effect.gen(function* () {
        const params = yield* HttpRouter.schemaPathParams(Params)
        if (!(yield* pty.get(params.ptyID))) return HttpServerResponse.empty({ status: 404 })

        const query = yield* HttpServerRequest.schemaSearchParams(CursorQuery)
        const parsedCursor = query.cursor === undefined ? undefined : Number(query.cursor)
        const cursor =
          parsedCursor !== undefined && Number.isSafeInteger(parsedCursor) && parsedCursor >= -1
            ? parsedCursor
            : undefined
        const socket = yield* Effect.orDie((yield* HttpServerRequest.HttpServerRequest).upgrade)
        const write = yield* socket.writer
        const services = yield* Effect.context()
        const writeScoped = (effect: Effect.Effect<void, unknown>) => {
          Effect.runForkWith(services)(effect.pipe(Effect.catch(() => Effect.void)))
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
        if (!handler) return HttpServerResponse.empty()

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
