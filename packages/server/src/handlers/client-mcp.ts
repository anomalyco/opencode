import { Bus } from "@opencode/core/bus"
import { SessionEvent } from "@opencode/schema/session-event"
import { Instance } from "@opencode/core/instance/service"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Mcp } from "@opencode/core/mcp/index"
import { Session } from "@opencode/core/session"
import { PtyTicket } from "@opencode/core/pty/ticket"
import { ForbiddenError, SessionNotFoundError } from "@opencode/protocol/errors"
import { PTY_CONNECT_TOKEN_HEADER, PTY_CONNECT_TOKEN_HEADER_VALUE } from "@opencode/protocol/groups/pty"
import { Effect, Queue, Stream } from "effect"
import { type HttpServerRequest, HttpServerResponse } from "effect/http"
import { Socket } from "effect/socket"
import { CorsConfig, isAllowedRequestOrigin } from "../cors"
import { locationErrors, requestDirectory, requestRef, response } from "../location"
import { missingSession } from "./session-error"
import { holdLocation, type Outbound, runPtySocket } from "./pty-socket"

export const clientMcp = Effect.gen(function* () {
  const bus = yield* Bus.Service
  const locations = yield* LocationServiceMap.Service
  const cors = yield* CorsConfig
  const tickets = yield* PtyTicket.Service

  const instances = yield* Instance.Service
  const sessions = yield* Session.Service
  const owned = Effect.fnUntraced(function* (sessionID: Session.ID, request: HttpServerRequest.HttpServerRequest) {
    const session = yield* sessions.get(sessionID).pipe(Effect.catchTag("Session.NotFoundError", missingSession))
    if (
      requestDirectory(request) &&
      session.location.directory !== LocationServiceMap.canonical(requestRef(request)).directory
    )
      return yield* new SessionNotFoundError({ sessionID, message: `Session not found at this location: ${sessionID}` })
    return session
  })
  const token = Effect.fnUntraced(function* (
    request: HttpServerRequest.HttpServerRequest,
    name: string,
    owner: Session.ID | undefined,
  ) {
    // The custom header forces a CORS preflight, so cross-origin pages cannot mint tickets.
    if (
      request.headers[PTY_CONNECT_TOKEN_HEADER] !== PTY_CONNECT_TOKEN_HEADER_VALUE ||
      !isAllowedRequestOrigin(request.headers.origin, request.headers.host, cors)
    )
      return yield* new ForbiddenError({ message: "Invalid client MCP connect token request" })
    const location = yield* Location.Service
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
    resolve: Effect.Effect<Session.Info | undefined, E>,
  ) {
    if (!isAllowedRequestOrigin(request.headers.origin, request.headers.host, cors))
      return HttpServerResponse.empty({ status: 403 })

    const outbox = yield* Queue.unbounded<Outbound>()
    // Subscribe before looking up placement: a move or deletion during the handshake must close this socket too.
    if (owner)
      yield* bus.subscribe([SessionEvent.Moved, SessionEvent.Deleted]).pipe(
        Stream.filter((event) => event.data.sessionID === owner),
        Stream.take(1),
        Stream.runForEach(() => Queue.offer(outbox, new Socket.CloseEvent(1000, "session moved or deleted"))),
        Effect.forkScoped({ startImmediately: true }),
      )
    const session = yield* resolve
    const ref = session?.location ?? LocationServiceMap.canonical(requestRef(request))
    if (
      ticket &&
      !(yield* tickets.consume({
        ticket,
        mcpClient: name,
        sessionID: owner,
        directory: ref.directory,
        workspaceID: ref.workspaceID,
      }))
    )
      return HttpServerResponse.empty({ status: 403 })

    const upgrade = Effect.gen(function* () {
      const mcp = yield* Mcp.Service
      const { McpSocketClient } = yield* Effect.promise(() => import("@opencode/core/mcp/socket-client"))
      const socket = yield* Effect.orDie(request.upgrade)
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
    }).pipe(Effect.scoped)
    return yield* (
      session ? upgrade.pipe(instances.provide(session)) : upgrade.pipe(Effect.provide(locations.get(ref)))
    ).pipe(locationErrors)
  }, Effect.scoped)
  return {
    token,
    socket,
    sessionToken: Effect.fnUntraced(function* (
      request: HttpServerRequest.HttpServerRequest,
      name: string,
      owner: Session.ID,
    ) {
      const session = yield* owned(owner, request)
      return yield* token(request, name, owner).pipe(instances.provide(session), locationErrors)
    }),
    sessionSocket: (
      request: HttpServerRequest.HttpServerRequest,
      query: { name: string; ticket?: string },
      owner: Session.ID,
    ) =>
      socket(request, query, owner, owned(owner, request)).pipe(
        Effect.catchTag("SessionNotFoundError", (error) =>
          query.ticket ? Effect.succeed(HttpServerResponse.empty({ status: 403 })) : Effect.fail(error),
        ),
      ),
  }
})
