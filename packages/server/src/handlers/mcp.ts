import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Mcp } from "@opencode/core/mcp/index"
import { SessionStore } from "@opencode/core/session/store"
import type { Session } from "@opencode/schema/session"
import { PtyTicket } from "@opencode/core/pty/ticket"
import { ForbiddenError, McpServerNotFoundError, SessionNotFoundError } from "@opencode/protocol/errors"
import { PTY_CONNECT_TOKEN_HEADER, PTY_CONNECT_TOKEN_HEADER_VALUE } from "@opencode/protocol/groups/pty"
import { Effect, Queue } from "effect"
import { type HttpServerRequest, HttpServerResponse } from "effect/http"
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api"
import { Socket } from "effect/socket"
import { Api } from "../api"
import { CorsConfig, isAllowedRequestOrigin } from "../cors"
import { locationErrors, requestRef, response } from "../location"
import { holdLocation, type Outbound, runPtySocket } from "./pty-socket"

const notFound = <A, R>(effect: Effect.Effect<A, Mcp.NotFoundError, R>) =>
  effect.pipe(Effect.mapError((error) => new McpServerNotFoundError({ server: error.server, message: error.message })))

export const McpHandler = HttpApiBuilder.group(Api, "server.mcp", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    const cors = yield* CorsConfig
    const tickets = yield* PtyTicket.Service

    const store = yield* SessionStore.Service
    const owned = (sessionID: Session.ID) =>
      Effect.fnUntraced(function* (ref: Location.Ref) {
        const session = yield* store.get(sessionID)
        if (
          !session ||
          session.location.directory !== ref.directory ||
          session.location.workspaceID !== ref.workspaceID
        )
          return yield* new SessionNotFoundError({
            sessionID,
            message: `Session not found at this location: ${sessionID}`,
          })
      })

    const token = Effect.fnUntraced(function* <E>(
      request: HttpServerRequest.HttpServerRequest,
      name: string,
      owner: Session.ID | undefined,
      guard: (ref: Location.Ref) => Effect.Effect<void, E>,
    ) {
      // The custom header forces a CORS preflight, so cross-origin pages cannot mint tickets.
      if (
        request.headers[PTY_CONNECT_TOKEN_HEADER] !== PTY_CONNECT_TOKEN_HEADER_VALUE ||
        !isAllowedRequestOrigin(request.headers.origin, request.headers.host, cors)
      )
        return yield* new ForbiddenError({ message: "Invalid client MCP connect token request" })
      const location = yield* Location.Service
      yield* guard(location)
      return yield* response(
        tickets.issue({
          mcpClient: name,
          sessionID: owner,
          directory: location.directory,
          workspaceID: location.workspaceID,
        }),
      )
    })
    const socket = Effect.fnUntraced(function* <E>(
      request: HttpServerRequest.HttpServerRequest,
      { name, ticket }: { name: string; ticket?: string },
      owner: Session.ID | undefined,
      guard: (ref: Location.Ref) => Effect.Effect<void, E>,
    ) {
      if (!isAllowedRequestOrigin(request.headers.origin, request.headers.host, cors))
        return HttpServerResponse.empty({ status: 403 })

      const ref = LocationServiceMap.canonical(requestRef(request))
      if (
        ticket &&
        !(yield* tickets.consume({
          ticket: ticket,
          mcpClient: name,
          sessionID: owner,
          directory: ref.directory,
          workspaceID: ref.workspaceID,
        }))
      )
        return HttpServerResponse.empty({ status: 403 })

      yield* guard(ref)
      return yield* Effect.gen(function* () {
        const mcp = yield* Mcp.Service
        const { McpSocketClient } = yield* Effect.promise(() => import("@opencode/core/mcp/socket-client"))
        const socket = yield* Effect.orDie(request.upgrade)
        const outbox = yield* Queue.unbounded<Outbound>()
        yield* holdLocation(outbox)
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
        yield* mcp.attach(name, transport, owner).pipe(
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
    })

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
      .handle("mcp.clientToken", (ctx) => token(ctx.request, ctx.query.name, undefined, () => Effect.void))
      .handle("session.clientMcp.token", (ctx) =>
        token(ctx.request, ctx.query.name, ctx.params.sessionID, owned(ctx.params.sessionID)),
      )
      .handleRaw("mcp.client", (ctx) => socket(ctx.request, ctx.query, undefined, () => Effect.void))
      .handleRaw("session.clientMcp", (ctx) =>
        socket(ctx.request, ctx.query, ctx.params.sessionID, owned(ctx.params.sessionID)),
      )
  }),
)
