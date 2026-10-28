import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Mcp } from "@opencode/core/mcp/index"
import { PtyTicket } from "@opencode/core/pty/ticket"
import { ForbiddenError, McpServerNotFoundError } from "@opencode/protocol/errors"
import { PTY_CONNECT_TOKEN_HEADER, PTY_CONNECT_TOKEN_HEADER_VALUE } from "@opencode/protocol/groups/pty"
import { Effect, Queue } from "effect"
import { HttpServerResponse } from "effect/http"
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api"
import { Socket } from "effect/socket"
import { Api } from "../api"
import { CorsConfig, isAllowedRequestOrigin } from "../cors"
import { locationErrors, requestRef, response } from "../location"
import { type Outbound, runPtySocket } from "./pty-socket"

const notFound = <A, R>(effect: Effect.Effect<A, Mcp.NotFoundError, R>) =>
  effect.pipe(Effect.mapError((error) => new McpServerNotFoundError({ server: error.server, message: error.message })))

export const McpHandler = HttpApiBuilder.group(Api, "server.mcp", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    const cors = yield* CorsConfig
    const tickets = yield* PtyTicket.Service

    return handlers
      .handle(
        "mcp.list",
        Effect.fn(function* () {
          const service = yield* Mcp.Service
          return yield* response(service.servers())
        }),
      )
      .handle(
        "mcp.add",
        Effect.fn(function* (ctx) {
          const service = yield* Mcp.Service
          yield* service.add(ctx.params.server, ctx.payload.config)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "mcp.remove",
        Effect.fn(function* (ctx) {
          const service = yield* Mcp.Service
          yield* notFound(service.remove(ctx.params.server))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "mcp.connect",
        Effect.fn(function* (ctx) {
          const service = yield* Mcp.Service
          yield* notFound(service.connect(ctx.params.server))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "mcp.disconnect",
        Effect.fn(function* (ctx) {
          const service = yield* Mcp.Service
          yield* notFound(service.disconnect(ctx.params.server))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "mcp.resource.catalog",
        Effect.fn(function* () {
          const service = yield* Mcp.Service
          return yield* response(service.resourceCatalog())
        }),
      )
      .handle(
        "mcp.clientToken",
        Effect.fn(function* (ctx) {
          // The custom header forces a CORS preflight, so cross-origin pages cannot mint tickets.
          if (
            ctx.headers[PTY_CONNECT_TOKEN_HEADER] !== PTY_CONNECT_TOKEN_HEADER_VALUE ||
            !isAllowedRequestOrigin(ctx.request.headers.origin, ctx.request.headers.host, cors)
          )
            return yield* new ForbiddenError({ message: "Invalid client MCP connect token request" })
          const location = yield* Location.Service
          return yield* response(
            tickets.issue({
              mcpClient: ctx.query.name,
              directory: location.directory,
              workspaceID: location.workspaceID,
            }),
          )
        }),
      )
      .handleRaw(
        "mcp.client",
        Effect.fn("McpHandler.client")(function* (ctx) {
          if (!isAllowedRequestOrigin(ctx.request.headers.origin, ctx.request.headers.host, cors))
            return HttpServerResponse.empty({ status: 403 })

          const name = ctx.query.name
          const ref = LocationServiceMap.canonical(requestRef(ctx.request))
          if (
            ctx.query.ticket &&
            !(yield* tickets.consume({
              ticket: ctx.query.ticket,
              mcpClient: name,
              directory: ref.directory,
              workspaceID: ref.workspaceID,
            }))
          )
            return HttpServerResponse.empty({ status: 403 })

          return yield* Effect.gen(function* () {
            const mcp = yield* Mcp.Service
            const { McpSocketClient } = yield* Effect.promise(() => import("@opencode/core/mcp/socket-client"))
            const socket = yield* Effect.orDie(ctx.request.upgrade)
            const outbox = yield* Queue.unbounded<Outbound>()
            const state = { attached: false, disconnected: false }
            const transport = McpSocketClient.make({
              send: (text) => Queue.offerUnsafe(outbox, text),
              // A failed attach closes the transport before reporting the error; ignore that close so the
              // socket closes with 1011 below instead of a normal 1000.
              close: (code, reason) => {
                if (state.attached) Queue.offerUnsafe(outbox, new Socket.CloseEvent(code, reason))
              },
            })
            const decoder = new TextDecoder()
            // The attachment lives in this scope, so it ends with the socket.
            yield* mcp.attach(name, transport).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  state.attached = true
                }),
              ),
              Effect.catch((error) =>
                state.disconnected
                  ? Effect.logInfo("client MCP disconnected during initialize", { name, error: error.message })
                  : Effect.logError("client MCP attach failed", { name, error: error.message }).pipe(
                      Effect.andThen(
                        Effect.sync(() => Queue.offerUnsafe(outbox, new Socket.CloseEvent(1011, "attach failed"))),
                      ),
                    ),
              ),
              Effect.forkScoped,
            )
            yield* runPtySocket({
              socket,
              outbox,
              // Frames should be text, but binary frames are accepted and decoded as UTF-8.
              onMessage: (message) =>
                Effect.sync(() => transport.deliver(typeof message === "string" ? message : decoder.decode(message))),
              detach: () => {
                state.disconnected = true
                transport.ended()
              },
            })
            return HttpServerResponse.empty()
          }).pipe(Effect.scoped, Effect.provide(locations.get(ref)), locationErrors)
        }),
      )
  }),
)
