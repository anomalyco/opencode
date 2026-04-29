import { EffectBridge } from "@/effect/bridge"
import { Pty } from "@/pty"
import { PtyID } from "@/pty/schema"
import { Shell } from "@/shell/shell"
import { Effect, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import * as Socket from "effect/unstable/socket/Socket"
import { Authorization } from "./auth"

const root = "/pty"
const Params = Schema.Struct({
  ptyID: PtyID,
})
const CursorQuery = Schema.Struct({
  cursor: Schema.optional(Schema.String),
})
const ShellItem = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  acceptable: Schema.Boolean,
})

export const PtyPaths = {
  shells: `${root}/shells`,
  list: root,
  create: root,
  get: `${root}/:ptyID`,
  update: `${root}/:ptyID`,
  remove: `${root}/:ptyID`,
  connect: `${root}/:ptyID/connect`,
} as const

export const PtyApi = HttpApi.make("pty")
  .add(
    HttpApiGroup.make("pty")
      .add(
        HttpApiEndpoint.get("shells", PtyPaths.shells, {
          success: Schema.Array(ShellItem),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "pty.shells",
            summary: "List available shells",
            description: "Get a list of available shells on the system.",
          }),
        ),
        HttpApiEndpoint.get("list", PtyPaths.list, {
          success: Schema.Array(Pty.Info),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "pty.list",
            summary: "List PTY sessions",
            description: "Get a list of all active pseudo-terminal (PTY) sessions managed by OpenCode.",
          }),
        ),
        HttpApiEndpoint.post("create", PtyPaths.create, {
          payload: Pty.CreateInput,
          success: Pty.Info,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "pty.create",
            summary: "Create PTY session",
            description: "Create a new pseudo-terminal (PTY) session for running shell commands and processes.",
          }),
        ),
        HttpApiEndpoint.get("get", PtyPaths.get, {
          params: { ptyID: PtyID },
          success: Pty.Info,
          error: HttpApiError.NotFound,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "pty.get",
            summary: "Get PTY session",
            description: "Retrieve detailed information about a specific pseudo-terminal (PTY) session.",
          }),
        ),
        HttpApiEndpoint.put("update", PtyPaths.update, {
          params: { ptyID: PtyID },
          payload: Pty.UpdateInput,
          success: Pty.Info,
          error: HttpApiError.NotFound,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "pty.update",
            summary: "Update PTY session",
            description: "Update properties of an existing pseudo-terminal (PTY) session.",
          }),
        ),
        HttpApiEndpoint.delete("remove", PtyPaths.remove, {
          params: { ptyID: PtyID },
          success: Schema.Boolean,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "pty.remove",
            summary: "Remove PTY session",
            description: "Remove and terminate a specific pseudo-terminal (PTY) session.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "pty",
          description: "Experimental HttpApi PTY routes.",
        }),
      )
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )

export const PtyConnectApi = HttpApi.make("pty-connect").add(
  HttpApiGroup.make("pty-connect")
    .add(
      HttpApiEndpoint.get("connect", PtyPaths.connect, {
        params: Params,
        success: Schema.Boolean,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "pty.connect",
          summary: "Connect to PTY session",
          description:
            "Establish a WebSocket connection to interact with a pseudo-terminal (PTY) session in real-time.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "pty", description: "PTY websocket route." })),
)

export const ptyHandlers = HttpApiBuilder.group(PtyApi, "pty", (handlers) =>
  Effect.gen(function* () {
    const pty = yield* Pty.Service

    const shells = Effect.fn("PtyHttpApi.shells")(function* () {
      return yield* Effect.promise(() => Shell.list())
    })

    const list = Effect.fn("PtyHttpApi.list")(function* () {
      return yield* pty.list()
    })

    const create = Effect.fn("PtyHttpApi.create")(function* (ctx: { payload: typeof Pty.CreateInput.Type }) {
      const bridge = yield* EffectBridge.make()
      return yield* Effect.promise(() =>
        bridge.promise(
          pty.create({
            ...ctx.payload,
            args: ctx.payload.args ? [...ctx.payload.args] : undefined,
            env: ctx.payload.env ? { ...ctx.payload.env } : undefined,
          }),
        ),
      )
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

export const ptyConnectRoute = HttpRouter.add(
  "GET",
  PtyPaths.connect,
  Effect.gen(function* () {
    const pty = yield* Pty.Service
    const params = yield* HttpRouter.schemaPathParams(Params)
    if (!(yield* pty.get(params.ptyID))) return HttpServerResponse.empty({ status: 404 })

    const query = yield* HttpServerRequest.schemaSearchParams(CursorQuery)
    const parsedCursor = query.cursor === undefined ? undefined : Number(query.cursor)
    const cursor =
      parsedCursor !== undefined && Number.isSafeInteger(parsedCursor) && parsedCursor >= -1 ? parsedCursor : undefined
    const socket = yield* Effect.orDie((yield* HttpServerRequest.HttpServerRequest).upgrade)
    const write = yield* socket.writer
    let closed = false
    const adapter = {
      get readyState() {
        return closed ? 3 : 1
      },
      send: (data: string | Uint8Array | ArrayBuffer) => {
        if (closed) return
        Effect.runFork(
          write(data instanceof ArrayBuffer ? new Uint8Array(data) : data).pipe(Effect.catch(() => Effect.void)),
        )
      },
      close: (code?: number, reason?: string) => {
        if (closed) return
        closed = true
        Effect.runFork(write(new Socket.CloseEvent(code, reason)).pipe(Effect.catch(() => Effect.void)))
      },
    }
    const handler = yield* pty.connect(params.ptyID, adapter, cursor)
    if (!handler) return HttpServerResponse.empty()

    yield* socket
      .runRaw((message) => {
        handler.onMessage(typeof message === "string" ? message : message.slice().buffer)
      })
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
  }).pipe(Effect.provide(Pty.defaultLayer)),
)
