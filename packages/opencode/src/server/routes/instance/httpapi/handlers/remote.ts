import { Workspace } from "@/control-plane/workspace"
import { WorkspaceAdapterRuntime } from "@/control-plane/workspace-adapter-runtime"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { RemoteAccess } from "@/remote/access"
import { RemoteEvent } from "@/remote/event"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { EventV2 } from "@opencode-ai/core/event"
import { Cause, Effect, Queue, Scope } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError, HttpApiSchema } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { RemoteAdminApi, RemoteApi, RemotePairApi } from "../groups/remote"
import * as SessionError from "./session-errors"

function eventData(data: unknown): Sse.Event {
  return { _tag: "Event", event: "message", id: undefined, data: JSON.stringify(data) }
}

function eventID() {
  return EventV2.ID.create()
}

function bearer(request: HttpServerRequest.HttpServerRequest) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? "")
  return match?.[1]
}

function remoteEventResponse(events: EventV2.Interface, sessionID: string) {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const token = bearer(request)
    const queue = yield* Queue.sliding<ReturnType<typeof RemoteEvent.signal>>(64)
    const unsubscribe = yield* events.listen((event) =>
      Effect.sync(() => {
        if (!RemoteEvent.shouldForward(event, sessionID)) return
        Queue.offerUnsafe(queue, RemoteEvent.signal(event))
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe)

    const output = Stream.fromQueue(queue)
    const heartbeat = Stream.tick("10 seconds").pipe(
      Stream.drop(1),
      Stream.map(() => ({ id: eventID(), type: "server.heartbeat", properties: {} })),
    )

    return HttpServerResponse.stream(
      Stream.make({ id: eventID(), type: "server.connected", properties: { sessionID } }).pipe(
        Stream.concat(output.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }))),
        Stream.takeWhile(() => !!token && RemoteAccess.authorized(token, sessionID)),
        Stream.map(eventData),
        Stream.pipeThroughChannel(Sse.encode()),
        Stream.encodeText,
      ),
      {
        contentType: "text/event-stream",
        headers: {
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
          "X-Content-Type-Options": "nosniff",
        },
      },
    )
  })
}

export const remoteAdminHandlers = HttpApiBuilder.group(RemoteAdminApi, "remote-admin", (handlers) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const workspaces = yield* Workspace.Service
    const requireSession = (sessionID: Parameters<typeof RemoteAccess.pair>[0]) =>
      SessionError.mapStorageNotFound(sessions.get(sessionID))
    const requireLocalSession = (sessionID: Parameters<typeof RemoteAccess.pair>[0]) =>
      Effect.gen(function* () {
        const session = yield* requireSession(sessionID)
        if (!session.workspaceID) return session
        const workspace = yield* workspaces.get(session.workspaceID)
        if (!workspace) return yield* new HttpApiError.BadRequest({})
        const target = yield* WorkspaceAdapterRuntime.target(workspace)
        if (target.type !== "local") return yield* new HttpApiError.BadRequest({})
        return session
      })

    return handlers
      .handle("pair", (ctx) =>
        Effect.gen(function* () {
          yield* requireLocalSession(ctx.params.sessionID)
          return RemoteAccess.pair(ctx.params.sessionID)
        }),
      )
      .handle("revoke", (ctx) =>
        Effect.sync(() => {
          RemoteAccess.revoke(ctx.params.sessionID)
          return true
        }),
      )
  }),
)

export const remotePairHandlers = HttpApiBuilder.group(RemotePairApi, "remote-pair", (handlers) =>
  Effect.succeed(
    handlers.handle("redeem", (ctx) => {
      const grant = RemoteAccess.redeem(ctx.payload.ticket)
      return grant ? Effect.succeed(grant) : Effect.fail(new HttpApiError.Forbidden({}))
    }),
  ),
)

export const remoteHandlers = HttpApiBuilder.group(RemoteApi, "remote", (handlers) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const status = yield* SessionStatus.Service
    const permission = yield* Permission.Service
    const question = yield* Question.Service
    const events = yield* EventV2Bridge.Service
    const scope = yield* Scope.Scope

    const unsubscribeDeleted = yield* events.listen((event) =>
      Effect.sync(() => {
        if (event.type !== "session.deleted") return
        const sessionID = (event.data as { sessionID?: unknown }).sessionID
        if (typeof sessionID !== "string") return
        RemoteAccess.revoke(sessionID as Parameters<typeof RemoteAccess.revoke>[0])
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribeDeleted)

    const requireSession = (sessionID: Parameters<typeof RemoteAccess.revoke>[0]) =>
      SessionError.mapStorageNotFound(sessions.get(sessionID))

    return handlers
      .handle("bootstrap", (ctx) =>
        Effect.gen(function* () {
          const session = yield* requireSession(ctx.params.sessionID)
          const messages = yield* SessionError.mapStorageNotFound(sessions.messages({ sessionID: ctx.params.sessionID }))
          const currentStatus = yield* status.get(ctx.params.sessionID)
          const pendingPermissions = (yield* permission.list()).filter((item) => item.sessionID === ctx.params.sessionID)
          const pendingQuestions = (yield* question.list()).filter((item) => item.sessionID === ctx.params.sessionID)
          return {
            session: { title: session.title },
            messages: messages.map((message) => ({
              info: { role: message.info.role },
              parts: message.parts.flatMap((part) => {
                if (part.type === "text" && !part.synthetic && !part.ignored) {
                  return [{ type: "text" as const, text: part.text }]
                }
                if (part.type === "tool") {
                  return [{ type: "tool" as const, tool: part.tool, state: { status: part.state.status } }]
                }
                return []
              }),
            })),
            status: { type: currentStatus.type },
            permissions: pendingPermissions.map((item) => ({
              id: item.id,
              permission: item.permission,
              patterns: item.patterns,
            })),
            questions: pendingQuestions.map((item) => ({ id: item.id, questions: item.questions })),
          }
        }),
      )
      .handleRaw("events", (ctx) => remoteEventResponse(events, ctx.params.sessionID))
      .handle("message", (ctx) =>
        Effect.gen(function* () {
          const session = yield* requireSession(ctx.params.sessionID)
          const parts = ctx.payload.parts.map((part) => ({ type: "text" as const, text: part.text }))
          const model = session.model
            ? { providerID: session.model.providerID, modelID: session.model.id }
            : undefined
          yield* prompt
            .prompt({
              sessionID: ctx.params.sessionID,
              parts,
              agent: session.agent,
              model,
              variant: session.model?.variant,
            })
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logError("remote prompt failed", { sessionID: ctx.params.sessionID, cause: Cause.pretty(cause) }),
              ),
              Effect.forkIn(scope, { startImmediately: true }),
            )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle("abort", (ctx) => prompt.cancel(ctx.params.sessionID).pipe(Effect.as(true)))
      .handle("permission", (ctx) =>
        Effect.gen(function* () {
          const request = (yield* permission.list()).find((item) => item.id === ctx.params.requestID)
          if (!request || request.sessionID !== ctx.params.sessionID) return yield* new HttpApiError.BadRequest({})
          yield* permission
            .reply({ requestID: ctx.params.requestID, reply: ctx.payload.reply, message: ctx.payload.message })
            .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
          return true
        }),
      )
      .handle("question", (ctx) =>
        Effect.gen(function* () {
          const request = (yield* question.list()).find((item) => item.id === ctx.params.requestID)
          if (!request || request.sessionID !== ctx.params.sessionID) return yield* new HttpApiError.BadRequest({})
          yield* question
            .reply({ requestID: ctx.params.requestID, answers: ctx.payload.answers })
            .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
          return true
        }),
      )
      .handle("questionReject", (ctx) =>
        Effect.gen(function* () {
          const request = (yield* question.list()).find((item) => item.id === ctx.params.requestID)
          if (!request || request.sessionID !== ctx.params.sessionID) return yield* new HttpApiError.BadRequest({})
          yield* question.reject(ctx.params.requestID).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
          return true
        }),
      )
  }),
)
