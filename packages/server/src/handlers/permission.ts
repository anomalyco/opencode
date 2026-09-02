import { Location } from "@opencode-ai/core/location"
import { Permission } from "@opencode-ai/core/permission"
import { PermissionLedger } from "@opencode-ai/core/permission/ledger"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { Workspace } from "@opencode-ai/core/workspace"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { PermissionNotFoundError } from "@opencode-ai/protocol/errors"
import { sessionInfo } from "../location"
import { missingSession } from "./session-error"

function missingRequest(id: Permission.ID) {
  return new PermissionNotFoundError({ requestID: id, message: `Permission request not found: ${id}` })
}

export const PermissionHandler = HttpApiBuilder.group(Api, "server.permission", (handlers) =>
  Effect.gen(function* () {
    const ledger = yield* PermissionLedger.Service
    const sessions = yield* Session.Service
    // Pending requests live in the host-wide ledger, so Session routes never boot the Session's instance.
    const requireOwnedRequest = Effect.fnUntraced(function* (
      sessionID: Permission.Request["sessionID"],
      requestID: Permission.ID,
    ) {
      yield* sessionInfo(sessions, sessionID)
      const request = yield* ledger.get(requestID)
      if (!request || request.sessionID !== sessionID) return yield* missingRequest(requestID)
      return request
    })

    return handlers
      .handle(
        "permission.request.list",
        Effect.fn(function* (ctx) {
          const directory = ctx.query.location?.directory
          const location = directory
            ? Location.Ref.make({
                directory: AbsolutePath.make(directory),
                workspaceID: ctx.query.location?.workspace
                  ? Workspace.ID.make(ctx.query.location.workspace)
                  : undefined,
              })
            : undefined
          return { data: yield* ledger.list(location) }
        }),
      )
      .handle(
        "session.permission.create",
        Effect.fn(function* (ctx) {
          const permission = yield* Permission.Service
          return {
            data: yield* permission
              .ask({
                id: ctx.payload.id,
                sessionID: ctx.params.sessionID,
                action: ctx.payload.action,
                resources: ctx.payload.resources,
                save: ctx.payload.save,
                metadata: ctx.payload.metadata,
                source: ctx.payload.source,
                agent: ctx.payload.agent,
              })
              .pipe(Effect.catchTag("Session.NotFoundError", missingSession)),
          }
        }),
      )
      .handle(
        "session.permission.list",
        Effect.fn(function* (ctx) {
          yield* sessionInfo(sessions, ctx.params.sessionID)
          return { data: yield* ledger.forSession(ctx.params.sessionID) }
        }),
      )
      .handle(
        "session.permission.get",
        Effect.fn(function* (ctx) {
          return { data: yield* requireOwnedRequest(ctx.params.sessionID, ctx.params.requestID) }
        }),
      )
      .handle(
        "session.permission.reply",
        Effect.fn(function* (ctx) {
          yield* requireOwnedRequest(ctx.params.sessionID, ctx.params.requestID)
          yield* ledger
            .reply({ requestID: ctx.params.requestID, reply: ctx.payload.reply, message: ctx.payload.message })
            .pipe(Effect.catchTag("Permission.NotFoundError", () => missingRequest(ctx.params.requestID)))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "permission.saved.list",
        Effect.fn(function* (ctx) {
          const location = yield* Location.Service
          const saved = yield* PermissionSaved.Service
          return {
            data: yield* saved.list({
              projectID: ctx.query.projectID ?? location.project.id,
            }),
          }
        }),
      )
      .handle(
        "permission.saved.remove",
        Effect.fn(function* (ctx) {
          const saved = yield* PermissionSaved.Service
          yield* saved.remove(ctx.params.id)
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
